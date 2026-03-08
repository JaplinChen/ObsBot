/**
 * Post-processing pipeline: runs after extract + AI enrich, before save.
 * Enriches linked URLs and translates non-zh-TW content in parallel.
 * Entire pipeline has a 20s hard timeout; any failure is silently skipped.
 */

import type { ExtractedContent } from '../extractors/types.js';
import { logger } from '../core/logger.js';
import { extractUrlsFromText, enrichLinkedUrls, type UrlEntry } from './link-enricher.js';
import { translateIfNeeded } from './translator.js';
import { canonicalizeUrl } from '../utils/url-canonicalizer.js';

export interface PostProcessOptions {
  enrichPostLinks: boolean;
  enrichCommentLinks: boolean;
  translate: boolean;
  maxLinkedUrls: number;
}

function collectUrls(content: ExtractedContent, opts: PostProcessOptions): UrlEntry[] {
  const entries: UrlEntry[] = [];
  const selfUrl = canonicalizeUrl(content.url);

  if (opts.enrichPostLinks) {
    for (const url of extractUrlsFromText(content.text)) {
      if (canonicalizeUrl(url) !== selfUrl) {
        entries.push({ url, source: 'post' });
      }
    }
  }

  if (opts.enrichCommentLinks && content.comments) {
    for (const c of content.comments) {
      for (const url of extractUrlsFromText(c.text)) {
        entries.push({ url, source: 'comment', mentionedBy: c.authorHandle });
      }
      for (const r of c.replies ?? []) {
        for (const url of extractUrlsFromText(r.text)) {
          entries.push({ url, source: 'comment', mentionedBy: r.authorHandle });
        }
      }
    }
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    const norm = canonicalizeUrl(e.url);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  }).slice(0, opts.maxLinkedUrls);
}

export async function postProcess(
  content: ExtractedContent,
  opts: PostProcessOptions,
): Promise<void> {
  const urlEntries = collectUrls(content, opts);
  const shouldTranslate = opts.translate;

  if (urlEntries.length === 0 && !shouldTranslate) return;

  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000));

  const work = Promise.allSettled([
    urlEntries.length > 0 ? enrichLinkedUrls(urlEntries) : Promise.resolve([]),
    shouldTranslate ? translateIfNeeded(content.title, content.text) : Promise.resolve(null),
  ]);

  const result = await Promise.race([work, timer]);

  if (result === 'timeout') {
    logger.warn('post-process', '整體超時 (20s)，略過補充處理');
    return;
  }

  const [linkedResult, translationResult] = result;

  if (linkedResult.status === 'fulfilled' && linkedResult.value.length > 0) {
    content.linkedContent = linkedResult.value;
    logger.info('post-process', '補充連結完成', { count: linkedResult.value.length });
  }

  if (translationResult.status === 'fulfilled' && translationResult.value) {
    content.translation = translationResult.value;
    logger.info('post-process', '翻譯完成', { language: translationResult.value.detectedLanguage });
  }
}
