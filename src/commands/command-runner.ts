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

