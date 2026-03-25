/**
 * 分類規則 — 樹狀結構
 *
 * 設計原則：
 *   子節點先匹配 → 命中就不回退到父節點
 *   不需要 exclude：精確關鍵字在子節點，泛關鍵字在父節點
 *   同層按精確度排列，分類器取最高分（同分時先出現的優先）
 */

export interface CategoryNode {
  name: string;
  keywords?: string[];
  children?: CategoryNode[];
}

import { AI_TREE } from './classifier-tree-ai.js';
import { NON_AI_TREE } from './classifier-tree-other.js';

/** 根節點陣列 — 順序即為同分優先級 */
export const CATEGORY_TREE: CategoryNode[] = [
  ...AI_TREE,
  ...NON_AI_TREE,
];
