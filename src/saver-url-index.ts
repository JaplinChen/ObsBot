import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalizeUrl } from './utils/url-canonicalizer.js';
import { getAllMdFiles } from './vault/frontmatter-utils.js';
import { logger } from './core/logger.js';
import { safeWriteJSON } from './core/safe-write.js';

const INDEX_FILE = join('data', 'url-index.json');

// In-memory URL index
let urlIndex: Map<string, string> | null = null;
let indexBuiltAt = 0;
// Concurrent calls share one build Promise instead of triggering multiple scans
let indexBuilding: Promise<Map<string, string>> | null = null;

/** Force the next isDuplicateUrl call to rebuild the index from disk. */
export function invalidateUrlIndex(): void {
  urlIndex = null;
  indexBuilding = null;
  indexBuiltAt = 0;
}

/** TTL: rebuild index if it has been in memory for more than 30 minutes.
 *  Covers the case where the user manually modifies the Vault without going through saveToVault. */
const INDEX_TTL_MS = 30 * 60 * 1000;

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

async function persistIndex(index: Map<string, string>): Promise<void> {
  try {
    const data = { version: 1, count: index.size, entries: Object.fromEntries(index) };
    await safeWriteJSON(INDEX_FILE, data);
  } catch { /* best-effort */ }
}

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

/** Check for duplicate URL (O(1) after first scan). Concurrent calls share one build Promise.
 *  Automatically rebuilds if the index is older than INDEX_TTL_MS (30 min). */
export async function isDuplicateUrl(url: string, vaultPath: string): Promise<string | null> {
  const stale = urlIndex !== null && (Date.now() - indexBuiltAt) > INDEX_TTL_MS;
  if (stale) invalidateUrlIndex();

  if (!urlIndex) {
    if (!indexBuilding) {
      indexBuilding = buildUrlIndex(vaultPath).then(idx => {
        urlIndex = idx;
        indexBuiltAt = Date.now();
        return idx;
      }).catch(err => {
        indexBuilding = null;
        throw err;
      });
    }
    urlIndex = await indexBuilding;
  }
  return urlIndex.get(canonicalizeUrl(url)) ?? null;
}

/** Add an entry to the in-memory index and persist asynchronously. */
export function updateUrlIndex(normUrl: string, mdPath: string): void {
  if (urlIndex) {
    urlIndex.set(normUrl, mdPath);
    indexBuiltAt = Date.now(); // reset TTL on each write
    persistIndex(urlIndex).catch(() => {});
  }
}
