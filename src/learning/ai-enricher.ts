/** Local LLM enrichment for keywords/summary/title/category generation. */

import { logger } from '../core/logger.js';
import { runLocalLlmPrompt, type ModelTier } from '../utils/local-llm.js';
import { cleanTitle } from '../utils/content-cleaner.js';
import { buildGithubPrompt, buildChapterPrompt, buildLinkedContentPrompt, buildPredictionPrompt } from './ai-enricher-prompts.js';
// @ts-expect-error opencc-js lacks proper TS declarations
import * as OpenCC from 'opencc-js';

/** Simplified → Traditional Chinese converter (deterministic, local). */
const s2tw: (text: string) => string = OpenCC.ConverterFactory(
  OpenCC.Locale.from.cn,
  OpenCC.Locale.to.tw,
);

import type { ChapterInfo } from '../extractors/types.js';

export interface PredictionRaw {
  text: string;
  confidence: number;
  deadline: string;
}

export interface EnrichResult {
  keywords: string[] | null;
  summary: string | null;
  analysis: string | null;
  keyPoints: string[] | null;
  title?: string;
  category?: string;
  /** Deep analysis for GitHub projects (use cases, comparison, pros/cons) */
  githubAnalysis?: string;
  /** AI-generated chapters from timed transcript */
  chapters?: ChapterInfo[];
  /** 1-2 testable predictions for cognitive calibration */
  predictions?: PredictionRaw[];
}

function normalizeCategory(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return v.slice(0, 40);
}

/** Pick model tier based on content length, platform, and linked content. */
function selectModelTier(textLen: number, hasTranscript: boolean, platform?: string, hasLinkedContent?: boolean): ModelTier {
  // GitHub: deep only for substantial READMEs; short descriptions use standard
  if (platform === 'github') return textLen > 800 ? 'deep' : 'standard';
  // Linked content: deep for rich context, standard for light context
  if (hasLinkedContent) return textLen > 1500 ? 'deep' : 'standard';
  // Transcripts: deep for substantial transcripts, standard for short ones
  if (hasTranscript) return textLen > 800 ? 'deep' : 'standard';
  // Length-based fallback
  if (textLen > 1000) return 'deep';
  if (textLen < 300) return 'flash';
  return 'standard';
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
  hasLinkedContent?: boolean,
  timedTranscriptText?: string,
): Promise<EnrichResult> {
  const isGithub = platform === 'github';
  // Expand preview limit when linked content is embedded in text
  const previewLimit = isGithub ? 2500 : hasLinkedContent ? 3500 : 1200;
  const textPreview = text.slice(0, previewLimit).replace(/\n/g, ' ');
  const hints = categoryHints.slice(0, 8).join(', ');
  const hasTranscript = text.includes('文字稿：') || text.includes('[Transcript]');
  const tier = selectModelTier(text.length, hasTranscript, platform, hasLinkedContent);
  const cleanedTitle = cleanTitle(title);
  logger.info('enricher', 'model-route', { tier, textLen: text.length, hasTranscript, platform, hasLinkedContent });

  const hasChapterRequest = !!timedTranscriptText;
  // Generate predictions only for substantive content (not flash-tier trivial posts)
  const wantPredictions = tier !== 'flash' && text.length > 400;
  // 薄內容（原文 < 300 字）跳過 analysis，避免 LLM 複述 summary
  const isThinContent = text.length < 300;
  const jsonKeys = isGithub
    ? 'keywords, summary, analysis, keyPoints, title, category, githubAnalysis'
    : hasChapterRequest
      ? 'keywords, summary, analysis, keyPoints, title, category, chapters'
      : wantPredictions
        ? 'keywords, summary, analysis, keyPoints, title, category, predictions'
        : isThinContent
          ? 'keywords, summary, keyPoints, title, category'
          : 'keywords, summary, analysis, keyPoints, title, category';

  const chapterPrompt = hasChapterRequest ? buildChapterPrompt(timedTranscriptText!) : [];
  const linkedContentPrompt = hasLinkedContent ? buildLinkedContentPrompt() : [];
  const predictionPrompt = (wantPredictions && !isGithub && !hasChapterRequest)
    ? buildPredictionPrompt()
    : [];

  const prompt = [
    'CAVEMAN RULE: Output ONLY the JSON object. No text before {. No text after }. No "Sure", no "Here is", no explanation.',
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
    'CRITICAL: summary / analysis / keyPoints 三個欄位絕對不可出現相同的句子或重複的描述。每個欄位必須提供不同維度的資訊：summary 說「是什麼」，analysis 說「怎麼做/技術原理」，keyPoints 說「能對用戶帶來什麼具體行動」。若原文內容不足以填充三個欄位，analysis 可縮短至 1 句，keyPoints 可減至 2 條，但不可直接複述 summary 的文字。',
    'title: 格式「{工具或概念名}-{簡短描述}」，<=40字，語意清楚，不要作者前綴，不要感嘆號。',
    '例：「Kaku-整合AI的深度定製終端」「Symphony-AI自動完成CI和PR」「Obsidian-雙向連結筆記管理工具」',
    'If content is insufficient, state what is missing briefly instead of inventing.',
    ...(isGithub ? buildGithubPrompt() : []),
    ...linkedContentPrompt,
    ...chapterPrompt,
    ...predictionPrompt,
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
      chapters: Array.isArray(parsed.chapters)
        ? parsed.chapters
            .filter((ch): ch is Record<string, unknown> => typeof ch === 'object' && ch !== null)
            .map(ch => ({
              startTime: typeof ch.startTime === 'string' ? ch.startTime : '00:00',
              title: typeof ch.title === 'string' ? s2tw(ch.title).slice(0, 20) : '',
              summary: typeof ch.summary === 'string' ? s2tw(ch.summary).slice(0, 40) : undefined,
            }))
            .filter(ch => ch.title.length > 0)
            .slice(0, 8)
        : undefined,
      predictions: Array.isArray(parsed.predictions)
        ? parsed.predictions
            .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
            .map(p => ({
              text: typeof p.text === 'string' ? s2tw(p.text).slice(0, 50) : '',
              confidence: typeof p.confidence === 'number'
                ? Math.min(0.95, Math.max(0.3, p.confidence))
                : 0.6,
              deadline: typeof p.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline)
                ? p.deadline
                : new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10),
            }))
            .filter(p => p.text.length > 5)
            .slice(0, 2)
        : undefined,
    };
  } catch {
    return NULL_RESULT;
  }
}

/* ── Generator: targeted field regeneration (Harness pattern) ────── */

interface FixInstruction {
  field: string;
  instruction: string;
}

/**
 * Regenerate specific fields based on Evaluator feedback.
 * Only regenerates the fields flagged by the Evaluator, with targeted prompts
 * that include the Evaluator's specific improvement instructions.
 */
export async function regenerateFields(
  title: string,
  text: string,
  currentOutput: Partial<EnrichResult>,
  fixInstructions: FixInstruction[],
): Promise<Partial<EnrichResult>> {
  const fields = fixInstructions.map(i => i.field);
  const instructionText = fixInstructions
    .map(i => `- ${i.field}：${i.instruction}`)
    .join('\n');

  const currentValues = fields.map(f => {
    const val = currentOutput[f as keyof EnrichResult];
    return `- ${f}：${Array.isArray(val) ? val.join(', ') : val ?? '（空）'}`;
  }).join('\n');

  const prompt = [
    'CAVEMAN RULE: Output ONLY the JSON object. No text before {. No text after }.',
    '你是內容修復器（Generator）。Evaluator 發現以下欄位品質不足，請根據指令重新生成。',
    '',
    `標題：${title}`,
    `原始內容：${text.slice(0, 1200)}`,
    '',
    '當前輸出（需要改善）：',
    currentValues,
    '',
    'Evaluator 的改善指令：',
    instructionText,
    '',
    `以 JSON 格式回覆，只包含需要修正的欄位（${fields.join(', ')}）：`,
    '注意：所有文字必須用繁體中文。摘要 ≤120字，關鍵字 3-5 個，分析 2-4 句有具體細節。',
  ].join('\n');

  try {
    const raw = await runLocalLlmPrompt(prompt, { timeoutMs: 30_000, task: 'summarize' });
    if (!raw) return {};

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};

    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const result: Partial<EnrichResult> = {};
    if (typeof parsed.summary === 'string') result.summary = s2tw(parsed.summary);
    if (Array.isArray(parsed.keywords)) {
      result.keywords = parsed.keywords
        .filter((v): v is string => typeof v === 'string')
        .slice(0, 5)
        .map(s2tw);
    }
    if (typeof parsed.analysis === 'string') result.analysis = s2tw(parsed.analysis);
    if (Array.isArray(parsed.keyPoints)) {
      result.keyPoints = parsed.keyPoints
        .filter((v): v is string => typeof v === 'string')
        .slice(0, 5)
        .map(s2tw);
    }
    return result;
  } catch {
    return {};
  }
}
