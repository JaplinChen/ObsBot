/**
 * /track — unified tracking entry point.
 * Consolidates timeline, subscribe, patrol into one command.
 * Old commands remain registered for backward compatibility.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleTimeline } from './timeline-command.js';
import { handleSubscribe } from './subscribe-command.js';
import { handlePatrol } from './patrol-command.js';

type SubHandler = (ctx: Context, config: AppConfig) => Promise<void>;

const MODES: Record<string, { handler: SubHandler; prefix: string }> = {
  timeline: { handler: handleTimeline, prefix: '/timeline' },
  subscribe: { handler: handleSubscribe, prefix: '/subscribe' },
  patrol: { handler: handlePatrol, prefix: '/patrol' },
};

function rewriteText(ctx: Context, newCommand: string, args: string): void {
  const text = args ? `${newCommand} ${args}` : newCommand;
  const existingMsg = ctx.message as unknown as Record<string, unknown> | undefined;
  if (existingMsg) { existingMsg.text = text; }
  else {
    const cbMsg = (ctx.callbackQuery?.message ?? {}) as Record<string, unknown>;
    (ctx.update as unknown as Record<string, unknown>).message = { ...cbMsg, text };
  }
}

export async function handleTrackHub(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
  const parts = text.replace(/^\/track\s*/i, '').trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase() ?? '';
  const rest = parts.slice(1).join(' ');

  const mode = MODES[sub];
  if (mode) {
    rewriteText(ctx, mode.prefix, rest);
    await mode.handler(ctx, config);
    return;
  }

  // If user typed /track @someone, treat as timeline
  if (sub.startsWith('@') || sub.startsWith('http')) {
    rewriteText(ctx, '/timeline', parts.join(' '));
    await handleTimeline(ctx, config);
    return;
  }

  // No args → show mode picker
  await ctx.reply(
    [
      '選擇追蹤功能：',
      '',
      '⏳ 時間軸 — 抓取用戶最近貼文',
      '🔔 訂閱 — 自動追蹤用戶新內容',
      '🌐 巡邏 — 多平台內容巡邏',
    ].join('\n'),
    Markup.inlineKeyboard([
      [
        Markup.button.callback('⏳ 時間軸', 'trk:timeline'),
        Markup.button.callback('🔔 訂閱', 'trk:subscribe'),
      ],
      [Markup.button.callback('🌐 巡邏', 'trk:patrol')],
    ]),
  );
}

/** Handle trk:* callbacks from InlineKeyboard */
export async function handleTrackCallback(ctx: Context & { match: RegExpExecArray }, config: AppConfig): Promise<void> {
  const mode = ctx.match[1];
  await ctx.answerCbQuery().catch(() => {});

  switch (mode) {
    case 'timeline':
      rewriteText(ctx, '/timeline', '');
      await handleTimeline(ctx, config);
      break;
    case 'subscribe':
      rewriteText(ctx, '/subscribe', '');
      await handleSubscribe(ctx, config);
      break;
    case 'patrol':
      rewriteText(ctx, '/patrol', '');
      await handlePatrol(ctx, config);
      break;
  }
}
