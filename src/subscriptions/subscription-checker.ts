/**
 * Background subscription checker — periodically scrapes subscribed users'
 * timelines and auto-saves new posts.
 */
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import type { SubscriptionStore, Subscription } from './types.js';
import { saveSubscriptions } from './subscription-store.js';
import { scrapeThreadsTimeline } from '../commands/timeline-command.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { logger } from '../core/logger.js';

const MAX_CHECK_POSTS = 5;

/** Check a single subscription for new posts */
async function checkSubscription(
  sub: Subscription, config: AppConfig,
): Promise<{ newCount: number; latestUrl: string | null }> {
  try {
    const posts = await scrapeThreadsTimeline(sub.username, MAX_CHECK_POSTS);
    if (posts.length === 0) return { newCount: 0, latestUrl: null };

    let newCount = 0;
    const latestUrl = posts[0]?.url ?? null;

    for (const post of posts) {
      // Skip if already saved
      const existing = await isDuplicateUrl(post.url, config.vaultPath);
      if (existing) continue;

      // Classify and save
      post.category = classifyContent(post.title, post.text);
      try {
        const result = await saveToVault(post, config.vaultPath);
        if (!result.duplicate) newCount++;
      } catch (err) {
        logger.warn('subscribe', '儲存失敗', { url: post.url, err: (err as Error).message });
      }
    }

    return { newCount, latestUrl };
  } catch (err) {
    logger.warn('subscribe', '檢查失敗', { user: sub.username, err: (err as Error).message });
    return { newCount: 0, latestUrl: null };
  }
}

/** Run a full check cycle across all subscriptions */
async function runCheckCycle(
  bot: Telegraf, config: AppConfig, store: SubscriptionStore,
): Promise<void> {
  if (store.subscriptions.length === 0) return;

  logger.info('subscribe', '開始訂閱檢查', { count: store.subscriptions.length });
  let totalNew = 0;

  for (const sub of store.subscriptions) {
    const { newCount, latestUrl } = await checkSubscription(sub, config);
    sub.lastCheckedAt = new Date().toISOString();
    if (latestUrl) sub.lastPostUrl = latestUrl;
    totalNew += newCount;
  }

  await saveSubscriptions(store);

  if (totalNew > 0) {
    const userId = getOwnerUserId(config);
    if (userId) {
      const lines = [`訂閱更新：發現 ${totalNew} 篇新貼文`];
      for (const sub of store.subscriptions) {
        if (sub.lastCheckedAt) {
          lines.push(`• @${sub.username} (${sub.platform})`);
        }
      }
      await bot.telegram.sendMessage(userId, lines.join('\n')).catch(() => {});
    }
  }

  logger.info('subscribe', '檢查完成', { totalNew });
}

/** Start the background subscription checker */
export function startSubscriptionChecker(
  bot: Telegraf, config: AppConfig, store: SubscriptionStore,
): NodeJS.Timeout {
  const intervalMs = (store.checkIntervalHours || 12) * 60 * 60 * 1000;

  logger.info('subscribe', '啟動訂閱檢查器', {
    interval: `${store.checkIntervalHours}h`,
    subscriptions: store.subscriptions.length,
  });

  return setInterval(
    () => { runCheckCycle(bot, config, store).catch(() => {}); },
    intervalMs,
  );
}
