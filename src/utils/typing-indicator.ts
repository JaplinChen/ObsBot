import type { Context } from 'telegraf';

/**
 * Send a Telegram "typing" chat action every 4.5s while an async operation runs.
 * Telegram automatically hides the indicator after 5s, so we refresh it before that.
 *
 * Usage:
 *   const typing = startTyping(ctx);
 *   try { ... } finally { stopTyping(typing); }
 */
export function startTyping(ctx: Context): ReturnType<typeof setInterval> {
  void ctx.sendChatAction('typing').catch(() => {});
  return setInterval(() => {
    void ctx.sendChatAction('typing').catch(() => {});
  }, 4500);
}

export function stopTyping(timer: ReturnType<typeof setInterval>): void {
  clearInterval(timer);
}
