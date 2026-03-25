import { describe, expect, it, vi } from 'vitest';

// Mock dynamic-classifier to isolate static tree-based logic
vi.mock('./learning/dynamic-classifier.js', () => ({
  classifyWithLearnedRules: vi.fn(() => null),
}));

import { classifyContent, extractKeywords } from './classifier.js';

describe('classifyContent — 樹狀分類器', () => {
  // ── 子節點優先（精確 > 泛） ──
  it('子節點命中時返回子節點路徑，不回退到父節點', () => {
    const result = classifyContent('OpenClaw 新功能發布', '龍蝦 agent');
    expect(result).toBe('AI/Agent 工程/OpenClaw');
  });

  it('Claude Code 內容歸 Claude Code 子分類', () => {
    const result = classifyContent('Claude Code 新功能', 'claude-code agent');
    expect(result).toBe('AI/Agent 工程/Claude Code');
  });

  it('Cowork 內容歸桌面 Agent/Cowork', () => {
    const result = classifyContent('Claude Cowork 入門', '桌面 agent');
    expect(result).toBe('AI/Agent 工程/桌面 Agent/Cowork');
  });

  it('GraphRAG 歸 RAG/GraphRAG 子分類', () => {
    const result = classifyContent('GraphRAG 實戰指南', '知識圖譜');
    expect(result).toBe('AI/RAG & 知識圖譜/GraphRAG');
  });

  it('Ghostty 歸開發工具/終端/Ghostty', () => {
    const result = classifyContent('Ghostty 終端配置', 'GPU 加速');
    expect(result).toBe('AI/開發工具/終端/Ghostty');
  });

  // ── 無子節點命中 → 回退到父節點 ──
  it('無子節點匹配時回退到父節點', () => {
    const result = classifyContent('全新 AI Agent 框架', 'multi-agent orchestration');
    expect(result).toMatch(/^AI\/Agent 工程/);
  });

  // ── 同分 tie-breaking：先出現者優先 ──
  it('同分時先出現的根節點優先（AI 排在非 AI 前面）', () => {
    // 'automation' 匹配 AI/Agent 工程；如果其他分類也 +1，AI 先出現所以贏
    const result = classifyContent('workflow automation', '');
    expect(result).toMatch(/^AI/);
  });

  // ── 無匹配 → '其他' ──
  it('完全無匹配時返回「其他」', () => {
    const result = classifyContent('asdfghjkl', 'qwertyuiop');
    expect(result).toBe('其他');
  });

  // ── oMLX 歸 macOS 生態 ──
  it('oMLX 內容歸 macOS 生態/oMLX，不被 AI/部署 & 推理 搶走', () => {
    const result = classifyContent('oMLX 本地推理伺服器', '本地模型 mlx apple');
    expect(result).toBe('macOS 生態/oMLX');
  });

  // ── 知識管理 ──
  it('Obsidian 純筆記方法歸知識管理', () => {
    const result = classifyContent('Zettelkasten 卡片盒筆記法', 'obsidian 雙向連結');
    expect(result).toBe('知識管理');
  });
});

describe('keywordMatch — 關鍵字匹配策略', () => {
  it('短關鍵字（≤3 字元）使用 word boundary', () => {
    // 'ai' 不應匹配 'Aitken'
    const result = classifyContent('Aitken 教授的演講', '');
    expect(result).not.toMatch(/^AI/);
  });

  it('長關鍵字使用 substring 匹配', () => {
    // 'openclaw' 應匹配含有該子串的標題
    const result = classifyContent('新的openclaw工具', '');
    expect(result).toBe('AI/Agent 工程/OpenClaw');
  });
});

describe('extractKeywords', () => {
  it('從樹中收集命中的關鍵詞（最多 5 個）', () => {
    const kws = extractKeywords('GraphRAG 知識圖譜 embedding', 'vector database rag');
    expect(kws.length).toBeGreaterThan(0);
    expect(kws.length).toBeLessThanOrEqual(5);
  });

  it('無匹配時返回空陣列', () => {
    const kws = extractKeywords('asdfghjkl', 'qwertyuiop');
    expect(kws).toEqual([]);
  });
});
