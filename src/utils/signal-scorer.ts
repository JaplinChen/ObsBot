/**
 * Signal strength scorer — lightweight, zero-LLM quality signal.
 * Scores each note 0-10 from available metadata and tags it:
 *   ≥ 7 → 'high-signal' (worth highlighting in digest/discover)
 *   ≤ 3 → 'low-signal'  (flag for review, still saved)
 *   4-6 → no tag
 */
import type { ExtractedContent } from '../extractors/types.js';

/** Platforms that tend to carry more structured/substantive content. */
const HIGH_SIGNAL_PLATFORMS = new Set(['github', 'reddit', 'web', 'youtube', 'bilibili', 'zhihu', 'ithome']);
const LOW_SIGNAL_PLATFORMS  = new Set(['x', 'threads', 'weibo', 'xiaohongshu', 'douyin', 'tiktok']);

export type SignalTag = 'high-signal' | 'low-signal';

/** Compute signal strength score (0–10) for a piece of extracted content. */
export function computeSignalScore(content: ExtractedContent): number {
  let score = 0;

  // Keyword density (0–2): more precise keywords → higher signal
  const kwCount = content.enrichedKeywords?.length ?? 0;
  if (kwCount >= 4)      score += 2;
  else if (kwCount >= 2) score += 1;

  // Summary quality (0–2): longer, more informative summary
  const sumLen = content.enrichedSummary?.length ?? 0;
  if (sumLen > 80)      score += 2;
  else if (sumLen > 30) score += 1;

  // Analysis presence (0–2): deep analysis indicates substantive content
  const analysisLen = content.enrichedAnalysis?.length ?? 0;
  if (analysisLen > 150)     score += 2;
  else if (analysisLen > 30) score += 1;

  // Content depth (0–2): raw text length as proxy for substance
  const textLen = content.text?.length ?? 0;
  if (textLen > 3000)      score += 2;
  else if (textLen > 800)  score += 1;

  // Source credibility bonus (0–2)
  if (HIGH_SIGNAL_PLATFORMS.has(content.platform))     score += 2;
  else if (!LOW_SIGNAL_PLATFORMS.has(content.platform)) score += 1;

  return Math.min(score, 10);
}

/**
 * Evaluate signal and return a tag to inject into suggestedTags,
 * or null if score is in the neutral range.
 */
export function getSignalTag(content: ExtractedContent): SignalTag | null {
  const score = computeSignalScore(content);
  if (score >= 7) return 'high-signal';
  if (score <= 3) return 'low-signal';
  return null;
}
