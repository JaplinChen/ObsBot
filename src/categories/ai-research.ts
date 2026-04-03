/** AI 研究對話分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
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
    keywords: [
      'claude code', 'claude', 'anthropic',
    ],
  },
  {
    name: 'AI/研究對話/OpenAI',
    keywords: [
      'chatgpt', 'openai', 'codex', 'openai codex', 'gpt-5', 'gpt-4o',
    ],
  },
  {
    name: 'AI/研究對話/Gemini',
    keywords: [
      'gemini', 'notebooklm', 'notebook lm', 'nano banana', 'google ai',
    ],
  },
  {
    name: 'AI/研究對話/DeepSeek',
    keywords: ['deepseek'],
  },
  {
    name: 'AI/研究對話/OpenClaw',
    keywords: [
      'openclaw', 'open claw', 'openclaws', 'clawbot', '龍蝦', '龙虾',
      'nanoclaw', 'opencloy', 'u-claw', 'clawhub', '養蝦', '小龍蝦',
    ],
  },
  {
    name: 'AI/研究對話/Perplexity',
    keywords: ['perplexity'],
  },
  {
    name: 'AI/研究對話/Abacus',
    keywords: ['abacus'],
  },
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
];