/**
 * /monitor command — cross-platform keyword search (mention discovery).
 * /google command — web search (DuckDuckGo HTML + Camoufox fallback).
 * Results shown with inline buttons — users pick which to save.
 */
import { Markup } from 'telegraf';
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { webSearch, rewriteQuery, filterRelevantResults } from '../utils/search-service.js';
import { isDuplicateUrl } from '../saver.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { rememberUrl } from './discover-command.js';

/** Hosts excluded from /monitor results (auth-required, content not accessible). */
const MONITOR_SKIP_HOSTS = new Set([
  'x.com', 'twitter.com', 'www.x.com', 'www.twitter.com',
]);

/** Build inline keyboard with save buttons (2 per row) */
function buildMonitorButtons(posts: Array<{ title: string; url: string }>) {
  const buttons = posts.map((p) => {
    const token = rememberUrl(p.url);
    const label = p.title.slice(0, 20);
    return Markup.button.callback(`📥 ${label}`, `dsc:${token}`);
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(rows);
}

export async function handleMonitor(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const keyword = text.replace(/^\/monitor\s*/i, '').trim();

  if (!keyword) {
    await ctx.reply(
      tagForceReply('monitor', '請輸入監控關鍵字：\n例：claude code'),
      forceReplyMarkup('輸入關鍵字…'),
    );
    return;
  }

  const status = await ctx.reply(`正在搜尋「${keyword}」...`);

  try {
    // AI query rewriting for better search quality
    const { rewritten, wasRewritten } = await rewriteQuery(keyword);
    if (wasRewritten) {
      await ctx.telegram.editMessageText(
        status.chat.id, status.message_id, undefined,
        `正在搜尋「${keyword}」→ 🔑 ${rewritten}`,
      ).catch(() => {});
    }

    const rawWeb = await webSearch(rewritten, 12);

    const domainFiltered = rawWeb.filter(g => {
      try { return !MONITOR_SKIP_HOSTS.has(new URL(g.url).hostname); }
      catch { return false; }
    });

    // AI relevance filtering
    const relevant = await filterRelevantResults(keyword, domainFiltered);

    const posts: Array<{ title: string; url: string; source: string }> = [];
    for (const g of relevant) {
      const host = (() => { try { return new URL(g.url).hostname; } catch { return 'web'; } })();
      posts.push({ title: g.title, url: g.url, source: host });
    }

    if (posts.length === 0) {
      await ctx.reply(`沒有找到關於「${keyword}」的內容。`);
      return;
    }

    // Filter out already-saved URLs
    const unsaved: typeof posts = [];
    for (const p of posts) {
      const dup = await isDuplicateUrl(p.url, config.vaultPath);
      if (!dup) unsaved.push(p);
    }

    if (unsaved.length === 0) {
      await ctx.reply(`🔍 搜尋「${keyword}」完成：找到 ${posts.length} 筆，全部已儲存。`);
      return;
    }

    const displayPosts = unsaved.slice(0, 8);
    const lines = [`🔍 搜尋「${keyword}」完成：${unsaved.length} 筆新結果\n`];
    for (const p of displayPosts) {
      lines.push(`🔹 ${p.title.slice(0, 40)}`);
      lines.push(`  ${p.url}`);
      if (lines.join('\n').length > 3500) break;
    }

    await ctx.reply(lines.join('\n'), {
      disable_web_page_preview: true,
      ...buildMonitorButtons(displayPosts),
    } as object);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`搜尋失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

export async function handleSearch(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const query = text.replace(/^\/(search|google)\s*/i, '').trim();

  if (!query) {
    await ctx.reply(
      tagForceReply('search', '請輸入搜尋關鍵字：\n例：camoufox typescript'),
      forceReplyMarkup('輸入搜尋關鍵字…'),
    );
    return;
  }

  const status = await ctx.reply(`正在搜尋「${query}」...`);
  try {
    const results = await webSearch(query, 8);
    if (results.length === 0) {
      await ctx.reply('沒有找到搜尋結果，請稍後再試。');
      return;
    }

    // Check which URLs are already saved
    const entries: Array<{ title: string; url: string; host: string; saved: boolean }> = [];
    for (const r of results) {
      const dup = await isDuplicateUrl(r.url, config.vaultPath);
      const host = (() => { try { return new URL(r.url).hostname; } catch { return ''; } })();
      entries.push({ title: r.title, url: r.url, host, saved: !!dup });
    }

    const unsaved = entries.filter(e => !e.saved);

    // Format result list with save buttons
    const lines = [`🔍 搜尋「${query}」：${entries.length} 筆結果\n`];
    for (const [i, e] of entries.entries()) {
      const icon = e.saved ? '📂' : '🔹';
      lines.push(`${i + 1}. ${icon} ${e.title.slice(0, 50)}`);
      lines.push(`   ${e.host}`);
    }
    if (unsaved.length > 0) {
      lines.push('', '📂 = 已儲存  🔹 = 可存入');
    }

    if (unsaved.length > 0) {
      await ctx.reply(lines.join('\n'), {
        disable_web_page_preview: true,
        ...buildMonitorButtons(unsaved),
      } as object);
    } else {
      lines.push('', '所有結果皆已儲存。');
      await ctx.reply(lines.join('\n'));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`搜尋失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
