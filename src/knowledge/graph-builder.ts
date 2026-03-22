/**
 * 輕量級知識圖譜建構器
 * 從 Vault 筆記的 frontmatter 抽取實體與關係，存為 graph.json。
 * 實體類型：tool（工具）、person（人物）、concept（概念）
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';
import { logger } from '../core/logger.js';

// ── Types ──

export interface GraphEntity {
  id: string;
  name: string;
  type: 'tool' | 'person' | 'concept' | 'platform';
  /** 出現次數 */
  count: number;
  /** 相關筆記路徑 */
  notes: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  /** 共同出現次數 */
  weight: number;
}

export interface KnowledgeGraph {
  entities: Record<string, GraphEntity>;
  edges: GraphEdge[];
  metadata: {
    noteCount: number;
    entityCount: number;
    edgeCount: number;
    buildDate: string;
  };
}

// ── Entity extraction (rule-based, zero LLM cost) ──

/** 已知工具名（從 classifier-categories 中提取的高頻工具） */
const KNOWN_TOOLS = new Set([
  'claude', 'claude code', 'openclaw', 'chatgpt', 'openai', 'gemini',
  'obsidian', 'cursor', 'perplexity', 'deepseek', 'midjourney',
  'stable diffusion', 'comfyui', 'hailuo', 'sora', 'minimax',
  'playwright', 'camoufox', 'telegraf', 'graphrag', 'neo4j',
  'docker', 'github', 'notion', 'figma', 'vscode', 'ollama',
  'omlx', 'gstack', 'openwork', 'worklenz', 'syncthing',
  'defuddle', 'readability', 'turndown', 'yt-dlp', 'ffmpeg',
  'opencli', 'codex', 'pi agent', 'aider', 'mirofish',
]);

/** 從標題和關鍵詞中抽取實體 */
function extractEntities(
  title: string,
  keywords: string[],
  category: string,
  author: string,
): Array<{ name: string; type: GraphEntity['type'] }> {
  const entities: Array<{ name: string; type: GraphEntity['type'] }> = [];
  const titleL = title.toLowerCase();

  // 工具實體
  for (const tool of KNOWN_TOOLS) {
    if (titleL.includes(tool) || keywords.some(k => k.toLowerCase() === tool)) {
      entities.push({ name: tool, type: 'tool' });
    }
  }

  // 關鍵詞中的概念（非工具名的關鍵詞視為概念）
  for (const kw of keywords) {
    const kwL = kw.toLowerCase();
    if (!KNOWN_TOOLS.has(kwL) && kwL.length >= 2) {
      entities.push({ name: kwL, type: 'concept' });
    }
  }

  // 作者視為 person
  if (author && author !== 'unknown' && author.length > 1) {
    entities.push({ name: author.replace(/^@/, ''), type: 'person' });
  }

  // 分類的第一層視為 concept
  const topCategory = category.split('/')[0];
  if (topCategory && topCategory !== '其他') {
    entities.push({ name: topCategory, type: 'concept' });
  }

  return entities;
}

function entityId(name: string, type: string): string {
  return `${type}:${name.toLowerCase().replace(/\s+/g, '-')}`;
}

// ── Graph building ──

export async function buildKnowledgeGraph(vaultPath: string): Promise<KnowledgeGraph> {
  const rootDir = join(vaultPath, 'GetThreads');
  const files = await getAllMdFiles(rootDir);
  const graph: KnowledgeGraph = {
    entities: {},
    edges: [],
    metadata: { noteCount: 0, entityCount: 0, edgeCount: 0, buildDate: new Date().toISOString() },
  };

  const edgeMap = new Map<string, number>();

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(raw);
      const title = fm.get('title')?.replace(/^"|"$/g, '') ?? '';
      if (!title) continue;

      const keywords = parseArrayField(fm.get('keywords') ?? '');
      const category = fm.get('category') ?? '';
      const author = fm.get('author')?.replace(/^"|"$/g, '') ?? '';

      const entities = extractEntities(title, keywords, category, author);
      graph.metadata.noteCount++;

      // 建立實體
      const noteEntityIds: string[] = [];
      for (const e of entities) {
        const id = entityId(e.name, e.type);
        if (!graph.entities[id]) {
          graph.entities[id] = { id, name: e.name, type: e.type, count: 0, notes: [] };
        }
        graph.entities[id].count++;
        if (graph.entities[id].notes.length < 5) {
          graph.entities[id].notes.push(filePath);
        }
        noteEntityIds.push(id);
      }

      // 建立共現邊（同一篇筆記中出現的實體互相連結）
      for (let i = 0; i < noteEntityIds.length; i++) {
        for (let j = i + 1; j < noteEntityIds.length; j++) {
          const [a, b] = [noteEntityIds[i], noteEntityIds[j]].sort();
          const key = `${a}||${b}`;
          edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
        }
      }
    } catch { /* skip */ }
  }

  // 轉換邊
  for (const [key, weight] of edgeMap) {
    if (weight < 2) continue; // 只保留出現 2 次以上的共現關係
    const [source, target] = key.split('||');
    graph.edges.push({ source, target, weight });
  }

  graph.edges.sort((a, b) => b.weight - a.weight);
  graph.metadata.entityCount = Object.keys(graph.entities).length;
  graph.metadata.edgeCount = graph.edges.length;

  return graph;
}

/** 儲存知識圖譜到 Vault */
export async function saveGraph(graph: KnowledgeGraph, vaultPath: string): Promise<string> {
  const outputPath = join(vaultPath, 'GetThreads', 'graph.json');
  await writeFile(outputPath, JSON.stringify(graph, null, 2), 'utf-8');
  logger.info('graph', '知識圖譜已建構', {
    notes: graph.metadata.noteCount,
    entities: graph.metadata.entityCount,
    edges: graph.metadata.edgeCount,
  });
  return outputPath;
}

/** 在圖譜中搜尋實體的關聯 */
export function findRelated(graph: KnowledgeGraph, query: string, limit = 10): GraphEntity[] {
  const queryL = query.toLowerCase();

  // 找到匹配的實體
  const matched = Object.values(graph.entities).filter(
    e => e.name.includes(queryL) || e.id.includes(queryL),
  );

  if (matched.length === 0) return [];

  // 找到所有關聯實體
  const matchedIds = new Set(matched.map(e => e.id));
  const relatedScores = new Map<string, number>();

  for (const edge of graph.edges) {
    if (matchedIds.has(edge.source) && !matchedIds.has(edge.target)) {
      relatedScores.set(edge.target, (relatedScores.get(edge.target) ?? 0) + edge.weight);
    }
    if (matchedIds.has(edge.target) && !matchedIds.has(edge.source)) {
      relatedScores.set(edge.source, (relatedScores.get(edge.source) ?? 0) + edge.weight);
    }
  }

  return [...relatedScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => graph.entities[id])
    .filter(Boolean);
}
