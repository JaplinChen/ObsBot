/**
 * 內容分類器 — 回傳繁體中文分類標籤。
 *
 * 三層 fallback：
 * [1] LLM 語意分類（classifier-llm.ts）— 主路徑，15s timeout
 * [2] 動態學習規則（dynamic-classifier）— 信心 >= 0.75
 * [3] 靜態關鍵字計分（CATEGORIES）— 標題×2、內文×1
 */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';
import { classifyWithLlm } from './classifier-llm.js';
import { CATEGORIES, type CategoryRule } from './classifier-categories.js';

/* ── 關鍵字比對工具 ──────────────────────────────────────── */

/** 短 ASCII 關鍵字（≤3 字元）用 word boundary，避免 'ai' 匹配 'Aitken' 等誤判 */
function keywordMatch(h: string, kw: string): boolean {
  const k = kw.toLowerCase();
  return k.length <= 3 && /^[a-z0-9]+$/.test(k)
    ? new RegExp(`\\b${k}\\b`).test(h)
    : h.includes(k);
}

/** 命中任一排除詞 → 跳過此分類 */
function isExcluded(cat: CategoryRule, titleH: string, bodyH: string): boolean {
  if (!cat.exclude?.length) return false;
  return cat.exclude.some(kw => keywordMatch(titleH, kw) || keywordMatch(bodyH, kw));
}

/** 計分：標題命中 ×2，內文命中 ×1 */
function scoreCategory(cat: CategoryRule, titleH: string, bodyH: string): number {
  let score = 0;
  for (const kw of cat.keywords) {
    if (keywordMatch(titleH, kw)) score += 2;
    else if (bodyH && keywordMatch(bodyH, kw)) score += 1;
  }
  return score;
}

/* ── [3] 靜態關鍵字分類（fallback，同步）──────────────────── */

export function classifyWithKeywords(title: string, text: string): string {
  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();
  const scores = new Map<string, { score: number; order: number }>();

  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    if (isExcluded(cat, titleH, bodyH)) continue;
    const score = scoreCategory(cat, titleH, bodyH);
    if (score <= 0) continue;
    const existing = scores.get(cat.name);
    if (existing) {
      existing.score += score;
    } else {
      scores.set(cat.name, { score, order: i });
    }
  }

  let bestName = '';
  let bestScore = 0;
  let bestOrder = Infinity;
  for (const [name, { score, order }] of scores) {
    if (score > bestScore || (score === bestScore && order < bestOrder)) {
      bestName = name;
      bestScore = score;
      bestOrder = order;
    }
  }
  return bestName || '其他';
}

/* ── 主要分類入口（async）───────────────────────────────── */

export async function classifyContent(_title: string, _text: string): Promise<string> {
  // 所有新文章固定存入 inbox，由用戶手動整理分類
  return 'inbox';
}

/* ── 關鍵字提取（同步，供 formatter 使用）───────────────── */

/**
 * 從靜態分類規則中提取最多 5 個命中關鍵詞。
 * 使用靜態分類器（非 LLM）確保同步執行，供 frontmatter 格式化使用。
 * 注意：enrichedKeywords（LLM 生成）優先於此函數的輸出。
 */
export function extractKeywords(title: string, text: string): string[] {
  const winner = classifyWithKeywords(title, text);
  const cat = CATEGORIES.find(c => c.name === winner);
  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();

  // Primary: category keywords that appear in content
  const catMatches = cat
    ? cat.keywords.filter(kw => keywordMatch(titleH, kw) || keywordMatch(bodyH, kw))
    : [];

  // Fallback: extract meaningful CJK/English words from title when category matching is thin
  const titleWords: string[] = [];
  if (catMatches.length < 3) {
    const cjk = title.match(/[\u4e00-\u9fff\u3040-\u30ff]{2,6}/g) ?? [];
    const eng = title.match(/\b[A-Za-z][a-z]{2,}\b/g)?.map(w => w.toLowerCase()) ?? [];
    titleWords.push(...cjk.slice(0, 4), ...eng.slice(0, 3));
  }

  return [...new Set([...catMatches, ...titleWords])].slice(0, 5);
}
