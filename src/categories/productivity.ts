/** 生產力相關分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 27. 生產力 ──
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
];