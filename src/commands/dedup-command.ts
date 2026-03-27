/**
 * /dedup — Scan vault for duplicate notes (same canonical URL) and optionally remove them.
 * Usage:
 *   /dedup        — dry-run: list all duplicates
 *   /dedup --fix  — delete duplicates, keeping the most recently modified version
 */
import type { Context } from 'telegraf';
import { readFile, stat, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { VAULT_SUBFOLDER, type AppConfig } from '../utils/config.js';
import { logger } from '../core/logger.js';
import { canonicalizeUrl } from '../utils/url-canonicalizer.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { cleanEmptyDirs } from '../vault/reprocess-helpers.js';

interface NoteEntry {
  filePath: string;
  url: string;
  mtime: Date;
}

/** Scan vault and group notes by canonical URL */
async function findDuplicates(vaultPath: string): Promise<Map<string, NoteEntry[]>> {
  const rootDir = join(vaultPath, VAULT_SUBFOLDER);
  const files = await getAllMdFiles(rootDir);

  const urlMap = new Map<string, NoteEntry[]>();

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const first25 = raw.split('\n').slice(0, 25).join('\n');
      const match = first25.match(/^url:\s*["']?(.*?)["']?\s*$/m);
      if (!match) continue;

      const canonical = canonicalizeUrl(match[1].trim());
      if (!canonical) continue;

      const fileStat = await stat(filePath);
      const entry: NoteEntry = { filePath, url: match[1].trim(), mtime: fileStat.mtime };

      const existing = urlMap.get(canonical);
      if (existing) {
        existing.push(entry);
      } else {
        urlMap.set(canonical, [entry]);
      }
    } catch { /* skip unreadable files */ }
  }

  // Filter to only duplicates (2+ entries)
  const dupes = new Map<string, NoteEntry[]>();
  for (const [url, entries] of urlMap) {
    if (entries.length > 1) dupes.set(url, entries);
  }
  return dupes;
}

/** Format duplicate report for Telegram */
function formatReport(dupes: Map<string, NoteEntry[]>, vaultPath: string): string {
  const rootDir = join(vaultPath, VAULT_SUBFOLDER);
  const lines: string[] = [];
  let totalDupes = 0;

  for (const [, entries] of dupes) {
    // Sort by mtime desc — first entry is the one we keep
    entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const keep = entries[0];
    const remove = entries.slice(1);
    totalDupes += remove.length;

    lines.push(`\n✅ 保留：${relative(rootDir, keep.filePath)}`);
    for (const r of remove) {
      lines.push(`  ❌ 刪除：${relative(rootDir, r.filePath)}`);
    }
  }

  const header = `找到 ${dupes.size} 組重複（共 ${totalDupes} 個多餘檔案）`;
  return [header, ...lines].join('\n');
}

export async function handleDedup(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const fix = text.includes('--fix');

  const status = await ctx.reply('正在掃描 Vault 中的重複筆記...');

  const dupes = await findDuplicates(config.vaultPath);

  if (dupes.size === 0) {
    try { await ctx.deleteMessage(status.message_id); } catch { /* */ }
    await ctx.reply('沒有找到重複的筆記 🎉');
    return;
  }

  const report = formatReport(dupes, config.vaultPath);

  if (!fix) {
    try { await ctx.deleteMessage(status.message_id); } catch { /* */ }
    // Truncate if too long for Telegram (4096 char limit)
    const msg = report.length > 4000
      ? report.slice(0, 3950) + '\n\n...（太長已截斷）\n\n使用 /dedup --fix 執行刪除'
      : report + '\n\n使用 /dedup --fix 執行刪除';
    await ctx.reply(msg);
    return;
  }

  // Execute deletion
  let deleted = 0;
  const errors: string[] = [];
  const rootDir = join(config.vaultPath, VAULT_SUBFOLDER);

  for (const [, entries] of dupes) {
    entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const remove = entries.slice(1);

    for (const r of remove) {
      try {
        await unlink(r.filePath);
        deleted++;
      } catch (err) {
        errors.push(`${relative(rootDir, r.filePath)}: ${(err as Error).message}`);
      }
    }
  }

  // Clean up empty directories
  await cleanEmptyDirs(rootDir);

  try { await ctx.deleteMessage(status.message_id); } catch { /* */ }

  const result = [`已刪除 ${deleted} 個重複檔案`];
  if (errors.length > 0) {
    result.push(`\n失敗 ${errors.length} 個：`);
    for (const e of errors.slice(0, 5)) result.push(`• ${e}`);
  }
  await ctx.reply(result.join('\n'));
  logger.info('dedup', '清理完成', { duplicateGroups: dupes.size, deleted, errors: errors.length });
}
