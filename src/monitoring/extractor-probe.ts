/**
 * Extractor health probe — periodically tests each platform extractor
 * with a known URL to detect API changes or blocks.
 */
import type { ExtractorHealth } from './health-types.js';
import { logger } from '../core/logger.js';

/** Probe URLs — lightweight, public, stable content for each platform */
const PROBE_URLS: Record<string, string> = {
  x: 'https://x.com/elonmusk/status/1585341984679469056',
  threads: 'https://www.threads.net/@zuck/post/CuVGBSxsuaJ',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  github: 'https://github.com/anthropics/claude-code',
  reddit: 'https://www.reddit.com/r/programming/comments/1a',
  bilibili: 'https://www.bilibili.com/video/BV1GJ411x7h7',
  weibo: 'https://weibo.com/2803301701/4976424138269810',
  xiaohongshu: 'https://www.xiaohongshu.com/explore/6548d6b2000000001f0066ab',
  douyin: 'https://www.douyin.com/video/7294556955546986752',
  tiktok: 'https://www.tiktok.com/@tiktok/video/7106594312292453674',
  ithome: 'https://ithelp.ithome.com.tw/articles/10290464',
  web: 'https://example.com',
};

/** Test a single extractor by attempting to extract a known URL */
async function probeExtractor(
  platform: string,
  extractFn: (url: string) => Promise<unknown>,
  url: string,
  timeoutMs: number = 30_000,
): Promise<ExtractorHealth> {
  const now = new Date().toISOString();

  try {
    const result = await Promise.race([
      extractFn(url),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);

    if (result === 'timeout') {
      return { platform, status: 'degraded', lastCheckAt: now, lastError: '超時', consecutiveFailures: 1 };
    }

    return { platform, status: 'ok', lastCheckAt: now, consecutiveFailures: 0 };
  } catch (err) {
    return {
      platform,
      status: 'down',
      lastCheckAt: now,
      lastError: (err as Error).message.slice(0, 200),
      consecutiveFailures: 1,
    };
  }
}

/** Run health probes for all configured extractors */
export async function probeAllExtractors(
  extractors: ReadonlyArray<{ platform: string; extract: (url: string) => Promise<unknown> }>,
  previousHealth: Record<string, ExtractorHealth>,
): Promise<Record<string, ExtractorHealth>> {
  const results: Record<string, ExtractorHealth> = {};

  // Probe all extractors in parallel for speed
  const probePromises: Array<{ platform: string; promise: Promise<ExtractorHealth> }> = [];

  for (const ext of extractors) {
    const probeUrl = PROBE_URLS[ext.platform];
    if (!probeUrl) {
      if (previousHealth[ext.platform]) {
        results[ext.platform] = previousHealth[ext.platform];
      }
      continue;
    }
    probePromises.push({ platform: ext.platform, promise: probeExtractor(ext.platform, ext.extract, probeUrl) });
  }

  const probeResults = await Promise.all(probePromises.map((p) => p.promise));

  for (let i = 0; i < probePromises.length; i++) {
    const health = probeResults[i];
    const prev = previousHealth[probePromises[i].platform];
    if (prev && health.status !== 'ok') {
      health.consecutiveFailures = prev.consecutiveFailures + 1;
    }
    results[probePromises[i].platform] = health;
    logger.info('probe', `${probePromises[i].platform}: ${health.status}`, {
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
