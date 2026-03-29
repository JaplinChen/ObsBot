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

// ─── Entity Type Classifier ────────────────────────────────────────────────

const KNOWN_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go', 'swift', 'kotlin',
  'java', 'ruby', 'php', 'dart', 'c++', 'c#', 'scala', 'elixir', 'haskell',
  'bash', 'shell', 'sql', 'r',
]);

const KNOWN_PLATFORMS = new Set([
  'github', 'twitter', 'x', 'youtube', 'reddit', 'hn', 'hacker news',
  'discord', 'telegram', 'notion', 'obsidian', 'cloudflare', 'vercel', 'hacker news',
  'netlify', 'hugging face', 'huggingface', 'producthunt', 'dev.to',
  'npm', 'pypi', 'docker hub', 'dockerhub', 'google', 'apple',
  'linkedin', 'medium', 'substack',
]);

const KNOWN_TOOLS = new Set([
  'claude', 'gpt', 'gemini', 'llama', 'mistral', 'ollama', 'omlx',
  'cursor', 'copilot', 'codeium', 'tabnine',
  'ffmpeg', 'yt-dlp', 'homebrew', 'brew',
  'vscode', 'vs code', 'neovim', 'vim', 'emacs',
  'docker', 'podman', 'kubernetes', 'k8s',
  'nginx', 'caddy', 'traefik',
  'telegraf', 'obsidian', 'notion', 'logseq',
  'tailscale', 'zerotier',
  'openai', 'anthropic',
  // Multi-word known tools
  'claude code', 'claude api', 'github copilot', 'visual studio',
  'vs code', 'xcode', 'android studio',
]);

const TOOL_SUFFIXES = [
  'sdk', 'cli', 'api', 'bot', 'app', 'tool', 'agent',
  '.js', '.py', '.ts', '-cli', '-sdk',
];

const FRAMEWORK_KEYWORDS = [
  'framework', 'library', 'runtime', 'engine', 'stack',
];

const TECH_ACRONYM_RE = /^[A-Z]{2,6}(\+\+)?$/;

const CAMEL_CASE_RE = /^[A-Z][a-z]+[A-Z]/;
const KEBAB_CODE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const VERSION_RE = /\d+\.\d+/;
// Two PascalCase words: "Claude Code", "Visual Studio", "Type Whisper"
const TITLE_CASE_TOOL_RE = /^[A-Z][a-z]+ [A-Z][a-z]+$/;

/**
 * Classify an entity type using heuristic rules.
 * Checks known sets first, then structural patterns.
 */
function classifyEntityType(name: string, category: string): EntityType {
  const lower = name.toLowerCase().trim();

  // Category-based quick path
  const catLower = category.toLowerCase();
  if (catLower.includes('程式語言')) return 'language';

  // Known language check
  if (KNOWN_LANGUAGES.has(lower)) return 'language';

  // Known platform check
  if (KNOWN_PLATFORMS.has(lower)) return 'platform';

  // Known tool check
  if (KNOWN_TOOLS.has(lower)) return 'tool';

  // Tech acronyms (LLM, RAG, OCR, GPU, etc.) — keep as technology
  if (TECH_ACRONYM_RE.test(name)) return 'technology';

  // Framework indicators
  for (const kw of FRAMEWORK_KEYWORDS) {
    if (lower.endsWith(kw) || lower.includes(kw + ' ')) return 'framework';
  }

  // Tool suffix indicators
  for (const suf of TOOL_SUFFIXES) {
    if (lower.endsWith(suf)) return 'tool';
  }

  // Kebab-case (code-style names like "claude-code", "yt-dlp")
  if (KEBAB_CODE_RE.test(name) && name.length <= 30) return 'tool';

  // CamelCase proper nouns (e.g. TypeWhisper, GraphRAG, VibeEdit)
  if (CAMEL_CASE_RE.test(name) && name.length <= 30) return 'tool';

  // Two Title-Case words (e.g. "Claude Code", "Visual Studio")
  if (TITLE_CASE_TOOL_RE.test(name) && name.length <= 30) return 'tool';

  // Contains version number → likely a tool/tech
  if (VERSION_RE.test(name)) return 'tool';

  // Mostly English + short → likely a tool/technology
  const isEnglishHeavy = (name.match(/[a-zA-Z]/g) ?? []).length / name.length > 0.7;
  if (isEnglishHeavy && name.length <= 20 && !name.includes(' ')) return 'tool';

  return 'concept';
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
        // Rebuild entity map — re-classify with updated classifier
        for (const e of existing.entities) {
          const reclassified = classifyEntityType(e.name, category);
          addEntity(entityMap, e.name, reclassified, noteId);
        }
        for (const part of category.split('/')) {
          if (part.trim().length >= 2) addEntity(entityMap, part.trim(), 'concept', noteId);
        }
        // Re-classify entities in the stored note too
        knowledge.notes[noteId].entities = existing.entities.map(e => ({
          ...e, type: classifyEntityType(e.name, category),
        }));
        skipped++;
        continue;
      }

      // Extract entities from keywords with smart type classification
      const entities: KnowledgeEntity[] = [];
      for (const kw of keywords) {
        if (kw.length < 2 || kw.length > 30) continue;
        const type = classifyEntityType(kw, category);
        entities.push({ name: kw, type, aliases: [], mentions: 1, noteIds: [noteId] });
        addEntity(entityMap, kw, type, noteId);
      }

      // Extract category as concept entities
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
