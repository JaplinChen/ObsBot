import type { Telegraf } from 'telegraf';
import { parseForceReplyTag } from '../utils/force-reply.js';

export function registerForceReplyRouter(bot: Telegraf): void {
  bot.on('message', (ctx, next) => {
    if (!ctx.message || !('text' in ctx.message)) return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || !('text' in replyTo) || !replyTo.from?.is_bot) return next();

    const cmd = parseForceReplyTag(replyTo.text);
    if (!cmd) return next();

    const newText = `/${cmd} ${ctx.message.text}`;
    const msg = ctx.message as unknown as Record<string, unknown>;
    msg.text = newText;
    // Inject bot_command entity so Telegraf's command middleware matches
    msg.entities = [{ type: 'bot_command', offset: 0, length: cmd.length + 1 }];
    return next();
  });
}
