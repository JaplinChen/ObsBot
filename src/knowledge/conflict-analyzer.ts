/**
 * Vault 矛盾偵測 — 掃描 knowledge store 中的 contradicts/alternative_to 關係，
 * 以及同一實體下 warning vs best_practice 的對立洞察。
 */
import type { VaultKnowledge } from './types.js';

export interface ConflictEntry {
  entities: string;
  noteA: string;
  noteB: string;
  relation: string;
  description: string;
}

/** 從 knowledge store 找出矛盾點 */
export function findConflicts(knowledge: VaultKnowledge): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];
  const CONFLICT_TYPES = new Set(['contradicts', 'alternative_to']);

  // 1. 直接來自 relations 的矛盾
  for (const note of Object.values(knowledge.notes)) {
    for (const rel of note.relations) {
      if (!CONFLICT_TYPES.has(rel.type)) continue;
      conflicts.push({
        entities: `${rel.from} vs ${rel.to}`,
        noteA: note.title,
        noteB: rel.to,
        relation: rel.type === 'contradicts' ? '直接矛盾' : '替代方案',
        description: rel.description,
      });
    }
  }

  // 2. 同一實體的對立洞察（warning vs best_practice / anti_pattern vs tip）
  const OPPOSING: Array<[string, string]> = [
    ['warning', 'best_practice'],
    ['anti_pattern', 'tip'],
    ['anti_pattern', 'best_practice'],
  ];

  type InsightRef = { type: string; content: string; source: string };
  const entityInsights = new Map<string, InsightRef[]>();

  for (const note of Object.values(knowledge.notes)) {
    for (const ins of note.insights) {
      for (const entity of ins.entities) {
        const key = entity.toLowerCase();
        if (!entityInsights.has(key)) entityInsights.set(key, []);
        entityInsights.get(key)!.push({ type: ins.type, content: ins.content, source: note.title });
      }
    }
  }

  for (const [entity, insightList] of entityInsights.entries()) {
    for (const [typeA, typeB] of OPPOSING) {
      const aList = insightList.filter(i => i.type === typeA);
      const bList = insightList.filter(i => i.type === typeB);
      if (aList.length === 0 || bList.length === 0) continue;

      const a = aList[0]!;
      const b = bList[0]!;
      if (a.source === b.source) continue;

      conflicts.push({
        entities: entity,
        noteA: a.source,
        noteB: b.source,
        relation: '觀點對立',
        description: `「${a.content.slice(0, 40)}」vs「${b.content.slice(0, 40)}」`,
      });
    }
  }

  return conflicts.slice(0, 20);
}

export function formatConflictsReport(conflicts: ConflictEntry[]): string {
  if (conflicts.length === 0) return '✅ 未發現明顯矛盾觀點，Vault 知識庫一致性良好。';

  const lines = [
    `⚡ Vault 矛盾偵測報告`,
    `發現 ${conflicts.length} 個知識衝突點`,
    '',
  ];

  for (const [i, c] of conflicts.entries()) {
    lines.push(
      `${i + 1}. 【${c.relation}】${c.entities}`,
      `   📄 ${c.noteA.slice(0, 40)}`,
      `   📄 ${c.noteB.slice(0, 40)}`,
      `   💡 ${c.description.slice(0, 65)}`,
      '',
    );
  }

  lines.push('提示：矛盾不代表錯誤——可能反映脈絡差異或時代更新，值得深入比對。');
  return lines.join('\n');
}
