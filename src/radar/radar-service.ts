/**
 * Content radar background service — periodically searches for new content
 * based on vault keywords and auto-saves to Obsidian vault.
 * Supports multiple source types: DDG search, GitHub trending, RSS feeds.
 */
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import type { RadarConfig, RadarResult } from './radar-types.js';
import { saveRadarConfig } from './radar-store.js';
import { promoteNextAuthor, runWeeklyAuthorRefresh } from './radar-author.js';
import { logger } from '../core/logger.js';
import type { ToolEntry, ToolMatchResult } from './wall-types.js';
import { buildToolIndex } from './wall-index.js';
import { loadWallConfig, addPendingMatches } from './wall-service.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { buildCycleSummary, sourceLabel } from './radar-cycle-utils.js';
import { runQuery, MAX_CONSECUTIVE_FAILURES } from './radar-query.js';

/** Run a full radar cycle across all queries */
export async function runRadarCycle(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): Promise<RadarResult[]> {
  if (radarConfig.queries.length === 0) return [];

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
    if (query.paused) continue;

    const remaining = radarConfig.maxTotalPerCycle - totalSaved;
    const maxResults = Math.min(radarConfig.maxResultsPerQuery, remaining);
    const { result, matches } = await runQuery(query, config, maxResults, toolIndex);
    results.push(result);
    allMatches.push(...matches);
    totalSaved += result.saved;

    if (query.paused) {
      const desc = query.type === 'rss' ? query.keywords[0] : query.keywords.join(' ');
      newlyPaused.push(`[${query.id}] ${desc}`);
      if (query.authorHandle) {
        const promoted = promoteNextAuthor(radarConfig);
        if (promoted) promotedAuthors.push(promoted);
      }
    }
  }

  await addPendingMatches(allMatches).catch(() => {});

  radarConfig.lastCycleResults = buildCycleSummary(results);
  radarConfig.lastRunAt = new Date().toISOString();
  await saveRadarConfig(radarConfig);

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
  logger.info('radar', '啟動內容雷達', { interval: `${radarConfig.intervalHours}h`, queries: radarConfig.queries.length });
  return setInterval(() => { runRadarCycle(bot, config, radarConfig).catch(() => {}); }, intervalMs);
}
