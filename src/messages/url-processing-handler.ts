import type { Telegraf } from 'telegraf';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { formatErrorMessage } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { ExtractorWithComments, ExtractorWithSeries } from '../extractors/types.js';
import type { AppConfig } from '../utils/config.js';
import { extractUrls, findExtractor } from '../utils/url-parser.js';
import {
  STAGE,
  formatDuplicateMessage,
  formatProcessingMessage,
  formatSavedSummary,
  formatUnsupportedUrlMessage,
} from './user-messages.js';
import { enrichExtractedContent } from './services/enrich-content-service.js';
import { extractContentWithComments } from './services/extract-content-service.js';
import { saveExtractedContent } from './services/save-content-service.js';
import { processSeriesBatch } from './services/series-processing-service.js';
import type { BotStats } from './types.js';

function isSeriesExtractor(e: unknown): e is ExtractorWithSeries {
  return typeof (e as ExtractorWithSeries).isSeries === 'function';
}

/** Set emoji reaction on the user's message (fire-and-forget) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function react(ctx: any, emoji: string): void {
  const chatId = ctx.chat?.id;
  const msgId = ctx.message?.message_id;
  if (!chatId || !msgId) return;
  (ctx.telegram.callApi as Function)('setMessageReaction', {
    chat_id: chatId,
    message_id: msgId,
    reaction: [{ type: 'emoji', emoji }],
  }).catch(() => {});
}

/** Keep typing indicator alive during long operations */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function startTyping(ctx: any): () => void {
  const timer = setInterval(() => { ctx.sendChatAction('typing').catch(() => {}); }, 4000);
  return () => clearInterval(timer);
}

export function registerUrlProcessingHandler(
  bot: Telegraf,
  config: AppConfig,
  stats: BotStats,
): void {
  bot.on('message', async (ctx) => {
    const text = 'text' in ctx.message ? ctx.message.text : undefined;
    logger.info('msg', 'received', { preview: text?.slice(0, 80) });
    if (!text) return;

    const urls = extractUrls(text);
    logger.info('msg', 'urls', { urls });
    if (urls.length === 0) return;

    // 收到 URL 立刻回饋：typing 指示器 + 👀 反應
    ctx.sendChatAction('typing').catch(() => {});
    react(ctx, '👀');

    for (const url of urls) {
      const extractor = findExtractor(url);
      if (!extractor) {
        logger.warn('msg', 'unsupported url', { url });
        await ctx.reply(formatUnsupportedUrlMessage(url));
        continue;
      }

      logger.info('msg', 'extracting', { platform: extractor.platform, url });
      stats.urls++;

      // Series detection: batch-process all articles
      if (isSeriesExtractor(extractor) && extractor.isSeries(url)) {
        const processing = await ctx.reply('正在處理系列文章...');
        try {
          const result = await processSeriesBatch(
            url, extractor, config,
            (msg) => ctx.reply(msg),
          );
          stats.saved += result.saved;
          const summary = [
            `系列處理完成`,
            `索引：${result.indexPath}`,
            `已存：${result.saved} | 跳過：${result.skipped} | 失敗：${result.failed}`,
          ].join('\n');
          await ctx.reply(summary);
        } catch (err) {
          logger.error('msg', 'series processing failed', { url, err });
          stats.errors++;
          await ctx.reply(formatErrorMessage(err));
        }
        try { await ctx.deleteMessage(processing.message_id); } catch { /* */ }
        continue;
      }

      // Standard single-URL processing with progress streaming
      const stopTyping = startTyping(ctx);
      const processing = await ctx.reply(formatProcessingMessage(extractor.platform, 'extracting'));
      const chatId = processing.chat.id;
      const msgId = processing.message_id;

      /** Update the progress message in-place (fire-and-forget, best-effort) */
      const updateProgress = (stage: keyof typeof STAGE) => {
        ctx.telegram.editMessageText(chatId, msgId, undefined, formatProcessingMessage(extractor.platform, stage)).catch(() => {});
      };

      try {
        const t0 = Date.now();
        const content = await extractContentWithComments(url, extractor as ExtractorWithComments);
        logger.info('perf', 'extract', { ms: Date.now() - t0 });

        updateProgress('enriching');
        const t1 = Date.now();
        await enrichExtractedContent(content, config);
        logger.info('perf', 'enrich', { ms: Date.now() - t1 });

        updateProgress('saving');
        const t2 = Date.now();
        const result = await saveExtractedContent(content, config.vaultPath, { saveVideos: config.saveVideos });
        logger.info('perf', 'save', { ms: Date.now() - t2 });
        logger.info('perf', 'total', { ms: Date.now() - t0 });

        if (result.duplicate) {
          await ctx.reply(formatDuplicateMessage(result.mdPath));
          continue;
        }

        stats.saved++;
        if (stats.recent.length >= 50) stats.recent.shift();
        stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);

        stopTyping();
        react(ctx, '✅');
        await ctx.reply(formatSavedSummary(content, result));

        // 回傳 .md 檔案到 Telegram
        try {
          const fullPath = join(config.vaultPath, result.mdPath);
          await ctx.replyWithDocument({ source: fullPath, filename: result.mdPath.split('/').pop() ?? 'note.md' });
        } catch { /* 檔案回傳非關鍵，靜默失敗 */ }
      } catch (err) {
        stopTyping();
        react(ctx, '❌');
        logger.error('msg', 'error processing url', { url, err });
        stats.errors++;
        if (stats.failedUrls.length >= 50) stats.failedUrls.shift();
        const urlHash = createHash('md5').update(url).digest('hex').slice(0, 12);
        stats.failedUrls.push({ url, error: formatErrorMessage(err), timestamp: Date.now() });
        await ctx.reply(formatErrorMessage(err), {
          reply_markup: {
            inline_keyboard: [[{ text: '🔄 重試', callback_data: `retry:${urlHash}` }]],
          },
        });
      }

      try {
        await ctx.deleteMessage(msgId);
      } catch {
        // ignore
      }
    }
  });
}
