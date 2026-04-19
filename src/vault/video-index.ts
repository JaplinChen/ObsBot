/**
 * Vault 影片筆記語意搜尋索引。
 * 以 node:sqlite FTS5 trigram 建立全文索引，支援中英文查詢。
 * 索引對象：YouTube / Bilibili / TikTok / Douyin / Threads / X 來源筆記中的影片類。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles, parseFrontmatter } from './frontmatter-utils.js';
import { logger } from '../core/logger.js';

/** 影片來源平台清單（source 欄位） */
const VIDEO_SOURCES = new Set(['YouTube', 'Bilibili', 'TikTok', 'Douyin', 'X (Twitter)']);

/** 影片類 category 關鍵字 */
const VIDEO_CATEGORY_RE = /影片|video/i;

let _db: DatabaseSync | null = null;

function getDb(dbPath: string): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath);
  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS video_notes USING fts5(
      path UNINDEXED,
      title,
      summary,
      keywords,
      source UNINDEXED,
      tokenize='trigram'
    )
  `);
  return _db;
}

export interface VideoNoteRecord {
  path: string;
  title: string;
  summary: string;
  keywords: string;
  source: string;
}

/** 判斷一篇筆記是否為影片類 */
function isVideoNote(fm: Map<string, string>): boolean {
  const source = fm.get('source') ?? '';
  const category = fm.get('category') ?? '';
  return VIDEO_SOURCES.has(source) || VIDEO_CATEGORY_RE.test(category);
}

/** 重建索引（掃描整個 KnowPipe vault） */
export async function rebuildVideoIndex(vaultPath: string, dbPath: string): Promise<number> {
  const db = getDb(dbPath);
  db.exec('DELETE FROM video_notes');

  const rootDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(rootDir);
  let count = 0;

  const insert = db.prepare('INSERT INTO video_notes VALUES (?,?,?,?,?)');

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(raw);
      if (!isVideoNote(fm)) continue;

      const relPath = filePath.replace(/.*KnowPipe[\\/]/, '');
      const title = fm.get('title') ?? '';
      const summary = fm.get('summary') ?? '';
      const keywords = fm.get('keywords') ?? '';
      const source = fm.get('source') ?? '';

      insert.run(relPath, title, summary, keywords, source);
      count++;
    } catch {
      // Skip unreadable files
    }
  }

  logger.info('video-index', '索引建立完成', { count, dbPath });
  return count;
}

/** 搜尋影片筆記。FTS5 trigram（≥3字）+ LIKE fallback（短詞）*/
export function searchVideoNotes(query: string, dbPath: string, limit = 8): VideoNoteRecord[] {
  const db = getDb(dbPath);

  // FTS5 trigram 搜尋（中文 trigram 需要 >=3 字，英文 token 不受限）
  try {
    const rows = db.prepare(
      'SELECT path, title, summary, keywords, source FROM video_notes WHERE video_notes MATCH ? ORDER BY rank LIMIT ?',
    ).all(query, limit) as unknown as VideoNoteRecord[];
    if (rows.length > 0) return rows;
  } catch {
    // FTS5 語法錯誤（如特殊字元）→ fallback
  }

  // LIKE fallback（短詞或特殊字元）
  const like = `%${query}%`;
  return db.prepare(
    `SELECT path, title, summary, keywords, source FROM video_notes
     WHERE title LIKE ? OR summary LIKE ? OR keywords LIKE ?
     LIMIT ?`,
  ).all(like, like, like, limit) as unknown as VideoNoteRecord[];
}

/** 取得索引中影片筆記總數 */
export function getIndexedCount(dbPath: string): number {
  const db = getDb(dbPath);
  const row = db.prepare('SELECT COUNT(*) as n FROM video_notes').get() as { n: number };
  return row.n;
}
