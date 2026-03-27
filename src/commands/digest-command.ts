/**
 * /digest — unified knowledge report menu.
 * Shows InlineKeyboard to choose:
 * - 精華摘要 (digest)
 * - 知識蒸餾 (distill)
 * - 跨筆記洞察 (consolidate)
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VAULT_SUBFOLDER, type AppConfig } from '../utils/config.js';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

interface NoteSummary {
  title: string;
  category: string;
  summary: string;
  date: string;
}

/** Parse frontmatter field */
function fm(raw: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*"?(.*?)"?\\s*$`, 'm');
  return raw.match(re)?.[1] ?? '';
}

/** Scan vault for recent notes within dayLimit */
async function collectRecentNotes(
  vaultPath: string, dayLimit: number,
): Promise<NoteSummary[]> {
  const rootDir = join(vaultPath, VAULT_SUBFOLDER);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dayLimit);
  const results: NoteSummary[] = [];
  const files = await getAllMdFiles(rootDir);

  for (const fullPath of files) {
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;

      const frontmatter = fmMatch[1];
      const dateStr = fm(frontmatter, 'date');
      if (!dateStr) continue;

      const noteDate = new Date(dateStr);
      if (isNaN(noteDate.getTime()) || noteDate < cutoff) continue;

      const title = fm(frontmatter, 'title');
      const category = fm(frontmatter, 'category') || '其他';
      const summary = fm(frontmatter, 'summary');
      if (!title) continue;

      results.push({ title, category, summary, date: dateStr.slice(0, 10) });
    } catch { /* skip */ }
  }

  return results;
}

/** Group notes by category */
function groupByCategory(notes: NoteSummary[]): Record<string, NoteSummary[]> {
  const groups: Record<string, NoteSummary[]> = {};
  for (const note of notes) {
    (groups[note.category] ??= []).push(note);
  }
  return groups;
}

/** Build digest using LLM */
async function buildDigest(
  groups: Record<string, NoteSummary[]>, days: number,
): Promise<string> {
  const catSummaries: string[] = [];
  for (const [cat, notes] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const titles = notes.map(n => `- ${n.title}${n.summary ? `：${n.summary.slice(0, 60)}` : ''}`);
    catSummaries.push(`【${cat}】(${notes.length} 篇)\n${titles.join('\n')}`);
  }

  const totalNotes = Object.values(groups).reduce((s, g) => s + g.length, 0);
  const prompt = [
    '你是知識庫摘要助手。以下是用戶近期收集的筆記分類概覽。',
    `時間範圍：最近 ${days} 天，共 ${totalNotes} 篇。`,
    '請用繁體中文產出一段精華摘要（200-400 字），包含：',
    '1. 本期主要關注方向（2-3 個主題）',
    '2. 每個主題的核心收穫（具體工具名、做法、觀點）',
    '3. 跨主題的共同趨勢或洞察（如有）',
    '不要重複列舉標題，要提煉出實質內容。語氣中性專業。',
    '',
    ...catSummaries,
  ].join('\n');

  const result = await runLocalLlmPrompt(prompt, { timeoutMs: 90_000, model: 'deep' });
  return result ?? '（LLM 無法生成摘要，請稍後再試）';
}

/** Format a simple digest without LLM */
function formatSimpleDigest(
  groups: Record<string, NoteSummary[]>, days: number,
): string {
  const totalNotes = Object.values(groups).reduce((s, g) => s + g.length, 0);
  const lines = [`近 ${days} 天知識摘要（${totalNotes} 篇）`, ''];

  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  for (const [cat, notes] of sorted) {
    lines.push(`【${cat}】${notes.length} 篇`);
    for (const note of notes.slice(0, 5)) {
      lines.push(`  • ${note.title}`);
    }
    if (notes.length > 5) lines.push(`  … 另 ${notes.length - 5} 篇`);
    lines.push('');
  }
  return lines.join('\n');
}

/** /digest — show report menu */
export async function handleDigestMenu(ctx: Context, _config: AppConfig): Promise<void> {
  await ctx.reply(
    '選擇知識報告類型：',
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 精華摘要', 'dg:digest')],
      [Markup.button.callback('🧪 知識蒸餾', 'dg:distill')],
      [Markup.button.callback('🧠 跨筆記洞察', 'dg:consolidate')],
    ]),
  );
}

/** dg:digest callback — recent knowledge digest */
export async function handleDigest(ctx: Context, config: AppConfig): Promise<void> {
  const days = 7;
  const status = await ctx.reply(`正在彙整近 ${days} 天的知識...`);

  try {
    const notes = await collectRecentNotes(config.vaultPath, days);
    if (notes.length === 0) {
      await ctx.reply(`近 ${days} 天沒有筆記。`);
      return;
    }

    const groups = groupByCategory(notes);
    const overview = formatSimpleDigest(groups, days);

    let aiDigest = '';
    if (notes.length >= 3) {
      try {
        aiDigest = await buildDigest(groups, days);
      } catch {
        aiDigest = '';
      }
    }

    const output = aiDigest
      ? `${overview}\nAI 精華摘要\n${aiDigest}`
      : overview;

    await ctx.reply(output);
    logger.info('digest', '摘要完成', { days, notes: notes.length, categories: Object.keys(groups).length });
  } catch (err) {
    await ctx.reply(`摘要生成失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
