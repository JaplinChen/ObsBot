/** Local LLM enrichment for keywords/summary/title/category generation. */

import { logger } from '../core/logger.js';
import { runLocalLlmPrompt, type ModelTier } from '../utils/local-llm.js';
import { cleanTitle } from '../utils/content-cleaner.js';
// @ts-expect-error opencc-js lacks proper TS declarations
import * as OpenCC from 'opencc-js';

/** Simplified → Traditional Chinese converter (deterministic, local). */
const s2tw: (text: string) => string = OpenCC.ConverterFactory(
  OpenCC.Locale.from.cn,
  OpenCC.Locale.to.tw,
);

export interface EnrichResult {
  keywords: string[] | null;
  summary: string | null;
  analysis: string | null;
  keyPoints: string[] | null;
  title?: string;
  category?: string;
  /** Deep analysis for GitHub projects (use cases, comparison, pros/cons) */
  githubAnalysis?: string;
}

function normalizeCategory(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return v.slice(0, 40);
}

/** Pick model tier based on content length and platform. */
function selectModelTier(textLen: number, hasTranscript: boolean, platform?: string): ModelTier {
  // GitHub READMEs need deep analysis regardless of length
  if (platform === 'github') return 'deep';
  if (hasTranscript || textLen > 1000) return 'deep';
  if (textLen < 300) return 'flash';
  return 'standard';
}

/** Build GitHub-specific prompt additions */
function buildGithubPrompt(): string[] {
  return [
    '',
    '=== GitHub 項目專屬分析指令 ===',
    'JSON 需額外包含 githubAnalysis 欄位（字串，繁體中文，300-500字）。',
    'githubAnalysis 必須包含以下結構（用 markdown 格式）：',
    '### 項目用途',
    '一段話說明這個項目解決什麼問題、目標使用者是誰。',
    '### 技術棧與架構',
    '列出主要技術、框架、語言，說明架構特色。',
    '### 核心功能',
    '3-5 條最重要的功能，每條一句話。',
    '### 同類工具對比',
    '列出 2-3 個替代方案，各用一句話說明差異。',
    '格式：「vs {工具名}：{差異描述}」',
    '### 適合場景',
    '說明最適合哪類開發者或使用場景，以及不適合的場景。',
    '### 優缺點',
    '各列 2-3 條具體優缺點。',
    '',
    '注意：githubAnalysis 的所有內容必須基於 README 和項目描述推斷，不可臆造。',
    '如果 README 資訊不足以推斷某個部分，明確標注「資訊不足」。',
  ];
}

const NULL_RESULT: EnrichResult = { keywords: null, summary: null, analysis: null, keyPoints: null };

/**
 * Enrich content with local LLM-generated metadata.
 * Auto-routes to the best free model based on content complexity.
 * Falls back silently to null fields on any error.
 */
export async function enrichContent(
  title: string,
  text: string,
  categoryHints: string[],
  platform?: string,
): Promise<EnrichResult> {
  const isGithub = platform === 'github';
  const previewLimit = isGithub ? 2500 : 1200;
  const textPreview = text.slice(0, previewLimit).replace(/\n/g, ' ');
  const hints = categoryHints.slice(0, 8).join(', ');
  const hasTranscript = text.includes('文字稿：') || text.includes('[Transcript]');
  const tier = selectModelTier(text.length, hasTranscript, platform);
  const cleanedTitle = cleanTitle(title);
  logger.info('enricher', 'model-route', { tier, textLen: text.length, hasTranscript, platform });

  const jsonKeys = isGithub
    ? 'keywords, summary, analysis, keyPoints, title, category, githubAnalysis'
    : 'keywords, summary, analysis, keyPoints, title, category';

  const prompt = [
    'You are a strict JSON generator for content enrichment.',
    `Return ONLY valid JSON with keys: ${jsonKeys}.`,
    'keywords: array of up to 5 concise keywords.',
    'All text output MUST be Traditional Chinese (zh-TW).',
    'CRITICAL: 必須過濾掉原文中的廢話、語助詞、誇張修飾、廣告話術。',
    '禁止出現：感嘆詞(哇靠/天啊)、誇張語(太震撼/巨好用/猛到不真實)、催促語(趕快/必須馬上)、按讚轉發數據。',
    '只保留可驗證的事實、具體工具名、操作步驟、技術細節。',
    'summary: <= 120字，客觀陳述核心主題與實用價值，語氣中性專業。',
    'analysis: 2-4句，引用內容中的具體做法/技術細節，不引用情緒語言。',
    'keyPoints: 3-5條，每條<=24字，必須可執行或可驗證，不可出現泛用模板語或推銷語。',
    'title: 格式「{工具或概念名}-{簡短描述}」，<=40字，語意清楚，不要作者前綴，不要感嘆號。',
    '例：「Kaku-整合AI的深度定製終端」「Symphony-AI自動完成CI和PR」「Obsidian-雙向連結筆記管理工具」',
    'If content is insufficient, state what is missing briefly instead of inventing.',
    ...(isGithub ? buildGithubPrompt() : []),
    hints ? `Category hints: ${hints}` : '',
    `Original title: ${cleanedTitle}`,
    `Content: ${textPreview}`,
  ].filter(Boolean).join('\n');

  try {
    const responseText = await runLocalLlmPrompt(prompt, { timeoutMs: 90_000, model: tier });
    if (!responseText) return NULL_RESULT;

    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) return NULL_RESULT;

    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    // 確保所有文字欄位為繁體中文（LLM 可能回傳簡體）
    return {
      keywords: Array.isArray(parsed.keywords)
        ? (parsed.keywords.filter((v): v is string => typeof v === 'string').slice(0, 5).map(s2tw))
        : null,
      summary: typeof parsed.summary === 'string' ? s2tw(parsed.summary) : null,
      analysis: typeof parsed.analysis === 'string' ? s2tw(parsed.analysis) : null,
      keyPoints: Array.isArray(parsed.keyPoints)
        ? (parsed.keyPoints.filter((v): v is string => typeof v === 'string').slice(0, 5).map(s2tw))
        : null,
      title: typeof parsed.title === 'string' ? s2tw(parsed.title).slice(0, 40) : undefined,
      category: normalizeCategory(parsed.category),
      githubAnalysis: typeof parsed.githubAnalysis === 'string' ? s2tw(parsed.githubAnalysis) : undefined,
    };
  } catch {
    return NULL_RESULT;
  }
}
