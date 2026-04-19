import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { ExtractedContent, Platform } from './extractors/types.js';
import { formatAsMarkdown } from './formatter.js';
import { canonicalizeUrl } from './utils/url-canonicalizer.js';
import { logger } from './core/logger.js';
import { CATEGORIES } from './classifier-categories.js';
import { sanitizeContent } from './utils/content-sanitizer.js';
import { notifyNoteAdded } from './knowledge/wiki-updater.js';
import { safeWriteFile } from './core/safe-write.js';
import { isDuplicateUrl as checkDuplicate, updateUrlIndex } from './saver-url-index.js';
import { downloadImage } from './saver-image-downloader.js';

export { isDuplicateUrl } from './saver-url-index.js';

/** 合法分類白名單 — 防止 LLM 或用戶輸入汙染目錄結構 */
const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.name));

/** In-flight saves: second call for same URL waits on the first Promise instead of racing */
const inFlight = new Map<string, Promise<SaveResult>>();

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

/** Shorter slug for attachment filenames */
function attachmentSlug(text: string): string {
  return text
    .replace(/[\\/:*?"<>|#\[\](){}@]/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, 30)
    .replace(/-$/, '');
}

export interface SaveResult {
  mdPath: string;
  imageCount: number;
  videoCount: number;
  duplicate?: boolean;
  cardPath?: string;
}

/** Warn when same source domain floods the same category within a time window. */
export async function warnIfDomainFlood(
  url: string,
  notesDir: string,
  opts = { maxSameSource: 5, dayWindowDays: 7 },
): Promise<void> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - opts.dayWindowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let files: string[];
  try {
    files = await readdir(notesDir);
  } catch {
    return;
  }

  let count = 0;
  for (const fname of files) {
    if (!fname.endsWith('.md')) continue;
    const dateMatch = fname.match(/-(\d{4}-\d{2}-\d{2})-[^-]+\.md$/);
    if (!dateMatch || dateMatch[1] < cutoffStr) continue;

    const fpath = join(notesDir, fname);
    try {
      const buf = Buffer.alloc(300);
      const fd = await import('node:fs/promises').then(m => m.open(fpath, 'r'));
      await fd.read(buf, 0, 300, 0);
      await fd.close();
      const head = buf.toString('utf-8');
      const urlMatch = head.match(/^url:\s*["']?(https?:\/\/[^\s"'\n]+)/m);
      if (!urlMatch) continue;
      const fHost = new URL(urlMatch[1]).hostname.replace(/^www\./, '');
      if (fHost === hostname) count++;
    } catch {
      continue;
    }
  }

  if (count >= opts.maxSameSource) {
    logger.warn('saver', `同來源 domain 近 ${opts.dayWindowDays} 天已有 ${count} 篇，留意是否重複`, {
      hostname,
      count,
      dir: notesDir.split('/').slice(-2).join('/'),
    });
  }
}

/** Save extracted content as Obsidian Markdown + images to the vault */
export function saveToVault(
  content: ExtractedContent,
  vaultPath: string,
  opts?: { forceOverwrite?: boolean; saveVideos?: boolean },
): Promise<SaveResult> {
  const normUrl = canonicalizeUrl(content.url);

  if (!opts?.forceOverwrite) {
    const existing = inFlight.get(normUrl);
    if (existing) return existing;
  }

  const p = doSave(content, vaultPath, opts, normUrl);
  if (!opts?.forceOverwrite) {
    inFlight.set(normUrl, p);
    p.finally(() => inFlight.delete(normUrl));
  }
  return p;
}

async function doSave(
  content: ExtractedContent,
  vaultPath: string,
  opts: { forceOverwrite?: boolean; saveVideos?: boolean } | undefined,
  normUrl: string,
): Promise<SaveResult> {
  // Dedup check (skipped when forceOverwrite)
  if (!opts?.forceOverwrite) {
    const existingPath = await checkDuplicate(content.url, vaultPath);
    if (existingPath) {
      return { mdPath: existingPath, imageCount: 0, videoCount: 0, duplicate: true };
    }
  }

  // Compute slug early — used for both .md filename and attachment filenames
  const ERROR_TITLE_RE = /^(warning[:\s]|error\s*\d{3}|access denied|forbidden|you've been blocked|未命名|untitled|n\/a|overview|總覽|無標題)$/i;
  let titleForFilename = content.title;
  if (!titleForFilename || titleForFilename.length < 5 || ERROR_TITLE_RE.test(titleForFilename.trim())) {
    try {
      const u = new URL(content.url);
      const pathParts = u.pathname.split('/').map(p => decodeURIComponent(p)).filter(p => p && p !== 'index.html' && p !== 'README');
      titleForFilename = pathParts.length > 0
        ? pathParts[pathParts.length - 1].replace(/\.[a-z]{2,4}$/i, '').replace(/[-_]/g, ' ')
        : u.hostname.replace(/^www\./, '');
      if (!content.title || ERROR_TITLE_RE.test(content.title.trim())) {
        content.title = titleForFilename;
      }
    } catch {
      titleForFilename = 'untitled';
    }
  }
  const slug = slugify(titleForFilename);
  const imgSlug = attachmentSlug(titleForFilename);

  // 白名單驗證：非法分類直接降回 '其他'
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
  const fullFolderPath = content.subFolder
    ? `${folderPath}/${content.subFolder.replace(/[<>:"/\\|?*]/g, '').trim()}`
    : folderPath;

  const isKnowledgeSynthesis = categoryParts[0] === '知識整合';
  const baseKnowPipe = resolve(join(vaultPath, 'KnowPipe'));
  const baseKnowledge = resolve(join(vaultPath, '知識整合'));
  const resolvedNotes = isKnowledgeSynthesis
    ? resolve(join(vaultPath, fullFolderPath))
    : resolve(join(vaultPath, 'KnowPipe', fullFolderPath));
  const notesDir = isKnowledgeSynthesis
    ? (resolvedNotes === baseKnowledge || resolvedNotes.startsWith(baseKnowledge + sep) ? resolvedNotes : baseKnowledge)
    : (resolvedNotes === baseKnowPipe || resolvedNotes.startsWith(baseKnowPipe + sep) ? resolvedNotes : baseKnowPipe);
  const imagesDir = join(vaultPath, 'attachments', 'knowpipe', content.platform);
  await mkdir(notesDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });
  warnIfDomainFlood(content.url, notesDir).catch(() => {});

  // Download images in parallel (semaphore limits to IMAGE_CONCURRENCY concurrent)
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

  // Download video thumbnails
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
          localVideoPaths.push(`attachments/knowpipe/${content.platform}/${vidName}`);
        } catch { /* skip if copy fails */ }
      }
    }
  }

  // Generate Markdown (並掃描敏感資訊)
  const { result: markdown, redacted } = sanitizeContent(formatAsMarkdown(content, localImagePaths, localVideoPaths, imageUrlMap));
  if (redacted > 0) logger.warn('saver', '已遮蔽敏感資訊', { count: redacted, url: content.url });
  const mdFilename = `${slug}-${content.date}-${content.platform}.md`;
  const mdPath = join(notesDir, mdFilename);
  await safeWriteFile(mdPath, markdown);

  updateUrlIndex(normUrl, mdPath);
  notifyNoteAdded(rawCategory, vaultPath).catch(() => {});

  return { mdPath, imageCount: localImagePaths.length, videoCount: content.videos.length };
}
