/** 分類規則資料 — 純資料檔，由 classifier.ts 引用 */

import { AI_TOOL_CATEGORIES } from './classifier-categories-tools.js';

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ══════════════════════════════════════════════════════
  // 方案 C：三層分類體系
  // 精確工具 → 功能子分類 → 功能兜底 → AI 通用兜底
  // 越精確的排越前面
  // ══════════════════════════════════════════════════════

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. AI/Claude — Claude 全家族
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/Claude/Cowork',
    keywords: [
      'claude cowork', 'cowork', '辦公協作', '協作辦公',
      '桌面ai助手', '桌面 ai 助手', '桌面ai代理', '桌面 ai 代理',
    ],
    exclude: [
      'sword', 'antique', '古劍', '金屬', 'jewelry',
      'staffing', 'employer', 'recruitment', '人力',
    ],
  },
  {
    name: 'AI/Claude/Claude Code',
    keywords: ['claude code', 'claude-code', 'claude cli'],
  },
  {
    name: 'AI/Claude/應用與技巧',
    keywords: ['claude', 'anthropic'],
    exclude: ['cowork', 'claude code', 'claude-code', 'claude cli'],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. AI/模型與平台
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/模型與平台/OpenAI',
    keywords: ['chatgpt', 'openai', 'codex', 'openai codex', 'gpt-5', 'gpt-4o'],
  },
  {
    name: 'AI/模型與平台/Gemini',
    keywords: ['gemini', 'notebooklm', 'notebook lm', 'nano banana', 'google ai'],
  },
  { name: 'AI/模型與平台/DeepSeek', keywords: ['deepseek'] },
  { name: 'AI/模型與平台/Perplexity', keywords: ['perplexity'] },
  { name: 'AI/模型與平台/Abacus', keywords: ['abacus'] },
  {
    name: 'AI/模型與平台/開源模型',
    keywords: [
      'minimax', 'qwen', 'llama', 'mistral', 'gemma', 'phi-',
      'omlx', 'ollama', '本地模型', '本地推理', 'local llm',
    ],
  },
  {
    name: 'AI/模型與平台/模型評測',
    keywords: [
      'benchmark', 'leaderboard', '模型评测', '模型評測',
      '模型對比', '模型对比', '大模型',
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. AI/技術架構
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/技術架構/知識圖譜',
    keywords: ['graphrag', 'knowledge graph', '知識圖譜', '知识图谱', '實體關係'],
  },
  {
    name: 'AI/技術架構/RAG',
    keywords: [
      'rag', 'retrieval augment', 'vector database', 'embedding',
      '向量資料庫', '向量数据库', '檢索增強', '检索增强',
    ],
  },
  {
    name: 'AI/技術架構/Prompt工程',
    keywords: [
      'prompt engineering', 'system prompt', '提示词', '提示詞',
      '调教', '調教', 'few-shot', 'zero-shot', 'chain of thought',
      '防幻覺', '幻覺協議', 'hallucination',
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. AI/開發工具（品牌名優先於泛用 Agent 關鍵字）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/OpenClaw',
    keywords: [
      'openclaw', 'open claw', 'openclaws', 'clawbot', '龍蝦', '龙虾',
      'nanoclaw', 'opencloy', 'u-claw', 'clawhub', '養蝦', '小龍蝦',
      'claw skill', 'clawhub skill', 'claw 技能',
    ],
  },
  {
    name: 'AI/開發工具/IDE',
    keywords: ['cursor', 'windsurf', 'cline', 'copilot', 'code editor'],
  },
  {
    name: 'AI/開發工具/爬蟲與抓取',
    keywords: [
      '爬蟲', 'crawler', 'scraping', 'scraper', 'firecrawl',
      '数据抓取', '資料抓取', '無頭瀏覽器', 'headless browser',
      'playwright', 'puppeteer', 'selenium',
    ],
  },
  {
    name: 'AI/開發工具/CLI',
    keywords: ['cli tool', 'cli 工具', 'cli 轉換', 'terminal tool'],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. AI/Agent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/Agent/MCP',
    keywords: ['mcp server', 'mcp tool', 'mcp 伺服器', 'model context protocol'],
  },
  {
    name: 'AI/Agent/多Agent系統',
    keywords: [
      'multi-agent', 'agent orchestration', 'agent 軍團', 'agent 編排',
      '多智能體', '多代理', 'agent 協作',
    ],
  },
  {
    name: 'AI/Agent/框架',
    keywords: [
      'langchain', 'langgraph', 'agent framework', 'agent 架構',
      'ai agent', 'agentic', 'agent工程', 'agent engineer',
      'agent monitoring', 'agent 監控',
    ],
  },
  {
    name: 'AI/Agent/自動化流程',
    keywords: [
      'make.com', 'zapier', 'n8n', 'xembly', 'bardeen',
      'workflow', 'automation', '自動化', 'telegram bot',
    ],
    exclude: ['image generat', 'video generat', '圖像', '影片'],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. AI/教程指南
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/教程指南/最佳實踐',
    keywords: [
      'best practices', '最佳实践', '最佳實踐', '工程指南',
      '實戰指南', '實戰經驗', 'skill清单', 'skill 清單',
    ],
  },
  {
    name: 'AI/教程指南/入門教學',
    keywords: [
      '完全教程', '教程', '小白', '新手',
      '入門', '入門指南', '入门指南', '入門教學', '入门教学',
      '从0开始', '从零开始', '零基礎', '零基础',
      'getting started', '手把手', '3分钟', '0代码',
      '安裝教學', '安裝指南', '設定教學',
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. 其他 AI 具體工具（從 classifier-categories-tools.ts 引入）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ...AI_TOOL_CATEGORIES,

  // ══════════════════════════════════════════════════════
  // AI 功能分類兜底
  // ══════════════════════════════════════════════════════
  {
    name: 'AI/圖像生成',
    keywords: [
      'image generat', '圖片生成', '圖像生成', '圖片放大', 'image enhance',
      'comfyui', '放大', 'text to image', '文生圖',
      '3d model', '3d模型', '圖片轉3d', 'trellis',
    ],
  },
  {
    name: 'AI/影片製作',
    keywords: [
      'video generat', '影片生成', '影片製作', '視頻生成', '视频生成',
      'text to video', '文生影片', '文生視頻',
      '字幕', 'caption', 'subtitle', '影片速度', '影片編輯', 'video edit',
      'ffmpeg', '短影音', '剪輯',
    ],
    exclude: ['cli', 'terminal', '終端', 'obsidian', 'zellij'],
  },
  { name: 'AI/文案撰寫', keywords: ['copywriting', '文案', 'ad copy', '廣告文案'] },
  {
    name: 'AI/寫作輔助',
    keywords: [
      '角色扮演', 'role play', 'jailbreak',
      '寫作', 'writing assist', '優化技巧', '細節優化', '生成技巧',
    ],
  },
  { name: 'AI/網站搭建', keywords: ['website builder', '網站搭建', 'ai 建站', 'ai建站'] },
  { name: 'AI/會議記錄', keywords: ['會議記錄', 'meeting note', 'meeting transcript', '會議摘要'] },
  { name: 'AI/SEO優化', keywords: ['seo 優化', 'seo優化', 'seo tool', 'keyword research'] },
  { name: 'AI/簡報', keywords: ['簡報', 'ppt', 'presentation', 'slide deck', '投影片'] },
  { name: 'AI/智慧客服', keywords: ['客服', 'customer service', 'ai chatbot', '智慧客服'] },
  { name: 'AI/UI設計', keywords: ['ui design', 'ux design', '介面設計', 'prototype', 'wireframe'] },
  { name: 'AI/設計工具', keywords: ['設計工具', 'design tool', '平面設計'] },
  { name: 'AI/Logo生成', keywords: ['logo生成', 'logo 生成', 'logo design', 'logo設計'] },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. AI/產業動態 — 最終 AI 兜底（取代舊 AI/研究對話 黑洞）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'AI/產業動態/工具發現',
    keywords: [
      '工具推薦', '工具合集', 'ai tool', '工具清單', '工具列表',
      '免費工具', '免费工具', '必備工具', '必备工具',
      '替代方案', 'alternative',
    ],
  },
  {
    name: 'AI/產業動態/業界新聞',
    keywords: [
      '發布', 'release', 'announce', '融資', 'funding',
      '收購', 'acquisition', 'ai 新聞', 'ai news',
    ],
  },
  {
    name: 'AI/產業動態',
    keywords: [
      'ai', 'gpt', 'llm', 'diffusion',
      '人工智慧', '大語言模型', '大语言模型',
      '機器學習', 'machine learning', 'deep learning',
    ],
  },

  // ══════════════════════════════════════════════════════
  // 其他頂層分類（不變）
  // ══════════════════════════════════════════════════════
  {
    name: '生產力/Obsidian',
    keywords: [
      'obsidian', 'pkm', 'zettelkasten',
      '第二大腦', '第二大脑', '筆記軟體', '笔记软件', '筆記工具', '笔记工具',
      '雙向連結', '雙向鏈結', '知識網路', '知識網絡',
    ],
  },
  {
    name: '科技/Apple',
    keywords: ['mac', 'macbook', 'iphone', 'ipad', 'macos', 'apple silicon', 'apple watch', 'ios ', 'mac mini', 'mac studio', 'mac pro', 'imac', 'macwhisper', 'orbstack'],
  },
  { name: '科技', keywords: ['hardware', 'chip', 'semiconductor', '晶片', '半導體', '硬體', '科技新聞', '休眠機制'] },
  { name: '程式設計', keywords: ['programming', 'javascript', 'typescript', 'python', 'rust', 'react', 'nextjs', '程式設計', 'backend', 'frontend', 'database', '訂閱管理', '健康檢查', 'heartbeat', 'health check', 'c#', '.net', 'golang', 'swift', 'kotlin', 'docker'] },
  {
    name: '投資理財',
    keywords: [
      'stock', 'etf', 'crypto', 'bitcoin', 'invest', 'portfolio',
      'dividend', '股票', '基金', '投資', '理財', '加密貨幣',
      '比特幣', '報酬', '資產', 'finance', 'market', '市場',
      '金融', 'a股', 'a 股',
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
