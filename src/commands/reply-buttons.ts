/**
 * Shared InlineKeyboard helpers for command suggestions.
 * Replaces plain text "/command" suggestions with clickable buttons.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';

/** Reply "知識庫為空" with a clickable analyze button */
export async function replyEmptyKnowledge(ctx: Context): Promise<void> {
  await ctx.reply(
    '知識庫為空，請先執行深度分析。',
    Markup.inlineKeyboard([[Markup.button.callback('🔍 深度分析', 'kb:analyze')]]),
  );
}

/** Reply when a callback button has expired, with a re-trigger button */
export async function replyExpired(ctx: Context, command: string, label: string): Promise<void> {
  await ctx.reply(
    '按鈕已過期，請重新操作：',
    Markup.inlineKeyboard([[Markup.button.callback(`🔄 ${label}`, `nav:${command}`)]]),
  );
}

/** Reply with suggested next-step buttons after an action completes */
export async function replyWithNextSteps(
  ctx: Context, message: string, buttons: Array<{ label: string; command: string }>,
): Promise<void> {
  const keyboard = buttons.map(b => [Markup.button.callback(b.label, b.command)]);
  await ctx.reply(message, Markup.inlineKeyboard(keyboard));
}

/** Common next-step button sets */
export const NEXT_STEPS = {
  afterAnalyze: [
    { label: '🔍 探索主題', command: 'nav:explore' },
    { label: '📰 週報合成', command: 'dg:weekly' },
    { label: '📋 精華摘要', command: 'dg:digest' },
  ],
  afterDigest: [
    { label: '🔍 探索主題', command: 'nav:explore' },
    { label: '🧠 跨筆記洞察', command: 'dg:consolidate' },
  ],
} as const;
