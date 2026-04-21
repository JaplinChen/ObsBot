/**
 * Ad URL filter with self-learning blocklist.
 *
 * 三層防禦：
 *   1. 靜態模式 — 硬編碼的廣告重定向規則（DDG y.js, Google Ads 等）
 *   2. 靜態域名黑名單 — 永遠不可能是內容來源的廣告網絡
 *   3. 動態學習黑名單 — 從廣告 URL 萃取目標域名，累積超過閾值後自動封鎖
 *
 * 進化機制：
 *   - 每次偵測到 DDG 廣告跳轉，自動萃取 ad_domain 並寫入 data/ad-domains.json
 *   - 出現次數 >= AUTO_BLOCK_THRESHOLD 時，該域名直接進入黑名單
 *   - 用戶手動送出同域名的合法 URL 時，呼叫 rehabilitateDomain 降低信心分數
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../core/logger.js';

const BLOCKLIST_FILE = join('data', 'ad-domains.json');

/** 出現幾次後自動封鎖 */
const AUTO_BLOCK_THRESHOLD = 3;

/** 靜態 URL 模式 — 永遠是廣告跳轉，直接拒絕 */
const AD_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/[^/]*duckduckgo\.com\/y\.js/,   // DDG 廣告跳轉
  /^https?:\/\/googleadservices\.com\//,
  /^https?:\/\/[^/]*doubleclick\.net\//,
  /^https?:\/\/[^/]*googlesyndication\.com\//,
  /[?&]ad_domain=/i,                            // 任何含 ad_domain 參數的 URL
  /[?&]ad_provider=/i,                           // 任何含 ad_provider 參數的 URL
];

/** 靜態域名黑名單 — 廣告聯盟域名，永不列為內容來源 */
const STATIC_BLOCKED_DOMAINS = new Set([
  'googleadservices.com',
  'doubleclick.net',
  'googlesyndication.com',
  'amazon-adsystem.com',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'mgid.com',
  'adnxs.com',
]);

/** 使用者自訂封鎖域名 — 在當前網路環境（越南）無法存取的網站 */
const USER_BLOCKED_DOMAINS = new Set([
  'medium.com',
  'daily-co.github.io',
  'dexcheck.ai',
]);

export interface AdDomainEntry {
  count: number;
  reason: string;
  addedAt: string;
  autoBlocked: boolean;
  confidence: number; // 0~1
}

export interface AdBlocklist {
  version: number;
  updatedAt: string;
  entries: Record<string, AdDomainEntry>;
}

let cache: AdBlocklist | null = null;

async function load(): Promise<AdBlocklist> {
  if (cache) return cache;
  try {
    const raw = await readFile(BLOCKLIST_FILE, 'utf-8');
    cache = JSON.parse(raw) as AdBlocklist;
  } catch {
    cache = { version: 1, updatedAt: new Date().toISOString(), entries: {} };
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  cache.updatedAt = new Date().toISOString();
  await writeFile(BLOCKLIST_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/** 從 DDG 廣告 URL 萃取目標廣告域名 */
function extractAdDomain(url: string): string | null {
  try {
    // &amp; 編碼的版本（HTML 屬性格式）
    const decoded = url.replace(/&amp;/g, '&');
    const u = new URL(decoded);
    const direct = u.searchParams.get('ad_domain');
    if (direct) return direct.toLowerCase();
  } catch {}
  // 正則回退（URL 格式不合法時）
  const m = url.replace(/&amp;/g, '&').match(/[?&]ad_domain=([^&\s"']+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** 快速靜態檢查（同步，無 I/O） */
export function isStaticAdUrl(url: string): boolean {
  if (AD_URL_PATTERNS.some(re => re.test(url))) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return STATIC_BLOCKED_DOMAINS.has(host) || USER_BLOCKED_DOMAINS.has(host);
  } catch {
    return false;
  }
}

/**
 * 完整廣告 URL 判斷（靜態 + 動態黑名單）。
 * 偵測到廣告時會自動觸發學習流程。
 */
export async function isAdUrl(url: string): Promise<{ isAd: boolean; reason: string }> {
  // 靜態模式（快速路徑）
  if (isStaticAdUrl(url)) {
    const adDomain = extractAdDomain(url);
    if (adDomain) {
      learnAdDomain(adDomain, 'ad-redirect-param').catch(() => {});
    }
    return { isAd: true, reason: 'static-ad-pattern' };
  }

  // 動態黑名單（需 I/O）
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const bl = await load();
    const entry = bl.entries[host];
    if (entry?.autoBlocked && entry.confidence >= 0.8) {
      return { isAd: true, reason: `learned-ad-domain (seen ${entry.count}x)` };
    }
  } catch {}

  return { isAd: false, reason: '' };
}

/**
 * 記錄一次廣告域名目擊。
 * 達到閾值後自動封鎖，並寫入持久黑名單。
 */
export async function learnAdDomain(domain: string, reason: string): Promise<void> {
  const bl = await load();
  const existing = bl.entries[domain];
  if (existing) {
    existing.count += 1;
    existing.confidence = Math.min(1.0, existing.confidence + 0.1);
    if (!existing.autoBlocked && existing.count >= AUTO_BLOCK_THRESHOLD) {
      existing.autoBlocked = true;
      logger.info('ad-filter', `自動封鎖廣告域名: ${domain} (累計 ${existing.count} 次)`, { domain });
    }
  } else {
    bl.entries[domain] = {
      count: 1,
      reason,
      addedAt: new Date().toISOString().slice(0, 10),
      autoBlocked: false,
      confidence: 0.7,
    };
  }
  await persist();
}

/**
 * 用戶主動送出某域名的合法 URL 時呼叫，降低其廣告信心分數。
 * 防止誤封有合法內容的域名。
 */
export async function rehabilitateDomain(url: string): Promise<void> {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const bl = await load();
    const entry = bl.entries[host];
    if (!entry) return;
    entry.confidence = Math.max(0, entry.confidence - 0.3);
    if (entry.confidence < 0.5 && entry.autoBlocked) {
      entry.autoBlocked = false;
      logger.info('ad-filter', `域名信用恢復，解除封鎖: ${host}`, { host, confidence: entry.confidence });
    }
    await persist();
  } catch {}
}

/** 取得目前黑名單統計 */
export async function getAdFilterStats(): Promise<{
  total: number;
  autoBlocked: number;
  domains: Array<{ domain: string; count: number; confidence: number }>;
}> {
  const bl = await load();
  const all = Object.entries(bl.entries);
  const blocked = all.filter(([, e]) => e.autoBlocked);
  return {
    total: all.length,
    autoBlocked: blocked.length,
    domains: blocked.map(([d, e]) => ({ domain: d, count: e.count, confidence: e.confidence })),
  };
}
