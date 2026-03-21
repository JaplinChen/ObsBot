/**
 * /retry — Retry failed URLs from the current session.
 * /retry     → retry all failed
 * /retry N   → retry last N failed
 * Also handles inline "🔄 重試" button callbacks.
 */
import type { Context } from 'telegraf';
import { createHash } from 'node:crypto';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { ExtractorWithComments } from '../extractors/types.js';
import type { AppConfig } from '../utils/config.js';
import { findExtractor } from '../utils/url-parser.js';
import { enrichExtractedContent } from '../messages/services/enrich-content-service.js';
import { extractContentWithComments } from '../messages/services/extract-content-service.js';
import { saveExtractedContent } from '../messages/services/save-content-service.js';
import { formatSavedSummary } from '../messages/user-messages.js';
import type { BotStats } from '../messages/types.js';

/** Process a single URL through the standard pipeline */
async function processUrl(
  url: string, config: AppConfig, stats: BotStats,
): Promise<{ success: boolean; title?: string; error?: string }> {
  const extractor = findExtractor(url);
  if (!extractor) return { success: false, error: '不支援的 URL' };

  try {
    const content = await extractContentWithComments(url, extractor as ExtractorWithComments);
    await enrichExtractedContent(content, config);
    const result = await saveExtractedContent(content, config.vaultPath, { saveVideos: config.saveVideos });

    if (!result.duplicate) {
      stats.saved++;
      if (stats.recent.length >= 50) stats.recent.shift();
      stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);
    }

    return { success: true, title: content.title };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

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

    // Find matching failed URL by hash
    const target = stats.failedUrls.find(f => {
      const hash = createHash('md5').update(f.url).digest('hex').slice(0, 12);
      return hash === urlHash;
    });

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
