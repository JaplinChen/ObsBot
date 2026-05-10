/**
 * Background subscription checker — periodically scrapes subscribed users'
 * timelines and auto-saves new posts.
 */
import type { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import type { SubscriptionStore, Subscription } from './types.js';
import { saveSubscriptions } from './subscription-store.js';
import { scrapeThreadsTimeline } from '../commands/timeline-command.js';
import { classifyContent } from '../classifier.js';
import { saveToVault, isDuplicateUrl } from '../saver.js';
import { loadContentFilter, isBlockedContent } from '../utils/content-filter.js';
import { rememberDislike } from '../utils/dislike-action.js';
import { logger } from '../core/logger.js';

const MAX_CHECK_POSTS = 5;

interface SavedPost {
  url: string;
  title: string;
  category: string;
}

/** Check a single subscription for new posts */
async function checkSubscription(
  sub: Subscription, config: AppConfig,
): Promise<SavedPost[]> {
  try {
    const posts = await scrapeThreadsTimeline(sub.username, MAX_CHECK_POSTS);
    if (posts.length === 0) return [];

    const filter = await loadContentFilter();
    const saved: SavedPost[] = [];

    for (const post of posts) {
      const existing = await isDuplicateUrl(post.url, config.vaultPath);
      if (existing) continue;

      post.category = await classifyContent(post.title, post.text);

      if (isBlockedContent(filter, post.category, post.title)) {
        logger.info('subscribe', '略過封鎖內容', { url: post.url, category: post.category });
        continue;
      }

      try {
        const result = await saveToVault(post, config.vaultPath);
        if (!result.duplicate) {
          saved.push({
            url: post.url,
            title: post.title ?? post.url,
            category: post.category ?? '',
          });
        }
      } catch (err) {
        logger.warn('subscribe', '儲存失敗', { url: post.url, err: (err as Error).message });
      }
    }

    return saved;
  } catch (err) {
    logger.warn('subscribe', '檢查失敗', { user: sub.username, err: (err as Error).message });
    return [];
  }
}

/** Run a full check cycle across all subscriptions */
async function runCheckCycle(
  bot: Telegraf, config: AppConfig, store: SubscriptionStore,
): Promise<void> {
  if (store.subscriptions.length === 0) return;

  logger.info('subscribe', '開始訂閱檢查', { count: store.subscriptions.length });
  const userId = getOwnerUserId(config);

  for (const sub of store.subscriptions) {
    const savedPosts = await checkSubscription(sub, config);
    sub.lastCheckedAt = new Date().toISOString();
    if (savedPosts.length > 0 && savedPosts[0]) {
      sub.lastPostUrl = savedPosts[0].url;
    }

    if (userId && savedPosts.length > 0) {
      for (const post of savedPosts) {
        const token = rememberDislike(post.category);
        const label = post.category ? `[${post.category}] ` : '';
        const text = `📬 @${sub.username}\n\n${label}${post.title}`;
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(`👎 不感興趣：${post.category}`, `dislike:${token}`)],
        ]);
        await bot.telegram.sendMessage(userId, text, keyboard).catch(() => {});
      }
    }
  }

  await saveSubscriptions(store);
  logger.info('subscribe', '檢查完成');
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
