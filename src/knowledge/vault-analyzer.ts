/**
 * In-bot vault knowledge analyzer — runs directly from Telegram,
 * no Claude Code needed. Extracts entities from frontmatter keywords,
 * builds global entity map, updates vault-knowledge.json.
 */
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { loadKnowledge, saveKnowledge, computeContentHash } from './knowledge-store.js';
import type { VaultKnowledge, KnowledgeEntity, EntityType } from './types.js';
import { logger } from '../core/logger.js';

interface AnalyzeResult {
  processed: number;
  skipped: number;
  totalEntities: number;
  topEntities: Array<{ name: string; mentions: number }>;
}

/** Parse frontmatter from raw markdown */
function parseFM(raw: string): Record<string, string> {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fields: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    fields[line.slice(0, ci).trim()] = line.slice(ci + 1).trim().replace(/^"|"$/g, '');
  }
  return fields;
}

/** Parse array field like [a, b, c] */
function parseArray(val: string): string[] {
  const m = val.match(/\[(.+)\]/);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/**
 * Run incremental vault analysis.
 * Extracts entities from frontmatter keywords + category.
 * Updates vault-knowledge.json in place.
 */
export async function runVaultAnalysis(vaultPath: string): Promise<AnalyzeResult> {
  const rootDir = join(vaultPath, 'ObsBot');
  const files = await getAllMdFiles(rootDir);
  const knowledge = await loadKnowledge();

  let processed = 0;
  let skipped = 0;

  // Clear global entities to rebuild
  const entityMap: Record<string, KnowledgeEntity> = {};

  for (const fullPath of files) {
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const hash = computeContentHash(raw);
      const noteId = basename(fullPath, '.md');
      const fm = parseFM(raw);
      const title = fm.title || noteId;
      const category = fm.category || '其他';
      const keywords = parseArray(fm.keywords || '');
      const summary = (fm.summary || '').slice(0, 200);

      if (!title || title.length < 3) { skipped++; continue; }

      // Check if already analyzed with same hash
      const existing = knowledge.notes[noteId];
      if (existing?.contentHash === hash) {
        // Still rebuild entity map from existing data
        for (const e of existing.entities) {
          addEntity(entityMap, e.name, e.type, noteId);
        }
        for (const part of category.split('/')) {
          if (part.trim().length >= 2) addEntity(entityMap, part.trim(), 'concept', noteId);
        }
        skipped++;
        continue;
      }

      // Extract entities from keywords
      const entities: KnowledgeEntity[] = [];
      for (const kw of keywords) {
        if (kw.length < 2 || kw.length > 30) continue;
        entities.push({ name: kw, type: 'concept', aliases: [], mentions: 1, noteIds: [noteId] });
        addEntity(entityMap, kw, 'concept', noteId);
      }

      // Extract category as entities
      for (const part of category.split('/')) {
        const trimmed = part.trim();
        if (trimmed.length >= 2) addEntity(entityMap, trimmed, 'concept', noteId);
      }

      knowledge.notes[noteId] = {
        noteId, filePath: fullPath, title, category, contentHash: hash,
        qualityScore: summary.length > 20 ? 3 : 1,
        entities, insights: [], relations: [],
        analyzedAt: new Date().toISOString(),
      };
      processed++;
    } catch { skipped++; }
  }

  // Update knowledge with rebuilt entity map and stats
  knowledge.globalEntities = entityMap;
  knowledge.stats = {
    ...knowledge.stats,
    analyzedNotes: Object.keys(knowledge.notes).length,
    totalEntities: Object.keys(entityMap).length,
    lastAnalyzedAt: new Date().toISOString(),
  };

  await saveKnowledge(knowledge);

  const topEntities = Object.values(entityMap)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 15)
    .map(e => ({ name: e.name, mentions: e.mentions }));

  logger.info('analyzer', '知識分析完成', { processed, skipped, entities: Object.keys(entityMap).length });

  return { processed, skipped, totalEntities: Object.keys(entityMap).length, topEntities };
}

function addEntity(
  map: Record<string, KnowledgeEntity>, name: string, type: EntityType, noteId: string,
): void {
  const key = name.toLowerCase();
  if (!map[key]) {
    map[key] = { name, type, mentions: 0, aliases: [], noteIds: [] };
  }
  map[key].mentions++;
  const ids = (map[key] as KnowledgeEntity & { noteIds: string[] }).noteIds;
  if (!ids.includes(noteId)) ids.push(noteId);
}
