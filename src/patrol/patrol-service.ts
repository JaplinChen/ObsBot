/**
 * Patrol service — automatically fetch GitHub Trending repos and save to Vault.
 * Uses raw HTML parsing (no SDK, no browser) for maximum reliability.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { getOwnerUserId } from '../utils/config.js';
import type { PatrolConfig, PatrolResult } from './patrol-types.js';
import { loadPatrolConfig, savePatrolConfig } from './patrol-store.js';
import { isDuplicateUrl } from '../saver.js';
import { findExtractor } from '../utils/url-parser.js';
import { enrichExtractedContent } from '../messages/services/enrich-content-service.js';
import { saveToVault } from '../saver.js';
import { logger } from '../core/logger.js';

interface TrendingRepo {
  url: string;
  name: string;
  description: string;
}

/** Parse GitHub Trending HTML to extract repo entries. */
function parseTrendingHtml(html: string): TrendingRepo[] {
  const repos: TrendingRepo[] = [];
  // Match each article.Box-row in trending page
  const articleRe = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let match: RegExpExecArray | null;

  while ((match = articleRe.exec(html)) !== null) {
    const block = match[1];

    // Extract repo path from h2 > a href
    const hrefMatch = block.match(/<h2[^>]*>[\s\S]*?<a\s+href="(\/[^"]+)"/);
    if (!hrefMatch) continue;
    const repoPath = hrefMatch[1].trim();

    // Extract description from <p> tag
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, '').trim()
      : '';

    repos.push({
      url: `https://github.com${repoPath}`,
      name: repoPath.slice(1), // remove leading /
      description,
    });
  }

  return repos;
}

/** Fetch GitHub Trending page for a given language (or all). */
async function fetchTrending(language?: string): Promise<TrendingRepo[]> {
  const url = language
    ? `https://github.com/trending/${encodeURIComponent(language)}?since=daily`
    : 'https://github.com/trending?since=daily';

  const res = await fetch(url, {
    headers: { 'User-Agent': 'ObsBot-Patrol/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];

  const html = await res.text();
  return parseTrendingHtml(html);
}

/** Run a single patrol cycle: fetch trending, filter dupes, extract+save. */
export async function runPatrolCycle(
  config: AppConfig, languages: string[],
): Promise<PatrolResult> {
  const result: PatrolResult = { source: 'github-trending', found: 0, saved: 0, skipped: 0 };

  // Fetch trending for each language (or all if empty)
  const targets = languages.length > 0 ? languages : [undefined];
  const allRepos: TrendingRepo[] = [];
  const seen = new Set<string>();

  for (const lang of targets) {
    const repos = await fetchTrending(lang);
    for (const repo of repos) {
      if (!seen.has(repo.url)) {
        seen.add(repo.url);
        allRepos.push(repo);
      }
    }
  }

  // Limit to top 15 repos
  const repos = allRepos.slice(0, 15);
  result.found = repos.length;

  for (const repo of repos) {
    try {
      const dup = await isDuplicateUrl(repo.url, config.vaultPath);
      if (dup) { result.skipped++; continue; }

      const extractor = findExtractor(repo.url);
      if (!extractor) { result.skipped++; continue; }

      const content = await extractor.extract(repo.url);
      await enrichExtractedContent(content, config);
      const saveResult = await saveToVault(content, config.vaultPath);
      if (!saveResult.duplicate) result.saved++;
      else result.skipped++;
    } catch (err) {
      logger.warn('patrol', `擷取失敗: ${repo.name}`, { error: (err as Error).message });
      result.skipped++;
    }
  }

  return result;
}

/** Format patrol result for Telegram notification. */
function formatPatrolMessage(result: PatrolResult): string {
  return [
    '🔭 巡邏完成：GitHub Trending',
    '',
    `找到 ${result.found} 個專案`,
    `✅ 新儲存 ${result.saved} 篇`,
    `⏭️ 跳過 ${result.skipped} 篇（已存在或擷取失敗）`,
  ].join('\n');
}

/** Background patrol checker — runs periodically. */
async function runScheduledPatrol(
  bot: Telegraf, config: AppConfig, pConfig: PatrolConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = pConfig.intervalHours * 3_600_000;

  if (pConfig.lastPatrolAt) {
    const lastTs = new Date(pConfig.lastPatrolAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('patrol', '開始定時巡邏');

  try {
    const result = await runPatrolCycle(config, pConfig.languages);
    pConfig.lastPatrolAt = new Date().toISOString();
    await savePatrolConfig(pConfig);

    if (result.saved > 0) {
      const userId = getOwnerUserId(config);
      if (userId) {
        await bot.telegram.sendMessage(userId, formatPatrolMessage(result));
      }
    }

    logger.info('patrol', '定時巡邏完成', { saved: result.saved, found: result.found });
  } catch (err) {
    logger.warn('patrol', '定時巡邏失敗', { error: (err as Error).message });
  }
}

/** Start the patrol background service. Returns timer for cleanup. */
export async function startPatrolService(
  bot: Telegraf, config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const pConfig = await loadPatrolConfig();
  if (!pConfig.enabled) {
    logger.info('patrol', '自動巡邏已停用');
    return [];
  }

  const checkMs = 60 * 60 * 1000; // check every hour
  const timer = setInterval(
    () => { runScheduledPatrol(bot, config, pConfig).catch(() => {}); },
    checkMs,
  );

  // Initial check after 10 min delay
  setTimeout(
    () => { runScheduledPatrol(bot, config, pConfig).catch(() => {}); },
    10 * 60 * 1000,
  );

  logger.info('patrol', '自動巡邏服務啟動', {
    interval: `${pConfig.intervalHours}h`,
    languages: pConfig.languages.join(', ') || 'all',
  });

  return [timer];
}
