import { readFile } from 'node:fs/promises';
import { logger } from '../core/logger.js';
import type { ClassificationRule, LearnedPatterns } from './vault-learner.js';

// In-memory cache ??updated by initDynamicClassifier() or refreshFromPatterns()
let cachedRules: ClassificationRule[] = [];
let cachedTopKeywords: Record<string, string[]> = {};

/** Load rules from disk (called on bot startup). Silent fallback on error. */
export async function initDynamicClassifier(rulesPath: string): Promise<void> {
  try {
    const raw = await readFile(rulesPath, 'utf-8');
    const patterns = JSON.parse(raw) as LearnedPatterns;
    cachedRules = patterns.classificationRules;
    cachedTopKeywords = patterns.formatting.topKeywordsByCategory;
    logger.info('classifier', '載入學習規則', { count: cachedRules.length });
  } catch {
    // File doesn't exist yet ??first run, silent fallback
  }
}

/** Update in-memory cache immediately after a learn run (no disk read). */
export function refreshFromPatterns(patterns: LearnedPatterns): void {
  cachedRules = patterns.classificationRules;
  cachedTopKeywords = patterns.formatting.topKeywordsByCategory;
}

/**
 * Classify using learned rules. Returns null if confidence is insufficient,
 * indicating the caller should fall back to static keyword matching.
 */
export function classifyWithLearnedRules(title: string, text: string): string | null {
  if (cachedRules.length === 0) return null;
  const titleLower = title.toLowerCase();
  const textLower = text.toLowerCase();

  // Skip overly short keywords — too many false positives
  const MIN_KEYWORD_LEN = 3;
  // Single-word keywords are often too generic (e.g. "基於", "安裝", "research")
  // Require higher confidence for them
  const isSingleWord = (kw: string) => !kw.includes(' ');

  // Pass 1: title match — require higher confidence
  for (const rule of cachedRules) {
    if (rule.keyword.length < MIN_KEYWORD_LEN) continue;
    const threshold = isSingleWord(rule.keyword) ? 0.85 : 0.8;
    if (rule.score >= threshold && titleLower.includes(rule.keyword)) {
      return rule.category;
    }
  }

  // Pass 2: body match — require high confidence (body is noisy)
  for (const rule of cachedRules) {
    if (rule.keyword.length < MIN_KEYWORD_LEN) continue;
    // Single-word body matches need very high confidence to avoid false positives
    const threshold = isSingleWord(rule.keyword) ? 0.95 : 0.85;
    if (rule.score >= threshold && textLower.includes(rule.keyword)) {
      return rule.category;
    }
  }

  return null;
}

/** Get top learned keywords for a given category (for AI enricher context). */
export function getTopKeywordsForCategory(category: string): string[] {
  return cachedTopKeywords[category] ?? [];
}



