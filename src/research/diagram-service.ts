/**
 * 圖表生成服務 — Mermaid 與 SVG 架構圖。
 */
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { buildNoteContext } from './vault-reader.js';
import { parseArchSpec, buildArchitectureSvg, type ArchStyle } from './arch-svg-builder.js';
import type { NoteRecord } from './types.js';

function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

export type DiagramType = 'flowchart' | 'mindmap' | 'timeline' | 'sequence' | 'architecture';

const DIAGRAM_PROMPTS: Record<DiagramType, string> = {
  flowchart:
    '請用 Mermaid flowchart LR 語法，畫出「{topic}」的核心概念流程圖。\n'
    + '節點用中文標示，包含 5-10 個節點，清楚顯示因果/流程關係。\n'
    + '只輸出 ```mermaid 代碼塊，不加其他文字。',
  mindmap:
    '請用 Mermaid mindmap 語法，畫出「{topic}」的心智圖。\n'
    + '根節點為主題，展開 3-4 層，中文標示。\n'
    + '只輸出 ```mermaid 代碼塊，不加其他文字。',
  timeline:
    '請用 Mermaid timeline 語法，畫出「{topic}」的時間軸或發展歷程。\n'
    + '如果沒有明確時間點，用邏輯順序的階段取代（如「第一階段」「第二階段」）。\n'
    + '中文標示。只輸出 ```mermaid 代碼塊，不加其他文字。',
  sequence:
    '請用 Mermaid sequenceDiagram 語法，畫出「{topic}」的互動時序圖。\n'
    + '顯示主要參與者之間的訊息流。中文標示。\n'
    + '只輸出 ```mermaid 代碼塊，不加其他文字。',
  architecture:
    '只回傳一個 JSON 物件，第一個字元是 {，最後一個字元是 }，絕對不含其他任何文字或 markdown。\n\n'
    + '為「{topic}」生成架構圖節點與連線：\n'
    + '{"title":"標題","nodes":[{"id":"英文ID","label":"名稱","sublabel":"技術","type":"類型"}],"edges":[{"from":"ID","to":"ID","label":"協議"}]}\n\n'
    + 'nodes 最多 8 個。type 值：前端→cyan、後端→green、資料庫→purple、雲端→amber、安全→rose、佇列→orange\n'
    + 'label/sublabel 用繁體中文。只輸出 JSON，不輸出任何解釋。',
};

/**
 * 自動生成 Mermaid 圖表或 SVG 架構圖。
 */
export async function generateDiagram(
  type: DiagramType,
  topic: string,
  notes: NoteRecord[],
  style: ArchStyle = 'sketch',
): Promise<string> {
  const context = buildNoteContext(notes, topic);
  const templatePrompt = DIAGRAM_PROMPTS[type] ?? DIAGRAM_PROMPTS.flowchart;
  const taskPrompt = templatePrompt.replace('{topic}', topic);
  const prompt = `${context}\n\n${taskPrompt}`;

  const isArchitecture = type === 'architecture';
  const result = await runLocalLlmPrompt(prompt, {
    task: 'summarize',
    maxTokens: isArchitecture ? 3072 : 1024,
    timeoutMs: isArchitecture ? 120_000 : 60_000,
  });

  if (!result) return '（圖表生成失敗，請稍後再試）';
  const cleaned = stripThinkingTags(result);

  if (isArchitecture) {
    let spec = parseArchSpec(cleaned);
    if (!spec || spec.nodes.length === 0) {
      const retry = await runLocalLlmPrompt(prompt, { task: 'summarize', maxTokens: 512, timeoutMs: 60_000 });
      if (retry) spec = parseArchSpec(stripThinkingTags(retry));
    }
    if (spec && spec.nodes.length > 0) {
      return '```svg\n' + buildArchitectureSvg(spec, style) + '\n```';
    }
    return '（架構圖生成失敗：LLM 未回傳有效 JSON，請稍後重試）';
  }

  if (cleaned.includes('```mermaid')) return cleaned;
  const mermaidKeywords = ['graph ', 'flowchart ', 'sequenceDiagram', 'mindmap', 'timeline', 'classDiagram', 'gantt'];
  if (mermaidKeywords.some((k) => cleaned.includes(k))) {
    return '```mermaid\n' + cleaned.trim() + '\n```';
  }
  return cleaned;
}

export interface DiagramSuggestion {
  anchor: string;
  type: DiagramType;
  topic: string;
}

/**
 * 分析回覆文字，建議適合插入圖表的位置（模式B後處理）。
 */
export async function analyzeForDiagrams(
  replyText: string,
  allowedTypes: DiagramType[],
  maxDiagrams: number,
): Promise<DiagramSuggestion[]> {
  const typesStr = allowedTypes.join('/');
  const prompt =
    `以下是研究助手的回覆（前 3000 字）：\n\n${replyText.slice(0, 3000)}\n\n`
    + `找出最多 ${maxDiagrams} 個適合插入圖表的位置，只在能顯著幫助理解的地方建議。\n`
    + `可用類型：${typesStr}（flowchart=流程/步驟、mindmap=概念關聯、timeline=時間軸、sequence=互動時序、architecture=系統架構）\n`
    + '回傳純 JSON 陣列：[{"anchor":"段落開頭前20字（必須與原文完全相符）","type":"類型","topic":"主題（10字內，繁體中文）"}]\n'
    + '若無適合位置回傳 []，不輸出任何其他文字。';

  const result = await runLocalLlmPrompt(prompt, { task: 'summarize', maxTokens: 512, timeoutMs: 45_000 });
  if (!result) return [];

  const cleaned = stripThinkingTags(result);
  const a = cleaned.indexOf('[');
  const b = cleaned.lastIndexOf(']');
  if (a < 0 || b <= a) return [];

  try {
    const arr = JSON.parse(cleaned.slice(a, b + 1)) as DiagramSuggestion[];
    return arr
      .filter((s) => s.anchor && s.type && s.topic && allowedTypes.includes(s.type))
      .slice(0, maxDiagrams);
  } catch {
    return [];
  }
}
