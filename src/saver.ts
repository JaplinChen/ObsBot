import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import type { ExtractedContent } from './extractors/types.js';
import { formatAsMarkdown } from './formatter.js';
import { canonicalizeUrl } from './utils/url-canonicalizer.js';
import { logger } from './core/logger.js';
import { CATEGORIES } from './classifier-categories.js';
import { sanitizeContent } from './utils/content-sanitizer.js';
import { notifyNoteAdded } from './knowledge/wiki-updater.js';
import { slugify, attachmentSlug, extractPostId } from './saver/slug.js';
import { isDuplicateUrl, processingUrls, updateIndex } from './saver/url-index.js';
import { downloadImage, warnIfDomainFlood } from './saver/image-downloader.js';
import { backupToTelegram } from './saver/telegram-backup.js';

export { isDuplicateUrl, warnIfDomainFlood };

/** 合法分類白名單 — 防止 LLM 或用戶輸入汙染目錄結構 */
const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.name));

export interface SaveResult {
  mdPath: string;
  imageCount: number;
  videoCount: number;
  duplicate?: boolean;
  /** Path to generated info card PNG (if available). */
  cardPath?: string;
}

/** Save extracted content as Obsidian Markdown + images to the vault */
export async function saveToVault(
  content: ExtractedContent,
  vaultPath: string,
  opts?: { forceOverwrite?: boolean; saveVideos?: boolean },
): Promise<SaveResult> {
  const normUrl = canonicalizeUrl(content.url);

  if (!opts?.forceOverwrite) {
    if (processingUrls.has(normUrl)) {
      return { mdPath: '', imageCount: 0, videoCount: 0, duplicate: true };
    }
    processingUrls.add(normUrl);
  }

  try {
    if (!opts?.forceOverwrite) {
      const existingPath = await isDuplicateUrl(content.url, vaultPath);
      if (existingPath) {
        return { mdPath: existingPath, imageCount: 0, videoCount: 0, duplicate: true };
      }
    }

    extractPostId(content.url, content.platform); // side-effect: validates URL

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
    const fullFolderPath = content.subFolder
      ? `${folderPath}/${content.subFolder.replace(/[<>:"/\\|?*]/g, '').trim()}`
      : folderPath;

    // 知識整合 獨立於 KnowPipe 之外（Vault 根目錄），其餘原始資料放 KnowPipe/
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

    // Download images in parallel
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

    const { result: markdown, redacted } = sanitizeContent(formatAsMarkdown(content, localImagePaths, localVideoPaths, imageUrlMap));
    if (redacted > 0) logger.warn('saver', '已遮蔽敏感資訊', { count: redacted, url: content.url });
    const mdFilename = `${slug}-${content.date}-${content.platform}.md`;
    const mdPath = join(notesDir, mdFilename);
    await writeFile(mdPath, markdown, 'utf-8');

    updateIndex(normUrl, mdPath);
    notifyNoteAdded(rawCategory, vaultPath).catch(() => {});
    backupToTelegram(mdFilename, markdown, {
      title: content.title,
      category: rawCategory,
      url: content.url,
    }).catch(() => {});
    return { mdPath, imageCount: localImagePaths.length, videoCount: content.videos.length };
  } finally {
    processingUrls.delete(normUrl);
  }
}
