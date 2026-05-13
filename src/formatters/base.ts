import type { ExtractedContent } from '../extractors/types.js';
import type { PlatformFormatter } from './types.js';
import {
  buildFrontmatter,
  buildLinkedContent,
  buildStats,
  buildComments,
  buildImageDescriptions,
} from './shared.js';
import { cleanAdSpeak, stripPromoBlocks } from '../utils/content-cleaner.js';
import { reformatBody } from './body-reformatter.js';
import { isLikelyStatsLine, splitSentences, toPlainText } from './text-utils.js';

function stripStatsPrefix(input: string): string {
  return input
    .replace(/\*\*Duration:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/\*\*Stats:\*\*.*(?:\r?\n|$)/gi, ' ')
    .replace(/Duration:\s*\d+:\d{2}.*?(?=\s{2,}|$)/gi, ' ')
    .replace(/Stats:\s*Views:.*?(?=\s{2,}|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectContentSentences(content: ExtractedContent, displayText: string): string[] {
  const transcriptSentences = splitSentences(content.transcript ?? '')
    .filter((s) => s.length >= 10 && !isLikelyStatsLine(s));
  if (transcriptSentences.length > 0) return transcriptSentences;

  return splitSentences(stripStatsPrefix(toPlainText(displayText)))
    .filter((s) => s.length >= 10 && !isLikelyStatsLine(s));
}

/**
 * 判斷兩個欄位是否高度重複。
 * 用字元集合覆蓋率：若 b 的 70% 字元都出現在 a 的滑動視窗中，視為重複。
 * 故意使用輕量字串比對，避免引入外部依賴。
 */
function isDuplicateContent(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s.replace(/[，。！？、：；\s]/g, '').toLowerCase();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  // 子字串包含：其中一方完全被另一方涵蓋
  if (na.includes(nb) || nb.includes(na)) return true;
  // 字元 n-gram 覆蓋率：用 3-gram 判斷
  const ngrams = (s: string, n: number): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n));
    return set;
  };
  const gA = ngrams(na, 3);
  const gB = ngrams(nb, 3);
  if (gB.size === 0) return false;
  let overlap = 0;
  for (const g of gB) if (gA.has(g)) overlap++;
  return overlap / gB.size > 0.7;
}

function looksGeneric(input: string): boolean {
  const text = input.trim();
  if (!text) return true;
  const genericPhrases = [
    '先掌握影片核心主題',
    '整理可立即執行的步驟',
    '回看原片驗證關鍵細節',
    '建議先看重點整理',
    '影片已完成擷取',
    '影片已下載並附加到筆記',
  ];
  return genericPhrases.some((p) => text.includes(p));
}

function isReadableText(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (/[�]|嚙|銝|蝯|撌亙||/.test(text)) return false;

  const compact = text.replace(/\s+/g, '');
  if (!compact) return false;

  const safeChars = (compact.match(/[A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af.,!?;:()\[\]{}'"`~@#$%^&*+\-_=\\/|]/g) ?? []).length;
  return safeChars / compact.length >= 0.6;
}

/** 在標點或空格邊界處截斷，避免句子斷在詞中間 */
function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const last = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('！'),
    cut.lastIndexOf('？'), cut.lastIndexOf('；'), cut.lastIndexOf(' '));
  return last > maxLen * 0.4 ? cut.slice(0, last + 1) : cut;
}

function fallbackSummary(content: ExtractedContent, displayText: string): string {
  const sentences = collectContentSentences(content, displayText);
  if (sentences.length > 0) {
    return truncateAtBoundary(sentences.slice(0, 3).join('。'), 200);
  }
  return '';
}

function fallbackAnalysis(): string {
  // Intentionally empty: without LLM enrichment, displaying raw sentence fragments
  // as "analysis" produces low-quality formulaic output worse than no section at all.
  // Articles without enrichedAnalysis simply omit the ## 內容分析 section.
  return '';
}

function fallbackKeyTakeaways(content: ExtractedContent, displayText: string): string[] {
  return collectContentSentences(content, displayText)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && isReadableText(s) && !looksGeneric(s))
    .slice(0, 5)
    .map((s) => truncateAtBoundary(s, 60).replace(/[。.!?]+$/g, ''));
}

export function assembleNote(
  content: ExtractedContent,
  localImagePaths: string[],
  localVideoPaths: string[],
  imageUrlMap: Map<string, string> | undefined,
  formatter: PlatformFormatter,
): string {
  const t = content.translation;
  const displayTitle = t?.translatedTitle ?? content.title;
  const displayText = t ? t.translatedText : content.text;

  const lines: string[] = [
    ...buildFrontmatter(content, displayTitle, displayText),
    '',
    `> **${content.authorHandle}** | ${content.date}`,
    '',
  ];

  if (t) {
    const langLabel: Record<string, string> = {
      en: 'English',
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      ja: 'Japanese',
      ko: 'Korean',
      other: 'Other',
    };
    lines.push(`> Translated from: ${langLabel[t.detectedLanguage] ?? 'Other'}`, '');
  }

  const { text: rawBodyText, usedPaths, inlinedVideoIndices: bodyInlinedVideos } = formatter.formatBody(displayText, imageUrlMap, localVideoPaths, content.videos);
  const bodyText = reformatBody(stripPromoBlocks(cleanAdSpeak(rawBodyText)));
  lines.push(bodyText, '');

  const cleanSummary = content.enrichedSummary
    && isReadableText(content.enrichedSummary)
    && !looksGeneric(content.enrichedSummary)
    ? content.enrichedSummary
    : fallbackSummary(content, displayText);
  if (cleanSummary) {
    lines.push('## 重點摘要', '', cleanSummary.slice(0, 300).replace(/\n/g, ' ').trim(), '');
  }

  const rawAnalysis = content.enrichedAnalysis
    && isReadableText(content.enrichedAnalysis)
    && !looksGeneric(content.enrichedAnalysis)
    ? content.enrichedAnalysis
    : fallbackAnalysis();
  // 若 analysis 與 summary 高度重複則不渲染，避免三個 section 複述同一句話
  const cleanAnalysis = rawAnalysis && cleanSummary && isDuplicateContent(cleanSummary, rawAnalysis)
    ? null
    : rawAnalysis;
  if (cleanAnalysis) {
    lines.push('## 內容分析', '', cleanAnalysis.replace(/\n/g, ' ').trim(), '');
  }

  const cleanKeyPoints = (content.enrichedKeyPoints ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isReadableText(s))
    .slice(0, 5);
  const keyTakeaways = cleanKeyPoints.length > 0 ? cleanKeyPoints : fallbackKeyTakeaways(content, displayText);
  if (keyTakeaways.length > 0) {
    lines.push('## 重點整理（條列）', '');
    for (const point of keyTakeaways) lines.push(`- ${point}`);
    lines.push('');
  }

  lines.push(...buildImageDescriptions(content.imageDescriptions));

  if (content.embeddedVideoTranscripts?.length) {
    lines.push('## 內嵌影片逐字稿', '');
    for (const v of content.embeddedVideoTranscripts) {
      lines.push(`**[${v.url}](${v.url})**`, '');
      lines.push(v.transcript.slice(0, 1500) + (v.transcript.length > 1500 ? '…' : ''), '');
    }
  }

  lines.push(...formatter.extraSections(content));
  lines.push(...buildLinkedContent(content.linkedContent));

  const remainingImages = formatter.filterRemainingImages(localImagePaths, usedPaths);
  if (remainingImages.length > 0) {
    lines.push('## Images', '');
    for (const imgPath of remainingImages) lines.push(`![](${imgPath})`, '');
  }

  const inlinedVideoIndices = new Set<number>(bodyInlinedVideos);
  for (let i = 0; i < localVideoPaths.length; i++) {
    if (usedPaths.has(localVideoPaths[i])) inlinedVideoIndices.add(i);
  }
  const remainingVideos = content.videos.filter((_, i) => !inlinedVideoIndices.has(i));
  const remainingVideoPaths = localVideoPaths.filter((_, i) => !inlinedVideoIndices.has(i));
  const videoLines = formatter.formatVideos(remainingVideos, remainingVideoPaths);
  if (videoLines.length > 0) lines.push('## Videos', '', ...videoLines);

  lines.push(...buildStats(content.reposts));
  lines.push(...buildComments(content.comments, content.commentCount));

  const category = content.category ?? 'other';
  const categoryLink = category.replace(/\//g, '-');
  lines.push(`Category: [[${categoryLink}]]`, '');
  lines.push(`[View original](${content.url})`, '');

  const result = lines.join('\n');
  // Defensive: ensure frontmatter closing --- is on its own line
  return result.replace(/^(---\n[\s\S]*?\n)(---)(>|\*|[^\n])/m, '$1$2\n\n$3');
}
