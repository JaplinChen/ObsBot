/**
 * RSSHub HTTP client。
 * 預設連接本機 Docker: http://localhost:1200
 * 透過 RSSHUB_BASE_URL 環境變數覆蓋。
 *
 * 使用方式：
 *   import { rssHubClient } from './rsshub-client.js';
 *   const items = await rssHubClient.fetchFeed('/zhihu/hotlist');
 */
import { parseXmlFeed, normalizePubDate } from './rss-parser.js';
import type { RSSItem } from './rss-parser.js';
import { logger } from '../core/logger.js';

const DEFAULT_BASE_URL = 'http://localhost:1200';
const FETCH_TIMEOUT = 15_000;

export { type RSSItem };

class RSSHubClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = (process.env['RSSHUB_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /** 健康檢查：確認 RSSHub 服務是否可用 */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * 取得 RSS feed。
   * @param path RSSHub 路由，例如 '/zhihu/hotlist'
   * @returns RSSItem[]，失敗時回傳空陣列（不拋例外）
   */
  async fetchFeed(path: string): Promise<RSSItem[]> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) {
        logger.warn('rsshub', `Feed 回傳 ${res.status}：${path}`);
        return [];
      }
      const xml = await res.text();
      const items = parseXmlFeed(xml);
      logger.info('rsshub', `取得 ${items.length} 筆：${path}`);
      return items;
    } catch (err) {
      logger.warn('rsshub', `取得 feed 失敗：${path}`, { error: (err as Error).message });
      return [];
    }
  }

  /**
   * 批次取得多個 feed，並行請求。
   * @param paths RSSHub 路由陣列
   * @returns 合併後的 RSSItem[]（不重複 link）
   */
  async fetchFeeds(paths: string[]): Promise<RSSItem[]> {
    const results = await Promise.allSettled(paths.map(p => this.fetchFeed(p)));
    const seen = new Set<string>();
    const items: RSSItem[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        items.push(item);
      }
    }
    return items;
  }

  /** 將 RSSItem 轉為 PatrolItem 所需格式 */
  toPatrolItem(item: RSSItem, sourcePath: string) {
    return {
      url: item.link,
      title: item.title,
      description: item.description.replace(/<[^>]+>/g, '').slice(0, 200),
      source: `rsshub:${sourcePath}`,
      publishedAt: normalizePubDate(item.pubDate),
    };
  }
}

export const rssHubClient = new RSSHubClient();
