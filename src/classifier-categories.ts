/** 分類規則資料 — 純資料檔，由 classifier.ts 引用 */

import { AI_TOOL_CATEGORIES } from './classifier-categories-tools.js';

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ══════════════════════════════════════════════════════
  // AI 三層分類：具體工具 → 功能分類兜底 → AI 通用兜底
  // 越精確的排越前面
  // ══════════════════════════════════════════════════════

  // ── 0. 辦公協作（claude cowork 比 claude 更精確，必須排前面）──
  {
    name: 'AI/辦公協作',
    keywords: [
      'claude cowork', 'cowork', 'openwork', '辦公協作', '協作辦公',
      'feishu', '飛書',
    ],
    exclude: [
      'sword', 'antique', '古劍', '金屬', 'jewelry',
      'staffing', 'employer', 'recruitment', '人力',
      'john mayer', 'johnmayer', 'rakuten', 'reddit.com', 'r/',
    ],
  },

  // ── 1. 研究對話：具體工具 ──
  {
    name: 'AI/研究對話/Claude',
    keywords: ['claude code', 'claude', 'anthropic'],
  },
  {
    name: 'AI/研究對話/OpenAI',
    keywords: ['chatgpt', 'openai', 'codex', 'openai codex', 'gpt-5', 'gpt-4o'],
  },
  {
    name: 'AI/研究對話/Gemini',
    keywords: ['gemini', 'notebooklm', 'notebook lm', 'nano banana', 'google ai'],
  },
  { name: 'AI/研究對話/DeepSeek', keywords: ['deepseek'] },
  {
    name: 'AI/研究對話/OpenClaw',
    keywords: [
      'openclaw', 'open claw', 'openclaws', 'clawbot', '龍蝦', '龙虾',
      'nanoclaw', 'opencloy', 'u-claw', 'clawhub', '養蝦', '小龍蝦',
    ],
  },
  { name: 'AI/研究對話/Perplexity', keywords: ['perplexity'] },
  { name: 'AI/研究對話/Abacus', keywords: ['abacus'] },

  // ── 2-14. AI 具體工具（由 classifier-categories-tools.ts 管理）──
  ...AI_TOOL_CATEGORIES,

  // ── 開發工具：IDE 與 Coding Assistant ──
  { name: 'AI/開發工具/Cursor', keywords: ['cursor'] },
  { name: 'AI/開發工具/Windsurf', keywords: ['windsurf'] },
  { name: 'AI/開發工具/Cline', keywords: ['cline'] },

  // ── 自動化：工作流工具 ──
  { name: 'AI/自動化/Make', keywords: ['make.com'] },
  { name: 'AI/自動化/Zapier', keywords: ['zapier'] },
  { name: 'AI/自動化/Xembly', keywords: ['xembly'] },
  { name: 'AI/自動化/Bardeen', keywords: ['bardeen'] },
  { name: 'AI/自動化/n8n', keywords: ['n8n'] },

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底（無法匹配到具體工具時）
  // ══════════════════════════════════════════════════════
  {
    name: 'AI/3D 視覺',
    keywords: [
      'gaussian splatting', '高斯潑灑', '3d gaussian', '3dgs',
      'nerf', 'neural radiance', 'novel view', '新視角',
      '3d reconstruction', '3d重建', '三維重建', '3d scene',
      'neural rendering', '神經渲染', 'point cloud', '點雲',
      'radiance field', 'splat', 'resplat',
      'mesh reconstruction', 'depth estimation', '深度估計',
    ],
  },
  {
    name: 'AI/多模態生成/圖像',
    keywords: [
      'image generat', '圖片生成', '圖像生成', '圖片放大', 'image enhance',
      'comfyui', '放大', 'text to image', '文生圖',
      '3d model', '3d模型', '圖片轉3d', 'trellis',
    ],
  },
  {
    name: 'AI/多模態生成/影片',
    keywords: [
      'video generat', '影片生成', '影片製作', '視頻生成', '视频生成',
      'text to video', '文生影片', '文生視頻',
      '字幕', 'caption', 'subtitle', '影片速度', '影片編輯', 'video edit',
      'ffmpeg', '短影音', '剪輯',
    ],
  },
  {
    name: 'AI/多模態生成/語音',
    keywords: [
      '語音輸入', '語音識別', '語音轉文字', '語音轉錄',
      'speech-to-text', 'speech to text', 'speech recognition',
      'whisper', 'stt', '轉錄', '聽寫', 'dictation',
      'voice input', 'voice typing', '語音打字',
      'sherpaonnx', 'sherpa-onnx', 'macparakeet', 'type4me', 'typeno',
    ],
  },
  { name: 'AI/文案撰寫', keywords: ['copywriting', '文案', 'ad copy', '廣告文案'] },
  {
    name: 'AI/Prompt 工程',
    keywords: [
      'prompt engineering', 'system prompt', '提示词', '提示詞',
      '调教', '調教', '角色扮演', 'role play', 'jailbreak',
      'few-shot', 'zero-shot', 'chain of thought',
    ],
  },
  {
    name: 'AI/寫作輔助',
    keywords: ['寫作', 'writing assist', '優化技巧', '細節優化', '生成技巧'],
  },
  { name: 'AI/網站搭建', keywords: ['website builder', '網站搭建', 'ai 建站', 'ai建站'] },
  { name: 'AI/會議記錄', keywords: ['會議記錄', 'meeting note', 'meeting transcript', '會議摘要'] },
  { name: 'AI/SEO優化', keywords: ['seo 優化', 'seo優化', 'seo tool', 'keyword research'] },
  {
    name: 'AI/自動化',
    keywords: [
      'ai agent', 'agentic', 'agent工程', 'agent engineer',
      'multi-agent', 'agent orchestration', 'agent 軍團', 'agent 架構',
      'agent framework', 'agent monitoring', 'agent 操控', 'agent 監控',
      '自動化', 'automation', 'workflow', 'mcp server', 'mcp tool', 'mcp ',
      'telegram bot', 'bot',
      'langchain', 'langgraph',
      'best practices', '最佳实践', '最佳實踐', '工程指南',
      '数据抓取', '資料抓取',
      '爬蟲', 'crawler', 'scraping', 'scraper', 'firecrawl',
      'cli tool', 'cli 工具', '情報', '無頭瀏覽器', 'headless browser',
      '團隊組建', 'skill清单', 'skill 清單',
    ],
  },
  {
    name: 'AI/RAG & 知識圖譜',
    keywords: [
      'rag', 'retrieval augmented', 'vector database', 'embedding',
      'knowledge graph', '知識圖譜', 'graphrag', 'graph rag',
      'retrieval', 'chunking', 'reranking', 'rerank',
    ],
  },
  { name: 'AI/簡報', keywords: ['簡報', 'ppt', 'presentation', 'slide deck', '投影片'] },
  { name: 'AI/智慧客服', keywords: ['客服', 'customer service', 'ai chatbot', '智慧客服'] },
  { name: 'AI/UI設計', keywords: ['ui design', 'ux design', '介面設計', 'prototype', 'wireframe'] },
  { name: 'AI/設計工具', keywords: ['設計工具', 'design tool', '平面設計'] },
  { name: 'AI/Logo生成', keywords: ['logo生成', 'logo 生成', 'logo design', 'logo設計'] },
  {
    name: 'AI/研究對話',
    keywords: [
      '完全教程', '教程', '小白', '新手',
      '入門指南', '入门指南', '入門教學', '入门教学',
      '从0开始', '从零开始', '零基礎', '零基础',
      'getting started', '手把手', '3分钟', '0代码',
      '大模型', '模型评测', '模型評測',
      'minimax', 'qwen', 'llama', 'mistral', 'gemma', 'phi-',
      'benchmark', 'leaderboard',
      '免费 claude', '免費 claude',
      'claude 3', 'claude 4', 'o1', 'o3',
    ],
  },

  // ══════════════════════════════════════════════════════
  // AI 通用兜底（所有 AI 相關但無法匹配到功能分類的內容）
  // ══════════════════════════════════════════════════════
  {
    name: 'AI/研究對話',
    keywords: [
      'ai', 'gpt', 'llm', 'copilot', 'diffusion',
      '人工智慧', '大語言模型', '大语言模型',
      '機器學習', 'machine learning', 'deep learning',
    ],
  },

  // ══════════════════════════════════════════════════════
  // 其他頂層分類
  // ══════════════════════════════════════════════════════
  {
    name: '知識管理/Obsidian',
    keywords: [
      'obsidian', 'pkm', 'zettelkasten',
      '第二大腦', '第二大脑', '筆記軟體', '笔记软件', '筆記工具', '笔记工具',
      '雙向連結', '雙向鏈結', '知識網路', '知識網絡',
      'note-taking', 'knowledge-management', 'knowledge management',
      'personal-knowledge', 'roam', 'logseq', 'siyuan', '思源',
      '知識管理', '知识管理',
    ],
  },
  {
    name: 'macOS 生態/oMLX',
    keywords: ['omlx', 'mlx', 'apple silicon model', 'local llm mac'],
  },
  {
    name: 'macOS 生態',
    keywords: [
      'mac', 'macbook', 'iphone', 'ipad', 'macos', 'apple silicon', 'apple watch',
      'ios ', 'mac mini', 'mac studio', 'mac pro', 'imac',
      'macwhisper', 'orbstack', 'ghostty', 'raycast',
    ],
  },
  { name: '科技', keywords: ['hardware', 'chip', 'semiconductor', '晶片', '半導體', '硬體', '科技新聞', '休眠機制'] },
  {
    name: '程式設計',
    keywords: [
      'programming', 'javascript', 'typescript', 'python', 'rust',
      'react', 'nextjs', '程式設計', 'backend', 'frontend',
      'database', '訂閱管理', '健康檢查', 'heartbeat', 'health check',
      'c#', '.net', 'golang', 'swift', 'kotlin', 'docker',
      'cli-tool', 'developer-tools', 'dev-tools', 'devtools',
      'code-generation', 'code-quality', 'linter', 'formatter',
      'syntax-highlighting', 'tree-sitter',
    ],
  },
  {
    name: '投資理財',
    keywords: [
      'stock', 'etf', 'crypto', 'bitcoin', 'invest', 'portfolio',
      'dividend', '股票', '基金', '投資', '理財', '加密貨幣',
      '比特幣', '報酬', '資產', 'finance', 'market', '市場',
    ],
  },
  {
    name: '創業商業',
    keywords: [
      'startup', 'founder', 'vc', 'venture', 'saas', 'product',
      'revenue', 'mrr', 'arr', 'b2b', '創業', '創辦人', '商業',
      '商業模式', 'business', 'entrepreneur', '產品',
    ],
  },
  { name: '設計', keywords: ['typography', 'brand design', 'visual design', '排版', '品牌設計', '視覺設計'] },
  { name: '行銷', keywords: ['marketing', 'seo', 'google ads', 'facebook ads', 'growth hack', 'content marketing', 'social media marketing', 'campaign', '行銷', '廣告', '流量', 'viral'] },
  { name: '中文媒體', keywords: ['微博', 'weibo', '小紅書', '小红书', 'xiaohongshu', '紅書', 'xhs', 'bilibili', 'b站', '嗶哩嗶哩', '哔哩哔哩', '抖音', 'douyin', '今日頭條', '今日头条', 'toutiao', 'tiktok', '知乎', 'zhihu', '豆瓣', 'douban'] },
  {
    name: '生產力',
    keywords: [
      'productivity', 'habit', 'focus', '生產力', '工作流',
      '效率', 'notion', 'syncthing', '檔案同步', '磁盤清理', '系統優化',
      'dotfiles', 'ricing', 'desktop-customization', 'rice',
      'awesome-list', 'curated-list', 'resource-list', '資源清單', '資源列表',
      'terminal-emulator', 'window-manager', 'linux-desktop',
    ],
  },
  { name: '新聞時事', keywords: ['news', 'breaking', 'report', 'election', 'government', 'policy', 'war', '新聞', '時事', '政策', '政府', '選舉', '戰爭', '國際'] },
  {
    name: '生活',
    keywords: [
      'food', 'travel', 'health', 'fitness', 'workout', 'recipe',
      'book', 'movie', '飲食', '旅遊', '健康', '運動', '閱讀', '電影', '生活', 'lifestyle',
    ],
    exclude: [
      'github', 'cli', 'api', 'heartbeat', '健康檢查', 'health check',
      'docker', '開源', 'open source', 'sdk', 'npm', 'bot',
    ],
  },
];
