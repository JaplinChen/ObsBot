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
import { startProactiveService } from './proactive/proactive-service.js';
import { startMonitorService } from './monitoring/monitor-service.js';
import { startWallService } from './radar/wall-service.js';
import { registerTimers } from './core/service-registry.js';

const config = loadConfig();
registerAllExtractors();

const bot = createBot(config);

bot.catch((err: unknown) => {
  logger.error('bot', 'Bot error', err);
});

// Load existing rules and knowledge immediately (fast, from disk)
initDynamicClassifier(RULES_PATH).catch((e) => logger.warn('classify', '分類器初始化失敗', { message: (e as Error).message }));
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

// Re-scan vault in background to update rules (slow, but non-blocking)
runVaultLearner(config.vaultPath, RULES_PATH)
  .then((patterns) => refreshFromPatterns(patterns))
  .catch((e) => logger.warn('learn', '啟動學習失敗', { message: (e as Error).message }));

// Start subscription checker in background
loadSubscriptions()
  .then((store) => {
    if (store.subscriptions.length > 0) {
      registerTimers(startSubscriptionChecker(bot, config, store));
    }
  })
  .catch((e) => logger.warn('subscribe', '載入訂閱失敗', { message: (e as Error).message }));

// Start content radar in background
loadRadarConfig()
  .then((radarConfig) => {
    if (radarConfig.enabled && radarConfig.queries.length > 0) {
      registerTimers(startRadarChecker(bot, config, radarConfig));
    }
  })
  .catch((e) => logger.warn('radar', '載入雷達失敗', { message: (e as Error).message }));

// Start proactive intelligence service
startProactiveService(bot, config)
  .then((ts) => registerTimers(...ts))
  .catch((e) => logger.warn('proactive', '啟動主動推理失敗', { message: (e as Error).message }));

// Start self-healing monitoring service
startMonitorService(bot, config)
  .then((ts) => registerTimers(...ts))
  .catch((e) => logger.warn('monitor', '啟動監控服務失敗', { message: (e as Error).message }));

// Start tool wall intelligence service
startWallService(bot, config)
  .then((ts) => registerTimers(...ts))
  .catch((e) => logger.warn('wall', '啟動情報牆失敗', { message: (e as Error).message }));

const forceMode = process.argv.includes('--force');
new ProcessGuardian(bot, forceMode).launch();
