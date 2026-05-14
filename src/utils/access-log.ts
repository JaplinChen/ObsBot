/**
 * Access Log — 記錄查詢行為，供未來 enricher 自適應優先級分析。
 * 追蹤：查詢關鍵字 × 命中的 category 頻率 + 逐筆記訪問記錄（供死角分析）。
 * 寫入 data/access-log.json（append-only，定期被 enricher 讀取）
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOG_FILE = join('data', 'access-log.json');
const MAX_QUERY_ENTRIES = 500;
const MAX_NOTE_ACCESS_ENTRIES = 2000;

export interface NoteAccessEntry {
  filePath: string;
  title: string;
  category: string;
  ts: string;
}

export interface AccessLog {
  /** 各 category 被查詢命中的累計次數 */
  categoryCounts: Record<string, number>;
  /** 近期查詢記錄（最多 MAX_QUERY_ENTRIES 條） */
  queries: Array<{ query: string; categories: string[]; ts: string }>;
  /** 逐筆記訪問記錄（最多 MAX_NOTE_ACCESS_ENTRIES 條） */
  noteAccesses: NoteAccessEntry[];
}

async function load(): Promise<AccessLog> {
  try {
    const raw = await readFile(LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AccessLog>;
    return {
      categoryCounts: parsed.categoryCounts ?? {},
      queries: parsed.queries ?? [],
      noteAccesses: parsed.noteAccesses ?? [],
    };
  } catch {
    return { categoryCounts: {}, queries: [], noteAccesses: [] };
  }
}

async function save(log: AccessLog): Promise<void> {
  try {
    const { safeWriteJSON } = await import('../core/safe-write.js');
    await safeWriteJSON(LOG_FILE, log);
  } catch { /* best-effort */ }
}

/**
 * 記錄一次查詢事件（find / knowledge-query / vsearch 命中時呼叫）。
 * @param query 用戶輸入的查詢詞
 * @param categories 命中的 category 列表
 */
export async function recordQuery(query: string, categories: string[]): Promise<void> {
  if (!query || categories.length === 0) return;
  try {
    const log = await load();
    // 更新 category 命中計數
    for (const cat of categories) {
      const root = cat.split('/')[0] ?? cat;
      log.categoryCounts[root] = (log.categoryCounts[root] ?? 0) + 1;
    }
    // 追加查詢記錄（cap at MAX_QUERY_ENTRIES）
    log.queries.push({ query: query.slice(0, 80), categories: categories.slice(0, 5), ts: new Date().toISOString() });
    if (log.queries.length > MAX_QUERY_ENTRIES) {
      log.queries = log.queries.slice(-MAX_QUERY_ENTRIES);
    }
    await save(log);
  } catch { /* best-effort, 不影響查詢本身 */ }
}

/**
 * 記錄單篇筆記被訪問（/ask 搜尋命中時呼叫）。
 */
export async function recordNoteAccess(filePath: string, title: string, category: string): Promise<void> {
  if (!filePath) return;
  try {
    const log = await load();
    log.noteAccesses.push({ filePath, title: title.slice(0, 100), category, ts: new Date().toISOString() });
    if (log.noteAccesses.length > MAX_NOTE_ACCESS_ENTRIES) {
      log.noteAccesses = log.noteAccesses.slice(-MAX_NOTE_ACCESS_ENTRIES);
    }
    await save(log);
  } catch { /* best-effort */ }
}

/**
 * 取得最近 N 天的筆記訪問記錄。
 */
export async function getRecentNoteAccesses(days: number): Promise<NoteAccessEntry[]> {
  const log = await load();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return log.noteAccesses.filter((e) => new Date(e.ts) >= cutoff);
}

/** 讀取 access-log（供 enricher 自適應使用）*/
export async function getAccessLog(): Promise<AccessLog> {
  return load();
}
