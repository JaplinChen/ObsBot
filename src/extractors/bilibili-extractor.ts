import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import type { ExtractedContent, Extractor, ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { getTimedTranscript } from '../utils/transcript-service.js';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);

const BV_PATTERN = /bilibili\.com\/video\/(BV[\w]+)/i;
const B23_PATTERN = /b23\.tv\/([\w]+)/i;

interface YtDlpOutput {
  id: string;
  title: string;
  description?: string;
  uploader?: string;
  uploader_id?: string;
  upload_date?: string;
  thumbnail?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  webpage_url: string;
  chapters?: Array<{ start_time: number; end_time: number; title: string }>;
}

function parseBvid(url: string): string | null {
  return url.match(BV_PATTERN)?.[1] ?? null;
}

function formatDate(uploadDate?: string): string {
  if (!uploadDate || uploadDate.length !== 8) return new Date().toISOString().split('T')[0];
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

function buildText(meta: YtDlpOutput): string {
  const duration = meta.duration ?? 0;
  const durationStr = duration > 0
    ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
    : 'n/a';

  const stats = [
    `Views: ${(meta.view_count ?? 0).toLocaleString()}`,
    `Likes: ${(meta.like_count ?? 0).toLocaleString()}`,
    `Comments: ${(meta.comment_count ?? 0).toLocaleString()}`,
    `Duration: ${durationStr}`,
  ].join(' | ');

  return [stats, '', meta.description?.slice(0, 3000) || '[No description]'].join('\n');
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
    let resolvedUrl = url;
    if (B23_PATTERN.test(url) && !BV_PATTERN.test(url)) {
      const r = await fetchWithTimeout(url, 15_000, { redirect: 'follow' });
      resolvedUrl = r.url;
    }

    const bvid = parseBvid(resolvedUrl);
    if (!bvid) throw new Error(`Invalid Bilibili URL: ${url}`);

    let data: YtDlpOutput;
    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--dump-json', '--no-playlist', '--no-warnings', resolvedUrl,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
      data = JSON.parse(stdout) as YtDlpOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) throw new Error('yt-dlp is not installed');
      throw new Error(`Bilibili extraction failed: ${msg.slice(0, 200)}`);
    }

    // Try fetching subtitles via yt-dlp
    let transcript: string | undefined;
    let timedTranscript: ExtractedContent['timedTranscript'];
    const tmpDir = join(tmpdir(), `obsbot-bili-${data.id}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      // Attempt subtitle download
      await execFileAsync('yt-dlp', [
        '--skip-download', '--write-auto-sub', '--sub-lang', 'zh-Hans,zh-Hant,zh,en',
        '--convert-subs', 'srt', '-o', join(tmpDir, 'subs'),
        '--no-playlist', '--no-warnings', resolvedUrl,
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

      // Whisper fallback: download video temporarily for STT
      if (!transcript) {
        logger.info('bilibili', 'no subtitles, trying whisper STT');
        const videoPath = join(tmpDir, 'video.mp4');
        try {
          await execFileAsync('yt-dlp', [
            '-f', 'best[ext=mp4]/best', '-o', videoPath,
            '--no-playlist', '--no-warnings', resolvedUrl,
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

    // Map native chapters
    const { formatTimestamp } = await import('../utils/transcript-service.js');
    const chapters = data.chapters?.length
      ? data.chapters.map(ch => ({
          startTime: formatTimestamp(ch.start_time),
          endTime: formatTimestamp(ch.end_time),
          title: ch.title,
        }))
      : undefined;

    return {
      platform: 'bilibili',
      author: data.uploader ?? 'Unknown',
      authorHandle: data.uploader_id ? `uid:${data.uploader_id}` : (data.uploader ?? 'Unknown'),
      title: data.title,
      text: buildText(data),
      images: data.thumbnail ? [data.thumbnail] : [],
      videos: [{ url: data.webpage_url ?? resolvedUrl, thumbnailUrl: data.thumbnail, type: 'video' }],
      date: formatDate(data.upload_date),
      url,
      likes: data.like_count,
      commentCount: data.comment_count,
      transcript,
      timedTranscript,
      chapters,
    };
  },

  async extractComments(_url: string, _limit = 20): Promise<ThreadComment[]> {
    // Keep extractor API-free: comments are not fetched via Bilibili API.
    return [];
  },
};
