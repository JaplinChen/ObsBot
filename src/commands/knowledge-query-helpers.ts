/**
 * Pure helper functions for knowledge queries (recommend/brief/compare).
 */
import type { VaultKnowledge, NoteAnalysis, KnowledgeEntity } from '../knowledge/types.js';
import { getInsightsByTopic } from '../knowledge/knowledge-aggregator.js';

const TYPE_LABEL: Record<string, string> = {
  tool: '工具', concept: '概念', person: '人物', framework: '框架',
  company: '公司', technology: '技術', platform: '平台', language: '語言',
};

export function findEntity(knowledge: VaultKnowledge, name: string): KnowledgeEntity | null {
  if (!knowledge.globalEntities) return null;
  const key = name.toLowerCase().trim();
  if (knowledge.globalEntities[key]) return knowledge.globalEntities[key];
  for (const e of Object.values(knowledge.globalEntities)) {
    if (e.aliases.some(a => a.toLowerCase().includes(key))) return e;
  }
  return null;
}

export function findNotesByTopic(knowledge: VaultKnowledge, topic: string): NoteAnalysis[] {
  const topicLower = topic.toLowerCase();
  return Object.values(knowledge.notes)
    .filter(note => {
      const catMatch = note.category.toLowerCase().includes(topicLower);
      const entityMatch = note.entities.some(e =>
        e.name.toLowerCase().includes(topicLower) ||
        e.aliases.some(a => a.toLowerCase().includes(topicLower)),
      );
      const titleMatch = note.title.toLowerCase().includes(topicLower);
      return catMatch || entityMatch || titleMatch;
    })
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

export function formatEntitySection(
  knowledge: VaultKnowledge, name: string, entity: KnowledgeEntity | null,
): string[] {
  const lines: string[] = [];
  if (entity) {
    lines.push(`📌 ${entity.name} [${TYPE_LABEL[entity.type] ?? entity.type}] — ${entity.mentions} 篇提及`);
    const alts = findAlternatives(knowledge, entity.name);
    if (alts.length > 0) lines.push(`  替代：${alts.join(', ')}`);
    const insights = getInsightsByTopic(knowledge, entity.name).slice(0, 3);
    if (insights.length > 0) {
      for (const ins of insights) lines.push(`  • ${ins.content.slice(0, 60)}`);
    }
  } else {
    lines.push(`📌 ${name} — 知識庫中未找到此實體`);
  }
  return lines;
}

export function findAlternatives(knowledge: VaultKnowledge, entityName: string): string[] {
  const nameLower = entityName.toLowerCase();
  const alts = new Set<string>();
  for (const note of Object.values(knowledge.notes)) {
    for (const r of note.relations) {
      if (r.type === 'alternative_to') {
        if (r.from.toLowerCase() === nameLower) alts.add(r.to);
        if (r.to.toLowerCase() === nameLower) alts.add(r.from);
      }
    }
  }
  return [...alts].slice(0, 5);
}

export function findDirectRelations(knowledge: VaultKnowledge, a: string, b: string) {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const results: Array<{ from: string; to: string; type: string; description: string }> = [];
  for (const note of Object.values(knowledge.notes)) {
    for (const r of note.relations) {
      const fromMatch = r.from.toLowerCase().includes(aLower) || r.from.toLowerCase().includes(bLower);
      const toMatch = r.to.toLowerCase().includes(aLower) || r.to.toLowerCase().includes(bLower);
      if (fromMatch && toMatch) results.push(r);
    }
  }
  return results;
}
