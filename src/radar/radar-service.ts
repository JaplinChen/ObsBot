/**
 * Content radar background service — periodically searches for new content
 * based on vault keywords and auto-saves to Obsidian vault.
 * Supports multiple source types: DDG search, GitHub trending, RSS feeds.
 */
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import type { RadarConfig, RadarResult, RadarCycleSummary, RadarQueryType } from './radar-types.js';
import { saveRadarConfig, promoteNextAuthor } from './radar-store.js';
import { webSearch } from '../utils/search-service.js';
import { findExtractor } from '../utils/url-parser.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
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
import { buildCycleSummary, sourceLabel } from './radar-cycle-utils.js';
import { isAdUrl } from '../utils/ad-url-filter.js';

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

        // Classify
        content.category = classifyContent(content.title, content.text);

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
    const { result, matches } = await runQuery(query, config, maxResults, toolIndex);
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

  // Notify user if any new content found or queued
  const totalQueued = results.reduce((s, r) => s + r.queued, 0);
  if (totalSaved > 0 || totalQueued > 0) {
    const userId = getOwnerUserId(config);
    if (userId) {
      const lines = [`🔍 內容雷達：發現 ${totalSaved} 篇新內容`, ''];
      for (const r of results) {
        if (r.saved > 0) {
          const label = sourceLabel(r.query.type ?? 'search', r.query.customConfig?.name);
          const desc = r.query.type === 'rss'
            ? r.query.keywords[0]
            : r.query.type === 'custom'
              ? (r.query.customConfig?.name ?? r.query.keywords.join(' '))
              : r.query.keywords.join(' ');
          lines.push(`• [${label}] ${r.saved} 篇 — ${desc}`);
        }
      }
      const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
      if (totalSkipped > 0) lines.push(`\n（${totalSkipped} 篇已存在，已跳過）`);
      if (totalQueued > 0) lines.push(`🎬 ${totalQueued} 部影片已排入轉錄佇列`);

      await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
    }
  }

  // Notify user about auto-paused queries
  if (newlyPaused.length > 0) {
    const userId = getOwnerUserId(config);
    if (userId) {
      const lines = [
        `⚠️ 以下查詢連續 ${MAX_CONSECUTIVE_FAILURES} 次無結果，已自動暫停：`,
        ...newlyPaused.map(q => `• ${q}`),
        '',
        '使用 /radar resume <id> 可恢復。',
      ];
      if (promotedAuthors.length > 0) {
        lines.push('', `🔄 已自動輪替加入下一位備用作者：`);
        promotedAuthors.forEach(h => lines.push(`• @${h}`));
        const remaining = radarConfig.authorQueue?.length ?? 0;
        if (remaining > 0) lines.push(`（備用佇列剩餘 ${remaining} 位）`);
      }
      await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
    }
  }

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
