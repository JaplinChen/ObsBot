/**
 * Reprocess vault helpers: backup, progress tracking, fallback reclassify.
 */
import { readdir, readFile, writeFile, rename, mkdir, cp, unlink, rmdir } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { classifyContent } from '../classifier.js';
import { VAULT_SUBFOLDER } from '../utils/config.js';

/* ── Backup ───────────────────────────────────────────────────────────── */

export async function backupVault(vaultPath: string): Promise<string> {
  const src = join(vaultPath, VAULT_SUBFOLDER);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = join(vaultPath, `${VAULT_SUBFOLDER}-backup-${ts}`);
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
    this.filePath = join(vaultPath, VAULT_SUBFOLDER, PROGRESS_FILE);
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

/* ── Fallback reclassify ──────────────────────────────────────────────── */

function extractField(content: string, field: string): string | null {
  const re = new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm');
  return content.match(re)?.[1]?.trim() ?? null;
}

function replaceField(content: string, field: string, newValue: string): string {
  const re = new RegExp(`^(${field}:\\s*).*$`, 'm');
  return content.replace(re, `$1${newValue}`);
}

export async function fallbackReclassify(
  filePath: string,
  baseDir: string,
): Promise<ReprocessResult> {
  const raw = await readFile(filePath, 'utf-8');
  const title = extractField(raw, 'title') ?? '';
  const url = extractField(raw, 'url') ?? '';
  const oldCategory = extractField(raw, 'category') ?? '其他';
  const newCategory = classifyContent(title, '');

  const oldTop = oldCategory.split('/')[0];
  const newTop = newCategory.split('/')[0];

  if (oldTop === newTop) {
    return { url, status: 'fallback', oldPath: filePath, oldCategory, newCategory: oldCategory };
  }

  // Move to new category folder
  const rel = normalize(filePath).slice(normalize(baseDir).length).replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  segments[0] = newTop;
  const newFilePath = join(baseDir, ...segments);
  await mkdir(dirname(newFilePath), { recursive: true });
  const updated = replaceField(raw, 'category', newCategory);
  await writeFile(filePath, updated, 'utf-8');
  await rename(filePath, newFilePath);

  return { url, status: 'fallback', oldPath: filePath, newPath: newFilePath, oldCategory, newCategory };
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
