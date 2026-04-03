/** AI 設計相關分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 12. UI設計：具體工具 ──
  { name: 'AI/UI設計/Figma', keywords: ['figma'] },
  { name: 'AI/UI設計/Uizard', keywords: ['uizard'] },
  { name: 'AI/UI設計/UiMagic', keywords: ['uimagic'] },
  { name: 'AI/UI設計/Photoshop', keywords: ['photoshop'] },

  // ── 13. 設計工具：具體工具 ──
  { name: 'AI/設計工具/Canva', keywords: ['canva'] },
  { name: 'AI/設計工具/Flair AI', keywords: ['flair ai'] },
  { name: 'AI/設計工具/Clipdrop', keywords: ['clipdrop'] },
  { name: 'AI/設計工具/Autodraw', keywords: ['autodraw'] },
  { name: 'AI/設計工具/Magician', keywords: ['magician design', 'magician'] },

  // ── 14. Logo生成：具體工具 ──
  { name: 'AI/Logo生成/Looka', keywords: ['looka'] },

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底（無法匹配到具體工具時）
  // ══════════════════════════════════════════════════════
  { name: 'AI/UI設計', keywords: ['ui design', 'ux design', '介面設計', 'prototype', 'wireframe'] },
  { name: 'AI/設計工具', keywords: ['設計工具', 'design tool', '平面設計'] },
  { name: 'AI/Logo生成', keywords: ['logo生成', 'logo 生成', 'logo design', 'logo設計'] },
];