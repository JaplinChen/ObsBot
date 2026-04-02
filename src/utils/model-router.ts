/**
 * Smart model router — maps AI task types to optimal model tiers.
 * Reads routing table from user-config.json for customization.
 */
import type { ModelTier } from './local-llm.js';
import { getUserConfig } from './user-config.js';

/** Semantic task types used across the pipeline. */
export type TaskType =
  | 'translate'
  | 'classify'
  | 'keywords'
  | 'summarize'
  | 'analyze'
  | 'digest'
  | 'vision'
  | 'general';

/**
 * Resolve the best model tier for a given task.
 * Explicit tier always wins; otherwise consult user-config routing table.
 */
export function resolveModelTier(task: TaskType, explicitTier?: ModelTier): ModelTier {
  if (explicitTier) return explicitTier;
  return getUserConfig().llm.routing[task] ?? 'standard';
}
