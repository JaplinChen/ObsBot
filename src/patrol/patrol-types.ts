/** Types for the automated multi-platform content patrol service. */

export interface PatrolConfig {
  /** Enable automatic patrol (default: false) */
  enabled: boolean;
  /** Patrol interval in hours (default: 12) */
  intervalHours: number;
  /** Last patrol timestamp */
  lastPatrolAt: string | null;
  /** Languages to filter on GitHub Trending (empty = all) */
  languages: string[];
  /** Enabled patrol sources (default: ['github-trending']) */
  enabledSources: string[];
  /** User interest topics for relevance scoring */
  topics: string[];
  /** Tags for Dev.to source */
  devtoTags: string[];
  /** RSSHub 路由清單，例如 ['/zhihu/hotlist', '/bilibili/trending/regionlist/0/1'] */
  rsshubPaths: string[];
  /** Relevance score threshold 0-10 (default: 6) */
  relevanceThreshold: number;
}

export interface PatrolResult {
  source: string;
  found: number;
  saved: number;
  skipped: number;
}

export const DEFAULT_PATROL_CONFIG: PatrolConfig = {
  enabled: false,
  intervalHours: 12,
  lastPatrolAt: null,
  languages: ['typescript', 'python'],
  enabledSources: ['github-trending'],
  topics: ['ai-agent', 'obsidian', 'typescript', 'local-llm'],
  devtoTags: ['ai', 'typescript', 'webdev', 'opensource'],
  rsshubPaths: [],
  relevanceThreshold: 6,
};
