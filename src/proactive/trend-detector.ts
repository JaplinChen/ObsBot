/**
 * Trend detector — identifies keyword frequency spikes and category gaps.
 * Zero LLM cost: pure statistical analysis on vault frontmatter.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import type { TrendAlert, CategoryGap } from './proactive-types.js';

interface NoteEntry {
  date: string;
  category: string;
  keywords: string[];
}

/** Parse frontmatter field from raw text */
function fm(raw: string, field: string): string {
  const m = raw.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function parseKeywords(raw: string): string[] {
  const m = raw.match(/^keywords:\s*\[(.+?)\]/m);
  if (!m) return [];
  return m[1].split(',').map(k => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Collect note metadata from vault */
async function collectNotes(vaultPath: string): Promise<NoteEntry[]> {
  const files = await getAllMdFiles(join(vaultPath, 'KnowPipe'));
  const notes: NoteEntry[] = [];

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const head = fmMatch[1];
      const date = fm(head, 'date');
      if (!date) continue;
      notes.push({
        date,
        category: fm(head, 'category') || '其他',
        keywords: parseKeywords(head),
      });
    } catch { /* skip */ }
  }
  return notes;
}

/**
 * Detect trending keywords: compare recent period vs previous period.
 * Returns keywords with significant growth.
 */
export function detectTrends(
  notes: NoteEntry[],
  recentDays: number = 3,
  previousDays: number = 14,
): TrendAlert[] {
  const now = Date.now();
  const recentCutoff = now - recentDays * 86_400_000;
  const prevCutoff = now - previousDays * 86_400_000;

  const recentKw = new Map<string, number>();
  const prevKw = new Map<string, number>();

  for (const note of notes) {
    const ts = new Date(note.date).getTime();
    if (isNaN(ts)) continue;

    for (const kw of note.keywords) {
      const k = kw.toLowerCase();
      if (ts >= recentCutoff) {
        recentKw.set(k, (recentKw.get(k) ?? 0) + 1);
      } else if (ts >= prevCutoff) {
        prevKw.set(k, (prevKw.get(k) ?? 0) + 1);
      }
    }
  }

  const alerts: TrendAlert[] = [];
  // Normalize by period length
  const recentScale = previousDays / recentDays;

  for (const [kw, recentCount] of recentKw) {
    const prevCount = prevKw.get(kw) ?? 0;
    const normalizedRecent = recentCount * recentScale;
    // Growth: if recent normalized > previous * 2, or new keyword with 2+ mentions
    if (prevCount === 0 && recentCount >= 2) {
      alerts.push({ keyword: kw, recentCount, previousCount: 0, growthRate: Infinity });
    } else if (prevCount > 0 && normalizedRecent >= prevCount * 2) {
      const rate = Math.round((normalizedRecent / prevCount - 1) * 100);
      alerts.push({ keyword: kw, recentCount, previousCount: prevCount, growthRate: rate });
    }
  }

  return alerts
    .sort((a, b) => b.recentCount - a.recentCount)
    .slice(0, 10);
}

/**
 * Detect category gaps: categories with no recent notes.
 */
export function detectCategoryGaps(
  notes: NoteEntry[],
  minDaysInactive: number = 14,
): CategoryGap[] {
  const now = Date.now();
  const lastActive = new Map<string, number>();

  for (const note of notes) {
    const ts = new Date(note.date).getTime();
    if (isNaN(ts)) continue;
    // Use top-level category
    const cat = note.category.split('/')[0];
    const prev = lastActive.get(cat) ?? 0;
    if (ts > prev) lastActive.set(cat, ts);
  }

  const gaps: CategoryGap[] = [];
  for (const [cat, lastTs] of lastActive) {
    const days = Math.floor((now - lastTs) / 86_400_000);
    if (days >= minDaysInactive) {
      gaps.push({ category: cat, daysSinceLastNote: days });
    }
  }

  return gaps.sort((a, b) => b.daysSinceLastNote - a.daysSinceLastNote);
}

/* ── Long-term trend detection ────────────────────────────── */

export interface TopicTrend {
  keyword: string;
  direction: 'rising' | 'stable' | 'declining';
  /** Monthly counts [{ month: '2026-01', count: N }, ...] */
  monthlyData: Array<{ month: string; count: number }>;
  /** Linear regression slope (positive = rising) */
  slope: number;
  /** Month with highest count */
  peakMonth: string;
  /** Total mentions */
  totalMentions: number;
}

/**
 * Detect long-term keyword trends over N months.
 * Groups keywords by month, computes linear slope to identify rising/declining topics.
 */
export function detectLongTermTrends(notes: NoteEntry[], months = 6): TopicTrend[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffTs = cutoff.getTime();

  // Bucket keywords by month
  const kwMonthly = new Map<string, Map<string, number>>();

  for (const note of notes) {
    const ts = new Date(note.date).getTime();
    if (isNaN(ts) || ts < cutoffTs) continue;
    const month = note.date.slice(0, 7); // YYYY-MM

    for (const kw of note.keywords) {
      const k = kw.toLowerCase();
      if (!kwMonthly.has(k)) kwMonthly.set(k, new Map());
      const m = kwMonthly.get(k)!;
      m.set(month, (m.get(month) ?? 0) + 1);
    }
  }

  // Generate all months in range
  const allMonths: string[] = [];
  const cursor = new Date(cutoff.getFullYear(), cutoff.getMonth(), 1);
  while (cursor <= now) {
    allMonths.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const trends: TopicTrend[] = [];

  for (const [kw, monthMap] of kwMonthly) {
    const total = [...monthMap.values()].reduce((s, v) => s + v, 0);
    if (total < 3) continue; // Skip rare keywords

    const monthlyData = allMonths.map(m => ({ month: m, count: monthMap.get(m) ?? 0 }));

    // Linear regression slope
    const n = monthlyData.length;
    const xMean = (n - 1) / 2;
    const yMean = total / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (monthlyData[i].count - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;

    // Peak month
    let peakMonth = allMonths[0];
    let peakCount = 0;
    for (const d of monthlyData) {
      if (d.count > peakCount) { peakCount = d.count; peakMonth = d.month; }
    }

    const direction = slope > 0.3 ? 'rising' : slope < -0.3 ? 'declining' : 'stable';

    trends.push({ keyword: kw, direction, monthlyData, slope: Math.round(slope * 100) / 100, peakMonth, totalMentions: total });
  }

  return trends.sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope));
}

/** Main entry: scan vault and return trend + gap analysis */
export async function analyzeVaultTrends(vaultPath: string): Promise<{
  notes: NoteEntry[];
  trends: TrendAlert[];
  gaps: CategoryGap[];
}> {
  const notes = await collectNotes(vaultPath);
  const trends = detectTrends(notes);
  const gaps = detectCategoryGaps(notes);
  return { notes, trends, gaps };
}
