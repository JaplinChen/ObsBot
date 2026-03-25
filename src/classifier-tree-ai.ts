/** AI 分類樹 */
import type { CategoryNode } from './classifier-categories.js';

export const AI_TREE: CategoryNode[] = [
  {
    name: 'AI',
    // 不放泛關鍵字 — 讓子節點各自精確匹配，泛詞放在末端「通用」兜底
    children: [

      // ── Agent 工程 ──
      {
        name: 'Agent 工程',
        keywords: [
          'ai agent', 'agentic', 'agent工程', 'agent engineer',
          'multi-agent', 'agent orchestration', 'agent 軍團', 'agent 架構',
          'agent framework', 'agent monitoring',
          'agent skill', 'agent 技能', 'agent team', 'agent 團隊',
          'mcp server', 'mcp tool', 'mcp ',
          'skill清单', 'skill 清單', 'skill市場', '團隊組建',
          'paperclip', 'symphony', 'open-sable', 'pi-agent',
          'langchain', 'langgraph',
          'telegram bot', 'bot framework',
          '自動化', 'automation', 'workflow',
          '導演式', '虛擬公司', 'ai團隊',
        ],
        children: [
          {
            name: 'OpenClaw',
            keywords: [
              'openclaw', 'open claw', 'openclaws', 'clawbot',
              'nanoclaw', 'opencloy', 'u-claw', 'clawhub',
              'openclaw-rl', 'nemoclaw', 'clawx',
              '龍蝦', '龙虾', '養蝦', '小龍蝦',
              'openjarvis', 'metaclaw', 'qveris', 'qclaw',
              'telegramlocalserver',
            ],
          },
          {
            name: '桌面 Agent',
            keywords: [
              '桌面助理', '桌面代理', '桌面 agent', '桌面agent',
              '桌面版', '桌面應用', '檔案管理ai', '檔案整理',
              'perplexity computer', 'perplexity personal computer',
              'comet browser', 'comet 瀏覽器',
            ],
            children: [
              {
                name: 'Cowork',
                keywords: ['claude cowork', 'cowork', 'copilot cowork'],
              },
              {
                name: 'OpenWork',
                keywords: ['openwork', 'open work'],
              },
            ],
          },
          {
            name: 'Claude Code',
            keywords: [
              'claude code', 'claude-code',
              'cc-switch', 'cc-connect', 'ccg workflow',
              'gstack', 'cli-anything',
              'claude skill', 'claude plugin',
              'agency agents', 'agency-agents',
              'claude-to-im', 'claude to im',
              'toonify', 'md2wechat',
              'article-illustrator', '文章配圖',
              'claude-cli', 'claude cli', 'claude telegram',
            ],
          },
        ],
      },

      // ── RAG & 知識圖譜 ──
      {
        name: 'RAG & 知識圖譜',
        keywords: [
          'rag', 'retrieval augmented', 'retrieval-augmented',
          'knowledge graph', '知識圖譜', '知識圖',
          'vector database', 'vector db', 'embedding', 'embeddings',
          '向量資料庫', '向量數據庫', '向量庫',
          'ai 記憶', 'ai記憶', 'memory system', 'memos',
          '召回', '檢索增強', '知識檢索',
          'second brain', '第二大腦', '第二大脑',
          '認知操作系統', 'cognitive os',
          'obsidian ai', 'obsidian claude', 'obsidian agent',
          'claudian', 'obsidian-claude',
          'notebooklm', 'notebook lm',
          'lenny資料集', 'ai友善markdown',
        ],
        children: [
          {
            name: 'GraphRAG',
            keywords: ['graphrag', 'graph rag', 'graph-rag'],
          },
        ],
      },

      // ── 部署 & 推理 ──
      {
        name: '部署 & 推理',
        keywords: [
          'ollama', '本地推理', 'local inference',
          '本地模型', 'local model', '本地 llm', '本地llm',
          '量化', 'quantization', 'gguf', 'ggml',
          '中轉站', 'api proxy', 'sub2api', 'cliproxyapi',
          '模型部署', 'model deploy', 'model serving',
          '免費 api', '免费 api', 'api 聚合',
          'omniroute', 'ai 閘道', 'ai gateway',
          'vps 部署', 'docker deploy',
        ],
      },

      // ── 開發工具 ──
      {
        name: '開發工具',
        keywords: [
          'cursor', 'windsurf', 'cline', 'codepilot',
          'cli tool', 'cli 工具', 'vizro',
          'public-apis', 'openai cookbook',
        ],
        children: [
          {
            name: '終端',
            keywords: [
              'terminal', '終端', 'kaku',
              'codex artifact', 'browser-use', 'browser use cli',
            ],
            children: [
              {
                name: 'Ghostty',
                keywords: ['ghostty', 'cmux'],
              },
            ],
          },
          {
            name: '爬蟲 & 擷取',
            keywords: [
              'firecrawl', 'crawler', 'scraping', 'scraper',
              '爬蟲', '資料抓取', '数据抓取',
              'web clipper', 'defuddle', 'agent-fetch', 'gpt-crawler',
              '無頭瀏覽器', 'headless browser', 'lightpanda',
              'bb-browser', '瀏覽器自動化',
              'kreuzberg', 'docspell', 'cloudflare crawler',
            ],
          },
          {
            name: 'CLI',
            keywords: ['opencli', 'open cli', 'reddit-cli', 'reddit cli'],
          },
        ],
      },

      // ── 多模態生成 ──
      {
        name: '多模態生成',
        children: [
          {
            name: '圖像',
            keywords: [
              'midjourney', 'dall-e', 'dalle', 'dall e', 'flux',
              'stability ai', 'stable diffusion', 'grok',
              'image generat', '圖片生成', '圖像生成', '圖片放大',
              'image enhance', 'comfyui', 'text to image', '文生圖',
              '3d model', '3d模型', 'trellis', 'nano banana',
            ],
          },
          {
            name: '影片',
            keywords: [
              'sora', 'luma', 'kling', 'pika', 'invideo',
              'heygen', 'runway', 'imgcreator', 'morphstudio',
              'jellyfish', 'seedance', 'hailuo',
              'video generat', '影片生成', '影片製作', '視頻生成',
              'text to video', '文生影片', '字幕', 'caption',
              'subtitle', '影片編輯', 'video edit', 'ffmpeg',
              '短影音', '剪輯', '影片提示詞', 'video prompt',
            ],
          },
          {
            name: '語音',
            keywords: [
              'macparakeet', 'mac parakeet', 'macwhisper', 'mac whisper',
              'typeno', 'type no', 'zero-type', 'zero type',
              'speech to text', 'stt', 'tts', 'text to speech',
              '語音輸入', 'voice input', '語音辨識', 'voice mode',
              'whisper',
            ],
          },
        ],
      },

      // ── Prompt 工程 ──
      {
        name: 'Prompt 工程',
        keywords: [
          'prompt engineering', 'system prompt', '提示词', '提示詞',
          '调教', '調教', 'soul.md',
          'few-shot', 'zero-shot', 'chain of thought',
          '寫作輔助', 'writing assist', '優化技巧', '生成技巧',
          '防幻覺', 'anti-hallucination', 'hallucination',
          'humanizer', '去人工化', 'prompt 技巧', 'prompt技巧',
          'copywriting', '文案', 'ad copy', '廣告文案',
          'rytr', 'copy.ai', 'copy ai', 'writesonic',
          'adcreative', 'otio', 'jasper ai', 'jasper.ai',
          'hix ai', 'hix.ai', 'jenny ai', 'textblaze',
          'text blaze', 'quillbot', '排版指北', '中英數字空格',
        ],
      },

      // ── LLM 基礎 ──
      {
        name: 'LLM 基礎',
        keywords: [
          '大模型', '模型评测', '模型評測',
          'benchmark', 'leaderboard',
          '預訓練', 'pre-train', 'fine-tun', '微調',
          'claude 3', 'claude 4', 'o1', 'o3',
          '免费 claude', '免費 claude',
          '完全教程', '教程', '小白', '新手',
          '入門指南', '入门指南', '入門教學',
          '从0开始', '从零开始', '零基礎', '零基础',
          'getting started', '手把手', '3分钟', '0代码',
        ],
        children: [
          { name: 'Claude', keywords: ['claude', 'anthropic'] },
          { name: 'OpenAI', keywords: ['chatgpt', 'openai', 'gpt-5', 'gpt-4o'] },
          { name: 'Gemini', keywords: ['gemini', 'google ai'] },
          { name: 'DeepSeek', keywords: ['deepseek'] },
          { name: '開源模型', keywords: ['minimax', 'qwen', 'llama', 'mistral', 'gemma', 'phi-', '開源模型', 'open source model'] },
        ],
      },

      // ── 應用場景 ──
      {
        name: '應用場景',
        keywords: [
          '辦公協作', '協作辦公', 'feishu', '飛書',
          '會議記錄', 'meeting note', 'meeting transcript', '會議摘要',
          'tldv', 'otter', 'noty ai', 'noty.ai', 'fireflies',
          'seo 優化', 'seo優化', 'seo tool', 'keyword research',
          'vidiq', 'seona', 'blogseo', 'keywrds',
          '客服', 'customer service', 'ai chatbot', '智慧客服',
          'droxy', 'chatbase', 'mutual info', 'chatsimple',
          '簡報', 'ppt', 'presentation', 'slide deck', '投影片',
          'decktopus', 'slides ai', 'slidesai',
          'gamma ai', 'gamma.app', 'beautiful ai', 'beautiful.ai',
          'popai', 'ui design', 'ux design', '介面設計',
          'prototype', 'wireframe', 'figma', 'uizard', 'uimagic',
          'photoshop', '設計工具', 'design tool', '平面設計',
          'canva', 'flair ai', 'clipdrop', 'autodraw',
          'magician design', 'logo生成', 'logo 生成', 'logo design',
          'logo設計', 'looka', 'website builder', '網站搭建',
          'ai 建站', 'ai建站', '10web', 'durable', 'framer',
          'style ai', 'landingsite', 'codex security', '資安',
          'security scan', '交易節點', 'ai 交易', '股票分析',
          '情報', 'intelligence', '情報牆',
          '自動化視頻', '自動化youtube', 'content collector',
          '內容收藏',
        ],
      },

      // ── 通用兜底（AI 相關但無更具體的子分類）──
      {
        name: '通用',
        keywords: [
          'ai', 'gpt', 'llm', 'copilot', 'diffusion',
          '人工智慧', '大語言模型', '大语言模型',
          '機器學習', 'machine learning', 'deep learning',
        ],
      },
    ],
  },

];
