import { classifyContent } from '../../classifier.js';
import { logger } from '../../core/logger.js';
import { postProcess } from '../../enrichment/post-processor.js';
import type { ExtractedContent } from '../../extractors/types.js';
import { enrichContent } from '../../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../../learning/dynamic-classifier.js';
import { AI_TRANSCRIPT_PREFIX } from '../user-messages.js';
import type { AppConfig } from '../../utils/config.js';

export async function enrichExtractedContent(content: ExtractedContent, config: AppConfig): Promise<void> {
  content.category = classifyContent(content.title, content.text);
  logger.info('msg', 'category', { category: content.category });

  const hints = getTopKeywordsForCategory(content.category);
  const cleanText = content.text
    .replace(/\*\*Duration:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\*\*Stats:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const textForAI = content.transcript
    ? `${cleanText}${AI_TRANSCRIPT_PREFIX}${content.transcript.slice(0, 2500)}`
    : cleanText;
  const enriched = await enrichContent(content.title, textForAI, hints);
  if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
  if (enriched.summary) content.enrichedSummary = enriched.summary;
  if (enriched.analysis) content.enrichedAnalysis = enriched.analysis;
  if (enriched.keyPoints?.length) content.enrichedKeyPoints = enriched.keyPoints;
  if (enriched.title) content.title = enriched.title;
  if (enriched.category) content.category = enriched.category;

  try {
    await postProcess(content, {
      enrichPostLinks: true,
      enrichCommentLinks: true,
      translate: config.enableTranslation,
      maxLinkedUrls: config.maxLinkedUrls,
    });
  } catch (err) {
    logger.warn('post-process', 'post process failed', { message: (err as Error).message });
  }
}
