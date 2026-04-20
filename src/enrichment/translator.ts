/**
 * Language detection + translation for non-Traditional-Chinese content.
 * - zh-CN -> zh-TW: opencc-js (deterministic, local)
 * - en -> zh-TW: unified LLM routing (oMLX → OpenCode → DDG)
 */

import type { TranslationResult } from '../extractors/types.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
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

const ESCAPE_MAP: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f',
};

function decodeJsonString(raw: string): string {
  return raw.replace(/\\(.)/g, (_, ch: string) => ESCAPE_MAP[ch] ?? ch);
}

/** 處理 JSON.parse 成功後 translatedText 可能仍是嵌套 JSON 的情況 */
function unwrapTranslatedText(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.trimStart().startsWith('{')) {
    try {
      const inner = JSON.parse(raw) as { translatedText?: unknown };
      if (typeof inner.translatedText === 'string' && inner.translatedText.length > 0) {
        return inner.translatedText;
      }
    } catch { /* fall through */ }
  }
  return raw;
}

/**
 * 位置定位法：不依賴 JSON.parse，直接從 JSON 塊中提取 translatedText / translatedTitle。
 * 可容忍無效逃逸、未逃逸引號、literal 控制字元等常見 LLM 輸出問題。
 */
function extractFromMalformedJson(
  jsonBlock: string,
): { translatedText: string; translatedTitle?: string } | null {
  const TEXT_KEY = '"translatedText"';
  const textKeyIdx = jsonBlock.indexOf(TEXT_KEY);
  if (textKeyIdx === -1) return null;

  // 找 translatedText 值的開頭引號
  let valueStart = textKeyIdx + TEXT_KEY.length;
  while (valueStart < jsonBlock.length && /[ \t:]/.test(jsonBlock[valueStart])) valueStart++;
  if (jsonBlock[valueStart] !== '"') return null;
  valueStart++;

  // 從塊末尾倒推找閉合引號（允許末尾多一個 `]`）
  let blockEnd = jsonBlock.length - 1; // `}`
  while (blockEnd > 0 && /\s/.test(jsonBlock[blockEnd - 1])) blockEnd--;
  if (jsonBlock[blockEnd - 1] === ']') {
    blockEnd--;
    while (blockEnd > 0 && /\s/.test(jsonBlock[blockEnd - 1])) blockEnd--;
  }
  if (jsonBlock[blockEnd - 1] !== '"') return null;
  const valueEnd = blockEnd - 1;

  const translatedText = decodeJsonString(jsonBlock.slice(valueStart, valueEnd));
  if (!translatedText) return null;

  // 嘗試提取 translatedTitle（位於 translatedText 之前）
  const TITLE_KEY = '"translatedTitle"';
  const titleKeyIdx = jsonBlock.indexOf(TITLE_KEY);
  let translatedTitle: string | undefined;
  if (titleKeyIdx !== -1 && titleKeyIdx < textKeyIdx) {
    let titleStart = titleKeyIdx + TITLE_KEY.length;
    while (titleStart < jsonBlock.length && /[ \t:]/.test(jsonBlock[titleStart])) titleStart++;
    if (jsonBlock[titleStart] === '"') {
      titleStart++;
      const commaIdx = jsonBlock.indexOf('",', titleStart);
      const newlineIdx = jsonBlock.indexOf('"\n', titleStart);
      let titleEnd = -1;
      if (commaIdx !== -1 && newlineIdx !== -1) titleEnd = Math.min(commaIdx, newlineIdx);
      else if (commaIdx !== -1) titleEnd = commaIdx;
      else if (newlineIdx !== -1) titleEnd = newlineIdx;
      if (titleEnd !== -1) {
        translatedTitle = decodeJsonString(jsonBlock.slice(titleStart, titleEnd));
      }
    }
  }

  return { translatedText, translatedTitle };
}

function parseTranslationResponse(response: string): TranslationResult | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (match) {
    // 第一次嘗試：標準 JSON.parse
    try {
      const parsed = JSON.parse(match[0]) as { translatedTitle?: unknown; translatedText?: unknown };
      const translatedText = unwrapTranslatedText(parsed.translatedText);
      if (translatedText) {
        return {
          detectedLanguage: 'en',
          translatedText,
          translatedTitle: typeof parsed.translatedTitle === 'string' ? parsed.translatedTitle : undefined,
        };
      }
    } catch { /* fall through to position-based */ }

    // 第二次嘗試：位置定位法（容忍不合規 JSON）
    const extracted = extractFromMalformedJson(match[0]);
    if (extracted?.translatedText) {
      return {
        detectedLanguage: 'en',
        translatedText: extracted.translatedText,
        translatedTitle: extracted.translatedTitle,
      };
    }
  }

  // 最終 fallback：opencode / DDG 直接回傳純文字翻譯（非 JSON 格式）
  const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const trimmed = response.trim();
  if (!trimmed.startsWith('{') && CJK_RE.test(trimmed) && trimmed.length > 20) {
    return {
      detectedLanguage: 'en',
      translatedText: trimmed,
      translatedTitle: undefined,
    };
  }

  return null;
}

async function translateEnglishWithLocalLlm(
  title: string,
  text: string,
): Promise<TranslationResult | null> {
  const prompt = buildTranslationPrompt(title, text);
  // Short translations (title-only or brief text) use flash; longer ones use standard
  const totalLen = title.length + text.length;
  const tier = totalLen < 500 ? 'flash' : 'standard';
  // 120s for standard: Qwen3.5-9B 翻譯長文（6000 chars）需要 60-90s，60s 太容易超時
  const timeoutMs = tier === 'flash' ? 20_000 : 120_000;
  const response = await runLocalLlmPrompt(prompt, { timeoutMs, model: tier });
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
