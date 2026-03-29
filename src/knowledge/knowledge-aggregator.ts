/**
 * Knowledge aggregation — merge per-note analyses into global statistics,
 * ranked entity lists, Telegram-friendly summaries, and Obsidian notes.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import type { VaultKnowledge, KnowledgeEntity, KnowledgeInsight, NoteAnalysis } from './types.js';

/** Recalculate all stats and rebuild globalEntities from per-note data */
export function aggregateKnowledge(knowledge: VaultKnowledge): void {
  const notes = Object.values(knowledge.notes);

  // Merge entities across notes (lowercase name as merge key)
  const entityMap = new Map<string, KnowledgeEntity>();
  let totalInsights = 0;
  let totalRelations = 0;
  let qualitySum = 0;

  for (const note of notes) {
    qualitySum += note.qualityScore;
    totalInsights += note.insights.length;
    totalRelations += note.relations.length;

    for (const entity of note.entities) {
      const key = entity.name.toLowerCase().trim();
      const existing = entityMap.get(key);
      if (existing) {
        existing.mentions++;
        if (!existing.noteIds.includes(note.noteId)) {
          existing.noteIds.push(note.noteId);
        }
        for (const alias of entity.aliases) {
          if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
        }
      } else {
        entityMap.set(key, {
          name: entity.name,
          type: entity.type,
          aliases: [...entity.aliases],
          mentions: 1,
          noteIds: [note.noteId],
        });
      }
    }
  }

  knowledge.globalEntities = Object.fromEntries(entityMap);
  knowledge.stats = {
    totalNotes: notes.length,
    analyzedNotes: notes.length,
    totalEntities: entityMap.size,
    totalInsights,
    totalRelations,
    avgQualityScore: notes.length > 0 ? Math.round((qualitySum / notes.length) * 10) / 10 : 0,
  };
}

/** Get top entities sorted by mention count */
export function getTopEntities(knowledge: VaultKnowledge, limit = 10): KnowledgeEntity[] {
  if (!knowledge.globalEntities) return [];
  return Object.values(knowledge.globalEntities)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit);
}

/** Get top insights sorted by confidence, across all notes */
export function getTopInsights(knowledge: VaultKnowledge, limit = 5): KnowledgeInsight[] {
  const all: KnowledgeInsight[] = [];
  for (const note of Object.values(knowledge.notes)) {
    all.push(...note.insights);
  }
  return all
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** Get insights filtered by topic (matches entity names or category) */
export function getInsightsByTopic(knowledge: VaultKnowledge, topic: string): KnowledgeInsight[] {
  const topicLower = topic.toLowerCase();
  const results: KnowledgeInsight[] = [];

  for (const note of Object.values(knowledge.notes)) {
    const categoryMatch = note.category.toLowerCase().includes(topicLower);
    const entityMatch = note.entities.some(e =>
      e.name.toLowerCase().includes(topicLower) ||
      e.aliases.some(a => a.toLowerCase().includes(topicLower)),
    );

    if (categoryMatch || entityMatch) {
      results.push(...note.insights);
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/** Format knowledge summary for Telegram message */
export function formatKnowledgeSummary(knowledge: VaultKnowledge): string {
  const { stats } = knowledge;
  const lines: string[] = [
    '📚 Vault 知識庫摘要',
    '',
    `已分析：${stats.analyzedNotes} 篇筆記`,
    `實體：${stats.totalEntities} 個 | 洞察：${stats.totalInsights} 條 | 關係：${stats.totalRelations} 條`,
    `平均品質：${stats.avgQualityScore}/5`,
  ];

  const topEntities = getTopEntities(knowledge, 10);
  if (topEntities.length > 0) {
    lines.push('', '🏷 Top 實體：');
    for (const e of topEntities) {
      const typeLabel = entityTypeLabel(e.type);
      lines.push(`  ${e.name} [${typeLabel}] — ${e.mentions} 篇提及`);
    }
  }

  const topInsights = getTopInsights(knowledge, 5);
  if (topInsights.length > 0) {
    lines.push('', '💡 Top 洞察：');
    for (const ins of topInsights) {
      lines.push(`  • ${ins.content}`);
      lines.push(`    ← ${ins.sourceTitle.slice(0, 40)}`);
    }
  }

  return lines.join('\n');
}

function entityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    tool: '工具', concept: '概念', person: '人物', framework: '框架',
    company: '公司', technology: '技術', platform: '平台', language: '語言',
  };
  return labels[type] ?? type;
}

const INSIGHT_TYPE_LABEL: Record<string, string> = {
  principle: '原則', framework: '框架', pattern: '模式', warning: '警示',
  best_practice: '最佳實踐', mental_model: '心智模型', tip: '技巧', anti_pattern: '反模式',
};
const REL_TYPE_LABEL: Record<string, string> = {
  uses: '使用', compares: '比較', builds_on: '建立在', contradicts: '矛盾',
  alternative_to: '替代', part_of: '屬於', created_by: '建立者', integrates: '整合',
};

/** Generate a readable knowledge summary note in the Obsidian vault */
export async function generateKnowledgeNote(vaultPath: string, knowledge: VaultKnowledge): Promise<string> {
  const outPath = join(vaultPath, 'ObsBot', '知識庫摘要.md');
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const { stats } = knowledge;

  // Quality & category distributions
  const qualityDist: Record<number, number> = {};
  const catCount: Record<string, number> = {};
  for (const note of Object.values(knowledge.notes)) {
    qualityDist[note.qualityScore] = (qualityDist[note.qualityScore] || 0) + 1;
    catCount[note.category] = (catCount[note.category] || 0) + 1;
  }

  const topEntities = getTopEntities(knowledge, 20);
  const topInsights = getTopInsights(knowledge, 15);
  const highQuality = Object.values(knowledge.notes)
    .filter(n => n.qualityScore >= 4)
    .sort((a, b) => b.qualityScore - a.qualityScore);

  // Group insights by type
  const insightsByType: Record<string, KnowledgeInsight[]> = {};
  for (const ins of topInsights) {
    if (!insightsByType[ins.type]) insightsByType[ins.type] = [];
    insightsByType[ins.type].push(ins);
  }

  const noteLink = (n: NoteAnalysis) => `[[${basename(n.filePath, '.md')}|${n.title.slice(0, 40)}]]`;
  const qualityLabels = ['', '純新聞', '基本資訊', '具體技巧', '深入分析', '原創洞察'];

  const L: string[] = [];
  L.push('---', `title: Vault 知識庫摘要`, `date: ${now}`, 'tags: [knowledge, auto-generated]', '---');
  L.push('', '# Vault 知識庫摘要', '');
  L.push(`> 自動產生於 ${now}，基於 ${stats.analyzedNotes} 篇筆記的深度分析。`);
  L.push('> 使用 `/vault analyze` 更新分析，`/knowledge` 在 Telegram 查看。', '');

  // Stats
  L.push('## 統計總覽', '');
  L.push('| 指標 | 數值 |', '|------|------|');
  L.push(`| 已分析筆記 | ${stats.analyzedNotes} 篇 |`);
  L.push(`| 萃取實體 | ${stats.totalEntities} 個 |`);
  L.push(`| 萃取洞察 | ${stats.totalInsights} 條 |`);
  L.push(`| 萃取關係 | ${stats.totalRelations} 條 |`);
  L.push(`| 平均品質 | ${stats.avgQualityScore}/5 |`, '');

  // Quality distribution
  L.push('### 品質分佈', '');
  for (const score of [5, 4, 3, 2, 1]) {
    const count = qualityDist[score] || 0;
    L.push(`- **${score}分**（${qualityLabels[score]}）：${'█'.repeat(count)} ${count} 篇`);
  }
  L.push('');

  // Category distribution
  L.push('### 分類分佈', '', '| 分類 | 篇數 |', '|------|------|');
  for (const [cat, count] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
    L.push(`| ${cat} | ${count} |`);
  }
  L.push('');

  // Top entities
  L.push('## 核心實體（Top 20）', '', '| 實體 | 類型 | 提及篇數 |', '|------|------|----------|');
  for (const e of topEntities) {
    const alias = e.aliases.length > 0 ? ` (${e.aliases.slice(0, 2).join(', ')})` : '';
    L.push(`| **${e.name}**${alias} | ${entityTypeLabel(e.type)} | ${e.mentions} |`);
  }
  L.push('');

  // Top insights grouped by type
  L.push('## 關鍵洞察（Top 15）', '');
  for (const [type, insights] of Object.entries(insightsByType)) {
    L.push(`### ${INSIGHT_TYPE_LABEL[type] ?? type}`, '');
    for (const ins of insights) {
      L.push(`> ${ins.content}`);
      L.push(`> — *${ins.sourceTitle.slice(0, 50)}*（信心 ${ins.confidence}）`, '');
    }
  }

  // High quality notes
  if (highQuality.length > 0) {
    L.push('## 高品質筆記（4-5 分）', '');
    L.push('| 品質 | 標題 | 分類 | 實體 | 洞察 |', '|:----:|------|------|:----:|:----:|');
    for (const n of highQuality) {
      L.push(`| ${n.qualityScore} | ${noteLink(n)} | ${n.category} | ${n.entities.length} | ${n.insights.length} |`);
    }
    L.push('');
  }

  // Relationships
  const allRelations = Object.values(knowledge.notes).flatMap(n => n.relations);
  const relByType: Record<string, typeof allRelations> = {};
  for (const r of allRelations) {
    if (!relByType[r.type]) relByType[r.type] = [];
    relByType[r.type].push(r);
  }
  L.push('## 實體關係網絡', '');
  for (const [type, rels] of Object.entries(relByType).sort((a, b) => b[1].length - a[1].length).slice(0, 5)) {
    L.push(`### ${REL_TYPE_LABEL[type] ?? type}（${rels.length} 條）`, '');
    for (const r of rels.slice(0, 8)) {
      L.push(`- **${r.from}** → **${r.to}**：${r.description}`);
    }
    L.push('');
  }

  L.push('---');
  L.push(`*自動產生 by ObsBot /vault analyze — ${new Date().toISOString().slice(0, 19)}*`);

  const content = L.join('\n');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, content, 'utf-8');
  return outPath;
}
