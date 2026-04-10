import { mkdir, writeFile, readFile, copyFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExtractedContent, Platform } from './extractors/types.js';
import { formatAsMarkdown } from './formatter.js';
import { fetchWithTimeout } from './utils/fetch-with-timeout.js';
import { canonicalizeUrl } from './utils/url-canonicalizer.js';
import { getAllMdFiles } from './vault/frontmatter-utils.js';
import { logger } from './core/logger.js';
import { CATEGORIES } from './classifier-categories.js';
import { sanitizeContent } from './utils/content-sanitizer.js';
import { notifyNoteAdded } from './knowledge/wiki-updater.js';

/** 合法分類白名單 — 防止 LLM 或用戶輸入汙染目錄結構 */
const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.name));

// In-memory URL index: normalizedUrl → filePath (built on first use)
let urlIndex: Map<string, string> | null = null;
const INDEX_FILE = join('data', 'url-index.json');

// URLs currently being processed (race condition protection)
const processingUrls = new Set<string>();

/** Extract a short, stable ID from a URL for use in filenames */
function extractPostId(url: string, platform: Platform): string {
  try {
    const u = new URL(url);
    switch (platform) {
      case 'x':
        return u.pathname.match(/\/status\/(\d+)/)?.[1] ?? 'unknown';
      case 'threads':
        return u.pathname.match(/\/post\/([\w-]+)/)?.[1] ?? 'unknown';
      case 'youtube':
        return u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? 'unknown';
      case 'github':
        return u.pathname.split('/').filter(Boolean).slice(0, 3).join('-').slice(0, 40);
      case 'tiktok':
        return u.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? createHash('md5').update(url).digest('hex').slice(0, 8);
      default:
        return createHash('md5').update(url).digest('hex').slice(0, 8);
    }
  } catch {
    return 'unknown';
  }
}

/** Convert a title string into a safe, readable filename slug */
function slugify(text: string, maxLen = 40): string {
  return text
    .replace(/[：；]/g, '-')
    .replace(/[\\/:*?"<>|，。！？【】「」（）《》\[\](){}]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .trim()
    .slice(0, maxLen)
    .replace(/-$/, '');
}

/** Shorter slug for attachment filenames (spaces → hyphens, tighter limit) */
function attachmentSlug(text: string): string {
  return text
    .replace(/[\\/:*?"<>|#\[\](){}@]/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, 30)
    .replace(/-$/, '');
}

/** Download a single image (or copy a local file) and return the vault-relative path */
async function downloadImage(
  imageUrl: string,
  destDir: string,
  filename: string,
  platform: string,
): Promise<string> {
  // Handle local file paths (e.g. TikTok screenshots saved to tmp)
  if (/^[a-zA-Z]:[\\/]/.test(imageUrl) || imageUrl.startsWith('/')) {
    const ext = extname(imageUrl) || '.jpg';
    const fullName = `${filename}${ext}`;
    const fullPath = join(destDir, fullName);
    await copyFile(imageUrl, fullPath);
    return `attachments/obsbot/${platform}/${fullName}`;
  }

  const res = await fetchWithTimeout(imageUrl, 30_000);
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status} ${imageUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extname(new URL(imageUrl).pathname) || '.jpg';
  const fullName = `${filename}${ext}`;
  const fullPath = join(destDir, fullName);
  await writeFile(fullPath, buffer);
  return `attachments/obsbot/${platform}/${fullName}`;
}

export interface SaveResult {
  mdPath: string;
  imageCount: number;
  videoCount: number;
  duplicate?: boolean;
  /** Path to generated info card PNG (if available). */
  cardPath?: string;
}

/** Try to load persisted URL index from disk. Returns null if stale or missing. */
async function loadPersistedIndex(vaultPath: string): Promise<Map<string, string> | null> {
  try {
    const raw = await readFile(INDEX_FILE, 'utf-8');
    const data = JSON.parse(raw) as { version: number; count: number; entries: Record<string, string> };
    if (data.version !== 1) return null;
    // Staleness check: if vault file count differs by >10%, rebuild
    const rootDir = join(vaultPath, 'ObsBot');
    const files = await getAllMdFiles(rootDir);
    if (Math.abs(files.length - data.count) > Math.max(data.count * 0.1, 5)) {
      logger.info('saver', 'URL 索引過期，重新掃描', { cached: data.count, actual: files.length });
      return null;
    }
    return new Map(Object.entries(data.entries));
  } catch { return null; }
}

/** Persist URL index to disk for fast cold start. */
async function persistIndex(index: Map<string, string>): Promise<void> {
  try {
    const { safeWriteJSON } = await import('./core/safe-write.js');
    const data = { version: 1, count: index.size, entries: Object.fromEntries(index) };
    await safeWriteJSON(INDEX_FILE, data);
  } catch { /* best-effort */ }
}

/** Build URL index by scanning all .md files (runs once, then cached in memory). */
async function buildUrlIndex(vaultPath: string): Promise<Map<string, string>> {
  // Try persisted cache first
  const cached = await loadPersistedIndex(vaultPath);
  if (cached) {
    logger.info('saver', 'URL 索引從快取載入', { size: cached.size });
    return cached;
  }

  const index = new Map<string, string>();
  const rootDir = join(vaultPath, 'ObsBot');
  const files = await getAllMdFiles(rootDir);

  for (const fullPath of files) {
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const first25 = raw.split('\n').slice(0, 25).join('\n');
      const match = first25.match(/^url:\s*["']?(.*?)["']?\s*$/m);
      if (match) index.set(canonicalizeUrl(match[1].trim()), fullPath);
    } catch { /* skip unreadable files */ }
  }

  logger.info('saver', 'URL 索引重新掃描完成', { size: index.size });
  await persistIndex(index);
  return index;
}

/** Check for duplicate URL using in-memory cache (O(1) after first scan). */
export async function isDuplicateUrl(url: string, vaultPath: string): Promise<string | null> {
  if (!urlIndex) urlIndex = await buildUrlIndex(vaultPath);
  return urlIndex.get(canonicalizeUrl(url)) ?? null;
}

/** Save extracted content as Obsidian Markdown + images to the vault */
export async function saveToVault(
  content: ExtractedContent,
  vaultPath: string,
  opts?: { forceOverwrite?: boolean; saveVideos?: boolean },
): Promise<SaveResult> {
  const normUrl = canonicalizeUrl(content.url);

  // Race condition guard (skip for forceOverwrite)
  if (!opts?.forceOverwrite) {
    if (processingUrls.has(normUrl)) {
      return { mdPath: '', imageCount: 0, videoCount: 0, duplicate: true };
    }
    processingUrls.add(normUrl);
  }

  try {
    // Dedup check (skipped when forceOverwrite)
    if (!opts?.forceOverwrite) {
      const existingPath = await isDuplicateUrl(content.url, vaultPath);
      if (existingPath) {
        return { mdPath: existingPath, imageCount: 0, videoCount: 0, duplicate: true };
      }
    }

    const postId = extractPostId(content.url, content.platform);

    // Compute slug early — used for both .md filename and attachment filenames
    const ERROR_TITLE_RE = /^(warning[:\s]|error\s*\d{3}|access denied|forbidden|you've been blocked)/i;
    let titleForFilename = content.title;
    if (ERROR_TITLE_RE.test(titleForFilename)) {
      try {
        titleForFilename = new URL(content.url).hostname.replace(/^www\./, '');
      } catch {
        titleForFilename = 'untitled';
      }
    }
    const slug = slugify(titleForFilename);
    const imgSlug = attachmentSlug(titleForFilename);

    // Ensure directories exist
    // 白名單驗證：非法分類直接降回 '其他'，避免汙染目錄結構
    const rawCategory = (content.category && VALID_CATEGORIES.has(content.category))
      ? content.category
      : (() => {
          if (content.category) {
            logger.warn('saver', '分類不在白名單，降回其他', { invalid: content.category });
          }
          return '其他';
        })();
    const categoryParts = rawCategory
      .split('/')
      .slice(0, 3)
      .map(p => p.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\-_ &]/g, '').replace(/\s{2,}/g, ' ').trim())
      .filter(p => p.length > 0);
    const folderPath = categoryParts.join('/') || '其他';
    // Append optional subFolder for series grouping (e.g. "Obsidian雙向連結系列教學")
    const fullFolderPath = content.subFolder
      ? `${folderPath}/${content.subFolder.replace(/[<>:"/\\|?*]/g, '').trim()}`
      : folderPath;
    // 知識整合 獨立於 ObsBot 之外（Vault 根目錄），其餘原始資料放 ObsBot/
    const isKnowledgeSynthesis = categoryParts[0] === '知識整合';
    const baseObsBot = resolve(join(vaultPath, 'ObsBot'));
    const baseKnowledge = resolve(join(vaultPath, '知識整合'));
    const resolvedNotes = isKnowledgeSynthesis
      ? resolve(join(vaultPath, fullFolderPath))
      : resolve(join(vaultPath, 'ObsBot', fullFolderPath));
    const notesDir = isKnowledgeSynthesis
      ? (resolvedNotes === baseKnowledge || resolvedNotes.startsWith(baseKnowledge + sep) ? resolvedNotes : baseKnowledge)
      : (resolvedNotes === baseObsBot || resolvedNotes.startsWith(baseObsBot + sep) ? resolvedNotes : baseObsBot);
    const imagesDir = join(vaultPath, 'attachments', 'obsbot', content.platform);
    await mkdir(notesDir, { recursive: true });
    await mkdir(imagesDir, { recursive: true });

    // Download images in parallel (slug-based readable filenames)
    const imageResults = await Promise.allSettled(
      content.images.map((imgUrl, i) =>
        downloadImage(imgUrl, imagesDir, `${imgSlug}-${i}`, content.platform),
      ),
    );
    const localImagePaths: string[] = [];
    const imageUrlMap = new Map<string, string>();
    for (let i = 0; i < imageResults.length; i++) {
      const r = imageResults[i];
      if (r.status === 'fulfilled') {
        localImagePaths.push(r.value);
        imageUrlMap.set(content.images[i], r.value);
      }
    }

    // Download video thumbnails in parallel
    for (const r of await Promise.allSettled(
      content.videos.map((v, i) =>
        v.thumbnailUrl
          ? downloadImage(v.thumbnailUrl, imagesDir, `${imgSlug}-vid${i}-thumb`, content.platform)
          : Promise.reject('no thumbnail'),
      ),
    )) {
      if (r.status === 'fulfilled') localImagePaths.push(r.value);
    }

    // Copy local video files to vault attachments (only when saveVideos enabled)
    const localVideoPaths: string[] = [];
    if (opts?.saveVideos) {
      for (let i = 0; i < content.videos.length; i++) {
        const v = content.videos[i];
        if (v.localPath) {
          try {
            const ext = extname(v.localPath) || '.mp4';
            const vidName = `${imgSlug}-vid${i}${ext}`;
            await copyFile(v.localPath, join(imagesDir, vidName));
            localVideoPaths.push(`attachments/obsbot/${content.platform}/${vidName}`);
          } catch { /* skip if copy fails */ }
        }
      }
    }

    // Generate Markdown (並掃描敏感資訊)
    const { result: markdown, redacted } = sanitizeContent(formatAsMarkdown(content, localImagePaths, localVideoPaths, imageUrlMap));
    if (redacted > 0) logger.warn('saver', '已遮蔽敏感資訊', { count: redacted, url: content.url });
    const mdFilename = `${slug}-${content.date}-${content.platform}.md`;
    const mdPath = join(notesDir, mdFilename);
    await writeFile(mdPath, markdown, 'utf-8');

    // Update in-memory index + persist
    if (urlIndex) {
      urlIndex.set(normUrl, mdPath);
      persistIndex(urlIndex).catch(() => {});
    }
    notifyNoteAdded(rawCategory, vaultPath).catch(() => {}); // fire-and-forget wiki 更新
    return { mdPath, imageCount: localImagePaths.length, videoCount: content.videos.length };
  } finally {
    processingUrls.delete(normUrl);
  }
}
