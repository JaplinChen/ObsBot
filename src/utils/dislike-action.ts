/**
 * 👎 "不感興趣" — token cache and callback handler.
 *
 * Token types:
 *   category  — block a category (subscription 👎)
 *   delete    — delete vault note + block category (subscription 🗑️)
 *   kw_pick   — show keyword picker (patrol 👎, first step)
 *   keyword   — block a specific keyword (patrol picker result)
 */
import { createHash } from 'crypto';
import { unlink } from 'fs/promises';
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { TtlCache } from './ttl-cache.js';
import { addBlockedCategory, addBlockedKeyword } from './content-filter.js';
import { removeFromIndex } from '../saver/url-index.js';

type DislikeInfo =
  | { type: 'category'; value: string }
  | { type: 'delete'; category: string; mdPath: string; url: string }
  | { type: 'kw_pick'; title: string }
  | { type: 'keyword'; value: string };

const cache = new TtlCache<DislikeInfo>({ maxSize: 300, ttlMs: 30 * 60_000 });

function makeToken(seed: string): string {
  return createHash('sha1').update(seed + String(Date.now())).digest('hex').slice(0, 12);
}

/** Block category — for subscription 👎 */
export function rememberDislike(category: string): string {
  const token = makeToken(category);
  cache.set(token, { type: 'category', value: category });
  return token;
}

/** Delete note + block category — for subscription 🗑️ */
export function rememberDelete(category: string, mdPath: string, url: string): string {
  const token = makeToken(mdPath);
  cache.set(token, { type: 'delete', category, mdPath, url });
  return token;
}

/** Show keyword picker — for patrol 👎 (first step) */
export function rememberDislikeKeyword(title: string): string {
  const token = makeToken(title);
  cache.set(token, { type: 'kw_pick', title });
  return token;
}

/** Block specific keyword — created dynamically during kw_pick handling */
function rememberKeyword(keyword: string): string {
  const token = makeToken(keyword + 'kw');
  cache.set(token, { type: 'keyword', value: keyword });
  return token;
}

export function resolveDislikeToken(token: string): DislikeInfo | null {
  return cache.get(token) ?? null;
}

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must',
  'can','could','with','for','in','of','to','on','by','at','from','and',
  'or','but','not','how','what','why','when','where','which','that','this',
  'these','those','it','its','i','you','we','they','he','she','them',
  'their','our','your','my','his','her','via','using','new','build',
  'into','up','about','just','more','than','also','some','any','all',
]);

function extractKeywords(title: string): string[] {
  return [...new Set(
    title
      .split(/[\s\-_,;:.!?()[\]{}]+/)
      .map(w => w.replace(/[^a-zA-Z一-鿿]/g, ''))
      .filter(w => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase())),
  )].slice(0, 3);
}

/** Main callback handler — dispatches by token type. */
export async function handleDislikeAction(ctx: Context, token: string): Promise<void> {
  const info = resolveDislikeToken(token);
  if (!info) {
    await ctx.answerCbQuery('按鈕已過期').catch(() => {});
    return;
  }

  if (info.type === 'category') {
    await addBlockedCategory(info.value);
    await ctx.answerCbQuery(`已封鎖「${info.value}」`).catch(() => {});
    await ctx.reply(`👎 已記錄：往後「${info.value}」類文章自動跳過`);
    return;
  }

  if (info.type === 'delete') {
    await addBlockedCategory(info.category);
    await unlink(info.mdPath).catch(() => {});
    removeFromIndex(info.url);
    await ctx.answerCbQuery('已刪除並封鎖').catch(() => {});
    await ctx.reply(`🗑️ 已刪除此篇並封鎖「${info.category}」分類`);
    return;
  }

  if (info.type === 'kw_pick') {
    const keywords = extractKeywords(info.title);
    if (keywords.length === 0) {
      await ctx.answerCbQuery('無法提取關鍵字').catch(() => {});
      return;
    }
    const buttons = keywords.map(kw => {
      const t = rememberKeyword(kw);
      return [Markup.button.callback(`🚫 ${kw}`, `dislike:${t}`)];
    });
    await ctx.answerCbQuery('選擇封鎖關鍵字').catch(() => {});
    await ctx.reply('選擇要封鎖的關鍵字：', Markup.inlineKeyboard(buttons));
    return;
  }

  if (info.type === 'keyword') {
    await addBlockedKeyword(info.value);
    await ctx.answerCbQuery(`已封鎖「${info.value}」`).catch(() => {});
    await ctx.reply(`👎 已記錄：往後標題含「${info.value}」的文章自動跳過`);
  }
}
