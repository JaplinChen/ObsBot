/** YouTube playlist extraction — separated from single video for file size compliance. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, access } from 'node:fs/promises';
import { logger } from '../core/logger.js';
import type { ExtractedContent, VideoInfo } from './types.js';

const execFileAsync = promisify(execFile);

interface YtDlpPlaylistEntry {
  id: string;
  title: string;
  url: string;
  webpage_url?: string;
  duration?: number;
  duration_string?: string;
  view_count?: number;
  thumbnail?: string;
  description?: string;
  upload_date?: string;
}

interface YtDlpPlaylistOutput {
  title: string;
  uploader?: string;
  channel?: string;
  description?: string;
  webpage_url: string;
  entries: YtDlpPlaylistEntry[];
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Clean video description: remove promo links, timestamps, social media spam */
function cleanDescription(desc?: string): string {
  if (!desc) return '';
  const lines = desc.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return false;
    if (/^👉|^🔗|^📌|^▶/.test(t)) return false;
    if (/facebook\.com|instagram\.com|substack\.com|twitter\.com|x\.com|linktr\.ee/i.test(t)) return false;
    if (/訂閱|subscribe|追蹤|follow/i.test(t)) return false;
    if (/^\d{1,2}:\d{2}/.test(t)) return false;
    if (/^[-=_]{3,}$/.test(t)) return false;
    return true;
  });
  const cleaned = lines.join('\n').trim();
  return cleaned.length > 500 ? cleaned.slice(0, 500) + '...' : cleaned;
}

function buildPlaylistText(data: YtDlpPlaylistOutput): string {
  const lines: string[] = [];
  lines.push(`**影片數量：** ${data.entries.length}`);
  lines.push('');

  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    const dur = e.duration_string ?? formatDuration(e.duration);
    const durStr = dur ? ` (${dur})` : '';

    lines.push(`### ${i + 1}. ${e.title}${durStr}`, '');
    lines.push(`{{VIDEO:${i}}}`, '');
    const summary = cleanDescription(e.description);
    if (summary) lines.push(summary, '');
  }

  return lines.join('\n');
}

export async function extractPlaylist(url: string): Promise<ExtractedContent> {
  let stdout: string;
  try {
    const result = await execFileAsync('yt-dlp', [
      '--dump-single-json', '--no-warnings', url,
    ], { maxBuffer: 50 * 1024 * 1024, timeout: 300_000 });
    stdout = result.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        'yt-dlp is not installed. Install it from https://github.com/yt-dlp/yt-dlp#installation',
      );
    }
    throw new Error(`yt-dlp failed: ${msg}`);
  }

  const data = JSON.parse(stdout) as YtDlpPlaylistOutput;
  const uploader = data.channel ?? data.uploader ?? 'Unknown';

  const tmpDir = join(tmpdir(), `obsbot-yt-pl-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const videos: VideoInfo[] = [];
  try {
    await execFileAsync('yt-dlp', [
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      '--merge-output-format', 'mp4',
      '-o', join(tmpDir, '%(playlist_index)s.mp4'),
      '--no-warnings', url,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 600_000 });

    for (let i = 0; i < data.entries.length; i++) {
      const videoFile = join(tmpDir, `${i + 1}.mp4`);
      try {
        await access(videoFile);
        videos.push({
          url: data.entries[i].webpage_url ?? data.entries[i].url,
          type: 'video' as const,
          localPath: videoFile,
        });
      } catch { /* file not downloaded */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('youtube', 'playlist video download failed', { message: msg.slice(0, 200) });
  }

  return {
    platform: 'youtube',
    author: uploader,
    authorHandle: uploader,
    title: data.title,
    text: buildPlaylistText(data),
    images: [],
    videos,
    date: new Date().toISOString().split('T')[0],
    url,
    tempDir: videos.length > 0 ? tmpDir : undefined,
  };
}
