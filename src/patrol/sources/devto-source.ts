/**
 * Dev.to patrol source — public API (free, no auth).
 * Fetches top articles by tag from the past week.
 */
import type { PatrolItem, PatrolSource } from './source-types.js';
import { logger } from '../../core/logger.js';

const FETCH_TIMEOUT = 10_000;
const PER_TAG_LIMIT = 10;
const DEFAULT_TAGS = ['ai', 'typescript', 'webdev', 'opensource'];

interface DevtoArticle {
  id: number;
  title: string;
  url: string;
  description: string;
  public_reactions_count: number;
  published_at: string;
  tag_list: string[];
  user: { name: string };
}

async function fetchByTag(tag: string): Promise<PatrolItem[]> {
  const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=7&per_page=${PER_TAG_LIMIT}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KnowPipe/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return [];

    const articles = await res.json() as DevtoArticle[];
    return articles.map((a): PatrolItem => ({
      url: a.url,
      title: a.title,
      description: a.description?.slice(0, 200) ?? '',
      score: a.public_reactions_count,
      source: 'devto',
      publishedAt: a.published_at,
    }));
  } catch {
    logger.warn('patrol-devto', `Failed to fetch tag: ${tag}`);
    return [];
  }
}

export const devtoSource: PatrolSource = {
  name: 'devto',

  async fetch(topics: string[]): Promise<PatrolItem[]> {
    const tags = topics.length > 0 ? topics : DEFAULT_TAGS;

    const results = await Promise.allSettled(tags.map(fetchByTag));
    const items: PatrolItem[] = [];
    const seen = new Set<string>();

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          items.push(item);
        }
      }
    }

    logger.info('patrol-devto', `Fetched ${items.length} articles from ${tags.length} tags`);
    return items;
  },
};
