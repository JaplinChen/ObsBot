/**
 * /admin — unified system administration entry point.
 * Consolidates status, health, doctor, logs, restart, code, clear, learn.
 * Old commands remain registered for backward compatibility.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleLogs, handleHealth, handleRestart } from './admin-command.js';
import { handleDoctor } from './doctor-command.js';
import { handleDoctorUpgrade, handleDoctorUpgradeRun } from './doctor-upgrade-command.js';
import { handleCode } from './code-command.js';
import type { BotStats } from '../messages/types.js';
import { cleanupSystemProcesses } from '../admin/system-health.js';
import { logger } from '../core/logger.js';

function rewriteText(ctx: Context, newCommand: string, args: string): void {
  const text = args ? `${newCommand} ${args}` : newCommand;
  const existingMsg = ctx.message as unknown as Record<string, unknown> | undefined;
  if (existingMsg) {
    existingMsg.text = text;
  } else {
    // Callback query context: ctx.message is getter-only (reads ctx.update.message).
    // Spread the real callback message to preserve chat/from so ctx.reply() still works,
    // then override text so downstream handlers can parse the command.
    const cbMsg = (ctx.callbackQuery?.message ?? {}) as Record<string, unknown>;
    (ctx.update as unknown as Record<string, unknown>).message = { ...cbMsg, text };
  }
}

type CtxHandler = (ctx: Context, config: AppConfig) => Promise<void>;

async function showLearnMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    '選擇 Vault 學習操作：',
    Markup.inlineKeyboard([
      [Markup.button.callback('📖 更新分類規則', 'lr:scan')],
      [Markup.button.callback('🔄 重新分類筆記', 'lr:reclassify')],
      [Markup.button.callback('🌐 批次翻譯', 'lr:translate')],
    ]),
  );
}

async function showCleanupMenu(ctx: Context): Promise<void> {
  await ctx.reply(
    '🧹 記憶體清理\n選擇要清理的背景程序：',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🖥 清理 oMLX', 'adm:cleanup:omlx'),
        Markup.button.callback('🤖 清理 Claude CLI', 'adm:cleanup:claude-cli'),
      ],
      [Markup.button.callback('🧼 全部清理', 'adm:cleanup:trim')],
    ]),
  );
}

async function runCleanupAction(ctx: Context, action: 'omlx' | 'claude-cli' | 'trim'): Promise<void> {
  const result = await cleanupSystemProcesses(action);
  logger.info('admin', 'system cleanup triggered', result);
  await ctx.reply(`🧹 清理完成：${action}\n已處理 PID：${result.killedPids.length > 0 ? result.killedPids.join(', ') : '0'}`);
}

/** Build admin hub with status/clear handlers injected at registration time */
export function createAdminHub(
  statusHandler: (ctx: Context) => Promise<void>,
  clearHandler: (ctx: Context) => Promise<void>,
) {
  return async function handleAdminHub(ctx: Context, config: AppConfig): Promise<void> {
    const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
    const parts = text.replace(/^\/admin\s*/i, '').trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() ?? '';
    const rest = parts.slice(1).join(' ');

    // Simple handlers (no config needed)
    if (sub === 'status') { await statusHandler(ctx); return; }
    if (sub === 'clear') { await clearHandler(ctx); return; }
    if (sub === 'learn') {
      await showLearnMenu(ctx);
      return;
    }
    if (sub === 'cleanup') {
      await showCleanupMenu(ctx);
      return;
    }

    // Config-based handlers
    if (sub === 'upgrade') {
      if (rest === 'run') { await handleDoctorUpgradeRun(ctx, config); return; }
      if (rest === 'recent') { await handleDoctorUpgradeRun(ctx, config, true); return; }
      await handleDoctorUpgrade(ctx, config); return;
    }

    const configHandlers: Record<string, CtxHandler> = {
      health: handleHealth, doctor: handleDoctor, logs: handleLogs,
      restart: handleRestart, code: handleCode,
    };
    const handler = configHandlers[sub];
    if (handler) {
      rewriteText(ctx, `/${sub}`, rest);
      await handler(ctx, config);
      return;
    }

    // No args → show menu
    await ctx.reply(
      '⚙️ 系統管理',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('📊 狀態', 'adm:status'),
          Markup.button.callback('💚 健康', 'adm:health'),
          Markup.button.callback('🩺 診斷', 'adm:doctor'),
        ],
        [
          Markup.button.callback('📋 日誌', 'adm:logs'),
          Markup.button.callback('🔧 指令', 'adm:code'),
          Markup.button.callback('📚 學習', 'adm:learn'),
        ],
        [
          Markup.button.callback('🧹 清理', 'adm:cleanup'),
          Markup.button.callback('⬆️ 版本升級', 'adm:upgrade'),
          Markup.button.callback('🔄 重啟', 'adm:restart'),
          Markup.button.callback('🗑 清除統計', 'adm:clear'),
        ],
      ]),
    );
  };
}

/** Handle adm:* callbacks from InlineKeyboard */
export function createAdminCallback(
  statusHandler: (ctx: Context) => Promise<void>,
  clearHandler: (ctx: Context) => Promise<void>,
) {
  return async function handleAdminCallback(ctx: Context & { match: RegExpExecArray }, config: AppConfig): Promise<void> {
    const mode = ctx.match[1];
    await ctx.answerCbQuery().catch(() => {});

    if (mode === 'cleanup') {
      await showCleanupMenu(ctx);
      return;
    }
    if (mode.startsWith('cleanup:')) {
      const action = mode.slice('cleanup:'.length);
      if (action === 'omlx' || action === 'claude-cli' || action === 'trim') {
        await runCleanupAction(ctx, action);
      }
      return;
    }

    switch (mode) {
      case 'status': await statusHandler(ctx); break;
      case 'clear': await clearHandler(ctx); break;
      case 'health': rewriteText(ctx, '/health', ''); await handleHealth(ctx, config); break;
      case 'doctor': rewriteText(ctx, '/doctor', ''); await handleDoctor(ctx, config); break;
      case 'logs': rewriteText(ctx, '/logs', ''); await handleLogs(ctx, config); break;
      case 'restart': rewriteText(ctx, '/restart', ''); await handleRestart(ctx, config); break;
      case 'code': rewriteText(ctx, '/code', ''); await handleCode(ctx, config); break;
      case 'upgrade': await handleDoctorUpgrade(ctx, config); break;
      case 'upgrade-run': await handleDoctorUpgradeRun(ctx, config); break;
      case 'upgrade-recent': await handleDoctorUpgradeRun(ctx, config, true); break;
      case 'learn': await showLearnMenu(ctx); break;
    }
  };
}
