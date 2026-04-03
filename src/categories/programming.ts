/** 程式設計相關分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 21. 程式設計 ──
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
];