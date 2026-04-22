/**
 * Daily insights generator — extracts deep insights from recent vault notes.
 * Unlike the statistical digest, this uses AI to find cross-domain patterns.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

export interface DailyInsight {
  category: string;
  title: string;
  insight: string;
  sourceNotes: string[];
}

interface NoteMeta {
  title: string;
  category: string;
  summary: string;
  keywords: string[];
  date: string;
}

/** Parse frontmatter value from raw note text. */
function fm(head: string, field: string): string {
  const m = head.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function parseList(head: string, field: string): string[] {
  const m = head.match(new RegExp(`^${field}:\\s*\\[(.+?)\\]`, 'm'));
  if (!m) return [];
  return m[1].split(',').map(k => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Collect recent note metadata from vault. */
async function collectRecentNotes(vaultPath: string, hours: number): Promise<NoteMeta[]> {
  const files = await getAllMdFiles(join(vaultPath, 'KnowPipe'));
  const cutoff = Date.now() - hours * 3_600_000;
  const notes: NoteMeta[] = [];

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const head = fmMatch[1];

      const date = fm(head, 'date');
      if (!date) continue;
      const noteTime = new Date(date).getTime();
      if (noteTime < cutoff) continue;

      notes.push({
        title: fm(head, 'title'),
        category: fm(head, 'category') || '其他',
        summary: fm(head, 'summary'),
        keywords: parseList(head, 'keywords'),
        date,
      });
    } catch { /* skip */ }
  }

  return notes;
}

/** Group notes by top-level category and pick representative ones. */
function groupByCategory(notes: NoteMeta[]): Map<string, NoteMeta[]> {
  const groups = new Map<string, NoteMeta[]>();
  for (const n of notes) {
    const topCat = n.category.split('/')[0];
    const list = groups.get(topCat) ?? [];
    list.push(n);
    groups.set(topCat, list);
  }
  return groups;
}

/** Generate insights from grouped notes via AI. */
async function generateInsightsFromGroups(
  groups: Map<string, NoteMeta[]>,
): Promise<DailyInsight[]> {
  // Pick top categories by note count, max 5
  const sorted = [...groups.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);

  const noteSummaries = sorted.map(([cat, notes]) => {
    const titles = notes.slice(0, 5).map(n => `「${n.title}」`).join('、');
    const kws = [...new Set(notes.flatMap(n => n.keywords))].slice(0, 8).join('、');
    return `[${cat}] ${notes.length} 篇：${titles}（關鍵字：${kws}）`;
  }).join('\n');

  const prompt = [
    '你是知識管理顧問。根據以下用戶近 24 小時收集的筆記統計，萃取 3-5 條深度洞察。',
    '每條洞察必須：(1) 指出跨筆記的模式或趨勢 (2) 提供可行動的建議。',
    '輸出格式（嚴格遵守，每條一行）：',
    '[分類] 洞察標題 | 洞察內容（50字內）| 來源筆記1、來源筆記2',
    '',
    '筆記統計：',
    noteSummaries,
  ].join('\n');

  try {
    const result = await runLocalLlmPrompt(prompt, {
      task: 'digest',
      timeoutMs: 30_000,
      maxTokens: 512,
    });
    if (!result) return [];
    return parseInsightResponse(result);
  } catch (err) {
    logger.warn('daily-insights', '生成洞察失敗', { error: (err as Error).message });
    return [];
  }
}

/** Parse AI response into structured insights. */
function parseInsightResponse(raw: string): DailyInsight[] {
  const insights: DailyInsight[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Expected: [分類] 標題 | 內容 | 來源
    const catMatch = trimmed.match(/^\[([^\]]+)\]\s*(.+)/);
    if (!catMatch) continue;

    const category = catMatch[1];
    const rest = catMatch[2];
    const parts = rest.split('|').map(s => s.trim());
    if (parts.length < 2) continue;

    insights.push({
      category,
      title: parts[0],
      insight: parts[1],
      sourceNotes: parts[2]?.split(/[、,]/).map(s => s.trim()).filter(Boolean) ?? [],
    });
  }
  return insights.slice(0, 5);
}

/** Format insights for Telegram message. */
export function formatInsightsSection(insights: DailyInsight[]): string[] {
  if (insights.length === 0) return [];
  const lines: string[] = ['💡 【今日洞察】', ''];
  for (let i = 0; i < insights.length; i++) {
    const ins = insights[i];
    lines.push(`${i + 1}. [${ins.category}] ${ins.title}`);
    lines.push(`   ${ins.insight}`);
    if (ins.sourceNotes.length > 0) {
      lines.push(`   來源：${ins.sourceNotes.join('、')}`);
    }
    lines.push('');
  }
  return lines;
}

/**
 * Generate daily insights from recent vault notes.
 * @param vaultPath Vault root path
 * @param hours Look-back window (default: 24)
 */
export async function generateDailyInsights(
  vaultPath: string,
  hours = 24,
): Promise<DailyInsight[]> {
  const notes = await collectRecentNotes(vaultPath, hours);
  if (notes.length < 3) {
    logger.info('daily-insights', '筆記不足，跳過洞察', { count: notes.length });
    return [];
  }

  const groups = groupByCategory(notes);
  return generateInsightsFromGroups(groups);
}
