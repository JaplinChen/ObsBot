/**
 * Language detection + translation for non-Traditional-Chinese content.
 * - zh-CN -> zh-TW: opencc-js (deterministic, local)
 * - en -> zh-TW: oMLX (local, fast) → opencode CLI (remote, fallback)
 */

import type { TranslationResult } from '../extractors/types.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { isOmlxAvailable, omlxChatCompletion } from '../utils/omlx-client.js';
// @ts-expect-error opencc-js lacks proper TS declarations
import * as OpenCC from 'opencc-js';

const s2tw = OpenCC.ConverterFactory(
  OpenCC.Locale.from.cn,
  OpenCC.Locale.to.tw,
);

const SC_CHARS = /[简体国这会时点里为后发当]/g;
const TC_CHARS = /[繁體國這會時點裡為後發當]/g;

type DetectedLang = TranslationResult['detectedLanguage'];

export function detectLanguage(sample: string): DetectedLang {
  const compact = [...sample].filter((c) => !/\s/.test(c));
  const asciiCount = compact.filter((c) => c.charCodeAt(0) < 128).length;
  const asciiRatio = compact.length > 0 ? asciiCount / compact.length : 0;
  if (asciiRatio > 0.85) return 'en';

  const scCount = (sample.match(SC_CHARS) ?? []).length;
  const tcCount = (sample.match(TC_CHARS) ?? []).length;

  if (scCount > 0 || tcCount > 0) {
    if (scCount > tcCount * 1.5) return 'zh-CN';
    if (tcCount >= scCount) return 'zh-TW';
  }

  return 'other';
}

function convertSimplifiedToTraditional(title: string, text: string): TranslationResult {
  return {
    detectedLanguage: 'zh-CN',
    translatedText: s2tw(text),
    translatedTitle: s2tw(title),
  };
}

function buildTranslationPrompt(title: string, text: string): string {
  const textToTranslate = text.length > 6000 ? text.slice(0, 6000) : text;
  return [
    'Translate the following English content to Traditional Chinese (zh-TW).',
    'Return ONLY valid JSON with keys: translatedTitle, translatedText.',
    `Title: ${title}`,
    `Text: ${textToTranslate}`,
  ].join('\n');
}

function parseTranslationResponse(response: string): TranslationResult | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { translatedTitle?: unknown; translatedText?: unknown };
    if (typeof parsed.translatedText !== 'string') return null;
    return {
      detectedLanguage: 'en',
      translatedText: parsed.translatedText,
      translatedTitle: typeof parsed.translatedTitle === 'string' ? parsed.translatedTitle : undefined,
    };
  } catch {
    return null;
  }
}

async function translateEnglishWithLocalLlm(
  title: string,
  text: string,
): Promise<TranslationResult | null> {
  const prompt = buildTranslationPrompt(title, text);

  // 1) Try oMLX (local, ~2-5s; 12s cap so CLI fallback fits within 45s post-process timeout)
  if (await isOmlxAvailable()) {
    const omlxResponse = await omlxChatCompletion(prompt, { timeoutMs: 12_000 });
    if (omlxResponse) {
      const result = parseTranslationResponse(omlxResponse);
      if (result) return result;
    }
  }

  // 2) Fallback to opencode CLI (remote)
  const response = await runLocalLlmPrompt(prompt, { timeoutMs: 30_000 });
  if (!response) return null;
  return parseTranslationResponse(response);
}

export async function translateIfNeeded(
  title: string,
  text: string,
): Promise<TranslationResult | null> {
  const sample = (title + ' ' + text).slice(0, 500);
  const lang = detectLanguage(sample);

  if (lang === 'zh-CN') return convertSimplifiedToTraditional(title, text);
  if (lang === 'en') return translateEnglishWithLocalLlm(title, text);
  return null;
}

/**
 * Translate body content (e.g. GitHub README) to Traditional Chinese.
 * Returns translated string or null if already zh-TW or translation fails.
 */
export async function translateBodyIfNeeded(body: string): Promise<string | null> {
  const lang = detectLanguage(body.slice(0, 500));
  if (lang === 'zh-TW' || lang === 'other') return null;
  if (lang === 'zh-CN') return s2tw(body);

  // English → zh-TW via LLM
  const result = await translateEnglishWithLocalLlm('', body);
  return result?.translatedText ?? null;
}
