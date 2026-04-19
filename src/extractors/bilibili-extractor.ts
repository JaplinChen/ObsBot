import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import type { ExtractedContent, Extractor, ThreadComment } from './types.js';
import { fetchWithTimeout, retry } from '../utils/fetch-with-timeout.js';
import { getTimedTranscript } from '../utils/transcript-service.js';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);

const BV_PATTERN = /bilibili\.com\/video\/(BV[\w]+)/i;
const B23_PATTERN = /b23\.tv\/([\w]+)/i;

/** Bilibili API /x/web-interface/view response shape (fields we use) */
interface BiliViewData {
  bvid: string;
  aid: number;
  title: string;
  desc: string;
  owner: { mid: number; name: string };
  pubdate: number;
  pic: string;
  duration: number;
  stat: {
    view: number;
    danmaku: number;
    like: number;
    reply: number;
    favorite: number;
    coin: number;
    share: number;
  };
  pages?: Array<{ part: string; duration: number }>;
  ugc_season?: { sections?: Array<{ episodes?: Array<{ title: string; arc?: { pic?: string } }> }> };
}

function parseBvid(url: string): string | null {
  return url.match(BV_PATTERN)?.[1] ?? null;
}

function formatUnixDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().split('T')[0];
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'n/a';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildText(data: BiliViewData): string {
  const stats = [
    `Views: ${data.stat.view.toLocaleString()}`,
    `Likes: ${data.stat.like.toLocaleString()}`,
    `Comments: ${data.stat.reply.toLocaleString()}`,
    `Duration: ${formatDuration(data.duration)}`,
  ].join(' | ');

  return [stats, '', data.desc?.slice(0, 3000) || '[No description]'].join('\n');
}

/** Fetch video metadata from Bilibili public API (no login required) */
async function fetchBiliMeta(bvid: string): Promise<BiliViewData> {
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  const res = await retry(async () => {
    const r = await fetchWithTimeout(apiUrl, 15_000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });
    if (!r.ok) throw new Error(`Bilibili API HTTP ${r.status}`);
    return r;
  }, 3, 1000);

  const json = await res.json() as { code: number; message: string; data: BiliViewData };
  if (json.code !== 0) throw new Error(`Bilibili API error: ${json.message} (code=${json.code})`);
  return json.data;
}

export const bilibiliExtractor: Extractor & {
  extractComments(url: string, limit?: number): Promise<ThreadComment[]>;
} = {
  platform: 'bilibili',

  match(url: string): boolean {
    return BV_PATTERN.test(url) || B23_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return parseBvid(url) ?? url.match(B23_PATTERN)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    // Resolve b23.tv short links
    let resolvedUrl = url;
    if (B23_PATTERN.test(url) && !BV_PATTERN.test(url)) {
      const r = await fetchWithTimeout(url, 15_000, { redirect: 'follow' });
      resolvedUrl = r.url;
    }

    const bvid = parseBvid(resolvedUrl);
    if (!bvid) throw new Error(`Invalid Bilibili URL: ${url}`);

    // Fetch metadata via public API (replaces yt-dlp --dump-json)
    const data = await fetchBiliMeta(bvid);
    const videoUrl = `https://www.bilibili.com/video/${bvid}`;

    // Subtitles & STT
    let transcript: string | undefined;
    let timedTranscript: ExtractedContent['timedTranscript'];
    const tmpDir = join(tmpdir(), `knowpipe-bili-${bvid}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      // yt-dlp still used for subtitle download only
      await execFileAsync('yt-dlp', [
        '--skip-download', '--write-auto-sub', '--sub-lang', 'zh-Hans,zh-Hant,zh,en',
        '--convert-subs', 'srt', '-o', join(tmpDir, 'subs'),
        '--no-playlist', '--no-warnings', videoUrl,
      ], { timeout: 30_000 }).catch(() => {});

      const files = await readdir(tmpDir);
      const srt = files.find(f => f.startsWith('subs.') && f.endsWith('.srt'));
      if (srt) {
        const text = (await readFile(join(tmpDir, srt), 'utf-8'))
          .split(/\r?\n/)
          .filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->'))
          .map(l => l.replace(/<[^>]+>/g, '').trim())
          .filter((l, i, a) => l && (i === 0 || l !== a[i - 1]))
          .join(' ').replace(/\s+/g, ' ').trim();
        if (text.length >= 50) transcript = text;
      }

      // Whisper fallback
      if (!transcript) {
        logger.info('bilibili', 'no subtitles, trying whisper STT');
        const videoPath = join(tmpDir, 'video.mp4');
        try {
          await execFileAsync('yt-dlp', [
            '-f', 'best[ext=mp4]/best', '-o', videoPath,
            '--no-playlist', '--no-warnings', videoUrl,
          ], { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 });
          const result = await getTimedTranscript(videoPath, tmpDir);
          if (result) {
            transcript = result.fullText;
            timedTranscript = result.segments;
          }
        } catch (err) {
          logger.warn('bilibili', 'video download for STT failed', {
            message: (err as Error).message?.slice(0, 200),
          });
        }
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    return {
      platform: 'bilibili',
      author: data.owner.name,
      authorHandle: `uid:${data.owner.mid}`,
      title: data.title,
      text: buildText(data),
      images: data.pic ? [data.pic] : [],
      videos: [{ url: videoUrl, thumbnailUrl: data.pic, type: 'video' }],
      date: formatUnixDate(data.pubdate),
      url,
      likes: data.stat.like,
      commentCount: data.stat.reply,
      transcript,
      timedTranscript,
    };
  },

  async extractComments(_url: string, _limit = 20): Promise<ThreadComment[]> {
    return [];
  },
};
