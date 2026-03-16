/** Tool Wall — type definitions for the AI agent intelligence wall. */

import type { EntityType } from '../knowledge/types.js';

/** A tool/framework entry in the wall index */
export interface ToolEntry {
  name: string;
  aliases: string[];
  type: EntityType;
  category: string;
  /** Functional tags derived from keywords (e.g. "ai-agent", "coding") */
  tags: string[];
  noteIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  mentionTimeline: MentionPoint[];
}

export interface MentionPoint {
  month: string; // "2026-03"
  count: number;
}

export type ActivityStatus = 'active' | 'dormant' | 'rising' | 'new';

export interface ToolActivity {
  name: string;
  status: ActivityStatus;
  totalMentions: number;
  /** Mentions in the last 14 days */
  recentMentions: number;
  daysSinceLastMention: number;
}

/** Match result when radar discovers a new tool */
export interface ToolMatchResult {
  newToolName: string;
  newToolUrl: string;
  matchedExisting: Array<{
    name: string;
    similarity: number;
    relation: 'alternative' | 'complement' | 'upgrade';
  }>;
}

/** Full wall report for display */
export interface WallReport {
  generatedAt: string;
  totalTools: number;
  activeTools: ToolActivity[];
  dormantTools: ToolActivity[];
  risingTools: ToolActivity[];
  newTools: ToolActivity[];
  recentMatches: ToolMatchResult[];
  summary?: string;
}

/** Persistent wall configuration */
export interface WallConfig {
  enabled: boolean;
  pushIntervalHours: number;
  dormantThresholdDays: number;
  lastPushAt: string | null;
  pendingMatches: ToolMatchResult[];
}

export const DEFAULT_WALL_CONFIG: WallConfig = {
  enabled: true,
  pushIntervalHours: 48,
  dormantThresholdDays: 30,
  lastPushAt: null,
  pendingMatches: [],
};
