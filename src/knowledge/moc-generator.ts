/**
 * Theme-based MOC (Map of Content) generator.
 * Detects themes via entity graph connected-component analysis,
 * then generates narrative MOC notes per theme using LLM (flash tier).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import type { VaultKnowledge, NoteAnalysis, KnowledgeEntity } from './types.js';
import { buildEntityGraph, type EntityGraph } from './knowledge-graph.js';
import { aggregateKnowledge } from './knowledge-aggregator.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

/* ── Types ────────────────────────────────────────────────── */

export interface Theme {
  id: string;
  name: string;
  /** Central entity that defines this theme */
  centerEntity: string;
  /** All entities in the connected component */
  entities: string[];
  /** Notes that contain at least 2 entities from this theme */
  noteIds: string[];
  /** Entity degree (connectivity) */
  degree: number;
}

export interface ThemeMoc {
  theme: Theme;
  /** LLM-generated 2-3 sentence narrative */
  narrative: string;
  /** File path of saved MOC note */
  filePath: string;
}

/* ── Theme detection ──────────────────────────────────────── */

/**
 * Detect themes via connected components in the entity graph.
 * High-degree entities become theme centers.
 */
export function detectThemes(knowledge: VaultKnowledge, minNotes = 3): Theme[] {
  aggregateKnowledge(knowledge);
  const graph = buildEntityGraph(knowledge);

  // Find connected components via BFS
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const entity of graph.adjacency.keys()) {
    if (visited.has(entity)) continue;
    const component: string[] = [];
    const queue = [entity];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      const neighbors = graph.adjacency.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) queue.push(n);
        }
      }
    }
    if (component.length >= 2) components.push(component);
  }

  // Convert components to themes
  const themes: Theme[] = [];
  for (const comp of components) {
    // Center = highest degree entity in component
    let maxDegree = 0;
    let center = comp[0];
    for (const e of comp) {
      const deg = graph.adjacency.get(e)?.size ?? 0;
      if (deg > maxDegree) { maxDegree = deg; center = e; }
    }

    // Collect notes containing ≥2 entities from this component
    const compSet = new Set(comp);
    const noteScores = new Map<string, number>();
    for (const e of comp) {
      const noteIds = graph.notesByEntity.get(e) ?? [];
      for (const nid of noteIds) {
        noteScores.set(nid, (noteScores.get(nid) ?? 0) + 1);
      }
    }
    const noteIds = [...noteScores.entries()]
      .filter(([, count]) => count >= 2)
      .map(([nid]) => nid);

    if (noteIds.length < minNotes) continue;

    // Resolve display name from globalEntities
    const displayName = knowledge.globalEntities?.[center]?.name ?? center;

    themes.push({
      id: center.replace(/\s+/g, '-').toLowerCase(),
      name: displayName,
      centerEntity: center,
      entities: comp,
      noteIds,
      degree: maxDegree,
    });
  }

  return themes.sort((a, b) => b.noteIds.length - a.noteIds.length);
}

/* ── MOC generation ───────────────────────────────────────── */

function buildThemeNoteList(theme: Theme, knowledge: VaultKnowledge): NoteAnalysis[] {
  return theme.noteIds
    .map(id => knowledge.notes[id])
    .filter((n): n is NoteAnalysis => !!n)
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

async function generateNarrative(theme: Theme, notes: NoteAnalysis[]): Promise<string> {
  const titles = notes.slice(0, 8).map(n => n.title).join('、');
  const entities = theme.entities.slice(0, 10).join('、');

  const prompt = `你是知識庫策展人。以下主題「${theme.name}」包含 ${notes.length} 篇筆記。
核心實體：${entities}
代表筆記：${titles}

請用繁體中文寫 2-3 句話描述這個主題的核心脈絡和價值，不要列點，用敘事風格。`;

  const result = await runLocalLlmPrompt(prompt, { model: 'flash', maxTokens: 256 });
  return result?.trim() ?? `主題「${theme.name}」涵蓋 ${notes.length} 篇筆記，圍繞 ${entities} 等核心概念。`;
}

/**
 * Generate theme MOC notes and save to vault.
 * @param maxLlmCalls Maximum LLM calls for narratives (default 5)
 */
export async function generateThemeMocs(
  vaultPath: string,
  knowledge: VaultKnowledge,
  maxLlmCalls = 5,
): Promise<ThemeMoc[]> {
  const themes = detectThemes(knowledge);
  if (themes.length === 0) return [];

  const mocDir = join(vaultPath, 'KnowPipe', 'MOC');
  await mkdir(mocDir, { recursive: true });

  const results: ThemeMoc[] = [];
  let llmCalls = 0;

  for (const theme of themes.slice(0, 15)) {
    const notes = buildThemeNoteList(theme, knowledge);
    if (notes.length === 0) continue;

    // Generate narrative with LLM budget control
    let narrative: string;
    if (llmCalls < maxLlmCalls) {
      try {
        narrative = await generateNarrative(theme, notes);
        llmCalls++;
      } catch (err) {
        logger.warn('moc', `LLM 敘事生成失敗: ${theme.name}`, { error: (err as Error).message });
        narrative = `主題「${theme.name}」涵蓋 ${notes.length} 篇筆記。`;
      }
    } else {
      narrative = `主題「${theme.name}」涵蓋 ${notes.length} 篇筆記，核心實體包括 ${theme.entities.slice(0, 5).join('、')}。`;
    }

    const filePath = await saveThemeMoc(mocDir, theme, notes, narrative, knowledge);
    results.push({ theme, narrative, filePath });
  }

  // Generate MOC index
  if (results.length > 0) {
    await saveMocIndex(mocDir, results);
  }

  logger.info('moc', `生成 ${results.length} 個主題 MOC`, { llmCalls });
  return results;
}

/* ── File writers ──────────────────────────────────────────── */

async function saveThemeMoc(
  mocDir: string, theme: Theme, notes: NoteAnalysis[], narrative: string,
  knowledgeRef: VaultKnowledge,
): Promise<string> {
  const fileName = `MOC-${theme.name.replace(/[/\\:*?"<>|]/g, '-').slice(0, 50)}.md`;
  const filePath = join(mocDir, fileName);
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const noteLink = (n: NoteAnalysis) => `[[${basename(n.filePath, '.md')}|${n.title.slice(0, 45)}]]`;

  const L: string[] = [];
  L.push('---');
  L.push(`title: "MOC：${theme.name}"`);
  L.push(`date: ${now}`);
  L.push('tags: [moc, auto-generated]');
  L.push(`entities: [${theme.entities.slice(0, 10).map(e => `"${e}"`).join(', ')}]`);
  L.push('---');
  L.push('', `# ${theme.name}`, '');
  L.push(`> ${narrative}`, '');

  // Stats
  L.push(`**${notes.length} 篇筆記** | **${theme.entities.length} 個實體** | 連結度 ${theme.degree}`, '');

  // Notes grouped by quality
  const high = notes.filter(n => n.qualityScore >= 4);
  const mid = notes.filter(n => n.qualityScore === 3);
  const low = notes.filter(n => n.qualityScore <= 2);

  if (high.length > 0) {
    L.push('## 核心筆記（高品質）', '');
    for (const n of high) L.push(`- ⭐ ${noteLink(n)}（${n.category}）`);
    L.push('');
  }
  if (mid.length > 0) {
    L.push('## 參考筆記', '');
    for (const n of mid) L.push(`- ${noteLink(n)}（${n.category}）`);
    L.push('');
  }
  if (low.length > 0) {
    L.push('## 補充資料', '');
    for (const n of low.slice(0, 10)) L.push(`- ${noteLink(n)}`);
    if (low.length > 10) L.push(`- ...還有 ${low.length - 10} 篇`);
    L.push('');
  }

  // Related entities
  L.push('## 相關實體', '');
  for (const e of theme.entities.slice(0, 15)) {
    const ge = knowledgeRef?.globalEntities?.[e];
    if (ge) L.push(`- **${ge.name}**（${ge.mentions} 篇）`);
    else L.push(`- ${e}`);
  }
  L.push('');

  L.push('---');
  L.push(`*自動產生 by KnowPipe — ${new Date().toISOString().slice(0, 19)}*`);

  await writeFile(filePath, L.join('\n'), 'utf-8');
  return filePath;
}

async function saveMocIndex(mocDir: string, mocs: ThemeMoc[]): Promise<void> {
  const filePath = join(mocDir, 'MOC-索引.md');
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });

  const L: string[] = [];
  L.push('---', `title: MOC 主題索引`, `date: ${now}`, 'tags: [moc, index, auto-generated]', '---');
  L.push('', '# 主題地圖索引', '');
  L.push(`> ${mocs.length} 個主題，自動產生於 ${now}`, '');

  for (const moc of mocs) {
    const linkName = `MOC-${moc.theme.name.replace(/[/\\:*?"<>|]/g, '-').slice(0, 50)}`;
    L.push(`### [[${linkName}|${moc.theme.name}]]`);
    L.push(`${moc.narrative.slice(0, 100)}${moc.narrative.length > 100 ? '…' : ''}`);
    L.push(`📊 ${moc.theme.noteIds.length} 篇 | ${moc.theme.entities.length} 實體`);
    L.push('');
  }

  L.push('---');
  L.push(`*自動產生 by KnowPipe — ${new Date().toISOString().slice(0, 19)}*`);

  await writeFile(filePath, L.join('\n'), 'utf-8');
}
