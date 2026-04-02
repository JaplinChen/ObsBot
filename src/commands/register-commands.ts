/**
 * Centralized command registration.
 * Keeps lightweight orchestration while command groups live in dedicated modules.
 */
import type { Context, Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleTimeline } from './timeline-command.js';
import { handleMonitor, handleSearch } from './monitor-command.js';
import { handleKnowledge, handleGaps, handleSkills, handleAnalyze, handleDashboard } from './knowledge-command.js';
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
import { handleDigestMenu, handleDigest, handleWeeklyDigest } from './digest-command.js';
import { handleSuggest } from './suggest-command.js';
import { handleRadar, handleRadarAction } from './radar-command.js';
import { handleBenchmark } from './benchmark-command.js';
import {
  handleExplore, handleRecommendByTopic, handleBriefByTopic,
  handleCompareByArg, handleModePicker, resolveCallbackToken,
} from './knowledge-query-command.js';
import { handleDeepSynthesis, handleSaveToVault } from './explore-deep-command.js';
import { runCommandTask } from './command-runner.js';
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
// Hub dispatchers
import { handleSearchHub, handleSearchCallback } from './search-hub.js';
import { handleTrackHub, handleTrackCallback } from './track-hub.js';
import { createVaultHub, createVaultCallback } from './vault-hub.js';
import { createAdminHub, createAdminCallback } from './admin-hub.js';
import { handleConfig, handleConfigFeatureToggle, handleConfigResetConfirm, handleConfigResetCancel } from './config-command.js';

export { formatErrorMessage };

type MatchedContext = Context & { match: RegExpExecArray };

function registerAsyncCommand(
  bot: Telegraf,
  command: string | readonly string[],
  tag: string,
  config: AppConfig,
  handler: (ctx: Context, config: AppConfig) => Promise<void>,
): void {
  bot.command(command as string | string[], (ctx) => {
    runCommandTask(ctx, tag, () => handler(ctx, config), formatErrorMessage).catch(() => {});
  });
}

function registerAsyncAction(
  bot: Telegraf,
  pattern: RegExp,
  tag: string,
  handler: (ctx: MatchedContext) => Promise<void>,
): void {
  bot.action(pattern, (ctx) => {
    const matchedCtx = ctx as MatchedContext;
    runCommandTask(matchedCtx, tag, () => handler(matchedCtx), formatErrorMessage).catch(() => {});
  });
}

export function registerCommands(
  bot: Telegraf,
  config: AppConfig,
  stats: BotStats,
  startTime: number,
): void {
  bot.start((ctx) => ctx.reply(HELP_TEXT, HELP_KEYBOARD));
  bot.command('help', (ctx) => {
    const arg = (ctx.message?.text ?? '').split(/\s+/)[1];
    if (arg === 'all') { ctx.reply(HELP_ALL_TEXT); return; }
    ctx.reply(HELP_TEXT, HELP_KEYBOARD);
  });

  registerLearningCommands(bot, config, formatErrorMessage);

  // Build closure-based handlers
  const statusHandler = createStatusHandler(stats, startTime);
  const clearHandler = createClearHandler(stats);
  const handleVaultHub = createVaultHub(stats);
  const handleAdminHub = createAdminHub(statusHandler, clearHandler);
  const handleVaultCallback = createVaultCallback(stats);
  const handleAdminCb = createAdminCallback(statusHandler, clearHandler);

  // === PRIMARY COMMANDS (shown in Telegram menu) ===
  registerAsyncCommand(bot, 'search', 'search-hub', config, handleSearchHub);
  registerAsyncCommand(bot, 'ask', 'ask', config, handleAsk);
  registerAsyncCommand(bot, 'explore', 'explore', config, handleExplore);
  registerAsyncCommand(bot, 'digest', 'digest', config, handleDigestMenu);
  registerAsyncCommand(bot, 'discover', 'discover', config, handleDiscover);
  registerAsyncCommand(bot, 'radar', 'radar', config, handleRadar);
  registerAsyncCommand(bot, 'track', 'track-hub', config, handleTrackHub);
  registerAsyncCommand(bot, 'vault', 'vault-hub', config, handleVaultHub);
  registerAsyncCommand(bot, 'admin', 'admin-hub', config, handleAdminHub);
  registerAsyncCommand(bot, 'config', 'config', config, handleConfig);
  registerAsyncCommand(bot, 'knowledge', 'knowledge', config, handleKnowledge);

  // === BACKWARD-COMPATIBLE ALIASES (not in menu) ===
  registerAsyncCommand(bot, 'find', 'find', config, handleFind);
  registerAsyncCommand(bot, 'monitor', 'monitor', config, handleMonitor);
  registerAsyncCommand(bot, 'vsearch', 'vsearch', config, handleVsearch);
  registerAsyncCommand(bot, 'timeline', 'timeline', config, handleTimeline);
  registerAsyncCommand(bot, 'subscribe', 'subscribe', config, handleSubscribe);
  registerAsyncCommand(bot, 'patrol', 'patrol', config, handlePatrol);
  registerAsyncCommand(bot, 'reprocess', 'reprocess', config, handleReprocess);
  registerAsyncCommand(bot, 'reformat', 'reformat', config, handleReformat);
  registerAsyncCommand(bot, 'dedup', 'dedup', config, handleDedup);
  registerAsyncCommand(bot, 'quality', 'quality', config, handleQuality);
  registerAsyncCommand(bot, 'benchmark', 'benchmark', config, handleBenchmark);
  registerAsyncCommand(bot, 'retry', 'retry', config, createRetryHandler(stats));
  registerAsyncCommand(bot, 'suggest', 'suggest', config, handleSuggest);
  registerAsyncCommand(bot, 'toolkit', 'toolkit', config, handleToolkit);
  registerAsyncCommand(bot, 'memory', 'memory-export', config, handleMemoryExport);

  // --- InlineKeyboard: /knowledge sub-actions ---
  registerAsyncAction(bot, /^kb:(.+)$/, 'knowledge-action', async (ctx) => {
    const mode = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      gaps: handleGaps,
      skills: handleSkills,
      preferences: handlePreferences,
      dashboard: handleDashboard,
      analyze: handleAnalyze,
    };
    const handler = handlers[mode];
    if (handler) await handler(ctx, config);
  });

  // --- InlineKeyboard: navigation shortcuts ---
  registerAsyncAction(bot, /^nav:(.+)$/, 'nav-shortcut', async (ctx) => {
    const target = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const navHandlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      explore: handleExplore,
      discover: handleDiscover,
      knowledge: handleKnowledge,
      digest: handleDigestMenu,
    };
    const handler = navHandlers[target];
    if (handler) await handler(ctx, config);
  });

  // --- InlineKeyboard: /explore sub-actions (token-based) ---
  const resolveAndRun = (
    cmd: string, handler: (ctx: MatchedContext, resolved: string) => Promise<void>, ack?: string,
  ) => async (ctx: MatchedContext) => {
    const resolved = resolveCallbackToken(cmd, ctx.match![1]);
    await ctx.answerCbQuery(ack).catch(() => {});
    if (!resolved) { await replyExpired(ctx, 'explore', '重新探索'); return; }
    await handler(ctx, resolved);
  };

  registerAsyncAction(bot, /^xpick:(.+)$/, 'explore-pick', resolveAndRun('xpick', (c, t) => handleModePicker(c, t)));
  registerAsyncAction(bot, /^xrec:(.+)$/, 'explore-action', resolveAndRun('xrec', (c, t) => handleRecommendByTopic(c, t)));
  registerAsyncAction(bot, /^xbrf:(.+)$/, 'explore-action', resolveAndRun('xbrf', (c, t) => handleBriefByTopic(c, t)));
  registerAsyncAction(bot, /^compare:(.+)$/, 'compare-action', resolveAndRun('compare', (c, a) => handleCompareByArg(c, a)));
  registerAsyncAction(bot, /^xdeep:(.+)$/, 'explore-deep', resolveAndRun('xdeep', (c, t) => handleDeepSynthesis(c, t, config)));
  registerAsyncAction(bot, /^xsave:(.+)$/, 'explore-save', resolveAndRun('xsave', (c, p) => handleSaveToVault(c, p, config), '存入 Vault 中…'));

  // --- InlineKeyboard: /digest sub-actions ---
  registerAsyncAction(bot, /^dg:(.+)$/, 'digest-action', async (ctx) => {
    const mode = ctx.match![1];
    await ctx.answerCbQuery().catch(() => {});
    const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
      digest: handleDigest,
      weekly: handleWeeklyDigest,
      distill: handleDistill,
      consolidate: handleConsolidate,
    };
    const handler = handlers[mode];
    if (handler) await handler(ctx, config);
  });

  // --- InlineKeyboard: hub callbacks ---
  registerAsyncAction(bot, /^srch:(.+)$/, 'search-hub-cb', handleSearchCallback);
  registerAsyncAction(bot, /^trk:(.+)$/, 'track-hub-cb', async (ctx) => {
    await handleTrackCallback(ctx, config);
  });
  registerAsyncAction(bot, /^vlt:(.+)$/, 'vault-hub-cb', async (ctx) => {
    await handleVaultCallback(ctx, config);
  });
  registerAsyncAction(bot, /^adm:(.+)$/, 'admin-hub-cb', async (ctx) => {
    await handleAdminCb(ctx, config);
  });

  // --- InlineKeyboard: /help category ---
  registerAsyncAction(bot, /^help:(.+)$/, 'help-category', handleHelpCategory);

  registerAsyncAction(bot, /^retry:(.+)$/, 'retry-action', createRetryActionHandler(stats, config));

  // --- InlineKeyboard: config actions ---
  registerAsyncAction(bot, /^cfg:feat:.+$/, 'config-feat', async (ctx) => {
    await handleConfigFeatureToggle(ctx);
  });
  registerAsyncAction(bot, /^cfg:reset:confirm$/, 'config-reset', async (ctx) => {
    await handleConfigResetConfirm(ctx);
  });
  registerAsyncAction(bot, /^cfg:reset:cancel$/, 'config-cancel', async (ctx) => {
    await handleConfigResetCancel(ctx);
  });

  // --- InlineKeyboard: admin actions ---
  registerAsyncAction(bot, /^admin:restart-confirm$/, 'admin-restart', async (ctx) => {
    await handleRestartConfirm(ctx);
  });
  registerAsyncAction(bot, /^admin:cancel$/, 'admin-cancel', async (ctx) => {
    await handleAdminCancel(ctx);
  });

  registerAsyncAction(bot, /^dedup:fix$/, 'dedup-fix', async (ctx) => {
    await ctx.answerCbQuery('開始刪除…').catch(() => {});
    await handleDedupFix(ctx, config);
  });

  registerAsyncAction(bot, /^quality:fix$/, 'quality-fix', async (ctx) => {
    await ctx.answerCbQuery('開始修復…').catch(() => {});
    const paths = getLastWorstPaths();
    if (paths.length === 0) { await ctx.reply('沒有待修復的筆記。'); return; }
    await ctx.reply(`🔄 正在重新處理 ${paths.length} 篇筆記…`);
    const pathArgs = paths.join(' ');
    const msg = ctx.message as unknown as Record<string, unknown> | undefined;
    if (!msg) { (ctx as unknown as Record<string, unknown>).message = { text: `/reprocess ${pathArgs}` }; }
    else { msg.text = `/reprocess ${pathArgs}`; }
    await handleReprocess(ctx, config);
  });

  // --- InlineKeyboard: /subscribe actions ---
  registerAsyncAction(bot, /^sub:(.+)$/, 'subscribe-action', async (ctx) => {
    await handleSubscribeAction(ctx, config);
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
  registerForceReplyHandler('search', (ctx) =>
    runCommandTask(ctx, 'search', () => handleSearch(ctx, config), formatErrorMessage));
  registerForceReplyHandler('monitor', (ctx) =>
    runCommandTask(ctx, 'monitor', () => handleMonitor(ctx, config), formatErrorMessage));
  registerForceReplyHandler('timeline', (ctx) =>
    runCommandTask(ctx, 'timeline', () => handleTimeline(ctx, config), formatErrorMessage));
  registerForceReplyHandler('explore', (ctx) =>
    runCommandTask(ctx, 'explore', () => handleExplore(ctx, config), formatErrorMessage));
  registerForceReplyHandler('ask', (ctx) =>
    runCommandTask(ctx, 'ask', () => handleAsk(ctx, config), formatErrorMessage));
  registerForceReplyHandler('discover', (ctx) =>
    runCommandTask(ctx, 'discover', () => handleDiscover(ctx, config), formatErrorMessage));
  registerForceReplyHandler('reprocess', (ctx) =>
    runCommandTask(ctx, 'reprocess', () => handleReprocess(ctx, config), formatErrorMessage));
  registerForceReplyHandler('reformat', (ctx) =>
    runCommandTask(ctx, 'reformat', () => handleReformat(ctx, config), formatErrorMessage));
  registerForceReplyHandler('subscribe', (ctx) =>
    runCommandTask(ctx, 'subscribe', () => handleSubscribe(ctx, config), formatErrorMessage));
  registerForceReplyHandler('find', (ctx) =>
    runCommandTask(ctx, 'find', () => handleFind(ctx, config), formatErrorMessage));
  registerForceReplyHandler('vsearch-hub', (ctx) =>
    runCommandTask(ctx, 'vsearch', () => handleVsearch(ctx, config), formatErrorMessage));

  registerInfoCommands(bot, stats, startTime);

  // --- Register command menu ---
  bot.telegram
    .setMyCommands(BOT_COMMANDS_MENU)
    .catch((err) => logger.warn('bot', 'setMyCommands failed', err));
}
