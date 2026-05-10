import type { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { getOwnerUserId } from '../utils/config.js';
import type { RadarResult } from './radar-types.js';
import { sourceLabel } from './radar-cycle-utils.js';
import { rememberDislike, rememberDelete } from '../utils/dislike-action.js';

const MAX_ARTICLE_NOTIFS = 5;

export async function notifyRadarResults(
  bot: Telegraf,
  config: AppConfig,
  results: RadarResult[],
): Promise<void> {
  const totalSaved = results.reduce((sum, result) => sum + result.saved, 0);
  const totalQueued = results.reduce((sum, result) => sum + result.queued, 0);
  if (totalSaved === 0 && totalQueued === 0) return;

  const userId = getOwnerUserId(config);
  if (!userId) return;

  // ── Summary message ──────────────────────────────────────────────
  const lines = [`🔍 內容雷達：發現 ${totalSaved} 篇新內容`, ''];
  for (const result of results) {
    if (result.saved <= 0) continue;
    const label = sourceLabel(result.query.type ?? 'search', result.query.customConfig?.name);
    const desc = result.query.type === 'rss'
      ? result.query.keywords[0]
      : result.query.type === 'custom'
        ? (result.query.customConfig?.name ?? result.query.keywords.join(' '))
        : result.query.keywords.join(' ');
    lines.push(`• [${label}] ${result.saved} 篇 — ${desc}`);
  }

  const totalSkipped = results.reduce((sum, result) => sum + result.skipped, 0);
  if (totalSkipped > 0) lines.push(`\n（${totalSkipped} 篇已存在或封鎖，已跳過）`);
  if (totalQueued > 0) lines.push(`🎬 ${totalQueued} 部影片已排入轉錄佇列`);

  await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});

  // ── Per-article 👎 notifications (capped at MAX_ARTICLE_NOTIFS) ──
  const allArticles = results.flatMap(r => r.savedArticles ?? []);
  for (const article of allArticles.slice(0, MAX_ARTICLE_NOTIFS)) {
    const dislikeToken = rememberDislike(article.category);
    const deleteToken = rememberDelete(article.category, article.mdPath, article.url);
    const label = article.category ? `[${article.category}] ` : '';
    const text = `📡 雷達新增\n\n${label}${article.title}`;
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`👎 不感興趣：${article.category}`, `dislike:${dislikeToken}`),
        Markup.button.callback('🗑️ 刪除+封鎖', `dislike:${deleteToken}`),
      ],
    ]);
    await bot.telegram.sendMessage(userId, text, keyboard).catch(() => {});
  }
}

export async function notifyAutoPausedQueries(
  bot: Telegraf,
  config: AppConfig,
  maxConsecutiveFailures: number,
  newlyPaused: string[],
  promotedAuthors: string[],
  remainingAuthorQueue: number,
): Promise<void> {
  if (newlyPaused.length === 0) return;

  const userId = getOwnerUserId(config);
  if (!userId) return;

  const lines = [
    `⚠️ 以下查詢連續 ${maxConsecutiveFailures} 次無結果，已自動暫停：`,
    ...newlyPaused.map((query) => `• ${query}`),
    '',
    '使用 /radar resume <id> 可恢復。',
  ];

  if (promotedAuthors.length > 0) {
    lines.push('', '🔄 已自動輪替加入下一位備用作者：');
    promotedAuthors.forEach((handle) => lines.push(`• @${handle}`));
    if (remainingAuthorQueue > 0) lines.push(`（備用佇列剩餘 ${remainingAuthorQueue} 位）`);
  }

  await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
}
