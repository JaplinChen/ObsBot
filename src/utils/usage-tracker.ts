/**
 * Usage Tracker — 記錄每次 LLM 呼叫的 tier/task/耗時，供 /digest 週報分析使用。
 * 寫入 data/usage-stats.jsonl（每行一個 JSON record，append-only）
 */
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const STATS_FILE = join('data', 'usage-stats.jsonl');

export interface UsageEntry {
  ts: string;
  task: string;
  tier: string;
  provider: string;
  durationMs: number;
  inputLen: number;
  outputLen: number;
}

/** Append one usage record（best-effort，不影響主流程）*/
export async function appendUsage(entry: UsageEntry): Promise<void> {
  try {
    await mkdir(dirname(STATS_FILE), { recursive: true });
    await appendFile(STATS_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* silent */ }
}

/** 讀取最近 N 天的 usage records */
export async function readUsageStats(days: number): Promise<UsageEntry[]> {
  try {
    const raw = await readFile(STATS_FILE, 'utf-8');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line) as UsageEntry; } catch { return null; } })
      .filter((e): e is UsageEntry => e !== null && new Date(e.ts) >= cutoff);
  } catch {
    return [];
  }
}

/** 格式化 usage 報告為 Markdown 表格 */
export function formatUsageReport(entries: UsageEntry[]): string {
  if (entries.length === 0) return '（無 LLM 使用記錄）';

  // Tier 分佈
  const tierCounts: Record<string, number> = {};
  const taskCounts: Record<string, number> = {};
  const providerCounts: Record<string, number> = {};
  let totalDuration = 0;

  for (const e of entries) {
    tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1;
    taskCounts[e.task] = (taskCounts[e.task] ?? 0) + 1;
    providerCounts[e.provider] = (providerCounts[e.provider] ?? 0) + 1;
    totalDuration += e.durationMs;
  }

  const lines: string[] = [
    `📊 LLM 使用統計（共 ${entries.length} 次呼叫）`,
    '',
    '**Tier 分佈**',
    ...Object.entries(tierCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `  ${t}: ${c} 次（${Math.round(c / entries.length * 100)}%）`),
    '',
    '**Top Tasks**',
    ...Object.entries(taskCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, c]) => `  ${t}: ${c} 次`),
    '',
    '**Provider 分佈**',
    ...Object.entries(providerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([p, c]) => `  ${p}: ${c} 次`),
    '',
    `⏱ 平均耗時：${Math.round(totalDuration / entries.length)}ms`,
  ];

  return lines.join('\n');
}
