// 設定 process 顯示名稱（Activity Monitor 顯示為 KnowPipe）
process.title = 'KnowPipe';

import { loadConfig, getOwnerUserId } from './utils/config.js';
import { logger } from './core/logger.js';
import { registerAllExtractors } from './extractors/index.js';
import { createBot } from './bot.js';
import { ProcessGuardian } from './process-guardian.js';
import { initDynamicClassifier, refreshFromPatterns } from './learning/dynamic-classifier.js';
import { runVaultLearner } from './learning/vault-learner.js';
import { RULES_PATH } from './learning/learn-command.js';
import { loadKnowledge, scanVaultNotes, saveKnowledge } from './knowledge/knowledge-store.js';
import { shouldAutoConsolidate, consolidateVault } from './knowledge/consolidator.js';
import { formatConsolidationReport, saveConsolidationNote } from './knowledge/consolidation-report.js';
import { loadSubscriptions } from './subscriptions/subscription-store.js';
import { startSubscriptionChecker } from './subscriptions/subscription-checker.js';
import { loadRadarConfig } from './radar/radar-store.js';
import { startRadarChecker } from './radar/radar-service.js';
import { startVideoQueue } from './radar/video-queue.js';
import { startProactiveService } from './proactive/proactive-service.js';
import { startMonitorService } from './monitoring/monitor-service.js';
import { startWallService } from './radar/wall-service.js';
import { startPatrolService } from './patrol/patrol-service.js';
import { registerTimers } from './core/service-registry.js';
import { getUserConfig } from './utils/user-config.js';
import { startAdminServer } from './admin/server.js';
import { startQuickTunnel } from './admin/tunnel-service.js';
import { runDataIntegrityCheck } from './core/safe-write.js';
import { setOnBreakerOpen } from './monitoring/circuit-breaker.js';
import { runMigrations } from './core/migrator.js';

// 啟動前資料完整性檢查 + schema 遷移
const integrityIssues = await runDataIntegrityCheck();
await runMigrations();

const config = loadConfig();
const userConfig = getUserConfig();
const feat = userConfig.features;
await registerAllExtractors();

const bot = createBot(config);

bot.catch((err: unknown) => {
  logger.error('bot', 'Bot error', err);
});

// 熔斷器告警：平台連續失敗時主動通知 owner
setOnBreakerOpen((platform, failures) => {
  const userId = getOwnerUserId(config);
  if (userId) {
    bot.telegram.sendMessage(
      userId,
      `⚡ 熔斷器警報：${platform} 連續 ${failures} 次失敗，已暫停 5 分鐘。`,
    ).catch(() => {});
  }
});

// Startup health tracking
const startupResults: Array<{ name: string; ok: boolean; error?: string }> = [];
if (integrityIssues.length > 0) {
  startupResults.push({ name: '資料完整性', ok: false, error: `${integrityIssues.length} 個檔案需修復` });
} else {
  startupResults.push({ name: '資料完整性', ok: true });
}

// Load existing rules and knowledge immediately (fast, from disk)
initDynamicClassifier(RULES_PATH)
  .then(() => startupResults.push({ name: '分類器', ok: true }))
  .catch((e) => { startupResults.push({ name: '分類器', ok: false, error: (e as Error).message }); logger.warn('classify', '分類器初始化失敗', { message: (e as Error).message }); });
if (feat.consolidation) {
  loadKnowledge()
    .then(async (knowledge) => {
      if (!shouldAutoConsolidate(knowledge)) return;
      logger.info('consolidate', '距上次整合超過 7 天，背景自動整合');
      try {
        const notes = await scanVaultNotes(config.vaultPath);
        const report = await consolidateVault(notes, knowledge);
        if (report.clusterCount > 0) {
          await saveConsolidationNote(config.vaultPath, report);
          await saveKnowledge(knowledge);
          const text = formatConsolidationReport(report);
          const userId = getOwnerUserId(config);
          if (userId) {
            await bot.telegram.sendMessage(userId, `🧠 自動知識整合完成\n\n${text.slice(0, 3900)}`);
          }
        }
        logger.info('consolidate', '自動整合完成', { clusters: report.clusterCount });
      } catch (e) {
        logger.warn('consolidate', '自動整合失敗', { message: (e as Error).message });
      }
    })
    .catch((e) => logger.warn('knowledge', '知識庫載入失敗', { message: (e as Error).message }));
}

// Re-scan vault in background to update rules (slow, but non-blocking)
runVaultLearner(config.vaultPath, RULES_PATH)
  .then((patterns) => { refreshFromPatterns(patterns); startupResults.push({ name: '學習器', ok: true }); })
  .catch((e) => { startupResults.push({ name: '學習器', ok: false, error: (e as Error).message }); logger.warn('learn', '啟動學習失敗', { message: (e as Error).message }); });

// Start subscription checker in background
loadSubscriptions()
  .then((store) => {
    if (store.subscriptions.length > 0) registerTimers(startSubscriptionChecker(bot, config, store));
    startupResults.push({ name: '訂閱', ok: true });
  })
  .catch((e) => { startupResults.push({ name: '訂閱', ok: false, error: (e as Error).message }); logger.warn('subscribe', '載入訂閱失敗', { message: (e as Error).message }); });

// Start content radar in background
loadRadarConfig()
  .then((radarConfig) => {
    if (radarConfig.enabled && radarConfig.queries.length > 0) registerTimers(startRadarChecker(bot, config, radarConfig));
    startupResults.push({ name: '雷達', ok: true });
  })
  .catch((e) => { startupResults.push({ name: '雷達', ok: false, error: (e as Error).message }); logger.warn('radar', '載入雷達失敗', { message: (e as Error).message }); });

// Start async video transcription queue
registerTimers(startVideoQueue(bot, config));

// Start optional background services
const optionalServices: Array<[boolean, string, () => Promise<NodeJS.Timeout[]>]> = [
  [feat.proactive, '主動推理', () => startProactiveService(bot, config)],
  [feat.monitor, '監控', () => startMonitorService(bot, config)],
  [feat.wall, '情報牆', () => startWallService(bot, config)],
  [feat.patrol, '巡邏', () => startPatrolService(bot, config)],
];
for (const [enabled, name, starter] of optionalServices) {
  if (!enabled) continue;
  starter()
    .then((ts) => { registerTimers(...ts); startupResults.push({ name, ok: true }); })
    .catch((e) => { startupResults.push({ name, ok: false, error: (e as Error).message }); logger.warn(name, `啟動${name}失敗`, { message: (e as Error).message }); });
}

// Start Admin UI server (config management on port 3001)
startAdminServer();

// Quick Tunnel：啟動後透過 Telegram 通知 admin 新 URL
let tunnelUrl: string | undefined;
const ownerId = getOwnerUserId(config);

startQuickTunnel({
  port: 3001,
  onUrl: (url) => {
    tunnelUrl = url;
    if (ownerId) {
      bot.telegram.sendMessage(
        ownerId,
        `🌐 Research 對外網址已就緒\n${url}/research\n\n帳號：${process.env.RESEARCH_USER ?? '（未設定）'}`,
      ).catch(() => {});
    }
  },
  onError: (msg) => {
    logger.warn('tunnel', msg);
    if (ownerId) {
      bot.telegram.sendMessage(ownerId, `⚠️ Tunnel：${msg}`).catch(() => {});
    }
  },
});

// Send startup health summary after services settle (10s delay)
setTimeout(async () => {
  const startupOwnerId = getOwnerUserId(config);
  if (!startupOwnerId) return;
  const ok = startupResults.filter(r => r.ok).map(r => r.name);
  const fail = startupResults.filter(r => !r.ok);
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const lines = [
    `🚀 KnowPipe 啟動完成`,
    `✅ ${ok.length} 個服務正常${ok.length > 0 ? `：${ok.join('、')}` : ''}`,
    ...(fail.length > 0 ? [`❌ ${fail.length} 個服務失敗：${fail.map(f => `${f.name}(${f.error?.slice(0, 30)})`).join('、')}`] : []),
    `💾 記憶體：${heapMB} MB | PID：${process.pid}`,
    ...(tunnelUrl ? [`🌐 Tunnel：${tunnelUrl}/research`] : ['🌐 Tunnel：等待中…']),
  ];
  bot.telegram.sendMessage(startupOwnerId, lines.join('\n')).catch(() => {});
}, 10_000);

const forceMode = process.argv.includes('--force');
new ProcessGuardian(bot, forceMode).launch();
