/** AI 圖像生成分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 2. 圖像生成：具體工具 ──
  { name: 'AI/圖像生成/Midjourney', keywords: ['midjourney'] },
  { name: 'AI/圖像生成/Dall-E', keywords: ['dall-e', 'dalle', 'dall e'] },
  { name: 'AI/圖像生成/Flux', keywords: ['flux'] },
  { name: 'AI/圖像生成/Stability AI', keywords: ['stability ai', 'stable diffusion', 'stablediffusion'] },
  { name: 'AI/圖像生成/Grok', keywords: ['grok'] },

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底（無法匹配到具體工具時）
  // ══════════════════════════════════════════════════════
  {
    name: 'AI/圖像生成',
    keywords: [
      'image generat', '圖片生成', '圖像生成', '圖片放大', 'image enhance',
      'comfyui', '放大', 'text to image', '文生圖',
      '3d model', '3d模型', '圖片轉3d', 'trellis',
    ],
  },
];