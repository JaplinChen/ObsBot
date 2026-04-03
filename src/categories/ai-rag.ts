/** AI RAG 與知識圖譜分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 9. RAG & 知識圖譜 ──
  {
    name: 'AI/RAG & 知識圖譜',
    keywords: [
      'rag', 'retrieval augmented', 'vector database', 'embedding',
      'knowledge graph', '知識圖譜', 'graphrag', 'graph rag',
      'retrieval', 'chunking', 'reranking', 'rerank',
    ],
  },
];