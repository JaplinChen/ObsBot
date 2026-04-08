/**
 * Persistent storage for radar configuration.
 * Pattern: mirrors subscription-store.ts
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../core/logger.js';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import { scanVaultNotes, type NoteStats } from '../learning/vault-learner.js';
import { computeFormattingPatterns } from '../learning/vault-learner.js';
import type { RadarConfig, RadarQuery, RadarQueryType } from './radar-types.js';
import { createEmptyConfig } from './radar-types.js';

const STORE_PATH = join(process.cwd(), 'data', 'radar-config.json');

/** Too-generic keywords that produce noisy results */
const SKIP_KEYWORDS = new Set([
  'ai', '工具', '教學', '分享', '推薦', '介紹', '使用', '功能', '方法', '技巧',
  'archive', 'source', 'image', 'http', 'https', 'com',
]);

// ── Platform inference ────────────────────────────────────────────────────────

/** Vault category prefix → recommended platform sources */
const CATEGORY_PLATFORM_MAP: Array<{ prefix: string; types: RadarQueryType[] }> = [
  { prefix: 'AI/',      types: ['hn'] },
  { prefix: '程式設計', types: ['github', 'devto'] },
  { prefix: '科技',     types: ['hn'] },
  { prefix: 'macOS 生態', types: ['hn'] },
  { prefix: '生產力',   types: ['devto'] },
];

/** Min notes in a category before we auto-add its platform sources */
const PLATFORM_MIN_NOTES = 3;

/** Known programming languages for GitHub Trending detection */
const KNOWN_LANGS = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go',
  'java', 'swift', 'kotlin', 'ruby', 'cpp',
]);

/** Dev.to tag aliases for detected language keywords */
const LANG_TO_DEVTO: Record<string, string> = {
  typescript: 'typescript', javascript: 'javascript',
  python: 'python', rust: 'rust', go: 'go',
  java: 'java', swift: 'swift', kotlin: 'kotlin',
  ruby: 'ruby', node: 'node', react: 'react',
};

interface PlatformSuggestion { type: RadarQueryType; keywords: string[] }

/**
 * Analyse vault notes to suggest platform sources that match the user's
 * reading habits. Returns suggestions for types NOT already in existingQueries.
 */
function inferPlatformSources(
  notes: NoteStats[],
  existingQueries: RadarConfig['queries'],
): PlatformSuggestion[] {
  // Count notes per category prefix
  const catCount = new Map<string, number>();
  // Count language keyword occurrences across all notes
  const langCount = new Map<string, number>();

  for (const note of notes) {
    for (const { prefix } of CATEGORY_PLATFORM_MAP) {
      if (note.category.startsWith(prefix)) {
        catCount.set(prefix, (catCount.get(prefix) ?? 0) + 1);
      }
    }
    for (const kw of note.keywords) {
      const k = kw.toLowerCase();
      if (KNOWN_LANGS.has(k)) langCount.set(k, (langCount.get(k) ?? 0) + 1);
    }
  }

  // Detect top language for GitHub / Dev.to
  const topLangs = [...langCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
  const topLang = topLangs[0] ?? '';

  const existingTypes = new Set(existingQueries.map(q => q.type));
  const addedTypes = new Set<RadarQueryType>();
  const suggestions: PlatformSuggestion[] = [];

  for (const { prefix, types } of CATEGORY_PLATFORM_MAP) {
    if ((catCount.get(prefix) ?? 0) < PLATFORM_MIN_NOTES) continue;

    for (const type of types) {
      if (existingTypes.has(type) || addedTypes.has(type)) continue;

      if (type === 'hn') {
        suggestions.push({ type: 'hn', keywords: [] });
      } else if (type === 'github') {
        suggestions.push({ type: 'github', keywords: topLang ? [topLang] : [] });
      } else if (type === 'devto') {
        const tags = topLangs
          .map(l => LANG_TO_DEVTO[l])
          .filter(Boolean)
          .slice(0, 3) as string[];
        suggestions.push({ type: 'devto', keywords: tags.length > 0 ? tags : ['ai', 'typescript'] });
      }
      addedTypes.add(type);
    }
  }

  return suggestions;
}

export async function loadRadarConfig(): Promise<RadarConfig> {
  return safeReadJSON<RadarConfig>(STORE_PATH, createEmptyConfig());
}

export async function saveRadarConfig(config: RadarConfig): Promise<void> {
  await safeWriteJSON(STORE_PATH, config);
  logger.info('radar', '已儲存設定', { queries: config.queries.length });
}

export function addQuery(
  config: RadarConfig,
  keywords: string[],
  source: 'auto' | 'manual' = 'manual',
  type: RadarQueryType = 'search',
): RadarQuery {
  const query: RadarQuery = {
    id: randomUUID().slice(0, 8),
    type,
    keywords,
    source,
    addedAt: new Date().toISOString(),
  };
  config.queries.push(query);
  return query;
}

export function removeQuery(config: RadarConfig, id: string): boolean {
  const idx = config.queries.findIndex(q => q.id === id);
  if (idx < 0) return false;
  config.queries.splice(idx, 1);
  return true;
}

/** Auto-generate search queries from vault keyword patterns */
export async function autoGenerateQueries(
  vaultPath: string, config: RadarConfig,
): Promise<RadarQuery[]> {
  const notes = await scanVaultNotes(vaultPath);
  const patterns = computeFormattingPatterns(notes);
  const added: RadarQuery[] = [];

  // Remove old auto-generated queries
  config.queries = config.queries.filter(q => q.source !== 'auto');

  // 1. Auto-add platform sources inferred from vault category distribution
  const platformSuggestions = inferPlatformSources(notes, config.queries);
  for (const suggestion of platformSuggestions) {
    const query = addQuery(config, suggestion.keywords, 'auto', suggestion.type);
    added.push(query);
  }

  // 2. DDG search queries from vault keywords (quality-filtered)
  //    Rules: single-word only (no bigrams), 3–20 chars, not in SKIP_KEYWORDS
  const MAX_SEARCH_QUERIES = 8;
  for (const [, keywords] of Object.entries(patterns.topKeywordsByCategory)) {
    if (added.length >= MAX_SEARCH_QUERIES) break;

    const meaningful = keywords
      .filter(kw => {
        const k = kw.toLowerCase();
        if (SKIP_KEYWORDS.has(k)) return false;
        if (k.includes(' ')) return false;       // 排除 bigram（太長，DDG 找不到）
        if (k.length < 3 || k.length > 20) return false;
        return true;
      })
      .slice(0, 2); // 每個查詢最多 2 個關鍵字，避免太精確

    if (meaningful.length < 2) continue;

    const query = addQuery(config, meaningful, 'auto', 'search');
    added.push(query);
  }

  logger.info('radar', '自動生成查詢', {
    count: added.length,
    platforms: platformSuggestions.length,
    search: added.length - platformSuggestions.length,
  });
  return added;
}
