/**
 * RSSHub patrol source。
 * 讀取自架 RSSHub 服務（localhost:1200）的任意路由作為巡邏來源。
 *
 * 使用 rsshubPaths 設定訂閱的路由清單，例如：
 *   ['/zhihu/hotlist', '/weibo/search/keyword/AI', '/bilibili/trending']
 *
 * RSSHub 服務未啟動時自動跳過（回傳空陣列），不影響其他來源。
 */
import type { PatrolItem, PatrolSource } from './source-types.js';
import { rssHubClient } from '../../utils/rsshub-client.js';
import { logger } from '../../core/logger.js';

/** 預設路由：覆蓋中文主流平台熱門內容 */
export const DEFAULT_RSSHUB_PATHS = [
  '/zhihu/hotlist',
  '/bilibili/trending/regionlist/0/1',
  '/weibo/search/keyword/AI技术',
  '/sspai/index',
];

export const rsshubSource: PatrolSource = {
  name: 'rsshub',

  async fetch(paths: string[]): Promise<PatrolItem[]> {
    const activePaths = paths.length > 0 ? paths : DEFAULT_RSSHUB_PATHS;

    // 先做健康檢查，RSSHub 不可用時靜默跳過
    const available = await rssHubClient.isAvailable();
    if (!available) {
      logger.warn('patrol-rsshub', 'RSSHub 服務不可用，跳過此來源');
      return [];
    }

    const rawItems = await rssHubClient.fetchFeeds(activePaths);
    if (rawItems.length === 0) return [];

    // 轉換為 PatrolItem，description 移除 HTML 標籤並截短
    const items: PatrolItem[] = rawItems
      .filter(item => item.link && item.title)
      .map(item => {
        // 從路徑推斷 source label（取前兩段，例如 /zhihu/hotlist → zhihu）
        const pathMatch = item.link.match(/^https?:\/\/([^/]+)/);
        const domain = pathMatch?.[1]?.replace(/^www\./, '') ?? 'rsshub';

        return {
          url: item.link,
          title: item.title,
          description: item.description
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 200),
          source: `rsshub:${domain}`,
          publishedAt: item.pubDate,
        };
      });

    logger.info('patrol-rsshub', `共取得 ${items.length} 筆（${activePaths.length} 個路由）`);
    return items;
  },
};
