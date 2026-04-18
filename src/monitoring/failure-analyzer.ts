/**
 * Failure pattern analysis — reads corrections-log and generates
 * enrichment prompt improvement suggestions via LLM.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CorrectionEvent } from './health-types.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

const CORRECTIONS_LOG = join('data', 'corrections-log.json');
const MIN_EVENTS_FOR_ANALYSIS = 20;

export interface FailureStats {
  totalEvents: number;
  byField: Record<string, number>;
  byCategory: Record<string, number>;
  byReason: Record<string, number>;
  topFailingCategories: string[];
}

export interface FailureAnalysisResult {
  stats: FailureStats;
  suggestions: string[];
  analysisText: string;
}

function extractCategory(filePath: string): string {
  // e.g. "AI/研究對話/Claude/note.md" → "AI/研究對話"
  const parts = filePath.split('/');
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? '未知';
}

function computeStats(events: CorrectionEvent[]): FailureStats {
  const byField: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byReason: Record<string, number> = {};

  for (const ev of events) {
    byField[ev.field] = (byField[ev.field] ?? 0) + 1;
    const cat = extractCategory(ev.file);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (ev.reason) byReason[ev.reason] = (byReason[ev.reason] ?? 0) + 1;
  }

  const topFailingCategories = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cat]) => cat);

  return { totalEvents: events.length, byField, byCategory, byReason, topFailingCategories };
}

function formatStatsForPrompt(stats: FailureStats): string {
  const fieldLines = Object.entries(stats.byField)
    .sort(([, a], [, b]) => b - a)
    .map(([f, n]) => `  ${f}: ${n} 次`)
    .join('\n');

  const catLines = stats.topFailingCategories
    .map(c => `  ${c}: ${stats.byCategory[c]} 次`)
    .join('\n');

  const reasonLines = Object.entries(stats.byReason)
    .sort(([, a], [, b]) => b - a)
    .map(([r, n]) => `  ${r}: ${n} 次`)
    .join('\n');

  return [
    `總修正事件：${stats.totalEvents}`,
    `按欄位分布：\n${fieldLines}`,
    `按分類分布（前5）：\n${catLines}`,
    reasonLines ? `按失敗原因：\n${reasonLines}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function analyzeFailures(): Promise<FailureAnalysisResult> {
  let events: CorrectionEvent[] = [];
  try {
    const raw = await readFile(CORRECTIONS_LOG, 'utf-8');
    events = JSON.parse(raw) as CorrectionEvent[];
  } catch {
    return {
      stats: { totalEvents: 0, byField: {}, byCategory: {}, byReason: {}, topFailingCategories: [] },
      suggestions: [],
      analysisText: '尚無修正記錄，請先執行 /vault quality 累積資料。',
    };
  }

  const stats = computeStats(events);

  if (stats.totalEvents < MIN_EVENTS_FOR_ANALYSIS) {
    return {
      stats,
      suggestions: [],
      analysisText: `修正事件僅 ${stats.totalEvents} 筆（需 ≥${MIN_EVENTS_FOR_ANALYSIS}），資料不足無法可靠分析。`,
    };
  }

  const statsText = formatStatsForPrompt(stats);

  const prompt = [
    'CAVEMAN RULE: 回覆純文字，不要 JSON，不要 markdown 標題符號(#)。',
    '你是 ObsBot enrichment 品質分析師。根據以下 corrections-log 統計，找出 enrichment prompt 最需要改進的地方。',
    '',
    '統計數據：',
    statsText,
    '',
    '請輸出：',
    '1. 兩句話說明最主要的失敗模式',
    '2. 三條具體的 enrichment prompt 改進建議（每條一行，用「建議:」開頭）',
    '3. 哪個分類最需要優先改善，以及建議的改善方向',
    '',
    '使用繁體中文，簡短直接。',
  ].join('\n');

  let analysisText = statsText;
  let suggestions: string[] = [];

  try {
    const raw = await runLocalLlmPrompt(prompt, { timeoutMs: 30_000, model: 'flash' });
    if (raw) {
      analysisText = raw;
      suggestions = raw
        .split('\n')
        .filter(l => l.startsWith('建議:'))
        .map(l => l.replace(/^建議:\s*/, '').trim());
    }
  } catch (err) {
    logger.warn('failure-analyzer', 'LLM 分析失敗，回傳純統計', { err: (err as Error).message });
  }

  return { stats, suggestions, analysisText };
}

export function formatFailureReport(result: FailureAnalysisResult): string {
  const { stats, analysisText } = result;
  const lines: string[] = [
    '📊 *Enrichment 失敗模式分析*',
    '',
    `修正事件總計：${stats.totalEvents} 筆`,
  ];

  const topFields = Object.entries(stats.byField)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([f, n]) => `${f}(${n})`)
    .join('、');
  if (topFields) lines.push(`最常修正欄位：${topFields}`);

  if (stats.topFailingCategories.length > 0) {
    lines.push(`失敗最多分類：${stats.topFailingCategories.slice(0, 3).join('、')}`);
  }

  lines.push('', '💡 *LLM 分析建議*', '', analysisText);
  return lines.join('\n');
}
