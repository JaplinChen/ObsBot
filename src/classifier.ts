/** Keyword-based content classifier — returns a Traditional Chinese category label */
import { classifyWithLearnedRules } from './learning/dynamic-classifier.js';
import { CATEGORY_TREE } from './classifier-categories.js';
import type { CategoryNode } from './classifier-categories.js';

/** 短 ASCII 關鍵字（≤3 字元）用 word boundary，避免 'ai' 匹配 'Aitken' 等 substring 誤判 */
function keywordMatch(h: string, kw: string): boolean {
  const k = kw.toLowerCase();
  return k.length <= 3 && /^[a-z0-9]+$/.test(k)
    ? new RegExp(`\\b${k}\\b`).test(h)
    : h.includes(k);
}

/** 計算關鍵字命中分數：標題 ×2，本文 ×1 */
function score(keywords: string[], titleH: string, bodyH: string): number {
  let s = 0;
  for (const kw of keywords) {
    if (keywordMatch(titleH, kw)) s += 2;
    else if (bodyH && keywordMatch(bodyH, kw)) s += 1;
  }
  return s;
}

/**
 * 分層匹配：遞迴遍歷分類樹
 * 1. 先算本節點分數
 * 2. 若有子節點，在子節點中找最高分
 * 3. 子節點有匹配 → 返回子節點路徑（更精確）
 * 4. 子節點無匹配但本節點有 → 返回本節點路徑
 */
function matchNode(
  node: CategoryNode, titleH: string, bodyH: string, parentPath: string,
): { path: string; score: number } | null {
  const myPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const myScore = score(node.keywords ?? [], titleH, bodyH);

  // 嘗試子節點
  if (node.children?.length) {
    let bestChild: { path: string; score: number } | null = null;
    for (const child of node.children) {
      const result = matchNode(child, titleH, bodyH, myPath);
      if (result && (!bestChild || result.score > bestChild.score)) {
        bestChild = result;
      }
    }
    if (bestChild) return bestChild; // 子分類命中 → 優先
  }

  return myScore > 0 ? { path: myPath, score: myScore } : null;
}

export function classifyContent(title: string, text: string): string {
  // Step 0：優先使用 vault 學習到的規則
  const learned = classifyWithLearnedRules(title, text);
  if (learned) return learned;

  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();

  let bestPath = '';
  let bestScore = 0;

  // 同分時先出現的根節點優先（用 > 而非 >=）
  for (const root of CATEGORY_TREE) {
    const result = matchNode(root, titleH, bodyH, '');
    if (result && result.score > bestScore) {
      bestPath = result.path;
      bestScore = result.score;
    }
  }

  return bestPath || '其他';
}

/** 從內容中提取命中的所有關鍵詞（最多 5 個） */
export function extractKeywords(title: string, text: string): string[] {
  const titleH = title.toLowerCase();
  const bodyH = text.toLowerCase();
  const matched: string[] = [];

  function collect(node: CategoryNode): void {
    for (const kw of node.keywords ?? []) {
      if (keywordMatch(titleH, kw) || keywordMatch(bodyH, kw)) {
        matched.push(kw);
        if (matched.length >= 5) return;
      }
    }
    for (const child of node.children ?? []) {
      if (matched.length >= 5) return;
      collect(child);
    }
  }

  for (const root of CATEGORY_TREE) {
    if (matched.length >= 5) break;
    collect(root);
  }
  return matched;
}
