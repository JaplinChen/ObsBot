/**
 * Batch processing for series (e.g. ITHome 鐵人賽).
 *
 * Flow: save index note → iterate articles → extract + classify + save each
 *       (LLM enrichment skipped in batch to keep total time reasonable)
 */

import { classifyContent } from '../../classifier.js';
import { logger } from '../../core/logger.js';
import type { ExtractedContent, ExtractorWithSeries } from '../../extractors/types.js';
import type { AppConfig } from '../../utils/config.js';
import { enrichExtractedContent } from './enrich-content-service.js';
import { saveExtractedContent } from './save-content-service.js';

export interface SeriesProcessingResult {
  indexPath: string;
  saved: number;
  skipped: number;
  failed: number;
  total: number;
}

type ProgressCallback = (msg: string) => Promise<unknown>;

/** Delay helper to avoid hammering the server */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Process an entire series: save index + batch-extract all articles.
 * Reports progress via callback every 5 articles.
 */
export async function processSeriesBatch(
  seriesUrl: string,
  extractor: ExtractorWithSeries,
  config: AppConfig,
  onProgress: ProgressCallback,
): Promise<SeriesProcessingResult> {
  // 1. Extract series metadata
  const { seriesTitle, author, articles } =
    await extractor.extractSeriesArticles(seriesUrl);
  logger.info('series', 'fetched index', {
    title: seriesTitle,
    count: articles.length,
  });

  // 2. Generate subfolder name from series title
  const seriesFolder = seriesTitle
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 40)
    .trim();

  // 3. Save index note (with enrichment, NO subfolder — stays in main category)
  const indexContent = await extractor.extract(seriesUrl);
  await enrichExtractedContent(indexContent, config);
  const indexResult = await saveExtractedContent(indexContent, config.vaultPath, { saveVideos: config.saveVideos });
  const indexPath = indexResult.mdPath;

  await onProgress(
    `已建立索引筆記（${articles.length} 篇）\n開始逐篇抓取...`,
  );

  // 3. Batch-extract each article
  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    try {
      const content: ExtractedContent = await extractor.extract(article.url);

      // Classify only (skip LLM enrichment for speed)
      content.category = classifyContent(content.title, content.text);
      content.subFolder = seriesFolder;

      const result = await saveExtractedContent(content, config.vaultPath, { saveVideos: config.saveVideos });
      if (result.duplicate) {
        skipped++;
      } else {
        saved++;
      }
    } catch (err) {
      failed++;
      logger.warn('series', 'article failed', {
        url: article.url,
        err: (err as Error).message,
      });
    }

    // Progress report every 5 articles
    if ((i + 1) % 5 === 0 || i === articles.length - 1) {
      await onProgress(
        `進度：${i + 1}/${articles.length}（已存 ${saved}，跳過 ${skipped}，失敗 ${failed}）`,
      );
    }

    // Throttle: 1s between requests
    if (i < articles.length - 1) await delay(1000);
  }

  return { indexPath, saved, skipped, failed, total: articles.length };
}
