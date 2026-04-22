/**
 * LLM Wiki 模式 — 每個 category 維護一份動態 wiki.md
 * 每當同 category 累積 3 篇新筆記時自動觸發更新。
 * wiki 頁面存於 {vaultPath}/KnowPipe/{category}/wiki.md
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { getAllMdFiles, parseFrontmatter } from '../vault/frontmatter-utils.js';

const COUNTER_FILE = join('data', 'wiki-counter.json');
const TRIGGER_THRESHOLD = 3;

interface CounterEntry {
  pending: number;   // 尚未觸發 wiki 更新的新筆記數
  updatedAt: string; // 上次 wiki 更新時間
}

async function loadCounter(): Promise<Record<string, CounterEntry>> {
  try {
    const raw = await readFile(COUNTER_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, CounterEntry>;
  } catch { return {}; }
}

async function saveCounter(data: Record<string, CounterEntry>): Promise<void> {
  try {
    const { safeWriteJSON } = await import('../core/safe-write.js');
    await safeWriteJSON(COUNTER_FILE, data);
  } catch { /* best-effort */ }
}

/** 取得該 category 最近 10 篇筆記的 title + summary */
async function getRecentCategoryNotes(
  vaultPath: string, category: string, limit = 10,
): Promise<Array<{ title: string; summary: string; keywords: string }>> {
  const catPath = join(vaultPath, 'KnowPipe', ...category.split('/'));
  const files = await getAllMdFiles(catPath).catch(() => [] as string[]);

  const notes: Array<{ title: string; summary: string; keywords: string; date: string }> = [];
  for (const f of files) {
    if (f.endsWith('wiki.md')) continue;
    try {
      const raw = await readFile(f, 'utf-8');
      const fm = parseFrontmatter(raw);
      const title = fm.get('title') ?? '';
      const summary = fm.get('summary') ?? '';
      const keywords = fm.get('keywords') ?? '';
      const date = fm.get('date') ?? '';
      if (title || summary) notes.push({ title, summary, keywords, date });
    } catch { /* skip */ }
  }
  return notes
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map(({ title, summary, keywords }) => ({ title, summary, keywords }));
}

/** 讀取現有 wiki.md 的內容（若存在） */
async function loadExistingWiki(wikiPath: string): Promise<string> {
  try { return await readFile(wikiPath, 'utf-8'); }
  catch { return ''; }
}

/** 呼叫 LLM 更新 wiki 內容 */
async function generateWiki(
  category: string,
  notes: Array<{ title: string; summary: string; keywords: string }>,
  existingWiki: string,
): Promise<string> {
  const noteLines = notes
    .map((n, i) => `${i + 1}. 【${n.title}】${n.summary ? ' — ' + n.summary : ''}${n.keywords ? ' (' + n.keywords + ')' : ''}`)
    .join('\n');

  const existingSection = existingWiki
    ? `\n現有 wiki 內容（請在此基礎上更新）：\n${existingWiki.slice(0, 1500)}`
    : '';

  const prompt = `你是知識管理助手。請根據「${category}」分類的最新筆記，用繁體中文撰寫/更新一份 wiki 摘要頁面。

最新 ${notes.length} 篇筆記：
${noteLines}
${existingSection}

請輸出以下結構（只輸出 markdown，不要前言）：

## 核心主題
（2-3 句話描述本分類的主要關注方向）

## 近期觀點演進
（列出 3-5 個最新的觀點或趨勢，每條 1-2 句）

## 值得關注的矛盾或爭議
（若有相互衝突的觀點，列出 1-3 條；若無則略過此節）

## 延伸探索方向
（建議 2-3 個值得深入的問題或方向）`;

  return await runLocalLlmPrompt(prompt, { task: 'summarize' }) ?? '';
}

/**
 * 記錄一篇新筆記存入。若累積達 TRIGGER_THRESHOLD 篇，觸發 wiki 更新。
 * 設計為非同步 fire-and-forget，不阻塞主要儲存流程。
 */
export async function notifyNoteAdded(
  category: string,
  vaultPath: string,
): Promise<void> {
  if (!category) return;
  // 只對 2 層以內的分類建立 wiki（避免過深的子分類）
  const depth = category.split('/').length;
  if (depth > 2) return;

  try {
    const counter = await loadCounter();
    const entry = counter[category] ?? { pending: 0, updatedAt: '' };
    entry.pending++;

    if (entry.pending < TRIGGER_THRESHOLD) {
      counter[category] = entry;
      await saveCounter(counter);
      return;
    }

    // 達到閾值，觸發 wiki 更新
    logger.info('wiki-updater', 'wiki 更新觸發', { category, pending: entry.pending });
    entry.pending = 0;
    entry.updatedAt = new Date().toISOString();
    counter[category] = entry;
    await saveCounter(counter);

    const notes = await getRecentCategoryNotes(vaultPath, category);
    if (notes.length === 0) return;

    const wikiPath = join(vaultPath, 'KnowPipe', ...category.split('/'), 'wiki.md');
    const existingWiki = await loadExistingWiki(wikiPath);
    const body = await generateWiki(category, notes, existingWiki);
    if (!body) return;

    const today = new Date().toISOString().slice(0, 10);
    const wikiContent = `---\ntype: wiki\ncategory: ${category}\nupdated: ${today}\nnote_count: ${notes.length}\n---\n\n# ${category} 知識圖譜\n\n${body}\n`;

    await mkdir(dirname(wikiPath), { recursive: true });
    await writeFile(wikiPath, wikiContent, 'utf-8');
    logger.info('wiki-updater', 'wiki 已更新', { category, path: wikiPath });
  } catch (err) {
    logger.warn('wiki-updater', 'wiki 更新失敗（不影響儲存）', { category, err: String(err) });
  }
}
