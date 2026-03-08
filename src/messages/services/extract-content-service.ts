import { logger } from '../../core/logger.js';
import type { ExtractedContent, ExtractorWithComments } from '../../extractors/types.js';

/** Filter out noise: too short, pure emoji, or generic one-word reactions */
function isMeaningfulComment(c: { text: string }): boolean {
  const t = c.text.trim();
  if (!t) return false;
  if (/https?:\/\/\S+|(?:^|\s)\w+\.\w{2,}\/\S+/.test(t)) return true;
  if (t.length < 15) return false;
  if (/^[\p{Emoji}\s!?.\u3002\uFF0C\uFF01\uFF1F]+$/u.test(t)) return false;
  if (/^(great|nice|wow|lol|haha|yes|ok|okay|cool|love|good|awesome|amazing|thanks|congrats?)[\s!.\uFF01\u3002]*$/i.test(t)) return false;
  return true;
}

export async function extractContentWithComments(
  url: string,
  extractor: ExtractorWithComments,
): Promise<ExtractedContent> {
  const hasComments = typeof extractor.extractComments === 'function';
  const [contentResult, commentsResult] = await Promise.allSettled([
    extractor.extract(url),
    hasComments ? extractor.extractComments(url, 30) : Promise.resolve([]),
  ]);

  if (contentResult.status === 'rejected') throw contentResult.reason as Error;
  const content = contentResult.value;
  logger.info('msg', 'extracted', { title: content.title });

  if (commentsResult.status === 'fulfilled' && commentsResult.value.length > 0) {
    const meaningful = commentsResult.value.filter(isMeaningfulComment);
    if (meaningful.length > 0) {
      content.comments = meaningful;
      content.commentCount = commentsResult.value.length;
    }
  }

  return content;
}
