/**
 * /search — unified search entry point.
 * Consolidates find, search (web), monitor, vsearch into one command.
 * Old commands remain registered for backward compatibility.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleFind } from './find-command.js';
import { handleSearch, handleMonitor } from './monitor-command.js';
import { handleVsearch } from './vsearch-command.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';

type SubHandler = (ctx: Context, config: AppConfig) => Promise<void>;

const MODES: Record<string, { handler: SubHandler; prefix: string }> = {
  vault: { handler: handleFind, prefix: '/find' },
  web: { handler: handleSearch, prefix: '/search' },
  monitor: { handler: handleMonitor, prefix: '/monitor' },
  video: { handler: handleVsearch, prefix: '/vsearch' },
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

export async function handleSearchHub(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
  const parts = text.replace(/^\/search\s*/i, '').trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase() ?? '';
  const rest = parts.slice(1).join(' ');

  const mode = MODES[sub];
  if (mode) {
    rewriteText(ctx, mode.prefix, rest);
    await mode.handler(ctx, config);
    return;
  }

  // If user typed /search <something> that's not a mode keyword, treat as web search
  if (sub) {
    rewriteText(ctx, '/search', parts.join(' '));
    await handleSearch(ctx, config);
    return;
  }

  // No args → show mode picker
  await ctx.reply(
    '選擇搜尋模式：',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🔍 Vault 筆記', 'srch:vault'),
        Markup.button.callback('🌐 網頁搜尋', 'srch:web'),
      ],
      [
        Markup.button.callback('📡 跨平台提及', 'srch:monitor'),
        Markup.button.callback('🎬 影片筆記', 'srch:video'),
      ],
    ]),
  );
}

const FORCE_REPLY_PROMPTS: Record<string, { tag: string; prompt: string; placeholder: string }> = {
  vault: { tag: 'find', prompt: '請輸入 Vault 搜尋關鍵字：', placeholder: '關鍵字…' },
  web: { tag: 'search', prompt: '請輸入網頁搜尋查詢：', placeholder: '查詢…' },
  monitor: { tag: 'monitor', prompt: '請輸入跨平台搜尋關鍵字：', placeholder: '關鍵字…' },
  video: { tag: 'find', prompt: '請輸入影片搜尋關鍵字：', placeholder: '關鍵字…' },
};

/** Handle srch:* callbacks from InlineKeyboard */
export async function handleSearchCallback(ctx: Context & { match: RegExpExecArray }): Promise<void> {
  const mode = ctx.match[1];
  await ctx.answerCbQuery().catch(() => {});

  const fr = FORCE_REPLY_PROMPTS[mode];
  if (fr) {
    // For video, we need a special tag since vsearch doesn't have a force-reply handler
    const tag = mode === 'video' ? 'vsearch-hub' : fr.tag;
    await ctx.reply(
      tagForceReply(tag, fr.prompt),
      forceReplyMarkup(fr.placeholder),
    );
  }
}
