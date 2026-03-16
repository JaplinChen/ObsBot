/**
 * GitHub Trending source — scrapes github.com/trending for radar.
 * No API key needed; parses the public HTML page.
 */
import type { RadarSource, RadarSourceResult } from './source-types.js';
import { fetchWithTimeout } from '../../utils/fetch-with-timeout.js';
import { logger } from '../../core/logger.js';

/** Parse GitHub trending HTML into repo entries. */
function parseTrendingHtml(html: string, limit: number): RadarSourceResult[] {
  const results: RadarSourceResult[] = [];

  // Each trending repo is in an <article class="Box-row">
  const articleRe = /<article class="Box-row">([\s\S]*?)<\/article>/g;
  for (const m of html.matchAll(articleRe)) {
    if (results.length >= limit) break;
    const block = m[1];

    // Repo link: <h2 ...><a href="/owner/repo">
    const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="\/([^"]+)"/);
    if (!linkMatch) continue;
    const repoPath = linkMatch[1].trim();

    // Description: <p class="col-9 ...">
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, '').trim()
      : '';

    // Stars today: <span ...>★ 123 stars today</span>  (optional)
    const starsMatch = block.match(/([\d,]+)\s+stars\s+today/);
    const starsToday = starsMatch ? starsMatch[1] : '';

    const snippet = [description, starsToday ? `⭐ ${starsToday} stars today` : '']
      .filter(Boolean).join(' — ');

    results.push({
      url: `https://github.com/${repoPath}`,
      title: repoPath,
      snippet,
    });
  }

  return results;
}

export const githubTrendingSource: RadarSource = {
  type: 'github',

  async fetch(params: string[], maxResults: number): Promise<RadarSourceResult[]> {
    // params[0] = language (optional, e.g. "typescript", "python")
    const language = params[0] ?? '';
    const langPath = language ? `/${encodeURIComponent(language.toLowerCase())}` : '';
    const url = `https://github.com/trending${langPath}?since=daily`;

    try {
      const res = await fetchWithTimeout(url, 20_000, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
          Accept: 'text/html',
        },
      });
      if (!res.ok) {
        logger.warn('radar-github', 'HTTP 錯誤', { status: res.status, url });
        return [];
      }
      const html = await res.text();
      return parseTrendingHtml(html, maxResults);
    } catch (err) {
      logger.warn('radar-github', '抓取失敗', { err: (err as Error).message });
      return [];
    }
  },
};
