/** AI 相關分類規則 */
import type { CategoryRule } from './classifier-categories.js';
import { AI_TOOL_CATEGORIES } from './classifier-categories-tools.js';

export const AI_CATEGORIES: CategoryRule[] = [
  // ── 0. 辦公協作（具體工具排前，兜底排後）──
  {
    name: 'AI/Cowork/OpenWork',
    keywords: ['openwork', 'opencode'],
    exclude: ['sword', 'antique', '古劍', '金屬', 'jewelry', 'staffing', 'employer', 'recruitment', '人力'],
  },
  {
    name: 'AI/Cowork/Claude Cowork',
    keywords: ['claude cowork', 'cowork'],
    exclude: [
      'sword', 'antique', '古劍', '金屬', 'jewelry',
      'staffing', 'employer', 'recruitment', '人力',
      'john mayer', 'johnmayer', 'rakuten', 'openwork',
    ],
  },
  {
    name: 'AI/Cowork',
    keywords: ['辦公協作', '協作辦公', 'feishu', '飛書'],
    exclude: ['sword', 'antique', '古劍', '金屬', 'jewelry', 'staffing', 'employer', 'recruitment', '人力'],
  },

  // ── 1. 研究對話：具體工具 ──
  { name: 'AI/研究對話/Claude', keywords: ['claude code', 'claude', 'anthropic'] },
  { name: 'AI/研究對話/OpenAI', keywords: ['chatgpt', 'openai', 'codex', 'openai codex', 'gpt-5', 'gpt-4o'] },
  { name: 'AI/研究對話/Gemini', keywords: ['gemini', 'notebooklm', 'notebook lm', 'nano banana', 'google ai'] },
  { name: 'AI/研究對話/DeepSeek', keywords: ['deepseek'] },
  {
    name: 'AI/研究對話/OpenClaw',
    keywords: ['openclaw', 'open claw', 'openclaws', 'clawbot', '龍蝦', '龙虾', 'nanoclaw', 'opencloy', 'u-claw', 'clawhub', '養蝦', '小龍蝦'],
  },
  { name: 'AI/研究對話/Perplexity', keywords: ['perplexity'] },
  { name: 'AI/研究對話/Abacus', keywords: ['abacus'] },

  // ── 2-14. AI 具體工具（由 classifier-categories-tools.ts 管理）──
  ...AI_TOOL_CATEGORIES,

  // ── 開發工具：IDE 與 Coding Assistant ──
  { name: 'AI/開發工具/Cursor', keywords: ['cursor'] },
  { name: 'AI/開發工具/Windsurf', keywords: ['windsurf'] },
  { name: 'AI/開發工具/Cline', keywords: ['cline'] },
  {
    name: 'AI/開發工具',
    keywords: [
      'github copilot', 'copilot', 'tabnine', 'supermaven', 'aider',
      'continue.dev', 'zed editor', 'ai coding', 'code assistant', 'coding assistant',
      'devin', 'software engineer ai', 'swe-agent',
    ],
  },

  // ── 自動化：工作流工具 ──
  { name: 'AI/自動化/Make', keywords: ['make.com'] },
  { name: 'AI/自動化/Zapier', keywords: ['zapier'] },
  { name: 'AI/自動化/Xembly', keywords: ['xembly'] },
  { name: 'AI/自動化/Bardeen', keywords: ['bardeen'] },
  { name: 'AI/自動化/n8n', keywords: ['n8n'] },

  // ── AI 功能分類兜底 ──
  {
    name: 'AI/3D 視覺',
    keywords: [
      'gaussian splatting', '高斯潑灑', '3d gaussian', '3dgs',
      'nerf', 'neural radiance', 'novel view', '新視角',
      '3d reconstruction', '3d重建', '三維重建', '3d scene',
      'neural rendering', '神經渲染', 'point cloud', '點雲',
      'radiance field', 'splat', 'resplat', 'mesh reconstruction', 'depth estimation', '深度估計',
    ],
  },
  {
    name: 'AI/多模態生成/圖像',
    keywords: [
      'image generat', '圖片生成', '圖像生成', '圖片放大', 'image enhance',
      'comfyui', '放大', 'text to image', '文生圖', '3d model', '3d模型', '圖片轉3d', 'trellis',
    ],
  },
  {
    name: 'AI/多模態生成/影片',
    keywords: [
      'video generat', '影片生成', '影片製作', '視頻生成', '视频生成',
      'text to video', '文生影片', '文生視頻',
      '字幕', 'caption', 'subtitle', '影片速度', '影片編輯', 'video edit', 'ffmpeg', '短影音', '剪輯',
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
      'prompt engineering', 'system prompt', '提示词', '提示詞', '调教', '調教',
      '角色扮演', 'role play', 'jailbreak', 'few-shot', 'zero-shot', 'chain of thought',
    ],
  },
  { name: 'AI/寫作輔助', keywords: ['寫作', 'writing assist', '優化技巧', '細節優化', '生成技巧'] },
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
      'telegram bot', 'discord bot', 'slack bot', 'line bot', 'chatbot',
      'langchain', 'langgraph', 'best practices', '最佳实践', '最佳實踐', '工程指南',
      '数据抓取', '資料抓取', '爬蟲', 'crawler', 'scraping', 'scraper', 'firecrawl',
      'cli tool', 'cli 工具', '情報', '無頭瀏覽器', 'headless browser', '團隊組建', 'skill清单', 'skill 清單',
    ],
  },
  {
    name: 'AI/LLM 基礎',
    keywords: [
      'transformer', 'attention mechanism', '注意力機制',
      'tokenization', 'fine-tuning', 'finetuning', 'pre-training', 'pretraining',
      'rlhf', 'reinforcement learning from human feedback',
      'context window', 'inference', '推理加速', 'speculative decoding',
      'quantization', 'int4', 'int8', 'gguf', 'ggml', 'lora', 'qlora', 'peft', 'model merging',
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

  // ── AI 工具介紹：開源工具、平台、GitHub repo ──
  {
    name: 'AI/工具介紹',
    keywords: [
      'github.com/', 'github -', '開源工具', '開源專案', 'open source',
      '工具推薦', '工具介紹', '工具合集', '神器', '好用', '必裝', '必備',
      '免費工具', 'free tool', '瀏覽器擴充', 'chrome extension',
      'app 推薦', 'app 介紹', '應用推薦', 'mac app',
    ],
  },

  // ── AI 模型動態：模型發布、效能比較、版本更新 ──
  {
    name: 'AI/模型動態',
    keywords: [
      '模型發布', '模型更新', '正式發布', '開源發布', 'model release',
      'benchmark', 'leaderboard', '效能比較', '性能測試', '評測',
      '版本更新', 'v0.', 'v1.', 'v2.', 'v3.', 'v4.',
      'minimax', 'qwen', 'llama', 'mistral', 'gemma', 'phi-',
      'deepseek', 'glm-', 'kimi', 'moonshot',
      '免费 claude', '免費 claude', 'claude 3', 'claude 4', 'o1', 'o3',
      'gpt-4', 'gpt-5', 'gpt4', 'gpt5',
    ],
  },

  // ── AI 部署教學：本地部署、安裝、配置指南 ──
  {
    name: 'AI/部署教學',
    keywords: [
      '本地部署', '本地安裝', '本地运行', '本機部署', 'local deploy',
      '部署教學', '部署教程', '安裝教學', '配置指南', 'setup guide',
      '手把手', '从0到1', '从零到一', '從0到1', '從零到一',
      '完全教程', '入門指南', '入门指南', '小白教程', '新手教程',
      'docker compose', 'docker run', 'ollama pull', 'lm studio',
    ],
  },

  // ── AI 研究對話：學術論文、技術原理、深度分析（兜底收窄）──
  {
    name: 'AI/研究對話',
    keywords: [
      '研究論文', '技術報告', 'arxiv', 'paper', '學術研究',
      '原理解析', '技術原理', '架構分析', '深度解讀',
      '研究發現', '實驗結果', '消融實驗', 'ablation',
    ],
  },

  // ── AI 產業觀察：趨勢、觀點、新聞（最終兜底）──
  {
    name: 'AI/產業觀察',
    keywords: [
      'ai', 'gpt', 'llm', 'copilot', 'diffusion',
      '人工智慧', '大語言模型', '大语言模型', '機器學習', 'machine learning', 'deep learning',
      '大模型', '模型评测', '模型評測',
    ],
  },
];
