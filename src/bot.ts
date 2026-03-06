import { Telegraf } from 'telegraf';
import type { AppConfig } from './utils/config.js';
import { extractUrls, findExtractor } from './utils/url-parser.js';
import { saveToVault } from './saver.js';
import { classifyContent } from './classifier.js';
import { enrichContent } from './learning/ai-enricher.js';
import { getTopKeywordsForCategory } from './learning/dynamic-classifier.js';
import { executeLearn, formatLearnReport } from './learning/learn-command.js';
import { executeReclassify } from './learning/reclassify-command.js';
import { executeBatchTranslate } from './learning/batch-translator.js';
import type { ExtractorWithComments } from './extractors/types.js';
import { postProcess } from './enrichment/post-processor.js';
import { handleTimeline } from './commands/timeline-command.js';
import { handleMonitor, handleSearch } from './commands/monitor-command.js';
import { camoufoxPool } from './utils/camoufox-pool.js';

const startTime = Date.now();
const stats = { urls: 0, saved: 0, errors: 0, recent: [] as string[] };

/** Check if a Telegram user is allowed to use this bot */
function isAuthorized(config: AppConfig, userId: number | undefined): boolean {
  if (!config.allowedUserIds || config.allowedUserIds.size === 0) return true;
  return userId !== undefined && config.allowedUserIds.has(userId);
}

/** Filter out noise: too short, pure emoji, or generic one-word reactions */
function isMeaningfulComment(c: { text: string }): boolean {
  const t = c.text.trim();
  if (!t) return false;
  if (/https?:\/\/\S+|(?:^|\s)\w+\.\w{2,}\/\S+/.test(t)) return true;
  if (t.length < 15) return false;
  if (/^[\p{Emoji}\s!?.。，！？]+$/u.test(t)) return false;
  if (/^(great|nice|wow|lol|haha|yes|ok|okay|cool|love|good|awesome|amazing|thanks|congrats?)[\s!.！。]*$/i.test(t)) return false;
  return true;
}

/** Classify an error into a user-friendly message */
function formatErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|timed?\s*out|abort/i.test(msg)) return '抓取超時，請稍後重試。';
  if (/login|sign.?in|登入|登录|visitor/i.test(msg)) return '此平台需要登入才能存取，暫不支援。';
  if (/403|forbidden|blocked/i.test(msg)) return '被平台封鎖，請稍後重試。';
  if (/404|not.?found/i.test(msg)) return '找不到此內容，請確認連結是否正確。';
  if (/ENOTFOUND|ECONNREFUSED|network/i.test(msg)) return '網路連線問題，請檢查網路後重試。';
  return `處理失敗：${msg.slice(0, 100)}`;
}

export function createBot(config: AppConfig): Telegraf {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: 90_000,
  });

  // Auth middleware — all handlers below require authorization
  bot.use((ctx, next) => {
    if (!isAuthorized(config, ctx.from?.id)) {
      console.warn('[auth] Unauthorized from user ID:', ctx.from?.id);
      return;
    }
    return next();
  });

  const helpText = [
    'GetThreads Bot',
    '',
    '傳送連結即可自動儲存內容與評論：',
    'X / Threads / Reddit / YouTube / GitHub',
    '微博 / B站 / 小紅書 / 抖音 / 任何網頁',
    '',
    '指令：',
    '/search <查詢> — 網頁搜尋',
    '/monitor <關鍵字> — 跨平台搜尋提及',
    '/timeline @用戶 — 抓取用戶最近貼文',
    '/recent — 本次啟動已儲存的內容',
    '/status — Bot 運行狀態',
    '/learn — 重新掃描 Vault 更新分類',
    '/reclassify — 重新分類所有筆記',
    '/translate — 批次翻譯英文/簡中筆記',
    '/help — 顯示此說明',
  ].join('\n');

  bot.start((ctx) => ctx.reply(helpText));
  bot.command('help', (ctx) => ctx.reply(helpText));

  // Fire-and-forget: vault scan may exceed 90s with large vaults
  bot.command('learn', (ctx) => {
    ctx.reply('開始掃描 vault，完成後會通知你。').catch(() => {});
    executeLearn(config)
      .then(result => {
        ctx.reply(formatLearnReport(result)).catch(() => {});
      })
      .catch(err => {
        ctx.reply(formatErrorMessage(err)).catch(() => {});
      });
  });

  // Fire-and-forget: Camoufox-based commands may exceed 90s
  bot.command('timeline', (ctx) => {
    handleTimeline(ctx, config).catch(err => {
      console.error('[timeline]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('monitor', (ctx) => {
    handleMonitor(ctx, config).catch(err => {
      console.error('[monitor]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command(['search', 'google'], (ctx) => {
    handleSearch(ctx, config).catch(err => {
      console.error('[search]', err);
      ctx.reply(formatErrorMessage(err)).catch(() => {});
    });
  });

  bot.command('status', async (ctx) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const pool = camoufoxPool.getStats();
    const mem = process.memoryUsage();
    await ctx.reply(
      [
        'GetThreads Bot 狀態',
        '',
        `運行時間：${h}h ${m}m`,
        `記憶體：${Math.round(mem.rss / 1024 / 1024)} MB`,
        `Camoufox：${pool.inUse} 使用中 / ${pool.total} 總數`,
        '',
        `本次統計：處理 ${stats.urls} 個連結，儲存 ${stats.saved} 篇，失敗 ${stats.errors} 次`,
      ].join('\n'),
    );
  });

  // Fire-and-forget: vault reclassification may exceed 90s
  bot.command('reclassify', (ctx) => {
    ctx.reply('開始重新分類筆記，完成後會通知你。').catch(() => {});
    executeReclassify(config)
      .then(result => {
        const lines = [
          `重新分類完成：${result.total} 篇筆記`,
          `搬移：${result.moved} 篇`,
        ];
        if (result.changes.length > 0) {
          lines.push('', '異動清單：');
          for (const c of result.changes.slice(0, 10)) {
            lines.push(`• ${c.from} → ${c.to}: ${c.file}`);
          }
          if (result.changes.length > 10) lines.push(`...等共 ${result.changes.length} 篇`);
        }
        ctx.reply(lines.join('\n')).catch(() => {});
      })
      .catch(err => {
        ctx.reply(formatErrorMessage(err)).catch(() => {});
      });
  });

  // Fire-and-forget: batch translation may exceed 90s
  bot.command('translate', (ctx) => {
    if (!config.anthropicApiKey) { ctx.reply('未設定 ANTHROPIC_API_KEY，無法翻譯。').catch(() => {}); return; }
    ctx.reply('開始批次翻譯筆記，完成後會通知你。').catch(() => {});
    executeBatchTranslate(config)
      .then(r => {
        const lines = [`批次翻譯完成：掃描 ${r.total} 篇`, `✅${r.translated} ⏭${r.skipped} 🈚${r.noNeed} ❌${r.failed}`];
        for (const d of r.details.slice(0, 15)) lines.push(`• [${d.lang}] ${d.file.slice(0, 40)} ${d.status}`);
        if (r.details.length > 15) lines.push(`...等共 ${r.details.length} 篇`);
        ctx.reply(lines.join('\n')).catch(() => {});
      })
      .catch(err => ctx.reply(formatErrorMessage(err)).catch(() => {}));
  });

  bot.command('recent', async (ctx) => {
    if (stats.recent.length === 0) {
      await ctx.reply('本次啟動尚未儲存任何內容。');
      return;
    }
    const lines = [`本次已儲存 ${stats.saved} 篇：`, ''];
    for (const item of stats.recent.slice(-10).reverse()) {
      lines.push(`• ${item}`);
    }
    await ctx.reply(lines.join('\n'));
  });

  bot.on('message', async (ctx) => {
    const text = 'text' in ctx.message ? ctx.message.text : undefined;
    console.log('[msg] received:', text?.slice(0, 80));
    if (!text) return;

    const urls = extractUrls(text);
    console.log('[msg] urls:', urls);
    if (urls.length === 0) return;

    for (const url of urls) {
      const extractor = findExtractor(url);
      if (!extractor) {
        console.log('[msg] unsupported:', url);
        await ctx.reply(`不支援的連結：${url}`);
        continue;
      }

      console.log('[msg] extracting:', extractor.platform, url);
      stats.urls++;
      const processing = await ctx.reply(`正在處理 ${extractor.platform} 連結...`);

      try {
        const withComments = extractor as Partial<ExtractorWithComments>;
        const hasComments = typeof withComments.extractComments === 'function';
        const [contentResult, commentsResult] = await Promise.allSettled([
          extractor.extract(url),
          hasComments ? withComments.extractComments!(url, 30) : Promise.resolve([]),
        ]);
        if (contentResult.status === 'rejected') throw contentResult.reason as Error;
        const content = contentResult.value;
        console.log('[msg] extracted:', content.title);

        if (commentsResult.status === 'fulfilled' && commentsResult.value.length > 0) {
          const meaningful = commentsResult.value.filter(isMeaningfulComment);
          if (meaningful.length > 0) {
            content.comments = meaningful;
            content.commentCount = commentsResult.value.length;
          }
        }

        content.category = classifyContent(content.title, content.text);
        console.log('[msg] category:', content.category);

        if (config.anthropicApiKey) {
          const hints = getTopKeywordsForCategory(content.category);
          const enriched = await enrichContent(
            content.title, content.text, hints, config.anthropicApiKey,
          );
          if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
          if (enriched.summary) content.enrichedSummary = enriched.summary;
          if (enriched.title) content.title = enriched.title;
          if (enriched.category) content.category = enriched.category;
        }

        try {
          await postProcess(content, config.anthropicApiKey, {
            enrichPostLinks: true,
            enrichCommentLinks: true,
            translate: config.enableTranslation,
            maxLinkedUrls: config.maxLinkedUrls,
          });
        } catch (err) {
          console.warn('[postProcess] 補充處理失敗:', (err as Error).message);
        }

        const result = await saveToVault(content, config.vaultPath);
        console.log('[msg] saved:', result.mdPath);

        if (result.duplicate) {
          await ctx.reply(`已儲存過，略過：\n${result.mdPath}`);
          continue;
        }

        stats.saved++;
        if (stats.recent.length >= 50) stats.recent.shift();
        stats.recent.push(`[${content.category}] ${content.title.slice(0, 50)}`);

        const summary = [
          `已儲存：${content.author} (${content.authorHandle})`,
          `分類：${content.category}`,
          '',
          content.text.length > 200 ? content.text.slice(0, 200) + '...' : content.text,
          '',
          `圖片：${result.imageCount} | 影片：${result.videoCount}${content.comments?.length ? ` | 評論：${content.comments.length}` : ''}`,
          `檔案：${result.mdPath}`,
        ].join('\n');
        await ctx.reply(summary);
      } catch (err) {
        console.error('[msg] error processing url:', url, err);
        stats.errors++;
        await ctx.reply(formatErrorMessage(err));
      }

      try { await ctx.deleteMessage(processing.message_id); } catch { /* ignore */ }
    }
  });

  bot.telegram.setMyCommands([
    { command: 'start', description: '顯示 Bot 說明' },
    { command: 'search', description: '網頁搜尋' },
    { command: 'monitor', description: '跨平台搜尋提及' },
    { command: 'timeline', description: '抓取用戶最近貼文' },
    { command: 'recent', description: '本次已儲存的內容' },
    { command: 'status', description: 'Bot 運行狀態' },
    { command: 'learn', description: '重新掃描 Vault 更新分類' },
    { command: 'reclassify', description: '重新分類所有筆記' },
    { command: 'translate', description: '批次翻譯英文/簡中筆記' },
    { command: 'help', description: '顯示說明' },
  ]).catch((err) => console.warn('[bot] setMyCommands failed:', err));

  return bot;
}
