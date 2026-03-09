/** Local LLM enrichment for keywords/summary/title/category generation. */

import { runLocalLlmPrompt } from '../utils/local-llm.js';
// @ts-expect-error opencc-js lacks proper TS declarations
import * as OpenCC from 'opencc-js';

/** Simplified → Traditional Chinese converter (deterministic, local). */
const s2tw: (text: string) => string = OpenCC.ConverterFactory(
  OpenCC.Locale.from.cn,
  OpenCC.Locale.to.tw,
);

interface EnrichResult {
  keywords: string[] | null;
  summary: string | null;
  analysis: string | null;
  keyPoints: string[] | null;
  title?: string;
  category?: string;
}

function normalizeCategory(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  return v.slice(0, 40);
}

/**
 * Enrich content with local LLM-generated metadata.
 * Falls back silently to null fields on any error.
 */
export async function enrichContent(
  title: string,
  text: string,
  categoryHints: string[],
  _apiKey?: string,
): Promise<EnrichResult> {
  const textPreview = text.slice(0, 1200).replace(/\n/g, ' ');
  const hints = categoryHints.slice(0, 8).join(', ');

  const prompt = [
    'You are a strict JSON generator for content enrichment.',
    'Return ONLY valid JSON with keys: keywords, summary, analysis, keyPoints, title, category.',
    'keywords: array of up to 5 concise keywords.',
    'All text output MUST be Traditional Chinese (zh-TW).',
    'CRITICAL: 必須過濾掉原文中的廢話、語助詞、誇張修飾、廣告話術。',
    '禁止出現：感嘆詞(哇靠/天啊)、誇張語(太震撼/巨好用/猛到不真實)、催促語(趕快/必須馬上)、按讚轉發數據。',
    '只保留可驗證的事實、具體工具名、操作步驟、技術細節。',
    'summary: <= 120字，客觀陳述核心主題與實用價值，語氣中性專業。',
    'analysis: 2-4句，引用內容中的具體做法/技術細節，不引用情緒語言。',
    'keyPoints: 3-5條，每條<=24字，必須可執行或可驗證，不可出現泛用模板語或推銷語。',
    'title: <= 50字，語意清楚，不要作者前綴，不要感嘆號。',
    'If content is insufficient, state what is missing briefly instead of inventing.',
    hints ? `Category hints: ${hints}` : '',
    `Original title: ${title}`,
    `Content: ${textPreview}`,
  ].filter(Boolean).join('\n');

  try {
    const responseText = await runLocalLlmPrompt(prompt, { timeoutMs: 30_000 });
    if (!responseText) {
      return { keywords: null, summary: null, analysis: null, keyPoints: null };
    }

    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) {
      return { keywords: null, summary: null, analysis: null, keyPoints: null };
    }

    const parsed = JSON.parse(match[0]) as {
      keywords?: unknown;
      summary?: unknown;
      analysis?: unknown;
      keyPoints?: unknown;
      title?: unknown;
      category?: unknown;
    };

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
      title: typeof parsed.title === 'string' ? s2tw(parsed.title).slice(0, 50) : undefined,
      category: normalizeCategory(parsed.category),
    };
  } catch {
    return { keywords: null, summary: null, analysis: null, keyPoints: null };
  }
}
