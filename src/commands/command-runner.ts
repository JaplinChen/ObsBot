import type { Context } from 'telegraf';
import { logger } from '../core/logger.js';

/**
 * Run an async command task with unified error handling.
 * Keeps bot command handlers concise and consistent.
 */
export async function runCommandTask(
  ctx: Context,
  tag: string,
  task: () => Promise<void>,
  formatErrorMessage: (err: unknown) => string,
): Promise<void> {
  try {
    await task();
  } catch (err) {
    logger.error(tag, 'Command task failed', err);
    await ctx.reply(formatErrorMessage(err)).catch(() => {});
  }
}

/**
 * Send a status message, run fn(), then delete the status message when done.
 * On error: sends errorPrefix + error message, still deletes the status.
 */
export async function withTypingIndicator(
  ctx: Context,
  statusText: string,
  fn: () => Promise<void>,
  errorPrefix: string,
): Promise<void> {
  const status = await ctx.reply(statusText);
  try {
    await fn();
  } catch (err) {
    await ctx.reply(`${errorPrefix}：${(err as Error).message ?? String(err)}`).catch(() => {});
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

