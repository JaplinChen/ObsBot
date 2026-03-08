import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExtractedContent, Extractor, ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

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
    };
  },

  async extractComments(_url: string, _limit = 20): Promise<ThreadComment[]> {
    // Keep extractor API-free: comments are not fetched via Bilibili API.
    return [];
  },
};
