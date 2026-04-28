/**
 * /vsearch — Search video notes in Vault by content, chapters, and transcripts.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { searchVideos } from '../video/video-search.js';
import { withTypingIndicator } from './command-runner.js';

const PLATFORM_ICONS: Record<string, string> = {
  YouTube: '🎬',
  Bilibili: '📺',
  TikTok: '🎵',
  Douyin: '🎵',
};

export async function handleVsearch(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const query = text.replace(/^\/vsearch\s*/i, '').trim();

  if (!query) {
    await ctx.reply('🔍 使用方式：/vsearch <關鍵字>\n\n搜尋 Vault 中影片的標題、章節、轉錄文字');
    return;
  }

  await withTypingIndicator(ctx, `🔍 搜尋影片：${query}…`, async () => {
    const results = await searchVideos(config.vaultPath, query);

    if (results.length === 0) {
      await ctx.reply(`📭 未找到包含「${query}」的影片筆記`);
      return;
    }

    const lines: string[] = [`🎬 影片搜尋：「${query}」\n找到 ${results.length} 筆結果\n`];

    for (const [i, r] of results.entries()) {
      const icon = PLATFORM_ICONS[r.entry.platform] ?? '📹';
      const chapter = r.matchedChapter
        ? `\n   ⏱ ${r.matchedChapter.time} — ${r.matchedChapter.title}`
        : '';
      const excerpt = r.excerpt.length > 100
        ? r.excerpt.slice(0, 100) + '…'
        : r.excerpt;

      lines.push(
        `${i + 1}. ${icon} ${r.entry.title}`,
        `   📅 ${r.entry.date} | ${r.entry.platform}${chapter}`,
        `   📝 ${excerpt}`,
        `   🔗 ${r.entry.url}`,
        '',
      );
    }

    await ctx.reply(lines.join('\n'), {
      // @ts-expect-error Telegraf type mismatch
      disable_web_page_preview: true,
    });
  }, '搜尋失敗');
}
