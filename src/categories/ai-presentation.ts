/** AI 簡報分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 10. 簡報：具體工具 ──
  { name: 'AI/簡報/Decktopus', keywords: ['decktopus'] },
  { name: 'AI/簡報/Slides AI', keywords: ['slides ai', 'slidesai'] },
  { name: 'AI/簡報/Gamma', keywords: ['gamma ai', 'gamma.app'] },
  { name: 'AI/簡報/Beautiful AI', keywords: ['beautiful ai', 'beautiful.ai'] },
  { name: 'AI/簡報/PopAi', keywords: ['popai'] },

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底（無法匹配到具體工具時）
  // ══════════════════════════════════════════════════════
  { name: 'AI/簡報', keywords: ['簡報', 'ppt', 'presentation', 'slide deck', '投影片'] },
];