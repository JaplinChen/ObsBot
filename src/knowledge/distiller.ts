/**
 * Knowledge distillation — extract core principles per category
 * and flag low-value notes as archive candidates.
 * Zero LLM cost — aggregates existing vault-knowledge.json insights.
 */
import type { VaultKnowledge, NoteAnalysis, KnowledgeInsight } from './types.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';

/* ── Types ────────────────────────────────────────────────── */

export interface ArchiveCandidate {
  noteId: string;
  title: string;
  category: string;
  qualityScore: number;
  date: string;
  reason: string;
}

export interface CorePrinciple {
  content: string;
  confidence: number;
  sourceNotes: string[];
  relatedEntities: string[];
}

export interface CategoryDistillation {
  category: string;
  noteCount: number;
  archiveCandidates: ArchiveCandidate[];
  principles: CorePrinciple[];
  topEntities: Array<{ name: string; type: string; mentions: number }>;
}

export interface DistillationReport {
  generatedAt: string;
  totalNotes: number;
  totalArchiveCandidates: number;
  totalPrinciples: number;
  categories: CategoryDistillation[];
}

/* ── Helpers ──────────────────────────────────────────────── */

function parseDate(rawContent: string, filePath: string): string {
  const m = rawContent.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  if (m) return m[1];
  const fm = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  return fm?.[1] ?? '';
}

/* ── Archive candidate detection ─────────────────────────── */

function findArchiveCandidates(
  notes: Array<{ noteId: string; rawContent: string; filePath: string }>,
  knowledge: VaultKnowledge,
): ArchiveCandidate[] {
  const candidates: ArchiveCandidate[] = [];

  for (const note of notes) {
    const a = knowledge.notes[note.noteId];
    if (!a) continue;

    const reasons: string[] = [];
    if (a.qualityScore <= 1) reasons.push('純新聞/公告');
    else if (a.qualityScore <= 2 && a.insights.length === 0) reasons.push('低品質且無洞察');
    else if (a.qualityScore <= 2 && a.insights.every(i => i.confidence < 0.5)) reasons.push('低品質且洞察信心不足');

    if (reasons.length > 0) {
      candidates.push({
        noteId: note.noteId,
        title: a.title,
        category: a.category,
        qualityScore: a.qualityScore,
        date: parseDate(note.rawContent, note.filePath),
        reason: reasons.join('、'),
      });
    }
  }

  return candidates.sort((a, b) => a.qualityScore - b.qualityScore);
}

/* ── Core principle extraction ────────────────────────────── */

function distillCategory(category: string, analyses: NoteAnalysis[]): CategoryDistillation {
  const allInsights = analyses.flatMap(n => n.insights).filter(i => i.confidence >= 0.5);
  allInsights.sort((a, b) => b.confidence - a.confidence);

  const principles: CorePrinciple[] = [];
  const used = new Set<string>();

  for (const ins of allInsights) {
    if (used.has(ins.id) || principles.length >= 5) break;

    // Find related insights (share ≥1 entity)
    const sources = new Set([ins.sourceTitle]);
    for (const other of allInsights) {
      if (other.id === ins.id || used.has(other.id)) continue;
      if (ins.entities.some(e => other.entities.includes(e))) {
        sources.add(other.sourceTitle);
        used.add(other.id);
      }
    }
    used.add(ins.id);

    principles.push({
      content: ins.content,
      confidence: ins.confidence,
      sourceNotes: [...sources].slice(0, 3),
      relatedEntities: ins.entities,
    });
  }

  // Top entities
  const eMap = new Map<string, { name: string; type: string; count: number }>();
  for (const n of analyses) {
    for (const e of n.entities) {
      const key = e.name.toLowerCase();
      const ex = eMap.get(key);
      if (ex) ex.count++; else eMap.set(key, { name: e.name, type: e.type, count: 1 });
    }
  }
  const topEntities = [...eMap.values()].sort((a, b) => b.count - a.count).slice(0, 5)
    .map(e => ({ name: e.name, type: e.type, mentions: e.count }));

  return { category, noteCount: analyses.length, archiveCandidates: [], principles, topEntities };
}

/* ── Main distillation ────────────────────────────────────── */

export function distillVault(
  notes: Array<{ noteId: string; rawContent: string; filePath: string }>,
  knowledge: VaultKnowledge,
): DistillationReport {
  // Group analyses by category
  const byCategory = new Map<string, NoteAnalysis[]>();
  for (const note of notes) {
    const a = knowledge.notes[note.noteId];
    if (!a) continue;
    if (!byCategory.has(a.category)) byCategory.set(a.category, []);
    byCategory.get(a.category)!.push(a);
  }

  // Archive candidates
  const allCandidates = findArchiveCandidates(notes, knowledge);
  const candidatesByCat = new Map<string, ArchiveCandidate[]>();
  for (const c of allCandidates) {
    if (!candidatesByCat.has(c.category)) candidatesByCat.set(c.category, []);
    candidatesByCat.get(c.category)!.push(c);
  }

  // Distill each category (≥3 notes)
  let totalPrinciples = 0;
  const categories: CategoryDistillation[] = [];
  for (const [cat, analyses] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (analyses.length < 3) continue;
    const d = distillCategory(cat, analyses);
    d.archiveCandidates = candidatesByCat.get(cat) ?? [];
    totalPrinciples += d.principles.length;
    categories.push(d);
  }

  return {
    generatedAt: new Date().toISOString(),
    totalNotes: notes.length,
    totalArchiveCandidates: allCandidates.length,
    totalPrinciples,
    categories,
  };
}

/* ── Console report formatter ─────────────────────────────── */

export function formatDistillReport(report: DistillationReport): string {
  const L: string[] = [
    '🧪 知識蒸餾報告',
    `基於 ${report.totalNotes} 篇筆記，${report.categories.length} 個分類`,
    `蒸餾出 ${report.totalPrinciples} 條核心原則 | 歸檔候選 ${report.totalArchiveCandidates} 篇`,
    '',
  ];

  for (const cat of report.categories) {
    L.push(`━━━ ${cat.category}（${cat.noteCount} 篇）━━━`);

    if (cat.principles.length > 0) {
      L.push('  核心原則：');
      for (const p of cat.principles) {
        L.push(`  ✦ ${p.content}`);
        L.push(`    信心 ${p.confidence} | 來源：${p.sourceNotes.slice(0, 2).map(t => t.slice(0, 30)).join('、')}`);
      }
    }

    if (cat.archiveCandidates.length > 0) {
      L.push(`  歸檔候選（${cat.archiveCandidates.length} 篇）：`);
      for (const c of cat.archiveCandidates.slice(0, 5)) {
        L.push(`  ⚠ [${c.qualityScore}分] ${c.title.slice(0, 40)} — ${c.reason}`);
      }
      if (cat.archiveCandidates.length > 5) L.push(`  ... 還有 ${cat.archiveCandidates.length - 5} 篇`);
    }
    L.push('');
  }

  return L.join('\n');
}

/**
 * Generate a baoyu-article-illustrator style illustration prompt for the distill report.
 * Picks the top 3 high-confidence principles and asks the LLM to produce
 * a structured AI image prompt (Type × Style format).
 * Returns null silently on failure — the report renders fine without it.
 */
export async function generateDistillVisualPrompt(report: DistillationReport): Promise<string | null> {
  // Collect top principles sorted by confidence
  const allPrinciples = report.categories
    .flatMap(c => c.principles.map(p => ({ ...p, category: c.category })))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);

  if (allPrinciples.length === 0) return null;

  const principleList = allPrinciples
    .map((p, i) => `${i + 1}. [${p.category}] ${p.content}`)
    .join('\n');

  const prompt = `你是 AI 視覺提示詞生成師。根據以下知識蒸餾核心原則，生成一段可直接用於 Midjourney / DALL-E / 通義萬相的英文圖像提示詞。

核心原則：
${principleList}

圖表類型選擇（擇一）：
- infographic：多資料點展示 → 適合 3 個以上原則
- framework：模型架構圖 → 適合有層次關係的原則
- comparison：對比圖 → 適合有對立關係的原則
- flowchart：流程圖 → 適合有順序關係的原則

設計風格：minimal-flat（簡潔扁平）

請直接輸出提示詞，格式如下（英文，不超過 120 words）：
TYPE: [選擇的圖表類型]
LAYOUT: [版面描述]
LABELS: [關鍵標籤與數據]
COLORS: [配色方案含 hex 色值]
STYLE: minimal-flat, clean, professional infographic
ASPECT: 16:9`;

  try {
    const result = await runLocalLlmPrompt(prompt, {
      task: 'keywords',
      timeoutMs: 30_000,
      maxTokens: 300,
    });
    return result?.trim() ?? null;
  } catch {
    return null;
  }
}
