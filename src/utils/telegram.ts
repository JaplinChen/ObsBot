import type { Context } from 'telegraf';

/** Telegram message character limit */
export const TELEGRAM_MSG_LIMIT = 4096;

/** Unified reply helpers for consistent formatting */
export async function replyError(ctx: Context, message: string): Promise<void> {
  await ctx.reply(`❌ ${message}`);
}

export async function replyWarning(ctx: Context, message: string): Promise<void> {
  await ctx.reply(`⚠️ ${message}`);
}

export async function replySuccess(ctx: Context, message: string): Promise<void> {
  await ctx.reply(`✅ ${message}`);
}

/**
 * Split a long message into chunks respecting Telegram's 4096 char limit.
 * Splits on line boundaries to avoid breaking mid-sentence.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > TELEGRAM_MSG_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
