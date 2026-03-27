import type { Telegraf } from 'telegraf';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import type { BotStats } from '../messages/types.js';
import { logger } from '../core/logger.js';

export function registerInfoCommands(bot: Telegraf, stats: BotStats, startTime: number): void {
  bot.command('status', async (ctx) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const pool = camoufoxPool.getStats();
    const mem = process.memoryUsage();
    const recentErrors = logger.getRecent(3, 'error');

    const lines = [
      '📊 ObsBot 狀態',
      '',
      `⏱ 運行時間：${h}h ${m}m`,
      `💾 記憶體：${Math.round(mem.rss / 1024 / 1024)} MB`,
      `🦊 Camoufox：${pool.inUse} 使用中 / ${pool.total} 總數`,
      '',
      `📈 本次統計：處理 ${stats.urls} 個連結，儲存 ${stats.saved} 篇，失敗 ${stats.errors} 次`,
    ];

    if (stats.recent.length > 0) {
      lines.push('', `📝 最近儲存（${stats.recent.length} 篇）：`);
      for (const item of stats.recent.slice(-5).reverse()) {
        lines.push(`· ${item}`);
      }
    }

    if (stats.failedUrls.length > 0) {
      lines.push('', `⚠️ 待重試：${stats.failedUrls.length} 個連結`);
    }

    if (recentErrors.length > 0) {
      lines.push('', '🚨 最近錯誤：');
      for (const e of recentErrors) {
        const time = new Date(e.ts).toLocaleTimeString('zh-TW', { hour12: false });
        lines.push(`· ${time} [${e.scope}] ${e.message}`);
      }
    }

    await ctx.reply(lines.join('\n'));
  });

  /** /clear — reset stats and clear processing queue */
  bot.command('clear', async (ctx) => {
    const prevUrls = stats.urls;
    const prevSaved = stats.saved;
    const prevErrors = stats.errors;
    const prevFailed = stats.failedUrls.length;

    stats.urls = 0;
    stats.saved = 0;
    stats.errors = 0;
    stats.recent.length = 0;
    stats.failedUrls.length = 0;

    logger.info('admin', '收到 /clear 指令，已重置統計');

    await ctx.reply([
      '✅ Context cleared. Ready.',
      '',
      `已清除：${prevUrls} 處理 / ${prevSaved} 儲存 / ${prevErrors} 失敗 / ${prevFailed} 待重試`,
    ].join('\n'));
  });
}
