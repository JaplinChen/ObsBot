/**
 * /monitor command — cross-platform keyword search (mention discovery).
 * /google command — web search (DuckDuckGo HTML + Camoufox fallback).
 * Results shown with inline buttons — users pick which to save.
 */
import { Markup } from 'telegraf';
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { webSearch, rewriteQuery } from '../utils/search-service.js';
import { isDuplicateUrl } from '../saver.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { rememberUrl } from './discover-command.js';
import { withTypingIndicator } from './command-runner.js';

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

/** Author-specific platforms for site: searches */
const AUTHOR_PLATFORMS = [
  'github.com',
  'medium.com/@',
  'dev.to',
  'substack.com',
];

/** Shared result display helper */
async function displayResults(
  ctx: Context,
  config: AppConfig,
  label: string,
  posts: Array<{ title: string; url: string; source: string }>,
): Promise<void> {
  if (posts.length === 0) {
    await ctx.reply(`沒有找到關於「${label}」的內容。`);
    return;
  }
  const unsaved: typeof posts = [];
  for (const p of posts) {
    const dup = await isDuplicateUrl(p.url, config.vaultPath);
    if (!dup) unsaved.push(p);
  }
  if (unsaved.length === 0) {
    await ctx.reply(`🔍 搜尋「${label}」完成：找到 ${posts.length} 筆，全部已儲存。`);
    return;
  }
  const displayPosts = unsaved.slice(0, 8);
  const lines = [`🔍 搜尋「${label}」完成：${unsaved.length} 筆新結果\n`];
  for (const p of displayPosts) {
    lines.push(`🔹 ${p.title.slice(0, 40)}`);
    lines.push(`  ${p.url}`);
    if (lines.join('\n').length > 3500) break;
  }
  await ctx.reply(lines.join('\n'), {
    disable_web_page_preview: true,
    ...buildMonitorButtons(displayPosts),
  } as object);
}

/** Platforms to include in cross-platform mention search */
const MONITOR_PLATFORMS = [
  'reddit.com',
  'github.com',
  'news.ycombinator.com',
  'youtube.com',
  'dev.to',
  'medium.com',
];

/** Search a keyword across general web + platform-specific site: queries */
async function multiPlatformSearch(keyword: string, rewritten: string): Promise<Array<{ title: string; url: string; source: string }>> {
  const seen = new Set<string>();
  const results: Array<{ title: string; url: string; source: string }> = [];

  function addResult(title: string, url: string): void {
    if (!url || seen.has(url)) return;
    try {
      const host = new URL(url).hostname;
      if (MONITOR_SKIP_HOSTS.has(host)) return;
      seen.add(url);
      results.push({ title, url, source: host });
    } catch { /* skip invalid URLs */ }
  }

  // General search + platform-specific site: searches in parallel
  const searches = [
    webSearch(rewritten, 8),
    ...MONITOR_PLATFORMS.map(platform => webSearch(`site:${platform} ${keyword}`, 3)),
  ];

  const all = await Promise.allSettled(searches);
  for (const r of all) {
    if (r.status === 'fulfilled') {
      for (const item of r.value) addResult(item.title, item.url);
    }
  }

  return results;
}

/**
 * Topic search — multi-platform search with topic label.
 * Called from search-hub when user selects a topic.
 */
export async function handleMonitorTopic(ctx: Context, config: AppConfig, topic: string): Promise<void> {
  await withTypingIndicator(ctx, `正在搜尋主題「${topic}」...`, async () => {
    const { rewritten } = await rewriteQuery(topic);
    const posts = await multiPlatformSearch(topic, rewritten);
    await displayResults(ctx, config, topic, posts);
  }, '搜尋失敗');
}

/**
 * Author search — searches for author content across GitHub, Medium, Dev.to, Substack.
 * Called from search-hub when user provides an author name/handle.
 */
export async function handleMonitorAuthor(ctx: Context, config: AppConfig, author: string): Promise<void> {
  const handle = author.replace(/^@/, '').trim();
  await withTypingIndicator(ctx, `正在搜尋作者「${handle}」的文章...`, async () => {
    const seen = new Set<string>();
    const results: Array<{ title: string; url: string; source: string }> = [];

    function addResult(title: string, url: string): void {
      if (!url || seen.has(url)) return;
      try {
        const host = new URL(url).hostname;
        if (MONITOR_SKIP_HOSTS.has(host)) return;
        seen.add(url);
        results.push({ title, url, source: host });
      } catch { /* skip */ }
    }

    const searches = [
      webSearch(`"${handle}" blog articles`, 5),
      webSearch(`site:github.com/${handle}`, 4),
      webSearch(`site:medium.com "@${handle}"`, 3),
      webSearch(`site:dev.to/${handle}`, 3),
      webSearch(`site:substack.com/@${handle}`, 3),
      webSearch(`"${handle}" site:dev.to OR site:hashnode.dev OR site:blog`, 4),
    ];

    const all = await Promise.allSettled(searches);
    for (const r of all) {
      if (r.status === 'fulfilled') {
        for (const item of r.value) addResult(item.title, item.url);
      }
    }

    await displayResults(ctx, config, handle, results);
  }, '搜尋失敗');
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

    const posts = await multiPlatformSearch(keyword, rewritten);
    await displayResults(ctx, config, keyword, posts);
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

  await withTypingIndicator(ctx, `正在搜尋「${query}」...`, async () => {
    const results = await webSearch(query, 8);
    if (results.length === 0) {
      await ctx.reply('沒有找到搜尋結果，請稍後再試。');
      return;
    }

    const entries: Array<{ title: string; url: string; host: string; saved: boolean }> = [];
    for (const r of results) {
      const dup = await isDuplicateUrl(r.url, config.vaultPath);
      const host = (() => { try { return new URL(r.url).hostname; } catch { return ''; } })();
      entries.push({ title: r.title, url: r.url, host, saved: !!dup });
    }

    const unsaved = entries.filter(e => !e.saved);

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
  }, '搜尋失敗');
}
