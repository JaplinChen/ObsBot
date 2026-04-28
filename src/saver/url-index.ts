import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { logger } from '../core/logger.js';
import { canonicalizeUrl } from '../utils/url-canonicalizer.js';

const INDEX_FILE = join('data', 'url-index.json');

// In-memory URL index: normalizedUrl → filePath (built on first use)
let urlIndex: Map<string, string> | null = null;

// URLs currently being processed (race condition protection)
export const processingUrls = new Set<string>();

/** Try to load persisted URL index from disk. Returns null if stale or missing. */
async function loadPersistedIndex(vaultPath: string): Promise<Map<string, string> | null> {
  try {
    const raw = await readFile(INDEX_FILE, 'utf-8');
    const data = JSON.parse(raw) as { version: number; count: number; entries: Record<string, string> };
    if (data.version !== 1) return null;
    const rootDir = join(vaultPath, 'KnowPipe');
    const files = await getAllMdFiles(rootDir);
    if (Math.abs(files.length - data.count) > Math.max(data.count * 0.1, 5)) {
      logger.info('saver', 'URL 索引過期，重新掃描', { cached: data.count, actual: files.length });
      return null;
    }
    return new Map(Object.entries(data.entries));
  } catch { return null; }
}

/** Persist URL index to disk for fast cold start. */
export async function persistIndex(index: Map<string, string>): Promise<void> {
  try {
    const { safeWriteJSON } = await import('../core/safe-write.js');
    const data = { version: 1, count: index.size, entries: Object.fromEntries(index) };
    await safeWriteJSON(INDEX_FILE, data);
  } catch { /* best-effort */ }
}

/** Build URL index by scanning all .md files (runs once, then cached in memory). */
async function buildUrlIndex(vaultPath: string): Promise<Map<string, string>> {
  const cached = await loadPersistedIndex(vaultPath);
  if (cached) {
    logger.info('saver', 'URL 索引從快取載入', { size: cached.size });
    return cached;
  }

  const index = new Map<string, string>();
  const rootDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(rootDir);

  for (const fullPath of files) {
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const first25 = raw.split('\n').slice(0, 25).join('\n');
      const match = first25.match(/^url:\s*["']?(.*?)["']?\s*$/m);
      if (match) index.set(canonicalizeUrl(match[1].trim()), fullPath);
    } catch { /* skip unreadable files */ }
  }

  logger.info('saver', 'URL 索引重新掃描完成', { size: index.size });
  await persistIndex(index);
  return index;
}

/** Check for duplicate URL using in-memory cache (O(1) after first scan). */
export async function isDuplicateUrl(url: string, vaultPath: string): Promise<string | null> {
  if (!urlIndex) urlIndex = await buildUrlIndex(vaultPath);
  return urlIndex.get(canonicalizeUrl(url)) ?? null;
}

/** Update in-memory index and persist asynchronously. */
export function updateIndex(normUrl: string, mdPath: string): void {
  if (!urlIndex) return;
  urlIndex.set(normUrl, mdPath);
  persistIndex(urlIndex).catch(() => {});
}
