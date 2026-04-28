/**
 * /find — search Vault frontmatter (title, keywords, summary, category).
 * Returns matching notes from the local Obsidian Vault.
 */
import type { Context } from 'telegraf';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AppConfig } from '../utils/config.js';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { recordQuery } from '../utils/access-log.js';
import { withTypingIndicator } from './command-runner.js';

interface MatchedNote {
  title: string;
  category: string;
  date: string;
  /** Number of fields that matched */
  score: number;
  /** Short excerpt from body if body matched */
  excerpt?: string;
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

/** Extract body text (after frontmatter) and return a short excerpt around the match. */
function bodyExcerpt(raw: string, query: string): string | undefined {
  const fmEnd = raw.indexOf('\n---', 3);
  if (fmEnd === -1) return undefined;
  const body = raw.slice(fmEnd + 4).trim();
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - 30);
  const end = Math.min(body.length, idx + query.length + 50);
  const excerpt = body.slice(start, end).replace(/\n+/g, ' ').trim();
  return (start > 0 ? '…' : '') + excerpt + (end < body.length ? '…' : '');
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

  await withTypingIndicator(ctx, `正在搜尋 Vault「${query}」...`, async () => {
    const rootDir = join(config.vaultPath, 'KnowPipe');
    const files = await getAllMdFiles(rootDir);
    const matches: MatchedNote[] = [];

    for (const fullPath of files) {
      try {
        const raw = await readFile(fullPath, 'utf-8');
        const fm = parseFrontmatter(raw);
        let score = scoreMatch(fm, query);
        let excerpt: string | undefined;
        if (score === 0) {
          excerpt = bodyExcerpt(raw, query);
          if (!excerpt) continue;
          score = 1;
        }

        matches.push({
          title: fm.get('title') ?? relative(rootDir, fullPath),
          category: fm.get('category') ?? '其他',
          date: (fm.get('date') ?? '').slice(0, 10),
          score,
          excerpt,
        });
      } catch { /* skip */ }
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, 10);

    if (top.length === 0) {
      await ctx.reply(`在 Vault 中找不到「${query}」相關筆記。`);
      return;
    }

    recordQuery(query, top.map(n => n.category)).catch(() => {});

    const lines = [`🔎 Vault 搜尋「${query}」：找到 ${matches.length} 篇`, ''];
    for (const [i, note] of top.entries()) {
      lines.push(`${i + 1}. ${note.title}`);
      lines.push(`   📁 ${note.category} | 📅 ${note.date}`);
      if (note.excerpt) lines.push(`   "${note.excerpt}"`);
    }
    if (matches.length > 10) {
      lines.push('', `… 另有 ${matches.length - 10} 篇匹配`);
    }

    await ctx.reply(lines.join('\n'));
  }, 'Vault 搜尋失敗');
}
