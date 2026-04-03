/** Obsidian 相關分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 18. Obsidian ──
  {
    name: '生產力/Obsidian',
    keywords: [
      'obsidian', 'pkm', 'zettelkasten',
      '第二大腦', '第二大脑', '筆記軟體', '笔记软件', '筆記工具', '笔记工具',
      '雙向連結', '雙向鏈結', '知識網路', '知識網絡',
      'note-taking', 'knowledge-management', 'knowledge management',
      'personal-knowledge', 'roam', 'logseq', 'siyuan', '思源',
      '知識管理', '知识管理',
    ],
  },
];