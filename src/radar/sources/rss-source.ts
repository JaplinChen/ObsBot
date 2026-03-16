/**
 * RSS/Atom feed source — parses XML feeds for radar.
 * Lightweight regex-based parser; no external XML dependency.
 */
import type { RadarSource, RadarSourceResult } from './source-types.js';
import { fetchWithTimeout } from '../../utils/fetch-with-timeout.js';
import { logger } from '../../core/logger.js';

/** Strip XML/HTML tags and decode basic entities. */
function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Parse RSS 2.0 <item> elements. */
function parseRssItems(xml: string, limit: number): RadarSourceResult[] {
  const results: RadarSourceResult[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(itemRe)) {
    if (results.length >= limit) break;
    const block = m[1];

    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);

    const url = linkMatch ? stripTags(linkMatch[1]) : '';
    if (!url || !url.startsWith('http')) continue;

    results.push({
      url,
      title: titleMatch ? stripTags(titleMatch[1]) : url,
      snippet: descMatch ? stripTags(descMatch[1]).slice(0, 200) : '',
    });
  }
  return results;
}

/** Parse Atom <entry> elements. */
function parseAtomEntries(xml: string, limit: number): RadarSourceResult[] {
  const results: RadarSourceResult[] = [];
  const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  for (const m of xml.matchAll(entryRe)) {
    if (results.length >= limit) break;
    const block = m[1];

    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    // Atom <link> is self-closing: <link href="..." />
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
    const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

    const url = linkMatch ? linkMatch[1] : '';
    if (!url || !url.startsWith('http')) continue;

    results.push({
      url,
      title: titleMatch ? stripTags(titleMatch[1]) : url,
      snippet: summaryMatch ? stripTags(summaryMatch[1]).slice(0, 200) : '',
    });
  }
  return results;
}

export const rssSource: RadarSource = {
  type: 'rss',

  async fetch(params: string[], maxResults: number): Promise<RadarSourceResult[]> {
    // params[0] = feed URL
    const feedUrl = params[0];
    if (!feedUrl || !feedUrl.startsWith('http')) {
      logger.warn('radar-rss', '無效的 feed URL', { feedUrl });
      return [];
    }

    try {
      const res = await fetchWithTimeout(feedUrl, 20_000, {
        headers: {
          'User-Agent': 'GetThreads-Radar/1.0',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        },
      });
      if (!res.ok) {
        logger.warn('radar-rss', 'HTTP 錯誤', { status: res.status, feedUrl });
        return [];
      }
      const xml = await res.text();

      // Detect Atom vs RSS
      if (xml.includes('<feed') && xml.includes('<entry')) {
        return parseAtomEntries(xml, maxResults);
      }
      return parseRssItems(xml, maxResults);
    } catch (err) {
      logger.warn('radar-rss', '抓取失敗', { err: (err as Error).message, feedUrl });
      return [];
    }
  },
};
