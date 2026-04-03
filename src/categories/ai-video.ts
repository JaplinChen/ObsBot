/** AI 影片製作分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 6. 影片製作：具體工具 ──
  { name: 'AI/影片製作/Sora', keywords: ['sora'] },
  { name: 'AI/影片製作/Luma', keywords: ['luma'] },
  { name: 'AI/影片製作/Kling', keywords: ['kling'] },
  { name: 'AI/影片製作/Pika', keywords: ['pika'] },
  { name: 'AI/影片製作/InVideo', keywords: ['invideo'] },
  { name: 'AI/影片製作/HeyGen', keywords: ['heygen'] },
  { name: 'AI/影片製作/Runway', keywords: ['runway'] },
  { name: 'AI/影片製作/ImgCreator', keywords: ['imgcreator'] },
  { name: 'AI/影片製作/Morphstudio', keywords: ['morphstudio'] },

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底（無法匹配到具體工具時）
  // ══════════════════════════════════════════════════════
  {
    name: 'AI/影片製作',
    keywords: [
      'video generat', '影片生成', '影片製作', '視頻生成', '视频生成',
      'text to video', '文生影片', '文生視頻',
      '字幕', 'caption', 'subtitle', '影片速度', '影片編輯', 'video edit',
      'ffmpeg', '短影音', '剪輯',
    ],
  },
];