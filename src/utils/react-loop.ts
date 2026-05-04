/**
 * ReAct loop engine — Reasoning + Acting for multi-step knowledge queries.
 * Tools: search_vault (search Obsidian notes), final_answer (done).
 * Max 4 rounds to stay within Telegraf's 90s handler limit.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runLocalLlmPrompt } from './local-llm.js';
import { loadSoul } from './soul-loader.js';

const MAX_ROUNDS = 4;
const MAX_CONTEXT_NOTES = 5;
const MAX_CONTEXT_CHARS = 2000;

export interface ReactStep {
  thought: string;
  action: string;
  input: string;
  observation?: string;
}

export interface ReactResult {
  answer: string;
  steps: ReactStep[];
}

/* ── Vault search (search_vault tool) ─────────────────────────────────── */

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

function parseFm(raw: string): Map<string, string> {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return new Map();
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return new Map();
  const m = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const ci = line.indexOf(':');
    if (ci >= 0) m.set(line.slice(0, ci).trim(), line.slice(ci + 1).trim());
  }
  return m;
}

function parseArray(val: string): string[] {
  const m = val.match(/\[(.+)\]/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

async function searchVault(vaultPath: string, query: string): Promise<string> {
  const notesDir = join(vaultPath, 'KnowPipe');
  const files = await findMdFiles(notesDir);
  const words = query.split(/\s+/).filter((w) => w.length >= 2);

  const scored: Array<{ score: number; entry: string }> = [];
  for (const fp of files) {
    const raw = await readFile(fp, 'utf-8');
    const fm = parseFm(raw);
    const title = fm.get('title')?.replace(/^["']|["']$/g, '') ?? '';
    const summary = fm.get('summary')?.replace(/^["']|["']$/g, '') ?? '';
    const keywords = parseArray(fm.get('keywords') ?? '');
    const category = fm.get('category')?.replace(/^["']|["']$/g, '') ?? '';

    let score = 0;
    for (const w of words) {
      const lw = w.toLowerCase();
      if (title.toLowerCase().includes(lw)) score += 3;
      if (keywords.some((k) => k.toLowerCase().includes(lw))) score += 2;
      if (summary.toLowerCase().includes(lw)) score += 1;
      if (category.toLowerCase().includes(lw)) score += 1;
    }
    if (score > 0) scored.push({ score, entry: `[${title}] (${category}) ${summary}` });
  }

  scored.sort((a, b) => b.score - a.score);
  let ctx = '';
  for (const { entry } of scored.slice(0, MAX_CONTEXT_NOTES)) {
    if (ctx.length + entry.length > MAX_CONTEXT_CHARS) break;
    ctx += entry + '\n';
  }
  return ctx.trim() || '（無相關筆記）';
}

/* ── ReAct prompt builders ────────────────────────────────────────────── */

function buildSystemPrompt(soul: string): string {
  return [
    soul,
    '## 工具使用規則',
    '每次回應必須輸出 JSON（只有 JSON，不含其他文字）：',
    '{"thought":"推理過程","action":"search_vault|final_answer","input":"搜尋關鍵字 or 最終回答文字"}',
    '',
    '可用工具：',
    '- search_vault：在知識庫搜尋相關筆記，input 為搜尋關鍵字',
    '- final_answer：提供最終回答，input 為完整回答文字（繁體中文，≤300字）',
    '',
    '策略：先搜尋，根據觀察結果再決定是否需要追加搜尋，最多搜尋 3 次後給出 final_answer。',
  ].filter(Boolean).join('\n');
}

function buildUserMessage(query: string, history: ReactStep[]): string {
  let msg = `問題：${query}`;
  for (const step of history) {
    msg += `\n\n思考：${step.thought}\n行動：${step.action}(${step.input})\n觀察：${step.observation ?? ''}`;
  }
  msg += '\n\n請繼續：';
  return msg;
}

function parseStep(raw: string): ReactStep | null {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const thought = String(obj['thought'] ?? '');
    const action = String(obj['action'] ?? '');
    const input = String(obj['input'] ?? '');
    if (!action || !input) return null;
    return { thought, action, input };
  } catch { return null; }
}

/* ── Main ReAct loop ──────────────────────────────────────────────────── */

export async function runReActLoop(
  query: string,
  vaultPath: string,
): Promise<ReactResult> {
  const soul = await loadSoul();
  const systemPrompt = buildSystemPrompt(soul);
  const steps: ReactStep[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const raw = await runLocalLlmPrompt(buildUserMessage(query, steps), {
      systemPrompt,
      task: 'analyze',
      timeoutMs: 20_000,
      maxTokens: 512,
    });

    if (!raw) break;
    const step = parseStep(raw);
    if (!step) break;

    if (step.action === 'final_answer') {
      return { answer: step.input, steps };
    }

    step.observation = step.action === 'search_vault'
      ? await searchVault(vaultPath, step.input)
      : '（未知工具）';

    steps.push(step);
  }

  // Fallback: synthesize answer from accumulated context
  const ctxSummary = steps.map((s) => `搜尋「${s.input}」→ ${s.observation}`).join('\n');
  const fallback = await runLocalLlmPrompt(
    `問題：${query}\n\n知識庫搜尋結果：\n${ctxSummary}\n\n請根據以上資料用繁體中文回答，若資訊不足請坦承說明。`,
    { soul: true, task: 'analyze', timeoutMs: 30_000, maxTokens: 1024 },
  );

  return { answer: fallback ?? '無法生成回答，請稍後再試。', steps };
}
