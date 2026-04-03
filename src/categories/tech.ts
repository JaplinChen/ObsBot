/** 科技相關分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 19. Apple ──
  {
    name: '科技/Apple',
    keywords: ['mac', 'macbook', 'iphone', 'ipad', 'macos', 'apple silicon', 'apple watch', 'ios ', 'mac mini', 'mac studio', 'mac pro', 'imac', 'macwhisper', 'orbstack'],
  },
  // ── 20. 其他科技 ──
  { name: '科技', keywords: ['hardware', 'chip', 'semiconductor', '晶片', '半導體', '硬體', '科技新聞', '休眠機制'] },
];