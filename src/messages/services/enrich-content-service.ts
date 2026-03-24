import { classifyContent } from '../../classifier.js';
import { logger } from '../../core/logger.js';
import { postProcess } from '../../enrichment/post-processor.js';
import type { ExtractedContent } from '../../extractors/types.js';
import { enrichContent } from '../../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../../learning/dynamic-classifier.js';
import { AI_TRANSCRIPT_PREFIX } from '../user-messages.js';
import type { AppConfig } from '../../utils/config.js';
import { analyzeContentImages } from '../../utils/vision-llm.js';
import { computeEnrichmentScore } from '../../monitoring/benchmark-scorer.js';
import { loadBenchmarkData, saveBenchmarkData, recordPlatformAttempt } from '../../monitoring/benchmark-store.js';
import { ocrContentImages, isLikelyScreenshot } from '../../enrichment/ocr-service.js';
import { cleanTitle } from '../../utils/content-cleaner.js';

export async function enrichExtractedContent(content: ExtractedContent, config: AppConfig): Promise<void> {
  content.category = classifyContent(content.title, content.text);
  logger.info('msg', 'category', { category: content.category });

  const hints = getTopKeywordsForCategory(content.category);
  const cleanText = content.text
    .replace(/\*\*Duration:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\*\*Stats:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // OCR + Vision: run in parallel when images present and text is minimal
  let ocrText = '';
  let imageContext = '';
  if (content.images.length > 0 && cleanText.length < 200) {
    const needOcr = isLikelyScreenshot(content.url, cleanText);
    const [ocrResult, visionResult] = await Promise.all([
      needOcr
        ? ocrContentImages(content.images, cleanText, 2).catch((err: Error) => {
            logger.warn('msg', 'ocr failed', { message: err.message });
            return '';
          })
        : Promise.resolve(''),
      analyzeContentImages(content.images, 2).catch((err: Error) => {
        logger.warn('msg', 'vision-analysis failed', { message: err.message });
        return '';
      }),
    ]);
    ocrText = ocrResult;
    if (ocrText) logger.info('msg', 'ocr-extracted', { chars: ocrText.length });
    imageContext = visionResult;
    if (imageContext) {
      content.imageDescriptions = imageContext;
      logger.info('msg', 'vision-analysis', { chars: imageContext.length });
    }
  }

  let textForAI = content.transcript
    ? `${cleanText}${AI_TRANSCRIPT_PREFIX}${content.transcript.slice(0, 2500)}`
    : cleanText;
  if (ocrText) textForAI += `\n\n[OCR 文字辨識]\n${ocrText.slice(0, 1500)}`;
  const finalText = imageContext
    ? `${textForAI}\n\n[圖片視覺描述]\n${imageContext}`
    : textForAI;

  // Pre-clean title before AI enrichment
  const cleanedTitle = cleanTitle(content.title);

  // Inject GitHub structured metadata into text for AI context
  let enrichText = finalText;
  if (content.platform === 'github') {
    const meta: string[] = [];
    if (content.stars != null) meta.push(`Stars: ${content.stars}`);
    if (content.language) meta.push(`Language: ${content.language}`);
    if (content.extraTags?.length) meta.push(`Topics: ${content.extraTags.join(', ')}`);
    if (meta.length > 0) {
      enrichText = `[GitHub Metadata] ${meta.join(' | ')}\n\n${finalText}`;
    }
  }

  // Phase A: 連結深度抓取 + 翻譯並行（連結內容需先於 AI 豐富化完成）
  const originalTitle = content.title;
  await postProcess(content, {
    enrichPostLinks: true,
    enrichCommentLinks: true,
    translate: config.enableTranslation,
    maxLinkedUrls: config.maxLinkedUrls,
  }).catch((err: Error) => {
    logger.warn('post-process', 'post process failed', { message: err.message });
  });

  // Phase B: 將連結文章完整文本注入 AI 上下文
  const linkedTexts = (content.linkedContent ?? [])
    .filter((l) => l.fullText && l.fullText.length > 100)
    .map((l) => l.fullText!);
  if (linkedTexts.length > 0) {
    const linkedContext = linkedTexts.join('\n\n---\n\n').slice(0, 4000);
    enrichText += `\n\n[連結文章內容]\n${linkedContext}`;
    logger.info('msg', '連結內容已注入 AI 上下文', { count: linkedTexts.length, chars: linkedContext.length });
  }

  const enriched = await enrichContent(cleanedTitle, enrichText, hints, content.platform, linkedTexts.length > 0);

  if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
  if (enriched.summary) content.enrichedSummary = enriched.summary;
  if (enriched.analysis) content.enrichedAnalysis = enriched.analysis;
  if (enriched.keyPoints?.length) content.enrichedKeyPoints = enriched.keyPoints;
  if (enriched.title) content.title = enriched.title;
  if (enriched.githubAnalysis) content.githubAnalysis = enriched.githubAnalysis;
  // 不用 enricher 的 category — classifier 的關鍵字匹配更可靠

  // Benchmark: score enrichment quality (non-blocking)
  try {
    const score = computeEnrichmentScore(enriched, originalTitle, finalText);
    const benchData = await loadBenchmarkData();
    benchData.scores[content.url] = {
      score,
      timestamp: new Date().toISOString(),
      platform: content.platform,
    };
    recordPlatformAttempt(benchData, content.platform, true);
    await saveBenchmarkData(benchData);
    logger.info('benchmark', '品質評分', { url: content.url, score: score.overall });
  } catch {
    // Non-critical, silent fallback
  }
}
