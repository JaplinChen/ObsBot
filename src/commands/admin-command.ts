/**
 * /logs, /health, /restart — lightweight admin commands for bot management.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../core/logger.js';

const LOG_DIR = join(process.cwd(), 'logs');
const MAX_LOG_LINES = 30;

/** /logs — show recent log lines */
export async function handleLogs(ctx: Context, _config: AppConfig): Promise<void> {
  try {
    const logFile = join(LOG_DIR, 'app.log');
    const content = await readFile(logFile, 'utf-8').catch(() => '');
    if (!content) {
      await ctx.reply('📋 找不到日誌檔案或為空');
      return;
    }
    const lines = content.trim().split('\n');
    const tail = lines.slice(-MAX_LOG_LINES).join('\n');
    const msg = `📋 最近 ${Math.min(lines.length, MAX_LOG_LINES)} 行日誌：\n\n\`\`\`\n${tail.slice(0, 3800)}\n\`\`\``;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.warn('admin', 'logs command failed', { error: String(err) });
    await ctx.reply('❌ 讀取日誌失敗');
  }
}

/** /health — quick health check */
export async function handleHealth(ctx: Context, _config: AppConfig): Promise<void> {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const rssMB = (mem.rss / 1024 / 1024).toFixed(1);

  const lines = [
    '💚 Bot 健康狀態',
    '',
    `⏱ 運行時間：${hours}h ${mins}m`,
    `🧠 記憶體：${heapMB} MB heap / ${rssMB} MB RSS`,
    `📦 Node: ${process.version}`,
    `🖥 PID: ${process.pid}`,
  ];

  await ctx.reply(lines.join('\n'));
}

/** /restart — show confirmation before restarting */
export async function handleRestart(ctx: Context, _config: AppConfig): Promise<void> {
  await ctx.reply(
    '⚠️ 確定要重啟 Bot 嗎？',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ 確認重啟', 'admin:restart-confirm'),
        Markup.button.callback('❌ 取消', 'admin:cancel'),
      ],
    ]),
  );
}

/** admin:restart-confirm callback — actually restart */
export async function handleRestartConfirm(ctx: Context): Promise<void> {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🔄 正在準備重啟…');
  logger.info('admin', '收到重啟確認');
  setTimeout(() => { process.exit(0); }, 1000);
}

/** admin:cancel callback — dismiss */
export async function handleAdminCancel(ctx: Context): Promise<void> {
  await ctx.answerCbQuery('已取消').catch(() => {});
  await ctx.deleteMessage().catch(() => {});
}
