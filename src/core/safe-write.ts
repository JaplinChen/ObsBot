/**
 * Atomic file write utility — prevents data corruption on crash.
 * Writes to a .tmp file first, then renames (atomic on POSIX).
 * Includes integrity verification for JSON files.
 */
import { writeFile, rename, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from './logger.js';

/**
 * Atomically write content to a file.
 * 1. Write to `${path}.tmp`
 * 2. Rename to `${path}` (atomic on same filesystem)
 */
export async function safeWriteFile(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, path);
}

/**
 * Atomically write a JSON object to a file with pretty-printing.
 * Validates that the serialized JSON is re-parseable before committing.
 */
export async function safeWriteJSON(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  // Verify the JSON is valid before writing
  JSON.parse(json);
  await safeWriteFile(path, json + '\n');
}

/**
 * Safely read and parse a JSON file with corruption recovery.
 * Falls back to `.bak` if the primary file is corrupt, then to `defaultValue`.
 */
export async function safeReadJSON<T>(path: string, defaultValue: T): Promise<T> {
  // Try primary file
  const primary = await tryParseJSON<T>(path);
  if (primary !== null) return primary;

  // Try backup
  const backup = await tryParseJSON<T>(`${path}.bak`);
  if (backup !== null) {
    logger.warn('safe-io', `主檔損壞，從備份恢復: ${path}`);
    // Restore backup to primary
    try {
      const raw = await readFile(`${path}.bak`, 'utf-8');
      await safeWriteFile(path, raw);
    } catch { /* best-effort restore */ }
    return backup;
  }

  // Clean up corrupt .tmp if it exists
  try {
    await stat(`${path}.tmp`);
    const tmpData = await tryParseJSON<T>(`${path}.tmp`);
    if (tmpData !== null) {
      logger.warn('safe-io', `從 .tmp 檔恢復: ${path}`);
      await safeWriteFile(path, await readFile(`${path}.tmp`, 'utf-8'));
      return tmpData;
    }
  } catch { /* no tmp file */ }

  logger.warn('safe-io', `檔案不存在或損壞，使用預設值: ${path}`);
  return defaultValue;
}

async function tryParseJSON<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Create a periodic backup of a critical JSON file.
 * Call this after successful writes to maintain a `.bak` copy.
 */
export async function createBackup(path: string): Promise<void> {
  try {
    const raw = await readFile(path, 'utf-8');
    // Validate it's good data before backing up
    JSON.parse(raw);
    await writeFile(`${path}.bak`, raw, 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Run integrity check on all critical data files at startup.
 * Returns list of files that were recovered or had issues.
 */
export async function runDataIntegrityCheck(): Promise<string[]> {
  const issues: string[] = [];
  const dataDir = join(process.cwd(), 'data');

  const criticalFiles = [
    'url-index.json',
    'user-config.json',
    'subscriptions.json',
    'radar-config.json',
    'patrol-config.json',
    'proactive-config.json',
    'monitor-config.json',
    'knowledge.json',
  ];

  for (const file of criticalFiles) {
    const path = join(dataDir, file);
    try {
      await stat(path);
      const raw = await readFile(path, 'utf-8');
      JSON.parse(raw);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') continue; // File doesn't exist yet, OK

      // File exists but corrupt
      issues.push(file);
      logger.warn('integrity', `資料檔損壞: ${file}`, { message: error.message });

      // Try recovery from backup
      try {
        const bakRaw = await readFile(`${path}.bak`, 'utf-8');
        JSON.parse(bakRaw);
        await safeWriteFile(path, bakRaw);
        logger.info('integrity', `已從備份恢復: ${file}`);
      } catch {
        // No valid backup — file will be recreated with defaults on first access
        logger.warn('integrity', `無可用備份，將使用預設值: ${file}`);
      }
    }
  }

  if (issues.length > 0) {
    logger.warn('integrity', `啟動完整性檢查：${issues.length} 個檔案有問題`, { files: issues });
  } else {
    logger.info('integrity', '啟動完整性檢查通過');
  }

  return issues;
}
