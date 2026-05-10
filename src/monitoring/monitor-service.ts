/**
 * Self-healing monitoring service — scheduled vault health checks
 * and extractor probing with auto-fix and Telegram alerts.
 */
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import { healVault } from './vault-healer.js';
import { probeAllExtractors, formatHealthAlert } from './extractor-probe.js';
import { loadMonitorConfig, saveMonitorConfig } from './monitor-store.js';
import type { MonitorConfig } from './health-types.js';
import { logger } from '../core/logger.js';
import { getRegisteredExtractors } from '../extractors/index.js';
import type { Extractor } from '../extractors/types.js';
import { cleanupSystemProcesses, getSystemHealthSnapshot } from '../admin/system-health.js';
import { getUserConfig } from '../utils/user-config.js';
import { runIncidentScan, formatIncidentAlert, KNOWN_SIGNATURES } from './incident-detector.js';
import { getDailyDigest } from './incident-log.js';

/** Send Telegram notification to owner */
async function notify(bot: Telegraf, config: AppConfig, message: string): Promise<void> {
  const userId = getOwnerUserId(config);
  if (userId) {
    await bot.telegram.sendMessage(userId, message.slice(0, 4000)).catch(() => {});
  }
}

/** Run vault health check & auto-fix cycle */
async function runVaultHealthCycle(
  bot: Telegraf,
  config: AppConfig,
  monConfig: MonitorConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = monConfig.vaultCheckHours * 3_600_000;

  if (monConfig.lastVaultCheckAt) {
    const lastTs = new Date(monConfig.lastVaultCheckAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('monitor', '開始 Vault 自我修復掃描');

  try {
    const result = await healVault(config.vaultPath);

    if (result.autoFixed > 0 || result.pendingReviewTagged > 0 || result.translated > 0) {
      await notify(bot, config, [
        '🔧 Vault 自動修復完成',
        '',
        `掃描：${result.totalNotes} 篇`,
        `發現問題：${result.issues.length} 個`,
        `自動修復：${result.autoFixed} 個`,
        result.translated > 0 ? `翻譯為繁體中文：${result.translated} 篇` : '',
        result.pendingReviewTagged > 0 ? `標記待審：${result.pendingReviewTagged} 篇` : '',
        '',
        ...result.issues.filter(i => i.fixed).slice(0, 10).map(i => `✅ ${i.file} — ${i.issue}`),
        ...(result.pendingReviewTagged > 0
          ? result.issues.filter(i => i.severity === 'needs_review').slice(0, 5).map(i => `⚠️ ${i.file} — ${i.issue}`)
          : []),
      ].filter(Boolean).join('\n'));
    }

    monConfig.lastVaultCheckAt = new Date().toISOString();
    await saveMonitorConfig(monConfig);
  } catch (err) {
    logger.warn('monitor', 'Vault 健康檢查失敗', { message: (err as Error).message });
  }
}

/** Run extractor health probe cycle */
async function runExtractorProbeCycle(
  bot: Telegraf,
  config: AppConfig,
  monConfig: MonitorConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = monConfig.extractorCheckHours * 3_600_000;

  if (monConfig.lastExtractorCheckAt) {
    const lastTs = new Date(monConfig.lastExtractorCheckAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('monitor', '開始 Extractor 健康檢測');

  try {
    const extractors = ([...getRegisteredExtractors()] as Extractor[]).map((e: Extractor) => ({
      platform: e.platform,
      extract: (url: string) => e.extract(url),
    }));

    const health = await probeAllExtractors(extractors, monConfig.extractorHealth);
    monConfig.extractorHealth = health;

    // Alert on degraded/down extractors
    const alert = formatHealthAlert(health);
    if (alert) {
      await notify(bot, config, alert);
    }

    monConfig.lastExtractorCheckAt = new Date().toISOString();
    await saveMonitorConfig(monConfig);
  } catch (err) {
    logger.warn('monitor', 'Extractor 探測失敗', { message: (err as Error).message });
  }
}

/** Run conservative memory cleanup cycle */
async function runMemoryCleanupCycle(
  bot: Telegraf,
  config: AppConfig,
  monConfig: MonitorConfig,
): Promise<void> {
  const tuning = getUserConfig().monitor;
  if (!tuning.memoryCleanupEnabled) return;

  const now = Date.now();
  const cooldownMs = tuning.cooldownMinutes * 60 * 1000;
  if (monConfig.lastMemoryCleanupAt) {
    const lastTs = new Date(monConfig.lastMemoryCleanupAt).getTime();
    if (now - lastTs < cooldownMs) return;
  }

  const snapshot = await getSystemHealthSnapshot();
  const free = snapshot.freeMemoryPercent;
  if (free === null || free >= tuning.freeThresholdPercent) return;

  const killed = new Set<number>();
  if (snapshot.candidates.some((candidate) => candidate.label === 'oMLX')) {
    const result = await cleanupSystemProcesses('omlx');
    result.killedPids.forEach((pid) => killed.add(pid));
  }

  const shouldTrimClaude = free < tuning.claudeThresholdPercent && snapshot.claudeSessions.length > 0;
  if (shouldTrimClaude) {
    const result = await cleanupSystemProcesses('claude-cli');
    result.killedPids.forEach((pid) => killed.add(pid));
  }

  if (killed.size === 0) return;

  monConfig.lastMemoryCleanupAt = new Date().toISOString();
  await saveMonitorConfig(monConfig);

  logger.info('monitor', '保守自動記憶體清理完成', {
    freeMemoryPercent: free,
    killedPids: [...killed],
    claudeSessions: snapshot.claudeSessions.length,
  });

  await notify(bot, config, [
    '🧹 自動記憶體清理完成',
    `系統可用記憶體：${free}%`,
    `已處理 PID：${[...killed].join(', ')}`,
    `Claude sessions：${snapshot.claudeSessions.length}`,
  ].join('\n'));
}

/** Start self-healing monitoring service */
export async function startMonitorService(
  bot: Telegraf,
  config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const monConfig = await loadMonitorConfig();
  const tuning = getUserConfig().monitor;
  const timers: NodeJS.Timeout[] = [];

  // Vault health cycle: check every 4 hours
  const vaultCheckMs = 4 * 60 * 60 * 1000;
  timers.push(
    setInterval(
      () => { runVaultHealthCycle(bot, config, monConfig).catch((e) => logger.warn('monitor', 'vault 健康檢查失敗', { message: (e as Error).message })); },
      vaultCheckMs,
    ),
  );

  // Extractor probe cycle: check every 8 hours
  const extractorCheckMs = 8 * 60 * 60 * 1000;
  timers.push(
    setInterval(
      () => { runExtractorProbeCycle(bot, config, monConfig).catch((e) => logger.warn('monitor', 'extractor 探測失敗', { message: (e as Error).message })); },
      extractorCheckMs,
    ),
  );

  // Conservative memory cleanup: check every 15 min
  const memoryCleanupIntervalMs = tuning.intervalMinutes * 60 * 1000;
  timers.push(
    setInterval(
      () => { runMemoryCleanupCycle(bot, config, monConfig).catch((e) => logger.warn('monitor', 'memory cleanup 失敗', { message: (e as Error).message })); },
      memoryCleanupIntervalMs,
    ),
  );

  // Incident scan: check every 5 min，偵測已知錯誤簽名並推播警報
  const INCIDENT_SCAN_MS = 5 * 60 * 1000;
  timers.push(
    setInterval(() => {
      runIncidentScan().then(async (count) => {
        if (count === 0) return;
        const digest = await getDailyDigest();
        const topSig = Object.entries(digest.bySignature)
          .sort(([, a], [, b]) => b - a)[0];
        if (topSig) {
          const msg = formatIncidentAlert(topSig[0], topSig[1]);
          await notify(bot, config, msg);
        }
      }).catch((e) => logger.warn('monitor', 'incident scan 失敗', { message: (e as Error).message }));
    }, INCIDENT_SCAN_MS),
  );

  // Initial vault check after 10 min (non-blocking)
  setTimeout(
    () => { runVaultHealthCycle(bot, config, monConfig).catch((e) => logger.warn('monitor', 'vault 初始檢查失敗', { message: (e as Error).message })); },
    10 * 60 * 1000,
  );
  setTimeout(
    () => { runMemoryCleanupCycle(bot, config, monConfig).catch((e) => logger.warn('monitor', 'memory 初始清理失敗', { message: (e as Error).message })); },
    5 * 60 * 1000,
  );

  logger.info('monitor', '自我修復監控啟動', {
    vaultCheck: `${monConfig.vaultCheckHours}h`,
    extractorCheck: `${monConfig.extractorCheckHours}h`,
    memoryCleanup: `${memoryCleanupIntervalMs / 60000}m`,
  });

  return timers;
}
