/**
 * Proactive intelligence service — scheduled digest push & trend alerts.
 * Transforms KnowPipe from passive collector to active knowledge assistant.
 */
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import type { ProactiveConfig, ProactiveDigest } from './proactive-types.js';
import { DEFAULT_PROACTIVE_CONFIG } from './proactive-types.js';
import { analyzeVaultTrends } from './trend-detector.js';
import { loadProactiveConfig, saveProactiveConfig } from './proactive-store.js';
import { loadRadarConfig } from '../radar/radar-store.js';
import type { RadarCycleSummary } from '../radar/radar-types.js';
import { loadWallConfig } from '../radar/wall-service.js';
import { formatWallSummaryForDigest } from '../radar/wall-service.js';
import { logger } from '../core/logger.js';
import { runWeeklyCycle } from './proactive-weekly.js';
import { generateDailyInsights, formatInsightsSection } from './daily-insights.js';
import { formatDigestMessage, generateDigestInsight } from './proactive-formatter.js';
import { runCompilationCycle } from './compilation-cycle.js';

/** Check if current time is within the configured digest hour (±30 min window). */
function isDigestHour(digestHour: number): boolean {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  // Match the target hour: from HH:00 to HH:30
  return hour === digestHour && minute <= 30;
}

/** Check if digest was already sent today. */
function alreadySentToday(lastDigestAt: string | null): boolean {
  if (!lastDigestAt) return false;
  const last = new Date(lastDigestAt);
  const now = new Date();
  return last.getFullYear() === now.getFullYear()
    && last.getMonth() === now.getMonth()
    && last.getDate() === now.getDate();
}

/** Run proactive digest cycle */
async function runDigestCycle(
  bot: Telegraf,
  config: AppConfig,
  pConfig: ProactiveConfig,
): Promise<void> {
  // Fixed daily schedule: only fire during digestHour window, once per day
  if (!isDigestHour(pConfig.digestHour)) return;
  if (alreadySentToday(pConfig.lastDigestAt)) return;

  logger.info('proactive', '開始生成主動摘要');

  try {
    const { notes, trends, gaps } = await analyzeVaultTrends(config.vaultPath);

    // Count recent notes (last 24 hours)
    const recentCutoff = Date.now() - 24 * 3_600_000;
    const recentNotes = notes.filter(n => new Date(n.date).getTime() >= recentCutoff);

    if (recentNotes.length < pConfig.minNotesForDigest) {
      logger.info('proactive', '近期筆記不足，跳過摘要', { count: recentNotes.length });
      pConfig.lastDigestAt = new Date().toISOString();
      await saveProactiveConfig(pConfig);
      return;
    }

    // Build category breakdown from recent notes
    const catMap = new Map<string, number>();
    for (const n of recentNotes) {
      catMap.set(n.category, (catMap.get(n.category) ?? 0) + 1);
    }
    const categoryBreakdown = [...catMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const hours = pConfig.digestIntervalHours;
    const period = hours >= 24 ? `近 ${Math.round(hours / 24)} 天` : `近 ${hours} 小時`;

    const digest: ProactiveDigest = {
      period,
      totalNotes: recentNotes.length,
      categoryBreakdown,
      trends,
      gaps,
    };

    // Best-effort AI insight (brief summary)
    digest.summary = await generateDigestInsight(digest);

    // Deep insights from daily-insights generator (cross-domain patterns)
    try {
      const insights = await generateDailyInsights(config.vaultPath);
      if (insights.length > 0) {
        digest.insights = formatInsightsSection(insights);
      }
    } catch { /* best-effort */ }

    // Load radar cycle summary for integrated report
    const radarConfig = await loadRadarConfig();
    const radarSummary = radarConfig.lastCycleResults;

    // Load wall config for tool match section
    let wallLines: string[] = [];
    try {
      const wallConfig = await loadWallConfig();
      wallLines = formatWallSummaryForDigest(wallConfig);
    } catch { /* best-effort */ }

    const message = formatDigestMessage(digest, radarSummary, wallLines);
    const userId = getOwnerUserId(config);
    if (userId) {
      await bot.telegram.sendMessage(userId, message.slice(0, 4000));
    }

    pConfig.lastDigestAt = new Date().toISOString();
    await saveProactiveConfig(pConfig);
    logger.info('proactive', '主動摘要完成', { notes: recentNotes.length, trends: trends.length });
  } catch (err) {
    logger.warn('proactive', '主動摘要失敗', { message: (err as Error).message });
  }
}

/** Run trend alert cycle (more frequent than digest) */
async function runTrendCycle(
  bot: Telegraf,
  config: AppConfig,
  pConfig: ProactiveConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = pConfig.trendIntervalHours * 3_600_000;

  if (pConfig.lastTrendAt) {
    const lastTs = new Date(pConfig.lastTrendAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  try {
    const { trends } = await analyzeVaultTrends(config.vaultPath);

    // Only alert for significant new trends (3+ recent mentions, new keyword)
    const significantTrends = trends.filter(t => t.recentCount >= 3 && t.previousCount === 0);

    if (significantTrends.length > 0) {
      const userId = getOwnerUserId(config);
      if (userId) {
        const lines = ['🔔 趨勢提醒', ''];
        for (const t of significantTrends.slice(0, 3)) {
          lines.push(`• 「${t.keyword}」近期出現 ${t.recentCount} 次（之前未出現）`);
        }
        await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
      }
    }

    pConfig.lastTrendAt = new Date().toISOString();
    await saveProactiveConfig(pConfig);
  } catch (err) {
    logger.warn('proactive', '趨勢偵測失敗', { message: (err as Error).message });
  }
}

/** Start proactive intelligence service */
export async function startProactiveService(
  bot: Telegraf,
  config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const pConfig = await loadProactiveConfig();
  if (!pConfig.enabled) {
    logger.info('proactive', '主動推理已停用');
    return [];
  }

  const timers: NodeJS.Timeout[] = [];

  // Digest cycle: check every hour if it's time
  const digestCheckMs = 60 * 60 * 1000; // 1 hour
  timers.push(
    setInterval(() => { runDigestCycle(bot, config, pConfig).catch(() => {}); }, digestCheckMs),
  );

  // Trend cycle: check every 2 hours
  const trendCheckMs = 2 * 60 * 60 * 1000;
  timers.push(
    setInterval(() => { runTrendCycle(bot, config, pConfig).catch(() => {}); }, trendCheckMs),
  );

  // Weekly digest cycle: check every hour (same cadence as daily digest)
  timers.push(
    setInterval(() => { runWeeklyCycle(bot, config, pConfig).catch(() => {}); }, digestCheckMs),
  );

  // Compilation cycle: check every hour
  timers.push(
    setInterval(() => { runCompilationCycle(bot, config, pConfig).catch(() => {}); }, digestCheckMs),
  );

  // Run initial digest check after 5 min delay (let other services init first)
  setTimeout(() => { runDigestCycle(bot, config, pConfig).catch(() => {}); }, 5 * 60 * 1000);

  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  logger.info('proactive', '主動推理服務啟動', {
    digestTime: `每日 ${String(pConfig.digestHour).padStart(2, '0')}:00`,
    weeklyTime: `每週${dayNames[pConfig.weeklyDigestDay]} ${String(pConfig.digestHour).padStart(2, '0')}:00`,
    trendInterval: `${pConfig.trendIntervalHours}h`,
  });

  return timers;
}
