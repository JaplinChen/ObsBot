/**
 * Async video transcription queue for Radar.
 * When Radar finds a video URL (YouTube/Bilibili/etc.), it pushes the URL here
 * instead of blocking the Radar cycle. A background worker processes one video
 * at a time and sends a Telegram notification when done.
 */
import { join } from 'node:path';
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { getOwnerUserId } from '../utils/config.js';
import { findExtractor } from '../utils/url-parser.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { logger } from '../core/logger.js';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';

/** Video platforms whose extraction is moved to the async queue. */
export const VIDEO_PLATFORMS = new Set(['youtube', 'bilibili', 'tiktok', 'douyin']);

const QUEUE_PATH = join(process.cwd(), 'data', 'video-queue.json');
/** Process one video every 5 minutes. */
const PROCESS_INTERVAL_MS = 5 * 60_000;

interface VideoQueueItem {
  url: string;
  addedAt: string;
  status: 'pending' | 'done' | 'failed';
  processedAt?: string;
  error?: string;
}

interface VideoQueue {
  items: VideoQueueItem[];
}

async function loadQueue(): Promise<VideoQueue> {
  return safeReadJSON<VideoQueue>(QUEUE_PATH, { items: [] });
}

async function saveQueue(q: VideoQueue): Promise<void> {
  await safeWriteJSON(QUEUE_PATH, q);
}

/** Add a video URL to the queue if not already queued or done. */
export async function enqueueVideo(url: string): Promise<boolean> {
  const q = await loadQueue();
  const exists = q.items.some(
    item => item.url === url && (item.status === 'pending' || item.status === 'done'),
  );
  if (exists) return false;

  q.items.push({ url, addedAt: new Date().toISOString(), status: 'pending' });
  // Keep queue bounded: remove old done/failed items beyond 200
  q.items = q.items.filter(
    (item, _i, arr) =>
      item.status === 'pending' ||
      arr.filter(x => x.status !== 'pending').indexOf(item) < 200,
  );
  await saveQueue(q);
  logger.info('video-queue', '已排入佇列', { url });
  return true;
}

/** Process the next pending item in the queue. */
async function processNext(bot: Telegraf, config: AppConfig): Promise<void> {
  const q = await loadQueue();
  const item = q.items.find(i => i.status === 'pending');
  if (!item) return;

  logger.info('video-queue', '開始處理影片', { url: item.url });

  try {
    // Dedup check before heavy extraction
    const isDupe = await isDuplicateUrl(item.url, config.vaultPath);
    if (isDupe) {
      item.status = 'done';
      item.processedAt = new Date().toISOString();
      await saveQueue(q);
      return;
    }

    const extractor = findExtractor(item.url);
    if (!extractor) throw new Error('找不到對應的 extractor');

    const content = await extractor.extract(item.url);
    content.category = classifyContent(content.title, content.text);

    const saveResult = await saveToVault(content, config.vaultPath);

    item.status = 'done';
    item.processedAt = new Date().toISOString();
    await saveQueue(q);

    if (!saveResult.duplicate) {
      const chapterNote = (content.chapters?.length ?? 0) > 0
        ? ` · ${content.chapters!.length} 個章節`
        : '';
      const userId = getOwnerUserId(config);
      if (userId) {
        await bot.telegram.sendMessage(
          userId,
          `🎬 影片轉錄完成${chapterNote}\n${content.title.slice(0, 80)}`,
        ).catch(() => {});
      }
      logger.info('video-queue', '影片已儲存', { url: item.url, chapters: content.chapters?.length ?? 0 });
    }
  } catch (err) {
    item.status = 'failed';
    item.processedAt = new Date().toISOString();
    item.error = (err as Error).message.slice(0, 200);
    await saveQueue(q);
    logger.warn('video-queue', '影片處理失敗', { url: item.url, err: item.error });
  }
}

/** Start the background video queue worker. */
export function startVideoQueue(bot: Telegraf, config: AppConfig): NodeJS.Timeout {
  logger.info('video-queue', '影片佇列啟動', { intervalMin: PROCESS_INTERVAL_MS / 60_000 });
  return setInterval(
    () => { processNext(bot, config).catch(() => {}); },
    PROCESS_INTERVAL_MS,
  );
}
