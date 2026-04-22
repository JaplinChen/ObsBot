/**
 * Direct Video URL Extractor
 * Handles raw media file URLs (.mp4, .webm, .mov, etc.) — typically from
 * Twitter video CDN (video.twimg.com) or other direct file links.
 *
 * Pipeline: download → Whisper STT → AI enrichment (via existing pipeline).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import type { Extractor, ExtractedContent } from './types.js';
import { getTimedTranscript } from '../utils/transcript-service.js';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);

const MEDIA_EXT_RE = /\.(mp4|webm|mov|mkv|m4v|avi)(\?|$)/i;
const DOWNLOAD_TIMEOUT = 300_000; // 5 minutes

/** Extract a human-readable title from a media URL */
function titleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = basename(pathname, extname(pathname));
    // Clean up encoded chars and truncate
    return decodeURIComponent(name).replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Direct Video';
  } catch {
    return 'Direct Video';
  }
}

/** Derive a domain-based author from the URL */
function authorFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export const directVideoExtractor: Extractor = {
  platform: 'web',

  match(url: string): boolean {
    return MEDIA_EXT_RE.test(url);
  },

  parseId(url: string): string | null {
    try {
      const pathname = new URL(url).pathname;
      return basename(pathname, extname(pathname)).slice(0, 60) || null;
    } catch {
      return null;
    }
  },

  async extract(url: string): Promise<ExtractedContent> {
    const id = this.parseId(url) ?? 'video';
    const tmpDir = join(tmpdir(), `knowpipe-dv-${id}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const videoPath = join(tmpDir, `video.mp4`);

    // Step 1: Download video — direct file URLs don't support format selection
    logger.info('direct-video', 'downloading', { url: url.slice(0, 120) });
    try {
      await execFileAsync('curl', [
        '-fSL', '--max-time', '120',
        '-o', videoPath, url,
      ], { maxBuffer: 10 * 1024 * 1024, timeout: DOWNLOAD_TIMEOUT });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`影片下載失敗：${msg.slice(0, 200)}`);
    }

    // Verify download succeeded
    try {
      const s = await stat(videoPath);
      if (s.size < 1024) throw new Error('檔案過小');
    } catch {
      throw new Error(`影片下載失敗：檔案不存在或過小`);
    }

    // Step 2: Whisper STT → timed transcript
    logger.info('direct-video', 'transcribing audio');
    const timedResult = await getTimedTranscript(videoPath, tmpDir);

    const transcript = timedResult?.fullText ?? '';
    const timedTranscript = timedResult?.segments;

    const title = titleFromUrl(url);
    const author = authorFromUrl(url);

    return {
      platform: 'web',
      author,
      authorHandle: author,
      title,
      text: transcript || '[影片內容 — 無法辨識語音]',
      images: [],
      videos: [{ url, localPath: videoPath }],
      date: new Date().toISOString().split('T')[0],
      url,
      transcript: transcript || undefined,
      timedTranscript,
      tempDir: tmpDir,
    };
  },
};
