/**
 * Content radar background service — periodically searches for new content
 * based on vault keywords and auto-saves to Obsidian vault.
 * Supports multiple source types: DDG search, GitHub trending, RSS feeds.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import type { RadarConfig, RadarResult, RadarCycleSummary, RadarQueryType } from './radar-types.js';
import { saveRadarConfig } from './radar-store.js';
import { webSearch } from '../utils/search-service.js';
import { findExtractor } from '../utils/url-parser.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { logger } from '../core/logger.js';
import { githubTrendingSource } from './sources/github-trending.js';
import { rssSource } from './sources/rss-source.js';
import type { RadarSourceResult } from './sources/source-types.js';

/** Fetch candidates depending on query type. */
async function fetchCandidates(
  type: RadarQueryType,
  keywords: string[],
  maxResults: number,
): Promise<RadarSourceResult[]> {
  switch (type) {
    case 'github':
      return githubTrendingSource.fetch(keywords, maxResults);
    case 'rss':
      return rssSource.fetch(keywords, maxResults);
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
): Promise<RadarResult> {
  const result: RadarResult = { query, saved: 0, skipped: 0, errors: 0 };

  try {
    const candidates = await fetchCandidates(query.type ?? 'search', query.keywords, maxResults);
    if (candidates.length === 0) return result;

    for (const sr of candidates) {
      try {
        // Dedup check
        const existing = await isDuplicateUrl(sr.url, config.vaultPath);
        if (existing) { result.skipped++; continue; }

        // Find extractor
        const extractor = findExtractor(sr.url);
        if (!extractor) { result.skipped++; continue; }

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
  } catch (err) {
    logger.warn('radar', '查詢失敗', {
      keywords: query.keywords.join(' '),
      err: (err as Error).message,
    });
  }

  return result;
}

/** Build cycle summary for proactive digest integration. */
function buildCycleSummary(results: RadarResult[]): RadarCycleSummary {
  const byType: Record<RadarQueryType, number> = { search: 0, github: 0, rss: 0 };
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const r of results) {
    const qType = r.query.type ?? 'search';
    byType[qType] = (byType[qType] ?? 0) + r.saved;
    totalSaved += r.saved;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
  }

  return {
    timestamp: new Date().toISOString(),
    totalSaved,
    totalSkipped,
    totalErrors,
    byType,
  };
}

/** Format source type label for display. */
function sourceLabel(type: RadarQueryType): string {
  switch (type) {
    case 'github': return 'GitHub';
    case 'rss': return 'RSS';
    default: return '搜尋';
  }
}

/** Run a full radar cycle across all queries */
export async function runRadarCycle(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): Promise<RadarResult[]> {
  if (radarConfig.queries.length === 0) return [];

  logger.info('radar', '開始掃描', { queries: radarConfig.queries.length });
  const results: RadarResult[] = [];
  let totalSaved = 0;

  for (const query of radarConfig.queries) {
    if (totalSaved >= radarConfig.maxTotalPerCycle) break;

    const remaining = radarConfig.maxTotalPerCycle - totalSaved;
    const maxResults = Math.min(radarConfig.maxResultsPerQuery, remaining);
    const result = await runQuery(query, config, maxResults);
    results.push(result);
    totalSaved += result.saved;
  }

  // Save cycle summary for proactive digest
  radarConfig.lastCycleResults = buildCycleSummary(results);
  radarConfig.lastRunAt = new Date().toISOString();
  await saveRadarConfig(radarConfig);

  // Notify user if any new content found
  if (totalSaved > 0) {
    const userId = config.allowedUserIds?.values().next().value;
    if (userId) {
      const lines = [`🔍 內容雷達：發現 ${totalSaved} 篇新內容`, ''];
      for (const r of results) {
        if (r.saved > 0) {
          const label = sourceLabel(r.query.type ?? 'search');
          const desc = r.query.type === 'rss'
            ? r.query.keywords[0]
            : r.query.keywords.join(' ');
          lines.push(`• [${label}] ${r.saved} 篇 — ${desc}`);
        }
      }
      const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
      if (totalSkipped > 0) lines.push(`\n（${totalSkipped} 篇已存在，已跳過）`);

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
