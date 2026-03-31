/**
 * Shared single-URL processing pipeline.
 * Used by retry-command and discover-command save actions.
 */
import type { ExtractorWithComments } from '../../extractors/types.js';
import type { AppConfig } from '../../utils/config.js';
import { findExtractor } from '../../utils/url-parser.js';
import { enrichExtractedContent } from './enrich-content-service.js';
import { extractContentWithComments } from './extract-content-service.js';
import { saveExtractedContent } from './save-content-service.js';
import type { BotStats } from '../types.js';

export interface ProcessUrlResult {
  success: boolean;
  title?: string;
  category?: string;
  duplicate?: boolean;
  error?: string;
}

/** Process a single URL through extract → enrich → save pipeline */
export async function processUrl(
  url: string, config: AppConfig, stats: BotStats,
): Promise<ProcessUrlResult> {
  const extractor = findExtractor(url);
  if (!extractor) return { success: false, error: '不支援的 URL' };

  try {
    const content = await extractContentWithComments(url, extractor as ExtractorWithComments);
    await enrichExtractedContent(content, config);
    const result = await saveExtractedContent(content, config.vaultPath, { saveVideos: config.saveVideos });

    if (!result.duplicate) {
      stats.saved++;
      if (stats.recent.length >= 50) stats.recent.shift();
      stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);
    }

    return { success: true, title: content.title, category: content.category, duplicate: result.duplicate };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
