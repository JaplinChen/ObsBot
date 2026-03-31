/**
 * /retry — Retry failed URLs from the current session.
 * /retry     → retry all failed
 * /retry N   → retry last N failed
 * Also handles inline "🔄 重試" button callbacks.
 */
import type { Context } from 'telegraf';
import { logger } from '../core/logger.js';
import type { AppConfig } from '../utils/config.js';
import { processUrl } from '../messages/services/process-url-service.js';
import type { BotStats } from '../messages/types.js';

/** Create the /retry command handler (closure over stats) */
export function createRetryHandler(stats: BotStats) {
  return async function handleRetry(ctx: Context, config: AppConfig): Promise<void> {
    const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
    const args = text.replace(/^\/retry\s*/, '').trim();
    const count = args ? parseInt(args, 10) : undefined;

    if (stats.failedUrls.length === 0) {
      await ctx.reply('本次啟動尚無失敗的 URL。');
      return;
    }

    const targets = count && count > 0
      ? stats.failedUrls.slice(-count)
      : [...stats.failedUrls];

    const status = await ctx.reply(`正在重試 ${targets.length} 個失敗連結...`);
    let success = 0;
    let failed = 0;

    for (const target of targets) {
      const result = await processUrl(target.url, config, stats);
      if (result.success) {
        success++;
        // Remove from failedUrls
        const idx = stats.failedUrls.findIndex(f => f.url === target.url);
        if (idx >= 0) stats.failedUrls.splice(idx, 1);
      } else {
        failed++;
      }
    }

    try { await ctx.deleteMessage(status.message_id); } catch { /* */ }

    await ctx.reply([
      `重試完成`,
      `成功：${success} | 仍失敗：${failed}`,
      failed > 0 ? `剩餘 ${stats.failedUrls.length} 個失敗連結` : '',
    ].filter(Boolean).join('\n'));

    logger.info('retry', '重試完成', { success, failed });
  };
}

/** Handle inline retry button callback (retry:HASH) */
export function createRetryActionHandler(stats: BotStats, config: AppConfig) {
  return async function handleRetryAction(ctx: Context & { match: RegExpExecArray }): Promise<void> {
    const urlHash = ctx.match[1];
    await ctx.answerCbQuery('重試中...').catch(() => {});

    // Find matching failed URL by pre-computed hash
    const target = stats.failedUrls.find(f => f.hash === urlHash);

    if (!target) {
      await ctx.reply('此連結已不在失敗清單中。');
      return;
    }

    const result = await processUrl(target.url, config, stats);
    if (result.success) {
      const idx = stats.failedUrls.findIndex(f => f.url === target.url);
      if (idx >= 0) stats.failedUrls.splice(idx, 1);
      await ctx.reply(`✅ 重試成功：${result.title}`);
    } else {
      await ctx.reply(`❌ 重試失敗：${result.error}`);
    }
  };
}
