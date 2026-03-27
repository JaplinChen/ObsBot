/** AI 具體工具分類 — 由 classifier-categories.ts 合併引用 */

import type { CategoryRule } from './classifier-categories.js';

/** 圖像生成、影片製作、文案、寫作、網站、會議、SEO、客服、簡報、UI、設計、Logo 工具 */
export const AI_TOOL_CATEGORIES: CategoryRule[] = [
  // ── 圖像生成：具體工具 ──
  { name: 'AI/圖像生成/Midjourney', keywords: ['midjourney'] },
  { name: 'AI/圖像生成/Dall-E', keywords: ['dall-e', 'dalle', 'dall e'] },
  { name: 'AI/圖像生成/Flux', keywords: ['flux'] },
  { name: 'AI/圖像生成/Stability AI', keywords: ['stability ai', 'stable diffusion', 'stablediffusion'] },
  { name: 'AI/圖像生成/Grok', keywords: ['grok'] },

  // ── 文案撰寫：具體工具 ──
  { name: 'AI/文案撰寫/Rytr', keywords: ['rytr'] },
  { name: 'AI/文案撰寫/Copy AI', keywords: ['copy.ai', 'copy ai'] },
  { name: 'AI/文案撰寫/Writesonic', keywords: ['writesonic'] },
  { name: 'AI/文案撰寫/Adcreative', keywords: ['adcreative'] },
  { name: 'AI/文案撰寫/otio', keywords: ['otio'] },

  // ── 寫作輔助：具體工具 ──
  { name: 'AI/寫作輔助/Jasper', keywords: ['jasper ai', 'jasper.ai'] },
  { name: 'AI/寫作輔助/HIX AI', keywords: ['hix ai', 'hix.ai'] },
  { name: 'AI/寫作輔助/Jenny AI', keywords: ['jenny ai'] },
  { name: 'AI/寫作輔助/Textblaze', keywords: ['textblaze', 'text blaze'] },
  { name: 'AI/寫作輔助/Quillbot', keywords: ['quillbot'] },

  // ── 網站搭建：具體工具 ──
  { name: 'AI/網站搭建/10Web', keywords: ['10web'] },
  { name: 'AI/網站搭建/Durable', keywords: ['durable'] },
  { name: 'AI/網站搭建/Framer', keywords: ['framer'] },
  { name: 'AI/網站搭建/Style AI', keywords: ['style ai'] },
  { name: 'AI/網站搭建/Landingsite', keywords: ['landingsite'] },

  // ── 影片製作：具體工具 ──
  { name: 'AI/影片製作/Sora', keywords: ['sora'] },
  { name: 'AI/影片製作/Luma', keywords: ['luma'] },
  { name: 'AI/影片製作/Kling', keywords: ['kling'] },
  { name: 'AI/影片製作/Pika', keywords: ['pika'] },
  { name: 'AI/影片製作/InVideo', keywords: ['invideo'] },
  { name: 'AI/影片製作/HeyGen', keywords: ['heygen'] },
  { name: 'AI/影片製作/Runway', keywords: ['runway'] },
  { name: 'AI/影片製作/ImgCreator', keywords: ['imgcreator'] },
  { name: 'AI/影片製作/Morphstudio', keywords: ['morphstudio'] },

  // ── 會議記錄：具體工具 ──
  { name: 'AI/會議記錄/Tldv', keywords: ['tldv'] },
  { name: 'AI/會議記錄/Otter', keywords: ['otter'] },
  { name: 'AI/會議記錄/Noty AI', keywords: ['noty ai', 'noty.ai'] },
  { name: 'AI/會議記錄/Fireflies', keywords: ['fireflies'] },

  // ── SEO優化：具體工具 ──
  { name: 'AI/SEO優化/VidIQ', keywords: ['vidiq'] },
  { name: 'AI/SEO優化/Seona', keywords: ['seona'] },
  { name: 'AI/SEO優化/BlogSEO', keywords: ['blogseo'] },
  { name: 'AI/SEO優化/Keywrds', keywords: ['keywrds'] },

  // ── 智慧客服：具體工具 ──
  { name: 'AI/智慧客服/Droxy', keywords: ['droxy'] },
  { name: 'AI/智慧客服/Chatbase', keywords: ['chatbase'] },
  { name: 'AI/智慧客服/Mutual info', keywords: ['mutual info'] },
  { name: 'AI/智慧客服/Chatsimple', keywords: ['chatsimple'] },

  // ── 簡報：具體工具 ──
  { name: 'AI/簡報/Decktopus', keywords: ['decktopus'] },
  { name: 'AI/簡報/Slides AI', keywords: ['slides ai', 'slidesai'] },
  { name: 'AI/簡報/Gamma', keywords: ['gamma ai', 'gamma.app'] },
  { name: 'AI/簡報/Beautiful AI', keywords: ['beautiful ai', 'beautiful.ai'] },
  { name: 'AI/簡報/PopAi', keywords: ['popai'] },

  // ── UI設計：具體工具 ──
  { name: 'AI/UI設計/Figma', keywords: ['figma'] },
  { name: 'AI/UI設計/Uizard', keywords: ['uizard'] },
  { name: 'AI/UI設計/UiMagic', keywords: ['uimagic'] },
  { name: 'AI/UI設計/Photoshop', keywords: ['photoshop'] },

  // ── 設計工具：具體工具 ──
  { name: 'AI/設計工具/Canva', keywords: ['canva'] },
  { name: 'AI/設計工具/Flair AI', keywords: ['flair ai'] },
  { name: 'AI/設計工具/Clipdrop', keywords: ['clipdrop'] },
  { name: 'AI/設計工具/Autodraw', keywords: ['autodraw'] },
  { name: 'AI/設計工具/Magician', keywords: ['magician design', 'magician'] },

  // ── Logo生成：具體工具 ──
  { name: 'AI/Logo生成/Looka', keywords: ['looka'] },
];
