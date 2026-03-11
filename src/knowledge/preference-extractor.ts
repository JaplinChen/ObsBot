/**
 * User preference extraction from Vault metadata.
 * Zero LLM cost — pure statistical analysis of frontmatter fields.
 */
import type { VaultKnowledge } from './types.js';

/* ── Types ────────────────────────────────────────────────── */

interface NoteMeta {
  source: string;
  date: string;
  category: string;
  keywords: string[];
}

export interface UserPreferenceProfile {
  generatedAt: string;
  totalNotes: number;
  categoryDist: Array<{ category: string; count: number; pct: number }>;
  sourceDist: Array<{ source: string; count: number; pct: number }>;
  topKeywords: Array<{ keyword: string; count: number }>;
  qualityProfile: { avg: number; dist: Record<number, number>; highPct: number };
  topEntities: Array<{ name: string; type: string; mentions: number }>;
  monthlyTrend: Array<{ month: string; count: number }>;
  knowledgeGaps: string[];
  contentStyle: { toolPct: number; conceptPct: number; personPct: number };
}

/* ── Frontmatter parsing ──────────────────────────────────── */

function parseField(raw: string, field: string): string {
  const m = raw.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function parseArrayField(raw: string, field: string): string[] {
  const m = raw.match(new RegExp(`^${field}:\\s*\\[(.+?)\\]`, 'm'));
  if (!m) return [];
  return m[1].split(',').map(k => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function extractMeta(rawContent: string): NoteMeta {
  const head = rawContent.split('\n').slice(0, 30).join('\n');
  return {
    source: parseField(head, 'source') || '未知',
    date: parseField(head, 'date'),
    category: parseField(head, 'category') || '其他',
    keywords: parseArrayField(head, 'keywords'),
  };
}

/* ── Core extraction ──────────────────────────────────────── */

/** Build distribution map and sort descending */
function buildDist<T extends string>(items: T[]): Array<{ key: T; count: number; pct: number }> {
  const map = new Map<T, number>();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  const total = items.length || 1;
  return [...map.entries()]
    .map(([key, count]) => ({ key, count, pct: Math.round(count / total * 100) }))
    .sort((a, b) => b.count - a.count);
}

export function extractPreferences(
  notes: Array<{ rawContent: string }>,
  knowledge?: VaultKnowledge,
): UserPreferenceProfile {
  const total = notes.length;
  const metas = notes.map(n => extractMeta(n.rawContent));

  // Distributions
  const catDist = buildDist(metas.map(m => m.category));
  const srcDist = buildDist(metas.map(m => m.source));

  // Keywords
  const kwMap = new Map<string, number>();
  for (const m of metas) {
    for (const kw of m.keywords) {
      if (kw.length > 1) kwMap.set(kw, (kwMap.get(kw) ?? 0) + 1);
    }
  }
  const topKeywords = [...kwMap.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Monthly trend
  const monthDist = buildDist(metas.map(m => m.date.slice(0, 7)).filter(Boolean));

  // Quality (from knowledge store)
  const qDist: Record<number, number> = {};
  let qSum = 0;
  let qCount = 0;
  if (knowledge) {
    for (const note of Object.values(knowledge.notes)) {
      qDist[note.qualityScore] = (qDist[note.qualityScore] ?? 0) + 1;
      qSum += note.qualityScore;
      qCount++;
    }
  }
  const highQ = (qDist[4] ?? 0) + (qDist[5] ?? 0);

  // Entity focus
  const topEntities: Array<{ name: string; type: string; mentions: number }> = [];
  let toolCount = 0, conceptCount = 0, personCount = 0, entityTotal = 0;
  if (knowledge?.globalEntities) {
    const sorted = Object.values(knowledge.globalEntities).sort((a, b) => b.mentions - a.mentions);
    for (const e of sorted.slice(0, 15)) {
      topEntities.push({ name: e.name, type: e.type, mentions: e.mentions });
    }
    for (const e of sorted) {
      entityTotal++;
      if (['tool', 'technology', 'platform', 'framework', 'language'].includes(e.type)) toolCount++;
      else if (e.type === 'concept') conceptCount++;
      else if (e.type === 'person') personCount++;
    }
  }
  const eTotal = entityTotal || 1;

  // Knowledge gaps
  const knowledgeGaps: string[] = [];
  const catMap = new Map(catDist.map(d => [d.key, d.count]));
  for (const expected of ['生產力', '程式設計', '生活', '科技', '商業', '設計']) {
    let cnt = catMap.get(expected) ?? 0;
    for (const [cat, c] of catMap) { if (cat.startsWith(expected + '/')) cnt += c; }
    if (cnt <= 2) knowledgeGaps.push(`${expected}（${cnt} 篇）`);
  }

  return {
    generatedAt: new Date().toISOString(),
    totalNotes: total,
    categoryDist: catDist.map(d => ({ category: d.key, count: d.count, pct: d.pct })),
    sourceDist: srcDist.map(d => ({ source: d.key, count: d.count, pct: d.pct })),
    topKeywords,
    qualityProfile: {
      avg: qCount > 0 ? Math.round(qSum / qCount * 10) / 10 : 0,
      dist: qDist,
      highPct: qCount > 0 ? Math.round(highQ / qCount * 100) : 0,
    },
    topEntities,
    monthlyTrend: monthDist.map(d => ({ month: d.key, count: d.count })),
    knowledgeGaps,
    contentStyle: {
      toolPct: Math.round(toolCount / eTotal * 100),
      conceptPct: Math.round(conceptCount / eTotal * 100),
      personPct: Math.round(personCount / eTotal * 100),
    },
  };
}

/* ── Formatters ───────────────────────────────────────────── */

/** Concise MEMORY.md section (≤15 lines) */
export function formatForMemory(p: UserPreferenceProfile): string {
  const topCats = p.categoryDist.slice(0, 5).map(c => `${c.category}(${c.pct}%)`).join('、');
  const topSrcs = p.sourceDist.slice(0, 4).map(s => `${s.source}(${s.pct}%)`).join('、');
  const topKw = p.topKeywords.slice(0, 10).map(k => k.keyword).join(', ');
  const topEnt = p.topEntities.slice(0, 8).map(e => e.name).join(', ');
  const gaps = p.knowledgeGaps.length > 0 ? p.knowledgeGaps.join('、') : '無明顯缺口';

  return [
    '## 用戶偏好模型（自動生成）',
    '',
    `> 基於 ${p.totalNotes} 篇筆記統計，更新於 ${p.generatedAt.slice(0, 10)}`,
    '',
    `- **核心關注**：${topCats}`,
    `- **偏好來源**：${topSrcs}`,
    `- **高頻關鍵字**：${topKw}`,
    `- **高頻實體**：${topEnt}`,
    `- **內容風格**：工具/技術 ${p.contentStyle.toolPct}% | 概念 ${p.contentStyle.conceptPct}% | 人物 ${p.contentStyle.personPct}%`,
    `- **品質概況**：平均 ${p.qualityProfile.avg}/5，深度內容佔 ${p.qualityProfile.highPct}%`,
    `- **知識缺口**：${gaps}`,
  ].join('\n');
}

/** Detailed console report */
export function formatDetailedReport(p: UserPreferenceProfile): string {
  const L: string[] = ['📊 用戶偏好模型報告', `基於 ${p.totalNotes} 篇筆記`, ''];

  L.push('【分類分佈】');
  for (const c of p.categoryDist) L.push(`  ${c.category}: ${c.count} 篇 (${c.pct}%)`);
  L.push('');

  L.push('【來源分佈】');
  for (const s of p.sourceDist) L.push(`  ${s.source}: ${s.count} 篇 (${s.pct}%)`);
  L.push('');

  L.push('【Top 20 關鍵字】');
  for (const k of p.topKeywords) L.push(`  ${k.keyword}: ${k.count} 次`);
  L.push('');

  L.push('【品質分佈】');
  for (const score of [5, 4, 3, 2, 1]) {
    const count = p.qualityProfile.dist[score] ?? 0;
    L.push(`  ${score}分: ${'█'.repeat(count)} ${count}`);
  }
  L.push(`  平均: ${p.qualityProfile.avg}/5 | 高品質: ${p.qualityProfile.highPct}%`);
  L.push('');

  L.push('【Top 實體】');
  for (const e of p.topEntities) L.push(`  ${e.name} [${e.type}] — ${e.mentions} 篇`);
  L.push('');

  L.push('【月度趨勢】');
  for (const m of p.monthlyTrend) L.push(`  ${m.month}: ${'█'.repeat(m.count)} ${m.count}`);
  L.push('');

  if (p.knowledgeGaps.length > 0) {
    L.push('【知識缺口】');
    for (const g of p.knowledgeGaps) L.push(`  ⚠ ${g}`);
  }

  return L.join('\n');
}
