/** Knowledge extraction system — core type definitions */

/** Entity types that can be extracted from vault notes */
export type EntityType =
  | 'tool' | 'concept' | 'person' | 'framework'
  | 'company' | 'technology' | 'platform' | 'language';

/** Types of actionable insights extracted from notes */
export type InsightType =
  | 'principle' | 'framework' | 'pattern' | 'warning'
  | 'best_practice' | 'mental_model' | 'tip' | 'anti_pattern';

/** Types of relationships between entities */
export type RelationType =
  | 'uses' | 'compares' | 'builds_on' | 'contradicts'
  | 'alternative_to' | 'part_of' | 'created_by' | 'integrates';

/** A named entity mentioned in one or more vault notes */
export interface KnowledgeEntity {
  name: string;
  type: EntityType;
  aliases: string[];
  /** Number of distinct notes mentioning this entity */
  mentions: number;
  /** Note IDs (normalised URLs) where this entity appears */
  noteIds: string[];
}

/** An actionable insight extracted from a single note */
export interface KnowledgeInsight {
  id: string;
  type: InsightType;
  /** Insight content in Traditional Chinese, ≤100 chars */
  content: string;
  sourceNoteId: string;
  sourceTitle: string;
  /** Entity names related to this insight */
  entities: string[];
  /** AI confidence score 0–1 */
  confidence: number;
}

/** A relationship between two entities found in a note */
export interface KnowledgeRelation {
  from: string;
  to: string;
  type: RelationType;
  /** Brief description, ≤50 chars */
  description: string;
  sourceNoteId: string;
}

/** Analysis result for a single vault note */
export interface NoteAnalysis {
  /** Normalised URL — stable ID even when file moves */
  noteId: string;
  filePath: string;
  title: string;
  category: string;
  /** MD5 of note content (first 2500 chars) for incremental updates */
  contentHash: string;
  qualityScore: number;
  entities: KnowledgeEntity[];
  insights: KnowledgeInsight[];
  relations: KnowledgeRelation[];
  analyzedAt: string;
}

/** Persistent knowledge store for the entire vault */
export interface VaultKnowledge {
  version: number;
  generatedAt: string;
  stats: {
    totalNotes: number;
    analyzedNotes: number;
    totalEntities: number;
    totalInsights: number;
    totalRelations: number;
    avgQualityScore: number;
  };
  /** Per-note analyses keyed by noteId (normalised URL) */
  notes: Record<string, NoteAnalysis>;
  /** Aggregated global entities (merged across notes) */
  globalEntities?: Record<string, KnowledgeEntity>;
  /** ISO timestamp of last auto-consolidation run */
  lastConsolidatedAt?: string;
}

/** Raw JSON structure returned by Claude API for a single note analysis */
export interface AIAnalysisResponse {
  qualityScore: number;
  entities: Array<{
    name: string;
    type: EntityType;
    aliases?: string[];
  }>;
  insights: Array<{
    type: InsightType;
    content: string;
    relatedEntities: string[];
    confidence: number;
  }>;
  relations: Array<{
    from: string;
    to: string;
    type: RelationType;
    description: string;
  }>;
}
