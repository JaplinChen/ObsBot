/**
 * AI 筆記對話服務 — 支援分析與上下文感知問答。
 * LLM 呼叫全部走 runLocalLlmPrompt()。
 */
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { isOmlxAvailable, omlxStreamCompletion } from '../utils/omlx-client.js';
import { buildNoteContext } from './vault-reader.js';
import type { NoteRecord, ChatMessage, AnalysisOverview } from './types.js';

export type { DiagramType, DiagramSuggestion } from './diagram-service.js';
export { generateDiagram, analyzeForDiagrams } from './diagram-service.js';

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
  const context = buildNoteContext(notes, topic);
  const prompt = `${context}\n\n`
    + `針對「${topic}」，只回傳純 JSON（不含其他文字）：\n`
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
/** 截斷歷史：只保留最近 N 輪（user+assistant 各算一條）以防超出 context window。 */
const MAX_HISTORY_TURNS = 10;

export async function chatWithNotes(
  topic: string,
  notes: NoteRecord[],
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  const systemPrompt = buildNoteContext(notes, topic);

  const recentHistory = history.filter((m) => m.content).slice(-MAX_HISTORY_TURNS * 2);
  const historyText = recentHistory
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
 * 以筆記為上下文串流對話，透過 oMLX SSE 逐 token 回傳。
 * 若 oMLX 不可用，回退為一次性完整回覆。
 * opts.autodiagramA — 在 prompt 中注入模式A插圖標記指令
 * opts.allowedTypes — 允許的圖表類型清單
 */
export async function* streamChatWithNotes(
  topic: string,
  notes: NoteRecord[],
  history: ChatMessage[],
  userMessage: string,
  opts: { autodiagramA?: boolean; allowedTypes?: string[] } = {},
): AsyncGenerator<string> {
  if (!(await isOmlxAvailable())) {
    // 回退：整段完成再 yield
    const reply = await chatWithNotes(topic, notes, history, userMessage);
    yield reply;
    return;
  }

  const systemPrompt = buildNoteContext(notes, topic);
  const recentHistory = history.filter((m) => m.content).slice(-MAX_HISTORY_TURNS * 2);
  const historyText = recentHistory
    .map((m) => `${m.role === 'user' ? '使用者' : '助手'}：${m.content}`)
    .join('\n\n');

  const diagramInstruction = opts.autodiagramA
    ? `\n\n【插圖規則】若回覆涉及架構、流程、步驟或比較，可在相關段落後插入標記：[DIAGRAM:type:主題]。`
      + `type 限：${(opts.allowedTypes ?? ['flowchart', 'architecture']).join('/')}。`
      + '整個回覆最多插入 2 個標記，只在確實有助理解時才插入，不強制插入。'
    : '';

  const fullPrompt = [
    systemPrompt + diagramInstruction,
    historyText ? `\n\n對話歷史：\n${historyText}` : '',
    `\n\n使用者：${userMessage}`,
    '\n\n助手：',
  ].join('');

  let inThinking = false;
  let thinkBuf = '';

  for await (const chunk of omlxStreamCompletion(fullPrompt, { maxTokens: 2048, timeoutMs: 90_000 })) {
    // 過濾 <thinking> 區塊（cross-chunk 狀態機）
    thinkBuf += chunk;
    if (!inThinking && thinkBuf.includes('<thinking>')) {
      inThinking = true;
      const before = thinkBuf.slice(0, thinkBuf.indexOf('<thinking>'));
      if (before) yield before;
      thinkBuf = thinkBuf.slice(thinkBuf.indexOf('<thinking>'));
    }
    if (inThinking) {
      if (thinkBuf.includes('</thinking>')) {
        inThinking = false;
        thinkBuf = thinkBuf.slice(thinkBuf.indexOf('</thinking>') + '</thinking>'.length);
      } else {
        thinkBuf = thinkBuf.slice(-100); // 只保留尾端等待閉標籤
      }
    } else {
      yield thinkBuf;
      thinkBuf = '';
    }
  }
  if (thinkBuf && !inThinking) yield thinkBuf;
}

