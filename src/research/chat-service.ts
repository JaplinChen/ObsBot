/**
 * AI 筆記對話服務 — 支援分析與上下文感知問答。
 * LLM 呼叫全部走 runLocalLlmPrompt()。
 */
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { buildNoteContext } from './vault-reader.js';
import { parseArchSpec, buildArchitectureSvg } from './arch-svg-builder.js';
import type { NoteRecord, ChatMessage, AnalysisOverview } from './types.js';

/* ── 工具函式 ────────────────────────────────────────────────── */

/** 移除 LLM 輸出中的 <thinking>/<think> 區塊。 */
function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

/** 從 LLM 回覆中提取 JSON。 */
function extractJson<T>(text: string): T | null {
  const cleaned = stripThinkingTags(text);

  // 嘗試 fenced JSON
  const fenced = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]) as T; } catch { /* fall through */ }
  }

  // 嘗試裸 JSON
  const braceStart = cleaned.indexOf('{');
  const braceEnd = cleaned.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try { return JSON.parse(cleaned.slice(braceStart, braceEnd + 1)) as T; } catch { /* fall through */ }
  }

  return null;
}

/* ── 公開 API ────────────────────────────────────────────────── */

/**
 * 分析所選筆記，產生摘要、關鍵問題、核心概念。
 */
export async function analyzeNotes(
  topic: string,
  notes: NoteRecord[],
): Promise<AnalysisOverview | null> {
  // 取前 6 篇筆記的摘要，每篇最多 300 字
  const noteSnippets = notes.slice(0, 6).map((n) => {
    const content = (n.body || n.preview || '').slice(0, 300);
    return `【${n.name}】${content}`;
  }).join('\n---\n') || '無';

  const prompt = `針對「${topic}」，基於以下筆記內容：\n${noteSnippets}\n\n只回傳純 JSON（不含其他文字）：\n`
    + '{"summary":"摘要100字以內","keyQuestions":["Q1","Q2","Q3","Q4","Q5"],'
    + '"keyConcepts":["概念1","概念2","概念3","概念4","概念5"]}';

  const result = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    maxTokens: 1024,
    timeoutMs: 60_000,
  });

  if (!result) return null;
  return extractJson<AnalysisOverview>(result);
}

/**
 * 以筆記為上下文進行對話，回傳助手回覆。
 * 支援 wikilink [[筆記名稱]] 歸因。
 */
export async function chatWithNotes(
  topic: string,
  notes: NoteRecord[],
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  const systemPrompt = buildNoteContext(notes, topic);

  // 組裝對話歷史為單一 prompt（因 runLocalLlmPrompt 只接受單一 prompt）
  const historyText = history
    .filter((m) => m.content)
    .map((m) => `${m.role === 'user' ? '使用者' : '助手'}：${m.content}`)
    .join('\n\n');

  const fullPrompt = [
    systemPrompt,
    historyText ? `\n\n對話歷史：\n${historyText}` : '',
    `\n\n使用者：${userMessage}`,
    '\n\n助手：',
  ].join('');

  const result = await runLocalLlmPrompt(fullPrompt, {
    task: 'analyze',
    maxTokens: 2048,
    timeoutMs: 90_000,
  });

  if (!result) return '（LLM 無回應，請稍後再試）';
  return stripThinkingTags(result);
}

/**
 * 產生研究報告 — 結構化的深度分析。
 */
export async function generateResearchReport(
  topic: string,
  notes: NoteRecord[],
): Promise<string> {
  const context = buildNoteContext(notes, topic);
  const prompt = `${context}\n\n`
    + `請針對「${topic}」撰寫一份結構化研究報告，包含：\n`
    + '1. ## 摘要（100-150字概述）\n'
    + '2. ## 背景（為何這個主題重要）\n'
    + '3. ## 核心發現（3-5 個重點，每個用 ### 子標題）\n'
    + '4. ## 分析與洞察（跨筆記的整合觀點）\n'
    + '5. ## 結論與建議\n\n'
    + '引用筆記時用 [[筆記名稱]] 標注。用繁體中文。';

  const result = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    model: 'deep',
    maxTokens: 3072,
    timeoutMs: 120_000,
  });

  return result ? stripThinkingTags(result) : '（報告生成失敗）';
}

/**
 * 產生比較表 — 多筆記的對比分析。
 */
export async function generateComparisonTable(
  topic: string,
  notes: NoteRecord[],
): Promise<string> {
  const context = buildNoteContext(notes, topic);
  const prompt = `${context}\n\n`
    + `請針對「${topic}」建立一個比較表，比較上述筆記中提到的主要概念/工具/方法。\n`
    + '輸出格式為 Markdown 表格，至少 3 個比較維度。\n'
    + '表格後附上簡短的比較分析（100-200字）。用繁體中文。';

  const result = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    maxTokens: 2048,
    timeoutMs: 90_000,
  });

  return result ? stripThinkingTags(result) : '（比較表生成失敗）';
}

/**
 * 產生 Anki 閃卡 — 10 張問答卡片。
 */
export async function generateAnkiCards(
  topic: string,
  notes: NoteRecord[],
): Promise<string> {
  const context = buildNoteContext(notes, topic);
  const prompt = `${context}\n\n`
    + `請從「${topic}」相關內容中提取 10 個關鍵知識點，產生 Anki 閃卡。\n`
    + '格式：每張卡片用 ### 分隔，包含「**問題：**」和「**答案：**」。\n'
    + '問題應測試理解而非記憶。用繁體中文。';

  const result = await runLocalLlmPrompt(prompt, {
    task: 'summarize',
    maxTokens: 2048,
    timeoutMs: 90_000,
  });

  return result ? stripThinkingTags(result) : '（閃卡生成失敗）';
}

/**
 * 產生教學大綱 — 課程結構。
 */
export async function generateTeachingOutline(
  topic: string,
  notes: NoteRecord[],
): Promise<string> {
  const context = buildNoteContext(notes, topic);
  const prompt = `${context}\n\n`
    + `請為「${topic}」設計一份教學大綱，包含：\n`
    + '1. ## 學習目標（3-5 個）\n'
    + '2. ## 課程章節（5-8 章，每章含 ### 標題、學習重點、關鍵概念）\n'
    + '3. ## 延伸閱讀\n\n'
    + '引用筆記時用 [[筆記名稱]] 標注。用繁體中文。';

  const result = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    model: 'deep',
    maxTokens: 3072,
    timeoutMs: 120_000,
  });

  return result ? stripThinkingTags(result) : '（教學大綱生成失敗）';
}

/**
 * 圖表類型定義。
 */
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
    '請為「{topic}」的系統架構生成 JSON 描述。只輸出 ```json 代碼塊，不加其他文字。\n\n'
    + '格式：{"title":"圖表標題","nodes":[{"id":"英文ID","label":"元件名稱","sublabel":"技術/備註","type":"類型"}],"edges":[{"from":"ID","to":"ID","label":"協議"}]}\n\n'
    + '規則：\n'
    + '- nodes 最多 8 個，必要時合併次要元件\n'
    + '- type 對應：前端UI→cyan、後端API→green、資料庫儲存→purple、雲端基礎設施→amber、安全認證→rose、訊息佇列→orange\n'
    + '- edges 描述元件間的呼叫或資料流，label 填 REST/SQL/gRPC/MQTT 等協議\n'
    + '- 所有 label/sublabel 用繁體中文',
};

/**
 * 自動生成 Mermaid 圖表。
 */
export async function generateDiagram(
  type: DiagramType,
  topic: string,
  notes: NoteRecord[],
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

  // 架構圖 — 從 JSON 規格產生 SVG（座標由 builder 計算，不靠 LLM）
  if (isArchitecture) {
    const spec = parseArchSpec(cleaned);
    if (spec && spec.nodes.length > 0) {
      return '```svg\n' + buildArchitectureSvg(spec) + '\n```';
    }
    return '（架構圖生成失敗：LLM 未回傳有效 JSON，請稍後重試）';
  }

  // Mermaid 圖表 — 確保包含 ```mermaid 代碼塊
  if (cleaned.includes('```mermaid')) return cleaned;
  const mermaidKeywords = ['graph ', 'flowchart ', 'sequenceDiagram', 'mindmap', 'timeline', 'classDiagram', 'gantt'];
  if (mermaidKeywords.some(k => cleaned.includes(k))) {
    return '```mermaid\n' + cleaned.trim() + '\n```';
  }

  return cleaned;
}
