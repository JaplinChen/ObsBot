/**
 * Unified transcript service — FFmpeg audio extraction + whisper.cpp STT.
 * Shared by all video extractors as fallback when platform subtitles are unavailable.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { rm, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);

const WHISPER_MODEL = join(process.cwd(), 'models', 'ggml-small.bin');
const AUDIO_TIMEOUT = 30_000;
const WHISPER_TIMEOUT = 180_000;
const WHISPER_MAX_BUFFER = 5 * 1024 * 1024;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TimedTranscript {
  segments: TranscriptSegment[];
  fullText: string;
}

/** Extract audio from video as 16kHz mono WAV (optimal Whisper input) */
export async function extractAudio(videoPath: string, outputDir: string): Promise<string | null> {
  const audioPath = join(outputDir, 'audio.wav');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', videoPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioPath,
    ], { timeout: AUDIO_TIMEOUT });
    return audioPath;
  } catch {
    logger.warn('transcript', 'ffmpeg audio extraction failed');
    return null;
  }
}

/** Run whisper.cpp on audio file with timestamps, return segments */
export async function whisperTranscribe(audioPath: string): Promise<TranscriptSegment[] | null> {
  for (const cmd of ['whisper-cli', 'whisper']) {
    try {
      const { stdout } = await execFileAsync(cmd, [
        '-m', WHISPER_MODEL,
        '-l', 'zh', '-f', audioPath,
      ], { timeout: WHISPER_TIMEOUT, maxBuffer: WHISPER_MAX_BUFFER });

      return parseWhisperOutput(stdout);
    } catch { continue; }
  }
  logger.warn('transcript', 'whisper.cpp not available; skipping STT');
  return null;
}

/** Parse whisper.cpp default output format: [HH:MM:SS.mmm --> HH:MM:SS.mmm]  text */
function parseWhisperOutput(stdout: string): TranscriptSegment[] | null {
  const segments: TranscriptSegment[] = [];
  const lines = stdout.split('\n');

  for (const line of lines) {
    const match = line.match(
      /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.+)/,
    );
    if (!match) continue;
    const text = match[3].trim();
    if (!text) continue;
    segments.push({
      start: parseTimestamp(match[1]),
      end: parseTimestamp(match[2]),
      text,
    });
  }

  return segments.length > 0 ? segments : null;
}

/** Parse HH:MM:SS.mmm to seconds */
function parseTimestamp(ts: string): number {
  const [h, m, rest] = ts.split(':');
  const [s, ms] = rest.split('.');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

/**
 * Full pipeline: extract audio → whisper transcribe → clean up audio.
 * Returns timed transcript with segments and concatenated full text.
 */
export async function getTimedTranscript(
  videoPath: string, tmpDir: string,
): Promise<TimedTranscript | null> {
  const audioPath = await extractAudio(videoPath, tmpDir);
  if (!audioPath) return null;

  try {
    const segments = await whisperTranscribe(audioPath);
    if (!segments) return null;

    const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return fullText.length >= 50 ? { segments, fullText } : null;
  } finally {
    await rm(audioPath, { force: true }).catch(() => {});
  }
}

/**
 * Get plain text transcript (no timestamps).
 * Convenience wrapper for extractors that only need flat text.
 */
export async function getPlainTranscript(
  videoPath: string, tmpDir: string,
): Promise<string | null> {
  const result = await getTimedTranscript(videoPath, tmpDir);
  return result?.fullText ?? null;
}

/**
 * Fetch YouTube subtitles via yt-dlp (no video download).
 * Tries auto-generated subtitles in zh-Hant/zh-TW/zh/en order.
 * Returns cleaned transcript text or null if unavailable.
 */
export async function fetchYouTubeTranscript(url: string): Promise<string | null> {
  const id = randomBytes(4).toString('hex');
  const dir = join(tmpdir(), `knowpipe-subs-${id}`);
  await mkdir(dir, { recursive: true });
  try {
    await execFileAsync('yt-dlp', [
      '--skip-download', '--write-auto-sub', '--sub-lang', 'zh-Hant,zh-TW,zh,en',
      '--convert-subs', 'srt', '-o', join(dir, 'subs'), '--no-playlist', '--no-warnings', url,
    ], { timeout: 30_000 });
    const files = await readdir(dir);
    const srt = files.find(f => f.startsWith('subs.') && f.endsWith('.srt'));
    if (!srt) return null;
    const text = (await readFile(join(dir, srt), 'utf-8'))
      .split(/\r?\n/)
      .filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->'))
      .map(l => l.replace(/<[^>]+>/g, '').trim())
      .filter((l, i, a) => l && (i === 0 || l !== a[i - 1]))
      .join(' ').replace(/\s+/g, ' ').trim();
    return text.length >= 50 ? text : null;
  } catch {
    return null;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Format seconds as HH:MM:SS */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
