/**
 * /find — search Vault frontmatter (title, keywords, summary, category).
 * Returns matching notes from the local Obsidian Vault.
 */
import type { Context } from 'telegraf';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { VAULT_SUBFOLDER, type AppConfig } from '../utils/config.js';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';

interface MatchedNote {
  title: string;
  category: string;
  date: string;
  /** Number of fields that matched */
  score: number;
}

/** Check if any frontmatter field contains the query (case-insensitive). */
function scoreMatch(fm: Map<string, string>, query: string): number {
  const q = query.toLowerCase();
  let score = 0;

  const title = (fm.get('title') ?? '').toLowerCase();
  if (title.includes(q)) score += 3;

  const keywords = parseArrayField(fm.get('keywords') ?? '');
  if (keywords.some(k => k.toLowerCase().includes(q))) score += 2;

  const category = (fm.get('category') ?? '').toLowerCase();
  if (category.includes(q)) score += 1;

  const summary = (fm.get('summary') ?? '').toLowerCase();
  if (summary.includes(q)) score += 1;

  return score;
}

export async function handleFind(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const query = text.replace(/^\/find\s*/i, '').trim();

  if (!query) {
    await ctx.reply(
      tagForceReply('find', '請輸入 Vault 搜尋關鍵字：\n例：GraphRAG、Claude Code、生產力'),
      forceReplyMarkup('搜尋 Vault…'),
    );
    return;
  }

  const status = await ctx.reply(`正在搜尋 Vault「${query}」...`);

  try {
    const rootDir = join(config.vaultPath, VAULT_SUBFOLDER);
    const files = await getAllMdFiles(rootDir);
    const matches: MatchedNote[] = [];

    for (const fullPath of files) {
      try {
        const raw = await readFile(fullPath, 'utf-8');
        const fm = parseFrontmatter(raw);
        const score = scoreMatch(fm, query);
        if (score === 0) continue;

        matches.push({
          title: fm.get('title') ?? relative(rootDir, fullPath),
          category: fm.get('category') ?? '其他',
          date: (fm.get('date') ?? '').slice(0, 10),
          score,
        });
      } catch { /* skip */ }
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, 10);

    if (top.length === 0) {
      await ctx.reply(`在 Vault 中找不到「${query}」相關筆記。`);
      return;
    }

    const lines = [`🔎 Vault 搜尋「${query}」：找到 ${matches.length} 篇`, ''];
    for (const [i, note] of top.entries()) {
      lines.push(`${i + 1}. ${note.title}`);
      lines.push(`   📁 ${note.category} | 📅 ${note.date}`);
    }
    if (matches.length > 10) {
      lines.push('', `… 另有 ${matches.length - 10} 篇匹配`);
    }

    await ctx.reply(lines.join('\n'));
  } catch (err) {
    await ctx.reply(`Vault 搜尋失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
