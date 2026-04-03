/** AI 文案撰寫分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 3. 文案撰寫：具體工具 ──
  { name: 'AI/文案撰寫/Rytr', keywords: ['rytr'] },
  { name: 'AI/文案撰寫/Copy AI', keywords: ['copy.ai', 'copy ai'] },
  { name: 'AI/文案撰寫/Writesonic', keywords: ['writesonic'] },
  { name: 'AI/文案撰寫/Adcreative', keywords: ['adcreative'] },
  { name: 'AI/文案撰寫/otio', keywords: ['otio'] },

  // ── 4. 寫作輔助：具體工具 ──
  { name: 'AI/寫作輔助/Jasper', keywords: ['jasper ai', 'jasper.ai'] },
  { name: 'AI/寫作輔助/HIX AI', keywords: ['hix ai', 'hix.ai'] },
  { name: 'AI/寫作輔助/Jenny AI', keywords: ['jenny ai'] },
  { name: 'AI/寫作輔助/Textblaze', keywords: ['textblaze', 'text blaze'] },
  { name: 'AI/寫作輔助/Quillbot', keywords: ['quillbot'] },

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底（無法匹配到具體工具時）
  // ══════════════════════════════════════════════════════
  { name: 'AI/文案撰寫', keywords: ['copywriting', '文案', 'ad copy', '廣告文案'] },
  {
    name: 'AI/寫作輔助',
    keywords: [
      'prompt engineering', 'system prompt', '提示词', '提示詞',
      '调教', '調教', '角色扮演', 'role play', 'jailbreak',
      'few-shot', 'zero-shot', 'chain of thought',
      '寫作', 'writing assist', '優化技巧', '細節優化', '生成技巧',
    ],
  },
];