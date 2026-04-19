/** 非 AI 通用分類 — 由 classifier-categories.ts 匯入 */

interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];
}

export const GENERAL_CATEGORIES: CategoryRule[] = [
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
      'ios ', 'ios開發', 'ios app', 'ios版', 'mac mini', 'mac studio', 'mac pro', 'imac',
      'macwhisper', 'orbstack', 'ghostty', 'raycast',
    ],
  },
  {
    name: '資安',
    keywords: [
      'security', 'cybersecurity', 'vulnerability', 'exploit', 'cve',
      '資安', '安全漏洞', '資訊安全', '網路安全', '漏洞', '滲透測試',
      'pentest', 'penetration test', 'hacking', 'malware', 'ransomware',
      'phishing', 'zero-day', 'xss', 'sql injection', 'csrf',
      'threat', 'attack surface', 'incident response', 'soc',
    ],
    exclude: ['生活安全', '食品安全', '交通安全'],
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
      '比特幣', '報酬', '資產', 'finance', '股市', 'market cap', 'bull market', 'bear market', '市場',
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
  { name: '行銷', keywords: ['marketing', 'seo策略', 'seo行銷', 'google ads', 'facebook ads', 'growth hack', 'content marketing', 'social media marketing', 'campaign', '行銷', '廣告', '流量', 'viral'] },
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

  // ══ 知識管理子分類（Obsidian PKM 生態）══
  {
    name: '知識管理/筆記方法論',
    keywords: [
      'zettelkasten', 'evergreen notes', 'progressive summarization',
      'hq&a', 'feynman', '費曼', '筆記方法', '學習方法', '記憶術',
      'spaced repetition', '間隔重複', 'anki', 'note-taking method',
      'moc', 'map of content', '主題地圖',
    ],
  },
  {
    name: '知識管理/Obsidian 設定',
    keywords: [
      'obsidian 設定', 'obsidian config', 'obsidian theme', 'obsidian vault',
      'obsidian 主題', 'obsidian 配置', 'obsidian css', 'obsidian snippets',
    ],
  },
  {
    name: '知識管理/Obsidian 插件',
    keywords: [
      'obsidian plugin', 'obsidian 插件', 'obsidian 外掛', 'dataview',
      'templater', 'excalidraw', 'kanban', 'community plugin',
    ],
  },

  // ══ 系統保留分類（不供關鍵字比對，只供白名單驗證）══
  { name: '知識整合', keywords: [] },
  { name: '其他', keywords: [] },
];
