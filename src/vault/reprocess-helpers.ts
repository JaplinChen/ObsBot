/**
 * Reprocess vault helpers: backup, progress tracking, empty-dir cleanup.
 */
import { readdir, readFile, writeFile, unlink, cp, rmdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';

/* ── Backup ───────────────────────────────────────────────────────────── */

export async function backupVault(vaultPath: string): Promise<string> {
  const src = join(vaultPath, 'ObsBot');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = join(vaultPath, `ObsBot-backup-${ts}`);
  await cp(src, dest, { recursive: true, filter: (s) => !s.includes('attachments') });
  return dest;
}

/* ── Progress ─────────────────────────────────────────────────────────── */

export interface ReprocessResult {
  url: string;
  status: 'success' | 'fallback' | 'failed' | 'skipped';
  oldPath: string;
  newPath?: string;
  oldCategory?: string;
  newCategory?: string;
  error?: string;
}

interface ProgressData {
  startedAt: string;
  results: ReprocessResult[];
  completedUrls: string[];
}

const PROGRESS_FILE = '.reprocess-progress.json';

export class ReprocessProgress {
  private data: ProgressData;
  private filePath: string;

  constructor(vaultPath: string) {
    this.filePath = join(vaultPath, 'ObsBot', PROGRESS_FILE);
    this.data = { startedAt: new Date().toISOString(), results: [], completedUrls: [] };
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch { /* fresh start */ }
  }

  isCompleted(canonicalUrl: string): boolean {
    return this.data.completedUrls.includes(canonicalUrl);
  }

  async mark(canonicalUrl: string, result: ReprocessResult): Promise<void> {
    this.data.completedUrls.push(canonicalUrl);
    this.data.results.push(result);
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8').catch(() => {});
  }

  getResults(): ReprocessResult[] {
    return this.data.results;
  }
}

/* ── Cleanup empty dirs ───────────────────────────────────────────────── */

export async function cleanEmptyDirs(dir: string): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) await cleanEmptyDirs(join(dir, e.name));
  }
  try {
    const after = await readdir(dir);
    if (after.length === 0) await rmdir(dir);
  } catch { /* skip */ }
}

/* ── Delete old file if path changed ──────────────────────────────────── */

export async function deleteOldFileIfMoved(oldPath: string, newPath: string): Promise<void> {
  if (normalize(oldPath) !== normalize(newPath)) {
    await unlink(oldPath).catch(() => {});
  }
}
