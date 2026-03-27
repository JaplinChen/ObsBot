/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';
import { CATEGORIES, type CategoryRule } from './classifier-categories.js';

/** 短 ASCII 關鍵字（≤3 字元）用 word boundary，避免 'ai' 匹配 'Aitken' 等 substring 誤判 */
function keywordMatch(h: string, kw: string): boolean {
  const k = kw.toLowerCase();
  return k.length <= 3 && /^[a-z0-9]+$/.test(k) ? new RegExp(`\\b${k}\\b`).test(h) : h.includes(k);
}

/** 檢查該分類的 exclude 關鍵字是否命中（命中 = 應排除此分類） */
function isExcluded(cat: CategoryRule, titleH: string, bodyH: string): boolean {
  if (!cat.exclude?.length) return false;
  return cat.exclude.some(kw => keywordMatch(titleH, kw) || keywordMatch(bodyH, kw));
}

/**
 * 分離計算標題與 body 的命中數，避免重複計分。
 * 回傳 { titleHits, bodyHits }。
 */
function countHits(cat: CategoryRule, titleH: string, bodyH: string) {
  let titleHits = 0;
  let bodyHits = 0;
  const matchedKws: string[] = [];
  for (const kw of cat.keywords) {
    // 跳過被已命中的更長關鍵字包含的短關鍵字（避免 "claude" 和 "claude code" 重複計分）
    const kwLower = kw.toLowerCase();
    if (matchedKws.some(prev => prev.includes(kwLower))) continue;
    if (keywordMatch(titleH, kw)) { titleHits++; matchedKws.push(kwLower); }
    else if (bodyH && keywordMatch(bodyH, kw)) { bodyHits++; matchedKws.push(kwLower); }
  }
  return { titleHits, bodyHits };
}

export function classifyContent(title: string, text: string): string {
  // Step 0：優先使用 vault 學習到的規則（高信心門檻）
  const learned = classifyWithLearnedRules(title, text);
  if (learned) return learned;

  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();

  // ── 兩階段分類：標題優先，body 輔助 ──
  // Phase 1：只看標題，找出所有在標題命中的分類
  // Phase 2：如果標題沒有命中任何分類，才考慮 body

  interface CatScore { titleHits: number; bodyHits: number; order: number }
  const scores = new Map<string, CatScore>();

  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    if (isExcluded(cat, titleH, bodyH)) continue;

    const { titleHits, bodyHits } = countHits(cat, titleH, bodyH);
    if (titleHits <= 0 && bodyHits <= 0) continue;

    const existing = scores.get(cat.name);
    if (existing) {
      existing.titleHits += titleHits;
      existing.bodyHits += bodyHits;
    } else {
      scores.set(cat.name, { titleHits, bodyHits, order: i });
    }
  }

  // Phase 1：有標題命中的分類才參與競爭
  const titleCandidates = [...scores.entries()].filter(([, s]) => s.titleHits > 0);

  if (titleCandidates.length > 0) {
    // 在標題候選中，用「標題命中數 ×3 + body 命中數」排序
    // 同分按 CATEGORIES 順序
    titleCandidates.sort((a, b) => {
      const scoreA = a[1].titleHits * 3 + a[1].bodyHits;
      const scoreB = b[1].titleHits * 3 + b[1].bodyHits;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a[1].order - b[1].order;
    });
    return titleCandidates[0][0];
  }

  // Phase 2：標題無命中，fallback 到 body（只有在完全沒有標題線索時）
  const bodyCandidates = [...scores.entries()].filter(([, s]) => s.bodyHits > 0);

  if (bodyCandidates.length > 0) {
    bodyCandidates.sort((a, b) => {
      if (b[1].bodyHits !== a[1].bodyHits) return b[1].bodyHits - a[1].bodyHits;
      return a[1].order - b[1].order;
    });
    return bodyCandidates[0][0];
  }

  return '其他';
}

/** 從內容中提取命中的所有關鍵詞（最多 5 個），供 frontmatter keywords 欄位使用 */
export function extractKeywords(title: string, text: string): string[] {
  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();
  const matched: string[] = [];
  for (const cat of CATEGORIES) {
    if (isExcluded(cat, titleH, bodyH)) continue;
    for (const kw of cat.keywords) {
      if (keywordMatch(titleH, kw) || keywordMatch(bodyH, kw)) {
        matched.push(kw);
        if (matched.length >= 5) return matched;
      }
    }
  }
  return matched;
}
