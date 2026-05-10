/**
 * Content radar background service — periodically searches for new content
 * based on vault keywords and auto-saves to Obsidian vault.
 * Supports multiple source types: DDG search, GitHub trending, RSS feeds.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { RadarConfig, RadarResult, RadarQueryType } from './radar-types.js';
import { saveRadarConfig } from './radar-store.js';
import { promoteNextAuthor, runWeeklyAuthorRefresh } from './radar-author.js';
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
import { buildToolIndex, matchNewTool } from './wall-index.js';
import { loadWallConfig, addPendingMatches } from './wall-service.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { VIDEO_PLATFORMS, enqueueVideo } from './video-queue.js';
import { createCustomSource } from './sources/custom-source.js';
import type { CustomSourceConfig } from './sources/custom-source.js';
import { buildCycleSummary } from './radar-cycle-utils.js';
import { notifyAutoPausedQueries, notifyRadarResults } from './radar-notifier.js';
import { isAdUrl } from '../utils/ad-url-filter.js';
import { type ContentFilter, loadContentFilter, isBlockedContent } from '../utils/content-filter.js';

/** Max consecutive failures before auto-pausing a query. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Fetch candidates depending on query type. */
async function fetchCandidates(
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
async function runQuery(
  query: RadarConfig['queries'][0],
  config: AppConfig,
  maxResults: number,
  wallToolIndex?: ToolEntry[] | null,
  contentFilter?: ContentFilter,
): Promise<{ result: RadarResult; matches: ToolMatchResult[] }> {
  const result: RadarResult = { query, saved: 0, skipped: 0, errors: 0, queued: 0 };
  const matches: ToolMatchResult[] = [];

  try {
    const candidates = await fetchCandidates(query.type ?? 'search', query.keywords, maxResults, query.customConfig);

    if (candidates.length === 0) {
      // No candidates — count as failure for auto-pause
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
        // Ad URL filter — 廣告跳轉直接略過，並觸發學習
        const adCheck = await isAdUrl(sr.url);
        if (adCheck.isAd) {
          logger.info('radar', '略過廣告 URL', { url: sr.url.slice(0, 80), reason: adCheck.reason });
          result.skipped++;
          continue;
        }

        // Dedup check
        const existing = await isDuplicateUrl(sr.url, config.vaultPath);
        if (existing) { result.skipped++; continue; }

        // Find extractor
        const extractor = findExtractor(sr.url);
        if (!extractor) { result.skipped++; continue; }

        // Video platforms: push to async queue instead of blocking the cycle
        if (VIDEO_PLATFORMS.has(extractor.platform)) {
          const queued = await enqueueVideo(sr.url);
          if (queued) result.queued++;
          else result.skipped++;
          continue;
        }

        // Extract content
        const content = await extractor.extract(sr.url);

        // 先做便宜的分類，跳過封鎖分類，再做昂貴的 enrich
        content.category = await classifyContent(content.title, content.text);
        if (contentFilter && isBlockedContent(contentFilter, content.category, content.title)) {
          logger.info('radar', '略過封鎖內容', { url: sr.url.slice(0, 80), category: content.category });
          result.skipped++;
          continue;
        }

        // Enrich（翻譯、AI 摘要、關鍵字）— 與正常 URL 流程一致
        await enrichExtractedContent(content, config);

        // Save to vault
        const saveResult = await saveToVault(content, config.vaultPath);
        if (saveResult.duplicate) {
          result.skipped++;
        } else {
          result.saved++;

          // Wall: collect match for batch write
          if (wallToolIndex && wallToolIndex.length > 0) {
            try {
              const kw = content.enrichedKeywords ?? [];
              const match = matchNewTool(
                content.title, kw, content.category ?? '', sr.url, wallToolIndex,
              );
              if (match) matches.push(match);
            } catch { /* best-effort */ }
          }
        }
      } catch (err) {
        result.errors++;
        logger.warn('radar', '單一 URL 失敗', {
          url: sr.url,
          err: (err as Error).message,
        });
      }
    }

    query.lastHitCount = result.saved;
    // Got candidates — reset failure counter
    query.consecutiveFailures = 0;
  } catch (err) {
    query.consecutiveFailures = (query.consecutiveFailures ?? 0) + 1;
    if (query.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      query.paused = true;
    }
    logger.warn('radar', '查詢失敗', {
      keywords: query.keywords.join(' '),
      err: (err as Error).message,
    });
  }

  return { result, matches };
}


/** Run a full radar cycle across all queries */
export async function runRadarCycle(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): Promise<RadarResult[]> {
  if (radarConfig.queries.length === 0) return [];

  // Lazy-load tool index for wall matching
  let toolIndex: ToolEntry[] | null = null;
  try {
    const wallConfig = await loadWallConfig();
    if (wallConfig.enabled) {
      const knowledge = await loadKnowledge();
      toolIndex = buildToolIndex(knowledge);
    }
  } catch { /* wall matching is best-effort */ }

  const contentFilter = await loadContentFilter().catch(() => undefined);

  logger.info('radar', '開始掃描', { queries: radarConfig.queries.length });
  const results: RadarResult[] = [];
  const allMatches: ToolMatchResult[] = [];
  let totalSaved = 0;

  const newlyPaused: string[] = [];
  const promotedAuthors: string[] = [];

  for (const query of radarConfig.queries) {
    if (totalSaved >= radarConfig.maxTotalPerCycle) break;
    if (query.paused) continue; // skip paused queries

    const remaining = radarConfig.maxTotalPerCycle - totalSaved;
    const maxResults = Math.min(radarConfig.maxResultsPerQuery, remaining);
    const { result, matches } = await runQuery(query, config, maxResults, toolIndex, contentFilter);
    results.push(result);
    allMatches.push(...matches);
    totalSaved += result.saved;

    // Track newly paused queries for notification
    if (query.paused) {
      const desc = query.type === 'rss' ? query.keywords[0] : query.keywords.join(' ');
      newlyPaused.push(`[${query.id}] ${desc}`);

      // Auto-rotate: replace paused author query with next from queue
      if (query.authorHandle) {
        const promoted = promoteNextAuthor(radarConfig);
        if (promoted) promotedAuthors.push(promoted);
      }
    }
  }

  // Batch-write wall matches (single disk I/O instead of per-URL)
  await addPendingMatches(allMatches).catch(() => {});

  // Save cycle summary for proactive digest
  radarConfig.lastCycleResults = buildCycleSummary(results);
  radarConfig.lastRunAt = new Date().toISOString();
  await saveRadarConfig(radarConfig);

  await notifyRadarResults(bot, config, results);

  // Notify user about auto-paused queries
  await notifyAutoPausedQueries(
    bot,
    config,
    MAX_CONSECUTIVE_FAILURES,
    newlyPaused,
    promotedAuthors,
    radarConfig.authorQueue?.length ?? 0,
  );

  // ── Weekly author-queue refresh (delegated to radar-author.ts) ───────────
  await runWeeklyAuthorRefresh(bot, config, radarConfig);

  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  logger.info('radar', '掃描完成', { totalSaved, totalErrors });
  return results;
}

/** Start the background radar checker */
export function startRadarChecker(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): NodeJS.Timeout {
  const intervalMs = (radarConfig.intervalHours || 6) * 60 * 60 * 1000;

  logger.info('radar', '啟動內容雷達', {
    interval: `${radarConfig.intervalHours}h`,
    queries: radarConfig.queries.length,
  });

  return setInterval(
    () => { runRadarCycle(bot, config, radarConfig).catch(() => {}); },
    intervalMs,
  );
}
