/** Local LLM enrichment for keywords/summary/title/category generation. */

import { runLocalLlmPrompt } from '../utils/local-llm.js';

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
    'summary: <= 120字，必須點出影片核心主題與受眾價值，不可只重述數據。',
    'analysis: 2-4句，必須引用內容中的具體做法/觀點/步驟，避免空泛建議。',
    'keyPoints: 3-5條，每條<=24字，必須可執行或可驗證，不可出現泛用模板語。',
    'title: <= 50字，語意清楚，不要作者前綴。',
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

    return {
      keywords: Array.isArray(parsed.keywords)
        ? (parsed.keywords.filter((v): v is string => typeof v === 'string').slice(0, 5))
        : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : null,
      keyPoints: Array.isArray(parsed.keyPoints)
        ? (parsed.keyPoints.filter((v): v is string => typeof v === 'string').slice(0, 5))
        : null,
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 50) : undefined,
      category: normalizeCategory(parsed.category),
    };
  } catch {
    return { keywords: null, summary: null, analysis: null, keyPoints: null };
  }
}
