/**
 * Generic JSON API source adapter for Radar.
 * Allows users to add any public JSON API as a Radar source without
 * changing TypeScript code — config is stored inline in RadarQuery.customConfig.
 *
 * Usage: /radar add custom <name> <url_template> <items_path> <url_field> <title_field> [snippet_field]
 * Example: /radar add custom "HN Jobs" "https://hacker-news.firebaseio.com/v0/jobstories.json" "" "" ""
 */
import type { RadarSource, RadarSourceResult } from './source-types.js';
import { fetchWithTimeout } from '../../utils/fetch-with-timeout.js';
import { logger } from '../../core/logger.js';

/** Configuration stored in RadarQuery.customConfig. */
export interface CustomSourceConfig {
  /** Human-readable name for display. */
  name: string;
  /**
   * URL template. Use {query} as placeholder for joined keywords.
   * Example: "https://api.example.com/search?q={query}&limit=10"
   */
  url: string;
  /**
   * Dot-notation path to the items array in the JSON response.
   * Use empty string "" for top-level array.
   * Example: "data.results" → response.data.results
   */
  itemsPath: string;
  /** Field name (or dot path) for the URL in each item. */
  urlField: string;
  /** Field name (or dot path) for the title in each item. */
  titleField: string;
  /** Optional field name for snippet/description. */
  snippetField?: string;
}

/** Resolve a dot-notation path in an object. Returns undefined if not found. */
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur != null && typeof cur === 'object') return (cur as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Build a RadarSource from a CustomSourceConfig. */
export function createCustomSource(cfg: CustomSourceConfig): RadarSource {
  return {
    type: 'custom',

    async fetch(keywords: string[], maxResults: number): Promise<RadarSourceResult[]> {
      const query = keywords.join(' ');
      const url = cfg.url.replace('{query}', encodeURIComponent(query));

      try {
        const res = await fetchWithTimeout(url, 15_000, {
          headers: { 'User-Agent': 'KnowPipe/1.0 (+https://github.com/JaplinChen/KnowPipe)' },
        });
        if (!res.ok) {
          logger.warn('radar-custom', 'HTTP 錯誤', { status: res.status, url, name: cfg.name });
          return [];
        }

        const json = await res.json() as unknown;
        const items = resolvePath(json, cfg.itemsPath);
        if (!Array.isArray(items)) {
          logger.warn('radar-custom', 'itemsPath 未指向陣列', { itemsPath: cfg.itemsPath, name: cfg.name });
          return [];
        }

        const results: RadarSourceResult[] = [];
        for (const item of items) {
          if (results.length >= maxResults) break;
          const itemUrl = String(resolvePath(item, cfg.urlField) ?? '');
          const title = String(resolvePath(item, cfg.titleField) ?? itemUrl);
          const snippet = cfg.snippetField
            ? String(resolvePath(item, cfg.snippetField) ?? '').slice(0, 200)
            : '';

          if (!itemUrl.startsWith('http')) continue;
          results.push({ url: itemUrl, title: title.slice(0, 200), snippet });
        }

        return results;
      } catch (err) {
        logger.warn('radar-custom', '抓取失敗', { err: (err as Error).message, name: cfg.name });
        return [];
      }
    },
  };
}
