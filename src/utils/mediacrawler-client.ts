/**
 * MediaCrawler HTTP client（佔位實作）。
 * 對接本機 FastAPI wrapper：http://localhost:8765
 *
 * 啟動 Python 服務後設定 MEDIACRAWLER_BASE_URL 環境變數即可啟用。
 * 服務未啟動時 isAvailable() 回傳 false，extractor 自動跳過。
 *
 * Python 服務啟動方式：
 *   pip install fastapi uvicorn mediacrawler
 *   python scripts/mediacrawler-server.py
 */
import { logger } from '../core/logger.js';

const DEFAULT_BASE_URL = 'http://localhost:8765';

export interface XhsResult {
  title: string;
  content: string;
  author: string;
  authorHandle: string;
  images: string[];
  likes: number;
  date: string;
}

export interface DouyinResult {
  title: string;
  description: string;
  author: string;
  authorHandle: string;
  videoUrl: string;
  likes: number;
  date: string;
}

class MediaCrawlerClient {
  private baseUrl: string;
  private _available: boolean | null = null;

  constructor() {
    this.baseUrl = (process.env['MEDIACRAWLER_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /** 檢查 MediaCrawler 服務是否可用（快取結果 60 秒） */
  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      this._available = res.ok;
      // 60 秒後重置快取
      setTimeout(() => { this._available = null; }, 60_000);
      return this._available;
    } catch {
      this._available = false;
      setTimeout(() => { this._available = null; }, 60_000);
      return false;
    }
  }

  /** 抓取小紅書貼文 */
  async crawlXhs(url: string): Promise<XhsResult | null> {
    return this.post<XhsResult>('/crawl/xhs', { url });
  }

  /** 抓取抖音影片/文章 */
  async crawlDouyin(url: string): Promise<DouyinResult | null> {
    return this.post<DouyinResult>('/crawl/douyin', { url });
  }

  private async post<T>(path: string, body: Record<string, string>): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        logger.warn('mediacrawler', `請求失敗 ${res.status}：${path}`);
        return null;
      }
      return await res.json() as T;
    } catch (err) {
      logger.warn('mediacrawler', `請求錯誤：${path}`, { error: (err as Error).message });
      return null;
    }
  }
}

export const mediaCrawlerClient = new MediaCrawlerClient();
