/**
 * entity-wiki — 實體知識頁自動維護
 * 每當同一個 keyword 累積被 2 篇筆記提及，自動建立/更新該實體的獨立頁面。
 * 實體頁存於 {vaultPath}/KnowPipe/知識庫/{type}/{EntityName}.md
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import { classifyEntityType } from './entity-classifier.js';

const COUNTER_FILE = join('data', 'entity-wiki-counter.json');
const TRIGGER_THRESHOLD = 2;
const MAX_KEYWORDS_PER_NOTE = 6;
const KNOWLEDGE_BASE_DIR = '知識庫';

/** 每個實體的追蹤狀態 */
interface EntityEntry {
  count: number;      // 提及次數
  updatedAt: string;  // 上次 wiki 頁面更新時間
}

async function loadCounter(): Promise<Record<string, EntityEntry>> {
  return safeReadJSON<Record<string, EntityEntry>>(COUNTER_FILE, {});
}

async function saveCounter(data: Record<string, EntityEntry>): Promise<void> {
  await safeWriteJSON(COUNTER_FILE, data).catch(() => {});
}

/** 從 keyword 字串正規化成可用於檔名的實體名 */
function normalizeEntityName(kw: string): string {
  return kw.trim().replace(/[<>:"/\\|?*]/g, '').slice(0, 60);
}

/** 從 Vault 找出所有提及此 keyword 的筆記摘要 */
async function findNotesMentioning(
  vaultPath: string,
  keyword: string,
): Promise<Array<{ title: string; summary: string; category: string; date: string; filename: string }>> {
  const rootDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(rootDir).catch(() => [] as string[]);
  const kwLower = keyword.toLowerCase();
  const results: Array<{ title: string; summary: string; category: string; date: string; filename: string }> = [];

  for (const f of files) {
    if (f.includes('知識庫')) continue;
    try {
      const raw = await readFile(f, 'utf-8');
      const fm = parseFrontmatter(raw);
      const kwField = fm.get('keywords') ?? '';
      const kwList = parseArrayField(kwField).map(k => k.toLowerCase());
      if (!kwList.some(k => k === kwLower || k.includes(kwLower) || kwLower.includes(k))) continue;

      const title = fm.get('title') ?? '';
      const summary = fm.get('summary') ?? '';
      const category = fm.get('category') ?? '';
      const date = fm.get('date') ?? '';
      const filename = f.split('/').pop()?.replace(/\.md$/, '') ?? '';
      if (title) results.push({ title, summary, category, date, filename });
    } catch { /* skip */ }
  }

  return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
}

/** 呼叫 LLM 生成實體頁內容 */
async function generateEntityPage(
  entityName: string,
  entityType: string,
  notes: Array<{ title: string; summary: string; category: string }>,
): Promise<string> {
  const noteLines = notes
    .map((n, i) => `${i + 1}. 【${n.title}】${n.summary ? ' — ' + n.summary.slice(0, 120) : ''}`)
    .join('\n');

  const prompt = `你是知識管理助手。請根據以下筆記，用繁體中文為「${entityName}」（類型：${entityType}）撰寫一份結構化的知識頁面。

相關筆記（${notes.length} 篇）：
${noteLines}

請輸出以下結構（只輸出 markdown 正文，不要 frontmatter 和前言）：

## 核心定義
（1-2 句話解釋這個${entityType}是什麼）

## 主要特點或功能
（列出 3-5 個要點，每條 1 句話）

## 相關應用場景
（列出 2-3 個實際應用情境）

## 已知侷限或注意事項
（若有，列出 1-2 條；若筆記未提及則略過此節）`;

  return await runLocalLlmPrompt(prompt, { task: 'summarize' }) ?? '';
}

/** 決定實體類型對應的子目錄 */
function entityTypeToDir(entityType: string): string {
  const mapping: Record<string, string> = {
    tool: '工具',
    framework: '框架',
    concept: '概念',
    person: '人物',
    company: '公司',
    technology: '技術',
    platform: '平台',
    language: '語言',
  };
  return mapping[entityType] ?? '概念';
}

/**
 * 通知某篇筆記的 keywords 被記錄。
 * 對每個 keyword 累計計數，達閾值時觸發實體頁生成。
 * Fire-and-forget，不阻塞主要儲存流程。
 */
export async function notifyKeywordsAdded(
  keywords: string[],
  category: string,
  vaultPath: string,
): Promise<void> {
  if (!keywords || keywords.length === 0) return;

  try {
    const counter = await loadCounter();
    const toUpdate: string[] = [];

    for (const kw of keywords.slice(0, MAX_KEYWORDS_PER_NOTE)) {
      const name = normalizeEntityName(kw);
      if (!name || name.length < 2) continue;

      const entry = counter[name] ?? { count: 0, updatedAt: '' };
      entry.count++;

      if (entry.count >= TRIGGER_THRESHOLD && entry.count % TRIGGER_THRESHOLD === 0) {
        toUpdate.push(name);
      }
      counter[name] = entry;
    }

    await saveCounter(counter);

    for (const name of toUpdate) {
      await generateAndSaveEntityPage(name, category, vaultPath, counter).catch(err => {
        logger.warn('entity-wiki', '實體頁生成失敗', { name, err: String(err) });
      });
    }
  } catch (err) {
    logger.warn('entity-wiki', 'keywords 記錄失敗', { err: String(err) });
  }
}

async function generateAndSaveEntityPage(
  entityName: string,
  hintCategory: string,
  vaultPath: string,
  counter: Record<string, EntityEntry>,
): Promise<void> {
  const notes = await findNotesMentioning(vaultPath, entityName);
  if (notes.length < TRIGGER_THRESHOLD) return;

  const entityType = classifyEntityType(entityName, hintCategory);
  const typeDir = entityTypeToDir(entityType);

  logger.info('entity-wiki', '生成實體頁', { entityName, entityType, noteCount: notes.length });

  const body = await generateEntityPage(entityName, typeDir, notes);
  if (!body) return;

  const today = new Date().toISOString().slice(0, 10);
  const noteLinks = notes
    .map(n => `- [[${n.filename}|${n.title}]]`)
    .join('\n');

  const pageContent = [
    '---',
    `title: "${entityName}"`,
    `type: entity-wiki`,
    `entity_type: ${entityType}`,
    `updated: ${today}`,
    `note_count: ${notes.length}`,
    '---',
    '',
    `# ${entityName}`,
    '',
    body,
    '',
    '## 相關筆記',
    '',
    noteLinks,
    '',
  ].join('\n');

  const safeName = entityName.replace(/[<>:"/\\|?*]/g, '-');
  const pagePath = join(vaultPath, 'KnowPipe', KNOWLEDGE_BASE_DIR, typeDir, `${safeName}.md`);
  await mkdir(dirname(pagePath), { recursive: true });
  await writeFile(pagePath, pageContent, 'utf-8');

  counter[entityName].updatedAt = new Date().toISOString();
  logger.info('entity-wiki', '實體頁已儲存', { path: pagePath });
}
