import { classifyContent } from '../../classifier.js';
import { logger } from '../../core/logger.js';
import { fetchLinkedContent, runPostTranslation } from '../../enrichment/post-processor.js';
import type { ExtractedContent } from '../../extractors/types.js';
import { enrichContent } from '../../learning/ai-enricher.js';
import { getTopKeywordsForCategory } from '../../learning/dynamic-classifier.js';
import { AI_TRANSCRIPT_PREFIX } from '../user-messages.js';
import type { AppConfig } from '../../utils/config.js';
import { analyzeContentImages } from '../../utils/vision-llm.js';
import { computeEnrichmentScore } from '../../monitoring/benchmark-scorer.js';
import { loadBenchmarkData, saveBenchmarkData, recordPlatformAttempt } from '../../monitoring/benchmark-store.js';
import { suggestAction } from '../../learning/action-suggester.js';
import { ocrContentImages, isLikelyScreenshot } from '../../enrichment/ocr-service.js';
import { cleanTitle } from '../../utils/content-cleaner.js';
import { getUserConfig } from '../../utils/user-config.js';
import { fetchYouTubeTranscript } from '../../utils/transcript-service.js';
import { isDuplicateUrl } from '../../saver.js';
import { basename } from 'node:path';

/** For GitHub repos, build classification text from description + topics only (not README body) */
function buildGithubClassifyText(content: ExtractedContent): string {
  const parts: string[] = [];
  // Use og:description (first line of text, before README)
  const desc = content.text.split('\n\n')[0] ?? '';
  if (desc) parts.push(desc);
  // Topics are the best signal for what a project actually does
  if (content.extraTags?.length) parts.push(content.extraTags.join(' '));
  return parts.join(' ');
}

export async function enrichExtractedContent(content: ExtractedContent, config: AppConfig): Promise<void> {
  const classifyText = content.platform === 'github'
    ? buildGithubClassifyText(content)
    : content.text;
  content.category = await classifyContent(content.title, classifyText);
  logger.info('msg', 'category', { category: content.category });

  const hints = getTopKeywordsForCategory(content.category);
  const cleanText = content.text
    .replace(/\*\*Duration:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\*\*Stats:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const features = getUserConfig().features;

  // OCR + Vision: run whenever images are present and imageAnalysis is enabled
  let ocrText = '';
  let imageContext = '';
  if (content.images.length > 0 && features.imageAnalysis) {
    const needOcr = isLikelyScreenshot(content.url, cleanText);
    const [ocrResult, visionResult] = await Promise.all([
      needOcr
        ? ocrContentImages(content.images, cleanText, 3).catch((err: Error) => {
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

  // Embedded video transcripts: fetch subtitles for YouTube videos found in web articles
  if (content.platform === 'web' && content.videos.length > 0 && features.videoTranscription) {
    const transcriptResults = await Promise.allSettled(
      content.videos.slice(0, 2).map(v => fetchYouTubeTranscript(v.url)),
    );
    const transcripts = transcriptResults
      .map((r, i) => ({ url: content.videos[i].url, result: r }))
      .filter((t): t is { url: string; result: PromiseFulfilledResult<string> } =>
        t.result.status === 'fulfilled' && t.result.value !== null,
      )
      .map(t => ({ url: t.url, transcript: (t.result as PromiseFulfilledResult<string>).value }));
    if (transcripts.length > 0) {
      content.embeddedVideoTranscripts = transcripts;
      logger.info('msg', 'embedded-video-transcripts', { count: transcripts.length });
    }
  }

  // Build timed transcript text for chapter generation
  const timedTranscriptText = content.timedTranscript && content.timedTranscript.length > 20
    ? content.timedTranscript.map(s => {
        const mm = Math.floor(s.start / 60);
        const ss = Math.floor(s.start % 60);
        return `[${mm}:${String(ss).padStart(2, '0')}] ${s.text}`;
      }).join('\n').slice(0, 4000)
    : '';

  let textForAI = content.transcript
    ? `${cleanText}${AI_TRANSCRIPT_PREFIX}${content.transcript.slice(0, 2500)}`
    : cleanText;
  if (ocrText) textForAI += `\n\n[OCR 文字辨識]\n${ocrText.slice(0, 1500)}`;
  if (content.embeddedVideoTranscripts?.length) {
    const videoText = content.embeddedVideoTranscripts
      .map((v, i) => `[內嵌影片${i + 1}逐字稿]\n${v.transcript.slice(0, 1500)}`)
      .join('\n\n');
    textForAI += `\n\n${videoText}`;
  }
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

  const originalTitle = content.title;
  const hasTimedTranscript = timedTranscriptText.length > 0 && !content.chapters;
  const postProcessOpts = {
    enrichPostLinks: true,
    enrichCommentLinks: true,
    maxLinkedUrls: config.maxLinkedUrls,
  };

  // Phase 1: 先抓取連結內容（必須在 AI 豐富化前完成，才能注入連結全文）
  await fetchLinkedContent(content, postProcessOpts).catch((err: Error) => {
    logger.warn('post-process', '連結補充失敗', { message: err.message });
  });

  // 查詢每個連結是否已存在於 Vault，有則標記 vaultNote 供 formatter 生成 wikilink
  if (content.linkedContent?.length) {
    await Promise.allSettled(
      content.linkedContent.map(async (link) => {
        const existing = await isDuplicateUrl(link.url, config.vaultPath);
        if (existing) link.vaultNote = basename(existing, '.md');
      }),
    );
  }

  // 將連結頁面全文注入 AI 輸入，讓 AI 可以分析連結內容
  let enrichTextWithLinks = enrichText;
  const linkedWithText = (content.linkedContent ?? []).filter(l => l.fullText);
  if (linkedWithText.length > 0) {
    const injected = linkedWithText
      .map(l => `[連結文章內容: ${l.title}]\n${l.fullText!.slice(0, 2000)}`)
      .join('\n\n');
    enrichTextWithLinks = `${enrichText}\n\n${injected}`;
    logger.info('enricher', '注入連結全文', { links: linkedWithText.length });
  }

  const hasLinkedContent = (content.linkedContent?.length ?? 0) > 0;

  // Phase 2: AI 豐富化 與 翻譯並行（翻譯不依賴連結內容）
  const [enriched] = await Promise.all([
    enrichContent(cleanedTitle, enrichTextWithLinks, hints, content.platform, hasLinkedContent, hasTimedTranscript ? timedTranscriptText : undefined),
    runPostTranslation(content, { translate: config.enableTranslation }).catch((err: Error) => {
      logger.warn('post-process', '翻譯失敗', { message: err.message });
    }),
  ]);

  if (enriched.keywords) content.enrichedKeywords = enriched.keywords;
  if (enriched.summary) content.enrichedSummary = enriched.summary;
  if (enriched.analysis) content.enrichedAnalysis = enriched.analysis;
  if (enriched.keyPoints?.length) content.enrichedKeyPoints = enriched.keyPoints;
  if (enriched.title) content.title = enriched.title;
  // enricher 的分類建議轉為語意 tag，不覆蓋 category（固定為 inbox）
  if (enriched.category) {
    content.suggestedTags = [enriched.category, ...(content.suggestedTags ?? [])];
  }
  if (enriched.githubAnalysis) content.githubAnalysis = enriched.githubAnalysis;
  // AI-generated chapters (only when no platform-native chapters exist)
  if (!content.chapters && enriched.chapters?.length) content.chapters = enriched.chapters;
  if (enriched.predictions?.length) content.predictions = enriched.predictions;

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

  // Action suggestion: fire-and-forget, must not block pipeline
  suggestAction(
    config.vaultPath,
    content.title,
    content.category,
    content.enrichedKeywords ?? [],
    content.enrichedSummary ?? '',
  ).catch(() => { /* silent fallback */ });
}
