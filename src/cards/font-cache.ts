/**
 * Local font cache for card rendering.
 * Downloads Noto Sans TC from Google Fonts once, caches woff2 files locally.
 * Replaces external URLs with file:// paths to eliminate network dependency.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../core/logger.js';

const CACHE_DIR = join(homedir(), '.cache', 'knowpipe', 'fonts');
const FACE_CSS_PATH = join(CACHE_DIR, 'noto-sans-tc.fontface.css');

// Google Fonts API returns woff2 URLs; use a modern UA to get woff2 format
const FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=block';

let cache: string | null = null;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchText(url: string, ua?: string): Promise<string> {
  const res = await fetch(url, {
    headers: ua ? { 'User-Agent': ua } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Build @font-face CSS with local file:// URLs, downloading woff2 files as needed. */
async function buildLocalFontCSS(): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });

  // Fetch font CSS — use a modern Chrome UA so Google returns woff2 format
  const ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const css = await fetchText(FONTS_CSS_URL, ua);

  // Find all woff2 URLs and download them
  const urlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g;
  let localCss = css;
  let idx = 0;

  for (const match of css.matchAll(urlRegex)) {
    const remoteUrl = match[1];
    const filename = `noto-tc-${idx++}.woff2`;
    const localPath = join(CACHE_DIR, filename);

    if (!(await fileExists(localPath))) {
      const data = await fetchBinary(remoteUrl);
      await writeFile(localPath, data);
    }

    localCss = localCss.replace(remoteUrl, `file://${localPath}`);
  }

  await writeFile(FACE_CSS_PATH, localCss, 'utf-8');
  logger.info('card', `Noto Sans TC 字型快取完成（${idx} 個檔案）`, { dir: CACHE_DIR });
  return localCss;
}

/**
 * Returns @font-face CSS with local file:// woff2 paths.
 * Downloads fonts on first use, then reads from disk cache.
 * Returns empty string on failure (will fall back to system fonts).
 */
export async function getLocalFontFaceCSS(): Promise<string> {
  if (cache !== null) return cache;

  try {
    if (await fileExists(FACE_CSS_PATH)) {
      cache = await readFile(FACE_CSS_PATH, 'utf-8');
      return cache;
    }
    cache = await buildLocalFontCSS();
    return cache;
  } catch (err) {
    logger.warn('card', '本地字型快取失敗，將使用系統字型', {
      error: (err as Error).message,
    });
    cache = ''; // negative cache — don't retry this session
    return '';
  }
}
