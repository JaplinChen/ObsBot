/**
 * Knowledge health report — unified assessment of vault knowledge quality.
 * Zero LLM cost: pure statistical analysis on existing knowledge data.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import type { VaultKnowledge, NoteAnalysis } from './types.js';
import { buildEntityGraph, detectKnowledgeGaps, type KnowledgeGap } from './knowledge-graph.js';
import { aggregateKnowledge } from './knowledge-aggregator.js';

/* ── Types ────────────────────────────────────────────────── */

export interface HealthSection {
  label: string;
  score: number;      // 0–100
  emoji: string;
  details: string[];
}

export interface KnowledgeHealthReport {
  generatedAt: string;
  totalNotes: number;
  overallScore: number;   // 0–100 weighted average
  sections: {
    coverage: HealthSection;
    quality: HealthSection;
    freshness: HealthSection;
    connectivity: HealthSection;
    contradictions: HealthSection;
  };
  /** Top 5 actionable recommendations */
  recommendations: string[];
}

function assessCoverage(knowledge: VaultKnowledge): HealthSection {
  const gaps = detectKnowledgeGaps(knowledge);
  const totalEntities = knowledge.globalEntities
    ? Object.keys(knowledge.globalEntities).length : 0;
  const severeGaps = gaps.filter(g => g.insightCount === 0);
  const moderateGaps = gaps.filter(g => g.insightCount > 0 && g.avgQuality < 3);

  // Score: 100 if no gaps, penalized by gap ratio
  const gapRatio = totalEntities > 0 ? gaps.length / totalEntities : 0;
  const score = Math.max(0, Math.round(100 - gapRatio * 200));

  const details: string[] = [
    `${totalEntities} 個實體，${gaps.length} 個知識缺口`,
  ];
  if (severeGaps.length > 0)
    details.push(`⚠ ${severeGaps.length} 個實體完全無洞察：${severeGaps.slice(0, 3).map(g => g.entity).join('、')}`);
  if (moderateGaps.length > 0)
    details.push(`${moderateGaps.length} 個實體品質偏低`);

  return { label: '覆蓋率', score, emoji: '📡', details };
}

function assessQuality(knowledge: VaultKnowledge): HealthSection {
  const notes = Object.values(knowledge.notes);
  if (notes.length === 0) return { label: '品質', score: 0, emoji: '⭐', details: ['尚無筆記'] };

  const low = notes.filter(n => n.qualityScore <= 2);
  const high = notes.filter(n => n.qualityScore >= 4);
  const noInsights = notes.filter(n => n.insights.length === 0);

  // Score: based on avg quality (1–5 → 0–100) with penalty for no-insight notes
  const avgQ = notes.reduce((s, n) => s + n.qualityScore, 0) / notes.length;
  const noInsightPenalty = (noInsights.length / notes.length) * 20;
  const score = Math.max(0, Math.min(100, Math.round((avgQ / 5) * 100 - noInsightPenalty)));

  const details = [
    `平均品質 ${(avgQ).toFixed(1)}/5`,
    `高品質（4-5 分）${high.length} 篇 | 低品質（1-2 分）${low.length} 篇`,
  ];
  if (noInsights.length > 0) details.push(`${noInsights.length} 篇完全無洞察`);

  return { label: '品質', score, emoji: '⭐', details };
}

function assessFreshness(notes: NoteAnalysis[]): HealthSection {
  if (notes.length === 0) return { label: '新鮮度', score: 0, emoji: '🕐', details: ['尚無筆記'] };

  const now = Date.now();
  const daysAgo = (n: NoteAnalysis) => {
    const d = n.analyzedAt ? new Date(n.analyzedAt).getTime() : 0;
    return d > 0 ? Math.floor((now - d) / 86_400_000) : 999;
  };

  const recent7d = notes.filter(n => daysAgo(n) <= 7).length;
  const recent30d = notes.filter(n => daysAgo(n) <= 30).length;
  const stale90d = notes.filter(n => daysAgo(n) > 90).length;

  // Score: weighted by recency
  const recentRatio = recent30d / notes.length;
  const staleRatio = stale90d / notes.length;
  const score = Math.max(0, Math.min(100, Math.round(recentRatio * 80 + (1 - staleRatio) * 20)));

  const details = [
    `近 7 天分析 ${recent7d} 篇 | 近 30 天 ${recent30d} 篇`,
    `超過 90 天未更新 ${stale90d} 篇`,
  ];

  return { label: '新鮮度', score, emoji: '🕐', details };
}

function assessConnectivity(knowledge: VaultKnowledge): HealthSection {
  const graph = buildEntityGraph(knowledge);
  const allNoteIds = new Set(Object.keys(knowledge.notes));
  const connectedNoteIds = new Set<string>();

  for (const noteIds of graph.notesByEntity.values()) {
    if (noteIds.length >= 2) {
      for (const id of noteIds) connectedNoteIds.add(id);
    }
  }

  const isolated = allNoteIds.size - connectedNoteIds.size;
  const isolatedRatio = allNoteIds.size > 0 ? isolated / allNoteIds.size : 0;
  const score = Math.max(0, Math.round((1 - isolatedRatio) * 100));

  const avgDegree = graph.adjacency.size > 0
    ? [...graph.adjacency.values()].reduce((s, v) => s + v.size, 0) / graph.adjacency.size
    : 0;

  const details = [
    `${connectedNoteIds.size} 篇有跨筆記連結 | ${isolated} 篇孤立`,
    `實體平均連結度 ${avgDegree.toFixed(1)}`,
  ];

  return { label: '連結密度', score, emoji: '🔗', details };
}

function assessContradictions(knowledge: VaultKnowledge): HealthSection {
  const contradictions: Array<{ from: string; to: string; note: string }> = [];

  for (const note of Object.values(knowledge.notes)) {
    for (const rel of note.relations) {
      if (rel.type === 'contradicts') {
        contradictions.push({ from: rel.from, to: rel.to, note: note.title });
      }
    }
  }

  // Also detect entity insight divergence (same entity, opposite confidence)
  const entityInsightMap = new Map<string, Array<{ confidence: number; noteTitle: string }>>();
  for (const note of Object.values(knowledge.notes)) {
    for (const ins of note.insights) {
      for (const eName of ins.entities) {
        const key = eName.toLowerCase();
        if (!entityInsightMap.has(key)) entityInsightMap.set(key, []);
        entityInsightMap.get(key)!.push({ confidence: ins.confidence, noteTitle: note.title });
      }
    }
  }

  const divergent: string[] = [];
  for (const [entity, entries] of entityInsightMap) {
    if (entries.length < 2) continue;
    const max = Math.max(...entries.map(e => e.confidence));
    const min = Math.min(...entries.map(e => e.confidence));
    if (max - min > 0.5) divergent.push(entity);
  }

  // Score: high = no contradictions (inverted — contradictions are interesting, not bad)
  // But too many suggests confusion
  const total = contradictions.length + divergent.length;
  const score = total === 0 ? 100 : total <= 3 ? 85 : total <= 10 ? 65 : 40;

  const details: string[] = [];
  if (contradictions.length > 0)
    details.push(`${contradictions.length} 組矛盾關係：${contradictions.slice(0, 2).map(c => `${c.from} ↔ ${c.to}`).join('、')}`);
  if (divergent.length > 0)
    details.push(`${divergent.length} 個實體洞察分歧：${divergent.slice(0, 3).join('、')}`);
  if (total === 0)
    details.push('未偵測到矛盾或分歧');

  return { label: '一致性', score, emoji: '⚖️', details };
}

const WEIGHTS = { coverage: 0.25, quality: 0.30, freshness: 0.15, connectivity: 0.20, contradictions: 0.10 };

export function generateHealthReport(knowledge: VaultKnowledge): KnowledgeHealthReport {
  aggregateKnowledge(knowledge);
  const notes = Object.values(knowledge.notes);

  const sections = {
    coverage: assessCoverage(knowledge),
    quality: assessQuality(knowledge),
    freshness: assessFreshness(notes),
    connectivity: assessConnectivity(knowledge),
    contradictions: assessContradictions(knowledge),
  };

  const overallScore = Math.round(
    sections.coverage.score * WEIGHTS.coverage +
    sections.quality.score * WEIGHTS.quality +
    sections.freshness.score * WEIGHTS.freshness +
    sections.connectivity.score * WEIGHTS.connectivity +
    sections.contradictions.score * WEIGHTS.contradictions,
  );

  const recommendations = buildRecommendations(sections, knowledge);

  return {
    generatedAt: new Date().toISOString(),
    totalNotes: notes.length,
    overallScore,
    sections,
    recommendations,
  };
}

function buildRecommendations(
  sections: KnowledgeHealthReport['sections'],
  knowledge: VaultKnowledge,
): string[] {
  const recs: string[] = [];

  if (sections.quality.score < 60) {
    const low = Object.values(knowledge.notes).filter(n => n.qualityScore <= 2);
    recs.push(`品質偏低：${low.length} 篇低分筆記，建議用 /quality 檢查並改善或歸檔`);
  }
  if (sections.coverage.score < 60) {
    const gaps = detectKnowledgeGaps(knowledge);
    const top = gaps.slice(0, 2).map(g => g.entity).join('、');
    recs.push(`知識缺口：${top} 等實體缺乏深入分析，建議蒐集相關文章`);
  }
  if (sections.connectivity.score < 60) {
    recs.push('連結不足：多數筆記缺乏交叉引用，建議用 /suggest 生成筆記連結');
  }
  if (sections.freshness.score < 50) {
    recs.push('新鮮度不足：大量筆記超過 90 天未更新分析，建議用 /reprocess --all 重新分析');
  }
  if (sections.contradictions.score < 60) {
    recs.push('一致性警告：偵測到多組矛盾，建議人工審查釐清');
  }

  if (recs.length === 0) recs.push('知識庫狀態良好，持續累積！');
  return recs.slice(0, 5);
}

/* ── Telegram formatter ───────────────────────────────────── */

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function gradeEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  return '🔴';
}

export function formatHealthReportTelegram(report: KnowledgeHealthReport): string {
  const L: string[] = [
    `🏥 知識健康報告`,
    '',
    `${gradeEmoji(report.overallScore)} 整體健康分：${report.overallScore}/100`,
    `📚 共 ${report.totalNotes} 篇筆記`,
    '',
  ];

  for (const section of Object.values(report.sections)) {
    L.push(`${section.emoji} ${section.label}：${scoreBar(section.score)} ${section.score}分`);
    for (const d of section.details) L.push(`  ${d}`);
    L.push('');
  }

  L.push('💡 建議行動：');
  for (const rec of report.recommendations) L.push(`• ${rec}`);

  return L.join('\n');
}

/* ── Vault note saver ─────────────────────────────────────── */

export async function saveHealthReportNote(vaultPath: string, report: KnowledgeHealthReport): Promise<string> {
  const outPath = join(vaultPath, 'KnowPipe', '知識健康報告.md');
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const L: string[] = [
    '---', `title: 知識健康報告`, `date: ${now}`, 'tags: [knowledge, health, auto-generated]', '---',
    '', '# 知識健康報告', '',
    `> 自動產生於 ${now}，基於 ${report.totalNotes} 篇筆記。`, '',
    `## 整體健康分：${report.overallScore}/100 ${gradeEmoji(report.overallScore)}`, '',
  ];
  for (const section of Object.values(report.sections)) {
    L.push(`### ${section.emoji} ${section.label}（${section.score}/100）`, '');
    for (const d of section.details) L.push(`- ${d}`);
    L.push('');
  }
  L.push('## 建議行動', '');
  for (const rec of report.recommendations) L.push(`- ${rec}`);
  L.push('', '---', `*自動產生 by KnowPipe — ${new Date().toISOString().slice(0, 19)}*`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, L.join('\n'), 'utf-8');
  return outPath;
}
