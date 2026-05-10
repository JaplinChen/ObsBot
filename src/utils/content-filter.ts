/**
 * Content filter — persistent blocklist for categories and keywords.
 * Applied across radar, subscription, and patrol pipelines.
 * Data stored in data/content-filter.json.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const STORE_PATH = join(process.cwd(), 'data', 'content-filter.json');

export interface FilterStats {
  date: string;           // YYYY-MM-DD, resets daily
  total: number;
  byCategory: Record<string, number>;
}

export interface ContentFilter {
  version: 1;
  blockedCategories: string[];
  blockedKeywords: string[];
  stats?: FilterStats;
}

const DEFAULTS: ContentFilter = {
  version: 1,
  blockedCategories: ['新聞時事', '生活', '其他'],
  blockedKeywords: [],
};

export async function loadContentFilter(): Promise<ContentFilter> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ContentFilter>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveContentFilter(filter: ContentFilter): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(filter, null, 2), 'utf-8');
}

/** Returns true if the content should be skipped. */
export function isBlockedContent(
  filter: ContentFilter,
  category: string | undefined,
  title?: string,
): boolean {
  if (category && filter.blockedCategories.includes(category)) return true;
  if (title && filter.blockedKeywords.length > 0) {
    const lower = title.toLowerCase();
    return filter.blockedKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }
  return false;
}

/** Record a block event for daily statistics (fire-and-forget). */
export function fireRecordBlocked(category?: string): void {
  recordBlocked(category).catch(() => {});
}

async function recordBlocked(category?: string): Promise<void> {
  const filter = await loadContentFilter();
  const today = new Date().toISOString().slice(0, 10);
  const stats = filter.stats?.date === today
    ? filter.stats
    : { date: today, total: 0, byCategory: {} };
  stats.total++;
  if (category) stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1;
  filter.stats = stats;
  await saveContentFilter(filter);
}

/** Read today's stats and reset them (called by daily digest). */
export async function readAndResetStats(): Promise<FilterStats | null> {
  const filter = await loadContentFilter();
  const stats = filter.stats ?? null;
  filter.stats = undefined;
  await saveContentFilter(filter);
  return stats;
}

export async function addBlockedCategory(category: string): Promise<ContentFilter> {
  const filter = await loadContentFilter();
  if (!filter.blockedCategories.includes(category)) {
    filter.blockedCategories.push(category);
    await saveContentFilter(filter);
  }
  return filter;
}

export async function removeBlockedCategory(category: string): Promise<ContentFilter> {
  const filter = await loadContentFilter();
  filter.blockedCategories = filter.blockedCategories.filter((c) => c !== category);
  await saveContentFilter(filter);
  return filter;
}

export async function addBlockedKeyword(keyword: string): Promise<ContentFilter> {
  const filter = await loadContentFilter();
  const lower = keyword.toLowerCase();
  if (!filter.blockedKeywords.some((k) => k.toLowerCase() === lower)) {
    filter.blockedKeywords.push(keyword);
    await saveContentFilter(filter);
  }
  return filter;
}

export async function removeBlockedKeyword(keyword: string): Promise<ContentFilter> {
  const filter = await loadContentFilter();
  const lower = keyword.toLowerCase();
  filter.blockedKeywords = filter.blockedKeywords.filter((k) => k.toLowerCase() !== lower);
  await saveContentFilter(filter);
  return filter;
}
