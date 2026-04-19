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
    if (!Array.isArray(patterns.classificationRules) || !patterns.formatting?.topKeywordsByCategory) {
      logger.warn('classifier', '規則檔格式不符，略過載入', { path: rulesPath });
      return;
    }
    cachedRules = patterns.classificationRules;
    cachedTopKeywords = patterns.formatting.topKeywordsByCategory;
    logger.info('classifier', '載入學習規則', { count: cachedRules.length });
  } catch {
    // File doesn't exist yet — first run, silent fallback
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
  // ASCII keywords need ≥ 5 chars (e.g. "day" matches everything)
  // CJK keywords need ≥ 3 chars (shorter CJK terms carry more meaning)
  const MIN_ASCII_LEN = 5;
  const MIN_CJK_LEN = 3;
  const isTooShort = (kw: string) => {
    const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(kw);
    return kw.length < (hasCJK ? MIN_CJK_LEN : MIN_ASCII_LEN);
  };

  // Pass 1: title match — require higher confidence
  for (const rule of cachedRules) {
    if (isTooShort(rule.keyword)) continue;
    if (rule.score >= 0.8 && titleLower.includes(rule.keyword)) {
      return rule.category;
    }
  }

  // Pass 2: body match — moderate confidence
  for (const rule of cachedRules) {
    if (isTooShort(rule.keyword)) continue;
    if (rule.score >= 0.75 && textLower.includes(rule.keyword)) {
      return rule.category;
    }
  }

  return null;
}

/** Get top learned keywords for a given category (for AI enricher context). */
export function getTopKeywordsForCategory(category: string): string[] {
  return cachedTopKeywords[category] ?? [];
}



