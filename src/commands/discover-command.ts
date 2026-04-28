/**
 * /discover — Proactive content discovery across platforms.
 * /discover <keyword> — search GitHub repos by keyword.
 * /discover (no args) — scan trending repos in default interest areas.
 * Each result includes a "📥 存入" inline button to save directly to Vault.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Markup } from 'telegraf';
import type { Context } from 'telegraf';
import { logger } from '../core/logger.js';
import type { AppConfig } from '../utils/config.js';
import { isDuplicateUrl } from '../saver.js';
import { TtlCache } from '../utils/ttl-cache.js';
import { withTypingIndicator } from './command-runner.js';

const DEFAULT_TOPICS = ['ai-agent', 'obsidian', 'cli-tool'];
const MAX_RESULTS = 8;

interface GhRepo {
  fullName: string;
  description: string;
  stargazersCount: number;
  language: string;
  htmlUrl: string;
  updatedAt: string;
}

/* ── URL token cache (maps short hash → full URL) ──────────────────── */

const urlTokenCache = new TtlCache<string>({ maxSize: 200, ttlMs: 30 * 60_000 });

export function rememberUrl(url: string): string {
  const token = createHash('sha1').update(url).digest('hex').slice(0, 12);
  urlTokenCache.set(token, url);
  return token;
}

/** Resolve a discover callback token back to a URL */
export function resolveDiscoverToken(token: string): string | null {
  return urlTokenCache.get(token) ?? null;
}

/* ── GitHub search via gh CLI ────────────────────────────────────────── */

async function searchGitHub(query: string, limit: number): Promise<GhRepo[]> {
  return new Promise((resolve) => {
    const args = [
      'search', 'repos', query,
      '--sort', 'stars',
      '--order', 'desc',
      '--limit', String(limit),
      '--json', 'fullName,description,stargazersCount,language,url,updatedAt',
    ];

    execFile('gh', args, { timeout: 15_000 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      try {
        const raw = JSON.parse(stdout) as Array<{
          fullName: string;
          description: string;
          stargazersCount: number;
          language: string;
          url: string;
          updatedAt: string;
        }>;
        resolve(raw.map((r) => ({
          fullName: r.fullName,
          description: r.description ?? '',
          stargazersCount: r.stargazersCount,
          language: r.language ?? '',
          htmlUrl: r.url,
          updatedAt: r.updatedAt,
        })));
      } catch {
        resolve([]);
      }
    });
  });
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function formatStars(count: number): string {
  return count >= 1000
    ? `${(count / 1000).toFixed(1)}k`
    : String(count);
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Build inline keyboard with save buttons for unsaved repos only (2 per row) */
function buildSaveButtons(repos: GhRepo[]) {
  const buttons = repos.map((r) => {
    const token = rememberUrl(r.htmlUrl);
    const shortName = r.fullName.split('/')[1] ?? r.fullName;
    return Markup.button.callback(
      `📥 ${shortName}`,
      `dsc:${token}`,
    );
  });

  // 2 buttons per row
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(rows);
}

/** Check which repos are already saved, returns Set of saved URLs */
async function checkSavedUrls(repos: GhRepo[], vaultPath: string): Promise<Set<string>> {
  const saved = new Set<string>();
  for (const r of repos) {
    const dup = await isDuplicateUrl(r.htmlUrl, vaultPath);
    if (dup) saved.add(r.htmlUrl);
  }
  return saved;
}

/* ── Format results ──────────────────────────────────────────────────── */

function formatSearchResults(repos: GhRepo[], query: string, savedUrls: Set<string>): string {
  if (repos.length === 0) return `找不到與「${query}」相關的專案。`;

  const lines = [`GitHub 搜尋結果：「${query}」\n`];
  for (const r of repos) {
    const icon = savedUrls.has(r.htmlUrl) ? '📂' : '🔹';
    const lang = r.language ? ` [${r.language}]` : '';
    lines.push(`${icon} ${r.fullName}${lang} (${formatStars(r.stargazersCount)})`);
    lines.push(`  ${r.htmlUrl}`);
    if (lines.join('\n').length > 3500) break;
  }
  return lines.join('\n');
}

function formatTrendingResults(
  topicRepos: Array<{ topic: string; repos: GhRepo[] }>,
  savedUrls: Set<string>,
): string {
  const lines = [`每日探索：你的關注領域\n`];

  for (const { topic, repos } of topicRepos) {
    if (repos.length === 0) continue;
    lines.push(`--- ${topic} ---`);
    for (const r of repos) {
      const icon = savedUrls.has(r.htmlUrl) ? '📂' : '🔹';
      lines.push(`${icon} ${r.fullName} (${formatStars(r.stargazersCount)}) ${r.htmlUrl}`);
    }
    lines.push('');
    if (lines.join('\n').length > 3500) break;
  }

  return lines.join('\n');
}

/* ── Command handler ─────────────────────────────────────────────────── */

/** /discover <keyword> — search; /discover (no args) — trending */
export async function handleDiscover(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const rawQuery = text.replace(/^\/discover\s*/i, '').trim();

  if (!rawQuery) {
    await runTrending(ctx, config);
    return;
  }

  await withTypingIndicator(ctx, '搜尋 GitHub…', async () => {
    const query = rawQuery.includes(' stars:')
      ? rawQuery
      : `${rawQuery} stars:>50`;

    const repos = await searchGitHub(query, MAX_RESULTS);
    const savedUrls = await checkSavedUrls(repos, config.vaultPath);
    const unsaved = repos.filter(r => !savedUrls.has(r.htmlUrl));
    const message = formatSearchResults(repos, rawQuery, savedUrls);

    if (unsaved.length > 0) {
      await ctx.reply(message, {
        disable_web_page_preview: true,
        ...buildSaveButtons(unsaved),
      } as object);
    } else {
      await ctx.reply(message);
    }
    logger.info('discover', 'searched', { query: rawQuery, found: repos.length });
  }, '搜尋失敗');
}

/** Scan trending repos in default interest areas */
async function runTrending(ctx: Context, config: AppConfig): Promise<void> {
  await withTypingIndicator(ctx, '掃描熱門專案中…', async () => {
    const topicRepos: Array<{ topic: string; repos: GhRepo[] }> = [];
    const allRepos: GhRepo[] = [];

    for (const topic of DEFAULT_TOPICS) {
      const repos = await searchGitHub(
        `topic:${topic} stars:>100 pushed:>${getDateDaysAgo(7)}`,
        3,
      );
      topicRepos.push({ topic, repos });
      allRepos.push(...repos);
    }

    const savedUrls = await checkSavedUrls(allRepos, config.vaultPath);
    const unsaved = allRepos.filter(r => !savedUrls.has(r.htmlUrl));
    const message = formatTrendingResults(topicRepos, savedUrls);

    if (unsaved.length > 0) {
      await ctx.reply(message, {
        disable_web_page_preview: true,
        ...buildSaveButtons(unsaved),
      } as object);
    } else {
      await ctx.reply(message);
    }
    logger.info('discover', 'trending-scan', { topics: DEFAULT_TOPICS.length });
  }, '掃描失敗');
}
