/**
 * Extractor health probe — lightweight connectivity checks for /doctor.
 * Uses HTTP HEAD/GET to test reachability without running full extraction.
 */
import type { ExtractorHealth } from './health-types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { logger } from '../core/logger.js';

const PROBE_TIMEOUT_MS = 5_000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Lightweight probe endpoints — homepage or API, never full article URLs */
const PROBE_ENDPOINTS: Record<string, { url: string; method: 'HEAD' | 'GET' }> = {
  x:           { url: 'https://api.fxtwitter.com/status/1585341984679469056', method: 'GET' },
  threads:     { url: 'https://www.threads.net/', method: 'HEAD' },
  youtube:     { url: 'https://www.youtube.com/', method: 'HEAD' },
  github:      { url: 'https://github.com/', method: 'HEAD' },
  bilibili:    { url: 'https://www.bilibili.com/', method: 'HEAD' },
  weibo:       { url: 'https://m.weibo.cn/api/config', method: 'GET' },
  xhs:         { url: 'https://www.xiaohongshu.com/', method: 'GET' },
  douyin:      { url: 'https://www.douyin.com/aweme/v1/web/general/search/single/', method: 'HEAD' },
  tiktok:      { url: 'https://www.tiktok.com/', method: 'HEAD' },
  ithome:      { url: 'https://ithelp.ithome.com.tw/', method: 'HEAD' },
  web:         { url: 'https://example.com', method: 'HEAD' },
};

/** Lightweight connectivity probe — HTTP only, no browser, no parsing */
async function probeConnectivity(
  platform: string,
  endpoint: { url: string; method: 'HEAD' | 'GET' },
): Promise<ExtractorHealth> {
  const now = new Date().toISOString();

  try {
    const res = await fetchWithTimeout(endpoint.url, PROBE_TIMEOUT_MS, {
      method: endpoint.method,
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
    });

    if (res.ok || (res.status >= 300 && res.status < 400)) {
      return { platform, status: 'ok', lastCheckAt: now, consecutiveFailures: 0 };
    }

    return {
      platform,
      status: 'degraded',
      lastCheckAt: now,
      lastError: `HTTP ${res.status}`,
      consecutiveFailures: 1,
    };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 200) ?? 'unknown';
    const status = msg.includes('abort') ? 'degraded' : 'down';
    return {
      platform,
      status,
      lastCheckAt: now,
      lastError: msg.includes('abort') ? '超時' : msg,
      consecutiveFailures: 1,
    };
  }
}

/** Run lightweight connectivity probes for all configured extractors */
export async function probeAllExtractors(
  extractors: ReadonlyArray<{ platform: string; extract: (url: string) => Promise<unknown> }>,
  previousHealth: Record<string, ExtractorHealth>,
): Promise<Record<string, ExtractorHealth>> {
  const results: Record<string, ExtractorHealth> = {};
  const probes: Array<{ platform: string; promise: Promise<ExtractorHealth> }> = [];

  for (const ext of extractors) {
    const endpoint = PROBE_ENDPOINTS[ext.platform];
    if (!endpoint) {
      if (previousHealth[ext.platform]) {
        results[ext.platform] = previousHealth[ext.platform];
      }
      continue;
    }
    probes.push({ platform: ext.platform, promise: probeConnectivity(ext.platform, endpoint) });
  }

  const probeResults = await Promise.all(probes.map((p) => p.promise));

  for (let i = 0; i < probes.length; i++) {
    const health = probeResults[i];
    const prev = previousHealth[probes[i].platform];
    if (prev && health.status !== 'ok') {
      health.consecutiveFailures = prev.consecutiveFailures + 1;
    }
    results[probes[i].platform] = health;
    logger.info('probe', `${probes[i].platform}: ${health.status}`, {
      error: health.lastError,
    });
  }

  return results;
}

/** Format health report for Telegram notification */
export function formatHealthAlert(
  health: Record<string, ExtractorHealth>,
): string | null {
  const degraded = Object.values(health).filter(h => h.status !== 'ok');
  if (degraded.length === 0) return null;

  const lines = ['🏥 Extractor 健康警報', ''];
  for (const h of degraded) {
    const icon = h.status === 'down' ? '🔴' : '🟡';
    lines.push(`${icon} ${h.platform}：${h.status}（連續 ${h.consecutiveFailures} 次失敗）`);
    if (h.lastError) lines.push(`   └ ${h.lastError.slice(0, 100)}`);
  }

  return lines.join('\n');
}
