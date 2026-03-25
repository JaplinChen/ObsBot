/** 非 AI 分類樹 */
import type { CategoryNode } from './classifier-categories.js';

export const NON_AI_TREE: CategoryNode[] = [
  // macOS 生態（含 oMLX 子分類，排在知識管理前面）
  {
    name: 'macOS 生態',
    keywords: [
      'mac', 'macbook', 'iphone', 'ipad', 'macos', 'apple silicon',
      'apple watch', 'ios ', 'mac mini', 'mac studio', 'mac pro',
      'imac', 'orbstack', 'homebrew', 'amphetamine', '闔蓋不休眠',
      'mole', '清理工具', '磁盤清理', '系統優化', 'oneclip',
      '剪貼簿', 'syncthing', '檔案同步', 'recordly', '螢幕錄製',
    ],
    children: [
      {
        name: 'oMLX',
        keywords: [
          'omlx', 'omlx-', 'mlx',
          'apple neural engine', 'neural engine', 'rustane',
          '本地推理', 'local inference', '本地模型', 'local model',
          '本地 llm', '本地llm',
        ],
      },
    ],
  },
  {
    name: '知識管理',
    keywords: [
      'obsidian', 'pkm', 'zettelkasten',
      '第二大腦', '第二大脑', '筆記軟體', '笔记软件',
      '筆記工具', '笔记工具', '雙向連結', '雙向鏈結',
      '知識圖譜', '知識網路', '知識網絡',
      'evergreen note', '漸進式總結', 'moc', 'breadcrumbs',
      'dataview', 'note refactor', 'hq&a',
      '卡片盒', '筆記法', '筆記系統', '知識管理',
    ],
  },
  {
    name: '軟體開發',
    keywords: [
      'programming', 'javascript', 'typescript', 'python', 'rust',
      'react', 'nextjs', '程式設計', 'backend', 'frontend',
      'database', '健康檢查', 'heartbeat', 'health check',
      'c#', '.net', 'golang', 'swift', 'kotlin', 'docker',
      'worklenz', '專案管理',
    ],
  },
  {
    name: '商業 & 趨勢',
    keywords: [
      'startup', 'founder', 'vc', 'venture', 'saas', 'product',
      'revenue', 'mrr', 'arr', 'b2b', '創業', '創辦人', '商業',
      '商業模式', 'business', 'entrepreneur', '產品',
      'stock', 'etf', 'crypto', 'bitcoin', 'invest', 'portfolio',
      'dividend', '股票', '基金', '投資', '理財', '加密貨幣',
      'marketing', 'seo', 'google ads', 'growth hack',
      '行銷', '廣告', '流量', 'viral',
      'news', 'breaking', '新聞', '時事', '政策', '國際',
    ],
  },
  {
    name: '中文媒體',
    keywords: [
      '微博', 'weibo', '小紅書', '小红书', 'xiaohongshu',
      'bilibili', 'b站', '嗶哩嗶哩', '哔哩哔哩',
      '抖音', 'douyin', 'tiktok', '知乎', 'zhihu',
      '微信', 'wechat', '公眾號',
    ],
  },
  {
    name: '生活',
    keywords: [
      'food', 'travel', 'health', 'fitness', 'workout', 'recipe',
      'book review', 'movie', '飲食', '旅遊', '健康', '運動',
      '閱讀', '電影', 'lifestyle',
    ],
  },
];
