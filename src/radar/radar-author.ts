/**
 * Author-tracking utilities for the content radar.
 * Handles: author query creation, auto-rotation, and weekly queue refresh.
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import { parseFrontmatter, getAllMdFiles } from '../vault/frontmatter-utils.js';
import { logger } from '../core/logger.js';
import { saveRadarConfig } from './radar-store.js';
import { addQuery } from './radar-store.js';
import type { RadarConfig, RadarQuery } from './radar-types.js';

/** Max authors kept in the standby queue. */
const AUTHOR_QUEUE_MAX = 20;

/** Days between automatic author-queue refreshes. */
export const AUTHOR_QUEUE_REFRESH_DAYS = 7;

// ── Author query CRUD ─────────────────────────────────────────────────────────

/**
 * Add an author-tracking search query.
 * Marked with `authorHandle` so the auto-rotation logic can identify it.
 */
export function addAuthorQuery(config: RadarConfig, handle: string): RadarQuery {
  const query = addQuery(config, [handle, 'AI'], 'manual', 'search');
  query.authorHandle = handle;
  return query;
}

/**
 * Promote the next author from `authorQueue` when an author query is paused.
 * Returns the promoted handle on success, null if the queue is empty.
 */
export function promoteNextAuthor(config: RadarConfig): string | null {
  const queue = config.authorQueue;
  if (!queue || queue.length === 0) return null;

  const activeHandles = new Set(
    config.queries.filter(q => q.authorHandle && !q.paused).map(q => q.authorHandle!),
  );

  while (queue.length > 0) {
    const handle = queue.shift()!;
    if (activeHandles.has(handle)) continue;
    addAuthorQuery(config, handle);
    logger.info('radar', '作者自動輪替', { promoted: handle, queueRemaining: queue.length });
    return handle;
  }

  return null;
}

// ── Weekly vault-author scan ──────────────────────────────────────────────────

/**
 * Scan vault notes and return a ranked map of author handle → article count.
 * Skips domain-style authors (containing dots) and very short names.
 */
async function scanVaultAuthors(vaultPath: string): Promise<Map<string, number>> {
  const files = await getAllMdFiles(join(vaultPath, 'KnowPipe')).catch(() => [] as string[]);
  const counts = new Map<string, number>();

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      if (!raw.startsWith('---')) continue;
      const fields = parseFrontmatter(raw);
      const rawAuthor = fields.get('author') ?? fields.get('authors') ?? '';
      if (!rawAuthor) continue;

      let handle = rawAuthor.replace(/^['"[\]|]+|['"[\]|]+$/g, '').split(/[,;]/)[0].trim();
      if (!handle || handle === 'null' || handle.includes('.') || handle.length < 2) continue;
      if (handle.startsWith('@')) handle = handle.slice(1);
      counts.set(handle, (counts.get(handle) ?? 0) + 1);
    } catch { /* skip unreadable */ }
  }

  return counts;
}

export interface AuthorQueueRefreshResult {
  added: string[];
  removed: string[];
  queueSize: number;
  topAuthors: Array<{ handle: string; count: number }>;
}

/**
 * Re-rank vault authors and rebuild the standby queue.
 * Keeps already-active author queries untouched.
 */
export async function refreshAuthorQueue(
  vaultPath: string,
  config: RadarConfig,
): Promise<AuthorQueueRefreshResult> {
  const counts = await scanVaultAuthors(vaultPath);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topAuthors = ranked.slice(0, 25).map(([handle, count]) => ({ handle, count }));

  const usedHandles = new Set(
    config.queries.filter(q => q.authorHandle).map(q => q.authorHandle!),
  );

  const freshQueue = ranked.map(([h]) => h).filter(h => !usedHandles.has(h)).slice(0, AUTHOR_QUEUE_MAX);
  const oldQueue = config.authorQueue ?? [];
  const added = freshQueue.filter(h => !oldQueue.includes(h));
  const removed = oldQueue.filter(h => !freshQueue.includes(h));

  config.authorQueue = freshQueue;
  config.lastAuthorQueueRefreshedAt = new Date().toISOString();

  logger.info('radar', '作者佇列每週更新', {
    queueSize: freshQueue.length, added: added.length, removed: removed.length,
  });

  return { added, removed, queueSize: freshQueue.length, topAuthors };
}

/**
 * Run the weekly author-queue refresh if due.
 * Saves config and notifies the owner on changes.
 */
export async function runWeeklyAuthorRefresh(
  bot: Telegraf, config: AppConfig, radarConfig: RadarConfig,
): Promise<void> {
  const lastRefresh = radarConfig.lastAuthorQueueRefreshedAt;
  const daysSince = lastRefresh
    ? (Date.now() - new Date(lastRefresh).getTime()) / 86_400_000
    : Infinity;
  if (daysSince < AUTHOR_QUEUE_REFRESH_DAYS) return;

  try {
    const result = await refreshAuthorQueue(config.vaultPath, radarConfig);
    await saveRadarConfig(radarConfig);

    const userId = getOwnerUserId(config);
    if (userId && (result.added.length > 0 || result.removed.length > 0)) {
      const top5 = result.topAuthors.slice(0, 5)
        .map(a => `• @${a.handle}（${a.count} 篇）`).join('\n');
      const lines = [
        '📊 每週作者排名更新',
        '',
        `備用佇列：${result.queueSize} 位`,
        result.added.length > 0 ? `新加入：${result.added.map(h => '@' + h).join('、')}` : '',
        result.removed.length > 0 ? `移出：${result.removed.map(h => '@' + h).join('、')}` : '',
        '',
        'Vault 前 5 名作者：',
        top5,
      ].filter(Boolean);
      await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
    }
  } catch (err) {
    logger.warn('radar', '每週作者排名更新失敗', { err: (err as Error).message });
  }
}
