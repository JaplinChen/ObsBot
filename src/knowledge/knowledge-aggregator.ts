/**
 * Knowledge aggregation — merge per-note analyses into global statistics,
 * ranked entity lists, and Telegram-friendly summaries.
 */
import type { VaultKnowledge, KnowledgeEntity, KnowledgeInsight } from './types.js';

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
