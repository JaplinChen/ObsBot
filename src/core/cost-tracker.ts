/**
 * Lean cost tracker — estimates token usage per LLM call via character count.
 * Chinese: ~2.5 chars/token; Latin: ~4 chars/token.
 * Logs to data/cost-log.json; provides monthly aggregate for /health.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.js';

const COST_LOG = join('data', 'cost-log.json');
const MAX_LOG_ENTRIES = 1000;

export interface CostEntry {
  timestamp: string;
  tier: string;
  estimatedTokens: number;
}

export interface MonthlyCostStats {
  month: string;          // 'YYYY-MM'
  totalEstimatedTokens: number;
  callCount: number;
  byTier: Record<string, number>;
}

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;

export function estimateTokens(text: string): number {
  const chineseCount = (text.match(CHINESE_RE) ?? []).length;
  const latinCount = text.length - chineseCount;
  return Math.ceil(chineseCount / 2.5 + latinCount / 4);
}

export async function recordCost(tier: string, promptText: string): Promise<void> {
  try {
    const estimated = estimateTokens(promptText);
    const entry: CostEntry = {
      timestamp: new Date().toISOString(),
      tier,
      estimatedTokens: estimated,
    };

    let entries: CostEntry[] = [];
    try {
      const raw = await readFile(COST_LOG, 'utf-8');
      entries = JSON.parse(raw) as CostEntry[];
    } catch { /* first write */ }

    const updated = [...entries, entry].slice(-MAX_LOG_ENTRIES);
    await writeFile(COST_LOG, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('cost-tracker', '成本記錄失敗', { err: (err as Error).message });
  }
}

export async function getMonthlyCostStats(): Promise<MonthlyCostStats> {
  const month = new Date().toISOString().slice(0, 7);
  const empty: MonthlyCostStats = { month, totalEstimatedTokens: 0, callCount: 0, byTier: {} };

  try {
    const raw = await readFile(COST_LOG, 'utf-8');
    const entries = JSON.parse(raw) as CostEntry[];

    const thisMonth = entries.filter(e => e.timestamp.startsWith(month));
    if (thisMonth.length === 0) return empty;

    const byTier: Record<string, number> = {};
    let total = 0;
    for (const e of thisMonth) {
      total += e.estimatedTokens;
      byTier[e.tier] = (byTier[e.tier] ?? 0) + e.estimatedTokens;
    }

    return { month, totalEstimatedTokens: total, callCount: thisMonth.length, byTier };
  } catch {
    return empty;
  }
}

export function formatCostStats(stats: MonthlyCostStats): string {
  const tierBreakdown = Object.entries(stats.byTier)
    .sort(([, a], [, b]) => b - a)
    .map(([tier, tokens]) => `${tier}: ~${(tokens / 1000).toFixed(1)}k`)
    .join('、');

  return [
    `💰 本月 LLM 用量（${stats.month}）`,
    `估算 tokens：~${(stats.totalEstimatedTokens / 1000).toFixed(1)}k（${stats.callCount} 次呼叫）`,
    tierBreakdown ? `按層級：${tierBreakdown}` : '',
    process.env.COST_OPTIMIZED === 'true' ? '⚡ 省錢模式：已啟用（強制 flash tier）' : '',
  ].filter(Boolean).join('\n');
}
