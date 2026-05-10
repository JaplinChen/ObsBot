/** Centralized command registration — orchestration only, logic in dedicated modules. */
import type { Context, Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleTimeline } from './timeline-command.js';
import { handleMonitor, handleSearch } from './monitor-command.js';
import { handleKnowledge, handleGaps, handleSkills, handleAnalyze, handleDashboard, handleHealth, handleCompile } from './knowledge-command.js';
import { handleSkillsCommand, registerSkillCallbacks } from './skill-command.js';
import { handlePreferences, handleDistill } from './distill-command.js';
import { handleConsolidate } from './consolidate-command.js';
import { handleAsk } from './ask-command.js';
import { handleDiscover, resolveDiscoverToken } from './discover-command.js';
import { processUrl } from '../messages/services/process-url-service.js';
import { handleReprocess } from './reprocess-command.js';
import { handleReformat } from './reformat-command.js';
import { handleDedup, handleDedupFix } from './dedup-command.js';
import { createRetryHandler, createRetryActionHandler } from './retry-command.js';
import { handleSubscribe, handleSubscribeAction } from './subscribe-command.js';
import { handleQuality, getLastWorstPaths } from './quality-command.js';
import { handleDigestMenu, handleDigest, handleWeeklyDigest, handleKnowledgeCards } from './digest-command.js';
import { handleSuggest } from './suggest-command.js';
import { handleRadar, handleRadarAction } from './radar-command.js';
import { handleBenchmark } from './benchmark-command.js';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { registerForceReplyHandler } from '../messages/force-reply-router.js';
import { BOT_COMMANDS_MENU, HELP_TEXT, HELP_ALL_TEXT, HELP_KEYBOARD, handleHelpCategory } from './command-help.js';
import { replyExpired } from './reply-buttons.js';
import { registerLearningCommands } from './register-learning-commands.js';
import { registerInfoCommands, createStatusHandler, createClearHandler } from './register-info-commands.js';
import type { BotStats } from '../messages/types.js';
import { handleRestartConfirm, handleAdminCancel } from './admin-command.js';
import { handleFind } from './find-command.js';
import { handlePatrol } from './patrol-command.js';
import { handleCodeAction } from './code-command.js';
import { handleVsearch } from './vsearch-command.js';
import { handleToolkit } from './toolkit-command.js';
import { handleMemoryExport } from './memory-export-command.js';
import { handleConfig, handleConfigFeatureToggle, handleConfigExtractorToggle, handleConfigResetConfirm, handleConfigResetCancel } from './config-command.js';
import { handleResearch, handleSlides, handleAnki } from '../research/research-commands.js';
import { handleReclassifyPicker, handleReclassifyMove } from './reclassify-action.js';
import { handleSearchHub, handleSearchCallback } from './search-hub.js';
import { handleMonitorTopic, handleMonitorAuthor } from './monitor-command.js';
import { handleRadarAddKeyword, handleRadarAddAuthor } from './radar-callbacks.js';
import { handleTrackHub, handleTrackCallback } from './track-hub.js';
import { handleDislikeAction } from '../utils/dislike-action.js';
import { handleFilter } from './filter-command.js';
import { createVaultHub, createVaultCallback } from './vault-hub.js';
import { createAdminHub, createAdminCallback } from './admin-hub.js';
import {
  createForceReplyRunner,
  mutateContextMessageText,
  registerActionSet,
  registerAsyncAction,
  registerCommandSet,
  type ActionRegistration,
  type CommandRegistration,
  type ForceReplyRegistration,
  type MatchedContext,
} from './register-command-helpers.js';

export function registerCommands(
  bot: Telegraf,
  config: AppConfig,
  stats: BotStats,
  startTime: number,
): void {
  bot.start((ctx) => ctx.reply(HELP_TEXT, HELP_KEYBOARD));
  bot.command('help', (ctx) => {
    ctx.reply((ctx.message?.text ?? '').includes('all') ? HELP_ALL_TEXT : HELP_TEXT, HELP_KEYBOARD);
  });

  registerLearningCommands(bot, config, formatErrorMessage);

  // Build closure-based handlers
  const statusHandler = createStatusHandler(stats, startTime);
  const clearHandler = createClearHandler(stats);
  const handleVaultHub = createVaultHub(stats);
  const handleAdminHub = createAdminHub(statusHandler, clearHandler);
  const handleVaultCallback = createVaultCallback(stats);
  const handleAdminCb = createAdminCallback(statusHandler, clearHandler);

  const commandRegistrations: CommandRegistration[] = [
    { command: 'search', tag: 'search-hub', handler: handleSearchHub },
    { command: 'ask', tag: 'ask', handler: handleAsk },
    { command: 'digest', tag: 'digest', handler: handleDigestMenu },
    { command: 'discover', tag: 'discover', handler: handleDiscover },
    { command: 'radar', tag: 'radar', handler: handleRadar },
    { command: 'track', tag: 'track-hub', handler: handleTrackHub },
    { command: 'vault', tag: 'vault-hub', handler: handleVaultHub },
    { command: 'admin', tag: 'admin-hub', handler: handleAdminHub },
    { command: 'knowledge', tag: 'knowledge', handler: handleKnowledge },
    { command: 'find', tag: 'find', handler: handleFind },
    { command: 'monitor', tag: 'monitor', handler: handleMonitor },
    { command: 'vsearch', tag: 'vsearch', handler: handleVsearch },
    { command: 'timeline', tag: 'timeline', handler: handleTimeline },
    { command: 'subscribe', tag: 'subscribe', handler: handleSubscribe },
    { command: 'patrol', tag: 'patrol', handler: handlePatrol },
    { command: 'reprocess', tag: 'reprocess', handler: handleReprocess },
    { command: 'reformat', tag: 'reformat', handler: handleReformat },
    { command: 'dedup', tag: 'dedup', handler: handleDedup },
    { command: 'quality', tag: 'quality', handler: handleQuality },
    { command: 'benchmark', tag: 'benchmark', handler: handleBenchmark },
    { command: 'retry', tag: 'retry', handler: createRetryHandler(stats) },
    { command: 'suggest', tag: 'suggest', handler: handleSuggest },
    { command: 'toolkit', tag: 'toolkit', handler: handleToolkit },
    { command: 'memory', tag: 'memory-export', handler: handleMemoryExport },
    { command: 'config', tag: 'config', handler: handleConfig },
    { command: 'compile', tag: 'compile', handler: handleCompile },
    { command: 'skillmgr', tag: 'skillmgr', handler: handleSkillsCommand },
    { command: 'research', tag: 'research', handler: handleResearch },
    { command: 'slides', tag: 'slides', handler: handleSlides },
    { command: 'anki', tag: 'anki', handler: handleAnki },
    { command: 'filter', tag: 'filter', handler: handleFilter },
  ];
  registerCommandSet(bot, config, commandRegistrations);
  // --- InlineKeyboard sub-actions ---
  registerAsyncAction(bot, /^kb:(.+)$/, 'knowledge-action', async (ctx) => {
    const mode = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      gaps: handleGaps,
      skills: handleSkills,
      preferences: handlePreferences,
      dashboard: handleDashboard,
      analyze: handleAnalyze,
      health: handleHealth,
    };
    const handler = handlers[mode];
    if (handler) await handler(ctx, config);
  });
  registerSkillCallbacks(bot, config);

  // --- InlineKeyboard: /digest sub-actions ---
  registerAsyncAction(bot, /^dg:(.+)$/, 'digest-action', async (ctx) => {
    const mode = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      digest: handleDigest,
      weekly: handleWeeklyDigest,
      distill: handleDistill,
      consolidate: handleConsolidate,
      cards: handleKnowledgeCards,
    };
    const handler = handlers[mode];
    if (handler) await handler(ctx, config);
  });

  const navHandlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
    discover: handleDiscover,
    knowledge: handleKnowledge,
    digest: handleDigestMenu,
  };
  const passthroughActions: ActionRegistration[] = [
    { pattern: /^srch:(.+)$/, tag: 'search-hub-cb', handler: async (ctx) => handleSearchCallback(ctx, config) },
    { pattern: /^trk:(.+)$/, tag: 'track-hub-cb', handler: async (ctx) => handleTrackCallback(ctx, config) },
    { pattern: /^vlt:(.+)$/, tag: 'vault-hub-cb', handler: async (ctx) => handleVaultCallback(ctx, config) },
    { pattern: /^adm:(.+)$/, tag: 'admin-hub-cb', handler: async (ctx) => handleAdminCb(ctx, config) },
    { pattern: /^help:(.+)$/, tag: 'help-category', handler: handleHelpCategory },
    { pattern: /^retry:(.+)$/, tag: 'retry-action', handler: createRetryActionHandler(stats, config) },
    { pattern: /^admin:restart-confirm$/, tag: 'admin-restart', handler: async (ctx) => handleRestartConfirm(ctx) },
    { pattern: /^admin:cancel$/, tag: 'admin-cancel', handler: async (ctx) => handleAdminCancel(ctx) },
    {
      pattern: /^dedup:fix$/,
      tag: 'dedup-fix',
      handler: async (ctx) => {
        await ctx.answerCbQuery('開始刪除…').catch(() => {});
        await handleDedupFix(ctx, config);
      },
    },
    {
      pattern: /^nav:(.+)$/,
      tag: 'nav-shortcut',
      handler: async (ctx) => {
        const target = ctx.match![1];
        await ctx.answerCbQuery().catch(() => {});
        const handler = navHandlers[target];
        if (handler) await handler(ctx, config);
      },
    },
  ];
  registerActionSet(bot, passthroughActions);

  registerAsyncAction(bot, /^quality:fix$/, 'quality-fix', async (ctx) => {
    await ctx.answerCbQuery('開始修復…').catch(() => {});
    const paths = getLastWorstPaths();
    if (paths.length === 0) { await ctx.reply('沒有待修復的筆記。'); return; }
    await ctx.reply(`🔄 正在重新處理 ${paths.length} 篇筆記…`);
    const pathArgs = paths.join(' ');
    mutateContextMessageText(ctx, `/reprocess ${pathArgs}`);
    await handleReprocess(ctx, config);
  });

  // --- InlineKeyboard: /subscribe actions ---
  registerAsyncAction(bot, /^sub:(.+)$/, 'subscribe-action', async (ctx) => {
    await handleSubscribeAction(ctx, config);
  });

  // --- InlineKeyboard: /config + reclassify actions ---
  bot.action(/^cfg:feat:(.+)$/, (ctx) => { handleConfigFeatureToggle(ctx).catch(() => {}); });
  bot.action(/^cfg:ext:(.+)$/, (ctx) => { handleConfigExtractorToggle(ctx).catch(() => {}); });
  bot.action(/^cfg:reset:(confirm|cancel)$/, (ctx) => {
    (ctx.match![1] === 'confirm' ? handleConfigResetConfirm : handleConfigResetCancel)(ctx).catch(() => {});
  });
  bot.action(/^recat:(.+)$/, (ctx) => { handleReclassifyPicker(ctx).catch(() => {}); });
  bot.action(/^rcmv:(.+)$/, (ctx) => { handleReclassifyMove(ctx).catch(() => {}); });

  // --- InlineKeyboard: 👎 不感興趣 ---
  registerAsyncAction(bot, /^dislike:(.+)$/, 'dislike-action', async (ctx) => {
    const token = ctx.match![1];
    await handleDislikeAction(ctx, token);
  });

  // --- InlineKeyboard: /code action ---
  registerAsyncAction(bot, /^code:(.+)$/, 'code-action', handleCodeAction);

  // --- InlineKeyboard: /radar sub-actions ---
  registerAsyncAction(bot, /^radar:(.+)$/, 'radar-action', async (ctx) => {
    const action = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    await handleRadarAction(ctx, action, config);
  });

  // --- InlineKeyboard: /discover save-to-vault ---
  registerAsyncAction(bot, /^dsc:(.+)$/, 'discover-save', async (ctx) => {
    const token = ctx.match![1];
    const url = resolveDiscoverToken(token);
    if (!url) {
      await ctx.answerCbQuery('按鈕已過期').catch(() => {});
      await replyExpired(ctx, 'discover', '重新探索');
      return;
    }
    await ctx.answerCbQuery('存入 Vault 中…').catch(() => {});
    const result = await processUrl(url, config, stats);
    if (result.success) {
      const label = result.duplicate ? '📋 已存在' : '✅ 已存入';
      const categoryTag = result.category ? `[${result.category}] ` : '';
      await ctx.reply(`${label}：${categoryTag}${result.title ?? url}`);
    } else if (result.error === 'blocked-domain' || result.error?.includes('403')) {
      await ctx.reply(`⚠️ 此網站無法擷取（存取被拒），已跳過`);
    } else {
      await ctx.reply(`❌ 儲存失敗：${result.error}`);
    }
  });

  // --- ForceReply dispatch ---
  const forceReplyRegistrations: ForceReplyRegistration[] = [
    { key: 'search', tag: 'search', handler: handleSearch },
    { key: 'monitor', tag: 'monitor', handler: handleMonitor },
    { key: 'timeline', tag: 'timeline', handler: handleTimeline },
    { key: 'ask', tag: 'ask', handler: handleAsk },
    { key: 'discover', tag: 'discover', handler: handleDiscover },
    { key: 'reprocess', tag: 'reprocess', handler: handleReprocess },
    { key: 'reformat', tag: 'reformat', handler: handleReformat },
    { key: 'subscribe', tag: 'subscribe', handler: handleSubscribe },
    { key: 'find', tag: 'find', handler: handleFind },
    { key: 'vsearch-hub', tag: 'vsearch', handler: handleVsearch },
  ];
  for (const registration of forceReplyRegistrations) {
    registerForceReplyHandler(
      registration.key,
      createForceReplyRunner(config, registration.handler, registration.tag),
    );
  }

  // --- ForceReply: search topic / author ---
  registerForceReplyHandler('srch-topic', (ctx) => {
    const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
    const topic = text.replace(/^\/srch-topic\s*/i, '').trim();
    return createForceReplyRunner(
      config,
      (forceReplyCtx, appConfig) => handleMonitorTopic(forceReplyCtx, appConfig, topic),
      'search-topic',
    )(ctx);
  });
  registerForceReplyHandler('srch-author', (ctx) => {
    const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
    const author = text.replace(/^\/srch-author\s*/i, '').trim();
    return createForceReplyRunner(
      config,
      (forceReplyCtx, appConfig) => handleMonitorAuthor(forceReplyCtx, appConfig, author),
      'search-author',
    )(ctx);
  });

  // --- ForceReply: radar add keyword / author ---
  registerForceReplyHandler('radar-keyword', (ctx) =>
    createForceReplyRunner(config, handleRadarAddKeyword, 'radar-add-keyword')(ctx));
  registerForceReplyHandler('radar-author', (ctx) =>
    createForceReplyRunner(config, handleRadarAddAuthor, 'radar-add-author')(ctx));

  registerInfoCommands(bot, stats, startTime);

  // --- Register command menu ---
  bot.telegram
    .setMyCommands(BOT_COMMANDS_MENU)
    .catch((err) => logger.warn('bot', 'setMyCommands failed', err));
}
