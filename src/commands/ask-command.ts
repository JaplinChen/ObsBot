/**
 * /ask — Query the Vault knowledge base using OpenCode + free model.
 * Searches relevant notes by keyword, builds context, generates answer.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'telegraf';
import { logger } from '../core/logger.js';
import { VAULT_SUBFOLDER, type AppConfig } from '../utils/config.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';

const MAX_CONTEXT_NOTES = 5;
const MAX_CONTEXT_CHARS = 2000;

interface NoteMeta {
  title: string;
  keywords: string[];
  summary: string;
  category: string;
}

/* ── Frontmatter helpers ─────────────────────────────────────────────── */

function parseFrontmatter(raw: string): Map<string, string> {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return new Map();
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return new Map();
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    fields.set(line.slice(0, ci).trim(), line.slice(ci + 1).trim());
  }
  return fields;
}

function parseArray(val: string): string[] {
  const m = val.match(/\[(.+)\]/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function strip(s: string): string {
  return s.replace(/^["']|["']$/g, '').trim();
}

/* ── Recursive file scan ─────────────────────────────────────────────── */

async function findMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) results.push(...await findMdFiles(full));
    else if (e.name.endsWith('.md')) results.push(full);
  }
  return results;
}

/* ── Search vault for relevant notes ─────────────────────────────────── */

function scoreNote(note: NoteMeta, queryWords: string[]): number {
  let score = 0;
  const lower = (s: string) => s.toLowerCase();
  for (const w of queryWords) {
    const lw = lower(w);
    if (lower(note.title).includes(lw)) score += 3;
    if (note.keywords.some((k) => lower(k).includes(lw))) score += 2;
    if (lower(note.summary).includes(lw)) score += 1;
    if (lower(note.category).includes(lw)) score += 1;
  }
  return score;
}

async function searchVault(vaultPath: string, query: string): Promise<string> {
  const notesDir = join(vaultPath, VAULT_SUBFOLDER);
  const files = await findMdFiles(notesDir);
  const queryWords = query.split(/\s+/).filter((w) => w.length >= 2);

  const scored: Array<{ meta: NoteMeta; score: number }> = [];
  for (const fp of files) {
    const raw = await readFile(fp, 'utf-8');
    const fm = parseFrontmatter(raw);
    const meta: NoteMeta = {
      title: strip(fm.get('title') ?? ''),
      keywords: parseArray(fm.get('keywords') ?? ''),
      summary: strip(fm.get('summary') ?? ''),
      category: strip(fm.get('category') ?? ''),
    };
    const s = scoreNote(meta, queryWords);
    if (s > 0) scored.push({ meta, score: s });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, MAX_CONTEXT_NOTES);

  if (top.length === 0) return '';

  let ctx = '';
  for (const { meta } of top) {
    const entry = `[${meta.title}] (${meta.category}) ${meta.summary}`;
    if (ctx.length + entry.length > MAX_CONTEXT_CHARS) break;
    ctx += entry + '\n';
  }
  return ctx.trim();
}

/* ── Command handler ─────────────────────────────────────────────────── */

export async function handleAsk(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const query = text.replace(/^\/ask\s*/i, '').trim();

  if (!query) {
    await ctx.reply(
      tagForceReply('ask', '請輸入您想問的問題：'),
      forceReplyMarkup('輸入問題…'),
    );
    return;
  }

  const status = await ctx.reply(`搜尋知識庫中…`);

  try {
    const vaultContext = await searchVault(config.vaultPath, query);
    const contextBlock = vaultContext
      ? `\n\n以下是知識庫中的相關筆記摘要：\n${vaultContext}`
      : '\n\n知識庫中沒有直接相關的筆記。';

    const prompt = [
      '你是一個個人知識助手。用繁體中文（zh-TW）回答問題。',
      '根據提供的知識庫筆記摘要來回答，若資訊不足就坦承說明。',
      '回答簡潔、具體、有用。不超過 300 字。',
      contextBlock,
      `\n問題：${query}`,
    ].join('\n');

    const answer = await runLocalLlmPrompt(prompt, { timeoutMs: 60_000, model: 'deep' });

    if (!answer) {
      await ctx.reply('LLM 無回應，請稍後再試。');
      return;
    }

    const header = vaultContext
      ? `(參考了 ${vaultContext.split('\n').length} 篇筆記)\n\n`
      : '(知識庫無直接相關筆記)\n\n';

    await ctx.reply(header + answer);
    logger.info('ask', 'answered', { queryLen: query.length, answerLen: answer.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('ask', 'failed', { message: msg });
    await ctx.reply(`查詢失敗：${msg}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
