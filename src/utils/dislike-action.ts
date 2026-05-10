/**
 * 👎 "不感興趣" button — token cache and callback handler.
 * Supports two block modes:
 *   "category" — adds to blockedCategories (subscription use)
 *   "keyword"  — adds to blockedKeywords (patrol use)
 */
import { createHash } from 'crypto';
import type { Context } from 'telegraf';
import { TtlCache } from './ttl-cache.js';
import { addBlockedCategory, addBlockedKeyword } from './content-filter.js';

interface DislikeInfo {
  type: 'category' | 'keyword';
  value: string;
}

const cache = new TtlCache<DislikeInfo>({ maxSize: 200, ttlMs: 30 * 60_000 });

function makeToken(seed: string): string {
  return createHash('sha1').update(seed + String(Date.now())).digest('hex').slice(0, 12);
}

/** Store a category-block intent; returns token for callback_data. */
export function rememberDislike(category: string): string {
  const token = makeToken(category);
  cache.set(token, { type: 'category', value: category });
  return token;
}

/** Store a keyword-block intent; returns token for callback_data. */
export function rememberDislikeKeyword(keyword: string): string {
  const token = makeToken(keyword);
  cache.set(token, { type: 'keyword', value: keyword });
  return token;
}

export function resolveDislikeToken(token: string): DislikeInfo | null {
  return cache.get(token) ?? null;
}

/** Handle the dislike callback: block the category or keyword and acknowledge. */
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
  } else {
    await addBlockedKeyword(info.value);
    await ctx.answerCbQuery(`已封鎖關鍵字「${info.value}」`).catch(() => {});
    await ctx.reply(`👎 已記錄：往後標題含「${info.value}」的文章自動跳過`);
  }
}
