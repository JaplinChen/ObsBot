/**
 * Structured metrics collection — append-only JSONL file for tracking
 * extraction performance, success rates, and enrichment quality.
 */
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.js';

const METRICS_DIR = 'data';
const METRICS_FILE = join(METRICS_DIR, 'metrics.jsonl');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB, then rotate

export interface MetricEntry {
  ts: number;
  type: 'extract' | 'enrich' | 'save' | 'error';
  platform: string;
  url?: string;
  durationMs?: number;
  success: boolean;
  fallback?: boolean;
  category?: string;
  error?: string;
}

/** Append a metric entry to the JSONL file. Fire-and-forget. */
export async function recordMetric(entry: MetricEntry): Promise<void> {
  try {
    await mkdir(METRICS_DIR, { recursive: true });
    // Rotate if file too large
    try {
      const s = await stat(METRICS_FILE);
      if (s.size > MAX_FILE_SIZE) {
        const { rename } = await import('node:fs/promises');
        await rename(METRICS_FILE, `${METRICS_FILE}.${Date.now()}.bak`);
      }
    } catch { /* file doesn't exist yet */ }
    await appendFile(METRICS_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    logger.warn('metrics', '指標寫入失敗', { err });
  }
}

export interface MetricsSummary {
  totalRequests: number;
  successRate: number;
  avgDurationMs: number;
  platformStats: Array<{ platform: string; count: number; successRate: number; avgMs: number }>;
  recentErrors: string[];
}

/** Read metrics and compute summary stats. */
export async function getMetricsSummary(hours = 24): Promise<MetricsSummary> {
  const cutoff = Date.now() - hours * 3600_000;
  let entries: MetricEntry[] = [];

  try {
    const raw = await readFile(METRICS_FILE, 'utf-8');
    entries = raw.trim().split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter((e): e is MetricEntry => e !== null && e.ts >= cutoff);
  } catch { /* no metrics file yet */ }

  const extracts = entries.filter(e => e.type === 'extract');
  const successes = extracts.filter(e => e.success);
  const durations = extracts.filter(e => e.durationMs).map(e => e.durationMs!);

  // Per-platform breakdown
  const platformMap = new Map<string, { count: number; ok: number; totalMs: number }>();
  for (const e of extracts) {
    const p = platformMap.get(e.platform) ?? { count: 0, ok: 0, totalMs: 0 };
    p.count++;
    if (e.success) p.ok++;
    if (e.durationMs) p.totalMs += e.durationMs;
    platformMap.set(e.platform, p);
  }

  const platformStats = [...platformMap.entries()]
    .map(([platform, s]) => ({
      platform,
      count: s.count,
      successRate: s.count > 0 ? Math.round((s.ok / s.count) * 100) : 0,
      avgMs: s.count > 0 ? Math.round(s.totalMs / s.count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const recentErrors = entries
    .filter(e => !e.success && e.error)
    .slice(-5)
    .map(e => `[${e.platform}] ${e.error?.slice(0, 60)}`);

  return {
    totalRequests: extracts.length,
    successRate: extracts.length > 0 ? Math.round((successes.length / extracts.length) * 100) : 0,
    avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    platformStats,
    recentErrors,
  };
}
