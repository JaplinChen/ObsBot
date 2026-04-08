/** Content radar — type definitions */

/** Source type for a radar query. */
export type RadarQueryType = 'search' | 'github' | 'rss' | 'hn' | 'devto' | 'custom';

export interface RadarConfig {
  version: number;
  enabled: boolean;
  intervalHours: number;
  maxResultsPerQuery: number;
  maxTotalPerCycle: number;
  queries: RadarQuery[];
  lastRunAt?: string;
  /** Per-cycle results kept for proactive digest integration. */
  lastCycleResults?: RadarCycleSummary;
  /**
   * Standby author handles to promote when an active author query is paused.
   * Ordered by priority (index 0 = next to promote).
   */
  authorQueue?: string[];
}

export interface RadarQuery {
  id: string;
  /** Query type: 'search' (DDG), 'github' (trending), 'rss' (feed), 'custom' (JSON API). */
  type: RadarQueryType;
  /** search: keywords, github: [language?], rss: [feedUrl], custom: [keywords...]. */
  keywords: string[];
  source: 'auto' | 'manual';
  addedAt: string;
  lastHitCount?: number;
  /** Consecutive fetch failures — auto-paused at 3. */
  consecutiveFailures?: number;
  /** If true, query is paused due to repeated failures. */
  paused?: boolean;
  /** Config for type='custom' JSON API sources. */
  customConfig?: {
    name: string;
    url: string;
    itemsPath: string;
    urlField: string;
    titleField: string;
    snippetField?: string;
  };
  /**
   * If this is an author-tracking query, store the handle (e.g. "op7418").
   * Used to trigger auto-rotation when the query is auto-paused.
   */
  authorHandle?: string;
}

export interface RadarResult {
  query: RadarQuery;
  saved: number;
  skipped: number;
  errors: number;
  /** URLs pushed to async video queue instead of extracted inline. */
  queued: number;
}

/** Summary of a full radar cycle — used by proactive digest. */
export interface RadarCycleSummary {
  timestamp: string;
  totalSaved: number;
  totalSkipped: number;
  totalErrors: number;
  /** Video URLs pushed to async queue for background transcription. */
  totalQueued?: number;
  byType: Partial<Record<RadarQueryType, number>>;
}

export function createEmptyConfig(): RadarConfig {
  return {
    version: 1,
    enabled: false,
    intervalHours: 6,
    maxResultsPerQuery: 5,
    maxTotalPerCycle: 20,
    queries: [],
  };
}
