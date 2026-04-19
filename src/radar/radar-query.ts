/**
 * Single radar query execution: fetch → extract → classify → save.
 * Extracted from radar-service.ts to keep each file ≤300 lines.
 */
import type { AppConfig } from '../utils/config.js';
import type { RadarConfig, RadarResult, RadarQueryType } from './radar-types.js';
import { webSearch } from '../utils/search-service.js';
import { findExtractor } from '../utils/url-parser.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { enrichExtractedContent } from '../messages/services/enrich-content-service.js';
import { logger } from '../core/logger.js';
import { githubTrendingSource } from './sources/github-trending.js';
import { rssSource } from './sources/rss-source.js';
import { radarHnSource } from './sources/hn-source.js';
import { radarDevtoSource } from './sources/devto-source.js';
import type { RadarSourceResult } from './sources/source-types.js';
import type { ToolEntry, ToolMatchResult } from './wall-types.js';
import { matchNewTool } from './wall-index.js';
import { VIDEO_PLATFORMS, enqueueVideo } from './video-queue.js';
import { createCustomSource } from './sources/custom-source.js';
import type { CustomSourceConfig } from './sources/custom-source.js';
import { isAdUrl } from '../utils/ad-url-filter.js';

/** Max consecutive failures before auto-pausing a query. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 非科技分類 — 雷達自動跳過，避免 RSS 寬泛 feed 帶入個人生活、時事等非 Vault 關注內容。
 */
export const RADAR_SKIP_CATEGORIES = new Set(['新聞時事', '生活', '其他']);

/** Fetch candidates depending on query type. */
export async function fetchCandidates(
  type: RadarQueryType,
  keywords: string[],
  maxResults: number,
  customConfig?: CustomSourceConfig,
): Promise<RadarSourceResult[]> {
  switch (type) {
    case 'github':
      return githubTrendingSource.fetch(keywords, maxResults);
    case 'rss':
      return rssSource.fetch(keywords, maxResults);
    case 'hn':
      return radarHnSource.fetch(keywords, maxResults);
    case 'devto':
      return radarDevtoSource.fetch(keywords, maxResults);
    case 'custom':
      if (!customConfig) return [];
      return createCustomSource(customConfig).fetch(keywords, maxResults);
    case 'search':
    default:
      return (await webSearch(keywords.join(' '), maxResults)).map(r => ({
        url: r.url, title: r.title, snippet: r.snippet,
      }));
  }
}

/** Run a single radar query: fetch → extract → classify → save */
export async function runQuery(
  query: RadarConfig['queries'][0],
  config: AppConfig,
  maxResults: number,
  wallToolIndex?: ToolEntry[] | null,
): Promise<{ result: RadarResult; matches: ToolMatchResult[] }> {
  const result: RadarResult = { query, saved: 0, skipped: 0, errors: 0, queued: 0 };
  const matches: ToolMatchResult[] = [];

  try {
    const candidates = await fetchCandidates(query.type ?? 'search', query.keywords, maxResults, query.customConfig);

    if (candidates.length === 0) {
      query.consecutiveFailures = (query.consecutiveFailures ?? 0) + 1;
      if (query.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        query.paused = true;
        logger.warn('radar', '查詢已自動暫停（連續無結果）', {
          id: query.id, keywords: query.keywords.join(' '),
          failures: query.consecutiveFailures,
        });
      }
      return { result, matches };
    }

    for (const sr of candidates) {
      try {
        const adCheck = await isAdUrl(sr.url);
        if (adCheck.isAd) {
          logger.info('radar', '略過廣告 URL', { url: sr.url.slice(0, 80), reason: adCheck.reason });
          result.skipped++;
          continue;
        }

        const existing = await isDuplicateUrl(sr.url, config.vaultPath);
        if (existing) { result.skipped++; continue; }

        const extractor = findExtractor(sr.url);
        if (!extractor) { result.skipped++; continue; }

        if (VIDEO_PLATFORMS.has(extractor.platform)) {
          const queued = await enqueueVideo(sr.url);
          if (queued) result.queued++;
          else result.skipped++;
          continue;
        }

        const content = await extractor.extract(sr.url);

        content.category = await classifyContent(content.title, content.text);
        if (RADAR_SKIP_CATEGORIES.has(content.category ?? '')) {
          logger.info('radar', '略過非科技分類', { url: sr.url.slice(0, 80), category: content.category });
          result.skipped++;
          continue;
        }

        await enrichExtractedContent(content, config);

        const saveResult = await saveToVault(content, config.vaultPath);
        if (saveResult.duplicate) {
          result.skipped++;
        } else {
          result.saved++;
          if (wallToolIndex && wallToolIndex.length > 0) {
            try {
              const kw = content.enrichedKeywords ?? [];
              const match = matchNewTool(content.title, kw, content.category ?? '', sr.url, wallToolIndex);
              if (match) matches.push(match);
            } catch { /* best-effort */ }
          }
        }
      } catch (err) {
        result.errors++;
        logger.warn('radar', '單一 URL 失敗', { url: sr.url, err: (err as Error).message });
      }
    }

    query.lastHitCount = result.saved;
    query.consecutiveFailures = 0;
  } catch (err) {
    query.consecutiveFailures = (query.consecutiveFailures ?? 0) + 1;
    if (query.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      query.paused = true;
    }
    logger.warn('radar', '查詢失敗', { keywords: query.keywords.join(' '), err: (err as Error).message });
  }

  return { result, matches };
}
