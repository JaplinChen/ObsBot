/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';
import { CATEGORIES } from './classifier-categories.js';

/** 短 ASCII 關鍵字（≤3 字元）用 word boundary，避免 'ai' 匹配 'Aitken' 等 substring 誤判 */
function keywordMatch(h: string, kw: string): boolean {
  const k = kw.toLowerCase();
  return k.length <= 3 && /^[a-z0-9]+$/.test(k) ? new RegExp(`\\b${k}\\b`).test(h) : h.includes(k);
}

export function classifyContent(title: string, text: string): string {
  // Step 0：優先使用 vault 學習到的規則（信心 >= 0.75）
  const learned = classifyWithLearnedRules(title, text);
  if (learned) return learned;

  const titleHaystack = title.toLowerCase();
  const bodyHaystack = text.toLowerCase();

  // Pass 1：標題優先（精準信號）
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => keywordMatch(titleHaystack, kw))) {
      return cat.name;
    }
  }

  // Pass 2：本文 fallback（標題無命中時）
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => keywordMatch(bodyHaystack, kw))) {
      return cat.name;
    }
  }

  return '其他';
}

/** 從內容中提取命中的所有關鍵詞（最多 5 個），供 frontmatter keywords 欄位使用 */
export function extractKeywords(title: string, text: string): string[] {
  const haystack = `${title} ${text}`.toLowerCase();
  const matched: string[] = [];
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (keywordMatch(haystack, kw)) {
        matched.push(kw);
        if (matched.length >= 5) return matched;
      }
    }
  }
  return matched;
}
