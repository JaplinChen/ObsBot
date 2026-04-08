/**
 * Patrol service — multi-platform content discovery.
 * Sources: GitHub Trending (HTML), HN (Firebase API), Dev.to (API).
 * Scoring via oMLX for relevance filtering.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { getOwnerUserId } from '../utils/config.js';
import type { PatrolConfig, PatrolResult } from './patrol-types.js';
import { loadPatrolConfig, savePatrolConfig } from './patrol-store.js';
import type { PatrolItem, PatrolSource } from './sources/source-types.js';
import { hnSource } from './sources/hn-source.js';
import { devtoSource } from './sources/devto-source.js';
import { rsshubSource } from './sources/rsshub-source.js';
import { scoreAndFilter } from './relevance-scorer.js';
import { filterUnsaved, formatPatrolNotification, buildPatrolButtons } from './patrol-notifier.js';
import { isDuplicateUrl } from '../saver.js';
import { findExtractor } from '../utils/url-parser.js';
import { enrichExtractedContent } from '../messages/services/enrich-content-service.js';
import { saveToVault } from '../saver.js';
import { logger } from '../core/logger.js';

/* ── GitHub Trending (original source, kept inline) ───────────────── */

interface TrendingRepo { url: string; name: string; description: string }

function parseTrendingHtml(html: string): TrendingRepo[] {
  const repos: TrendingRepo[] = [];
  const articleRe = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let match: RegExpExecArray | null;
  while ((match = articleRe.exec(html)) !== null) {
    const block = match[1];
    const hrefMatch = block.match(/<h2[^>]*>[\s\S]*?<a\s+href="(\/[^"]+)"/);
    if (!hrefMatch) continue;
    const repoPath = hrefMatch[1].trim();
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    repos.push({ url: `https://github.com${repoPath}`, name: repoPath.slice(1), description });
  }
  return repos;
}

async function fetchTrending(language?: string): Promise<TrendingRepo[]> {
  const url = language
    ? `https://github.com/trending/${encodeURIComponent(language)}?since=daily`
    : 'https://github.com/trending?since=daily';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  return parseTrendingHtml(await res.text());
}

/* ── GitHub Trending as PatrolSource ──────────────────────────────── */

const githubTrendingSource: PatrolSource = {
  name: 'github-trending',
  async fetch(topics: string[]): Promise<PatrolItem[]> {
    const langs = topics.length > 0 ? topics : [undefined];
    const allRepos: TrendingRepo[] = [];
    const seen = new Set<string>();
    for (const lang of langs) {
      const repos = await fetchTrending(lang as string | undefined);
      for (const r of repos) {
        if (!seen.has(r.url)) { seen.add(r.url); allRepos.push(r); }
      }
    }
    return allRepos.slice(0, 15).map((r) => ({
      url: r.url, title: r.name, description: r.description,
      source: 'github-trending',
    }));
  },
};

/* ── Source registry ──────────────────────────────────────────────── */

const ALL_SOURCES: Record<string, PatrolSource> = {
  'github-trending': githubTrendingSource,
  'hn': hnSource,
  'devto': devtoSource,
  'rsshub': rsshubSource,
};

/* ── Core patrol cycle ────────────────────────────────────────────── */

export interface MultiPatrolResult {
  results: PatrolResult[];
  notifyItems: PatrolItem[];
}

export async function runMultiPatrolCycle(
  config: AppConfig, pConfig: PatrolConfig,
): Promise<MultiPatrolResult> {
  const results: PatrolResult[] = [];
  const allItems: PatrolItem[] = [];

  for (const sourceName of pConfig.enabledSources) {
    const source = ALL_SOURCES[sourceName];
    if (!source) continue;

    const topicsForSource = sourceName === 'github-trending'
      ? pConfig.languages
      : sourceName === 'devto'
        ? pConfig.devtoTags
        : sourceName === 'rsshub'
          ? (pConfig.rsshubPaths ?? [])
          : pConfig.topics;

    try {
      const items = await source.fetch(topicsForSource);
      allItems.push(...items);
      results.push({ source: sourceName, found: items.length, saved: 0, skipped: 0 });
    } catch (err) {
      logger.warn('patrol', `Source ${sourceName} failed`, { error: (err as Error).message });
      results.push({ source: sourceName, found: 0, saved: 0, skipped: 0 });
    }
  }

  // Score and filter
  const scored = await scoreAndFilter(allItems, pConfig.topics, pConfig.relevanceThreshold);
  // Remove duplicates
  const unsaved = await filterUnsaved(scored, config.vaultPath);

  return { results, notifyItems: unsaved.slice(0, 10) };
}

/** Legacy: run GitHub-Trending-only cycle (for backward compat). */
export async function runPatrolCycle(
  config: AppConfig, languages: string[],
): Promise<PatrolResult> {
  const result: PatrolResult = { source: 'github-trending', found: 0, saved: 0, skipped: 0 };
  const targets = languages.length > 0 ? languages : [undefined];
  const allRepos: TrendingRepo[] = [];
  const seen = new Set<string>();
  for (const lang of targets) {
    for (const r of await fetchTrending(lang)) {
      if (!seen.has(r.url)) { seen.add(r.url); allRepos.push(r); }
    }
  }
  const repos = allRepos.slice(0, 15);
  result.found = repos.length;
  for (const repo of repos) {
    try {
      if (await isDuplicateUrl(repo.url, config.vaultPath)) { result.skipped++; continue; }
      const extractor = findExtractor(repo.url);
      if (!extractor) { result.skipped++; continue; }
      const content = await extractor.extract(repo.url);
      await enrichExtractedContent(content, config);
      const sr = await saveToVault(content, config.vaultPath);
      if (!sr.duplicate) result.saved++; else result.skipped++;
    } catch { result.skipped++; }
  }
  return result;
}

/* ── Background scheduler ─────────────────────────────────────────── */

async function runScheduledPatrol(
  bot: Telegraf, config: AppConfig, pConfig: PatrolConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = pConfig.intervalHours * 3_600_000;
  if (pConfig.lastPatrolAt) {
    if (now - new Date(pConfig.lastPatrolAt).getTime() < intervalMs) return;
  }
  logger.info('patrol', '開始定時巡邏');
  try {
    const { results, notifyItems } = await runMultiPatrolCycle(config, pConfig);
    pConfig.lastPatrolAt = new Date().toISOString();
    await savePatrolConfig(pConfig);
    const userId = getOwnerUserId(config);
    if (userId && notifyItems.length > 0) {
      const text = formatPatrolNotification(notifyItems);
      const buttons = buildPatrolButtons(notifyItems);
      await bot.telegram.sendMessage(userId, text, {
        ...buttons,
        // @ts-expect-error Telegraf type mismatch
        disable_web_page_preview: true,
      });
    }
    const totalSaved = results.reduce((s, r) => s + r.saved, 0);
    logger.info('patrol', '定時巡邏完成', { sources: results.length, totalSaved });
  } catch (err) {
    logger.warn('patrol', '定時巡邏失敗', { error: (err as Error).message });
  }
}

export async function startPatrolService(
  bot: Telegraf, config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const pConfig = await loadPatrolConfig();
  if (!pConfig.enabled) {
    logger.info('patrol', '自動巡邏已停用');
    return [];
  }
  const checkMs = 60 * 60 * 1000;
  const timer = setInterval(
    () => { runScheduledPatrol(bot, config, pConfig).catch(() => {}); },
    checkMs,
  );
  setTimeout(
    () => { runScheduledPatrol(bot, config, pConfig).catch(() => {}); },
    10 * 60 * 1000,
  );
  logger.info('patrol', '自動巡邏服務啟動', {
    interval: `${pConfig.intervalHours}h`,
    sources: pConfig.enabledSources.join(', '),
  });
  return [timer];
}
