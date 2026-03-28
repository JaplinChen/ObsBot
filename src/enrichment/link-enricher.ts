/**
 * Lightweight metadata fetcher for URLs found in post text or comments.
 * API-free implementation: fetches target web page directly and parses metadata.
 * Each URL gets its own timeout; partial failures are OK.
 */

import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import type { LinkedContentMeta } from '../extractors/types.js';

/** Entry describing a URL to enrich and where it was found */
export interface UrlEntry {
  url: string;
  source: 'post' | 'comment';
  mentionedBy?: string;
}

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi;

/** Extract all URLs from a piece of text (handles both bare URLs and markdown links) */
export function extractUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  for (const m of text.matchAll(MARKDOWN_LINK_RE)) urls.add(m[2]);
  for (const m of text.matchAll(URL_RE)) {
    const cleaned = m[0].replace(/[.,;:!?'"\)\]\}]+$/, '');
    urls.add(cleaned);
  }
  return [...urls];
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractMeta(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeHtml(m[1]).trim();
  }
  return '';
}

function detectPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('github.com')) return 'github';
    if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('reddit.com')) return 'reddit';
    return 'web';
  } catch {
    return 'web';
  }
}

async function enrichWebPage(url: string): Promise<Omit<LinkedContentMeta, 'url' | 'source' | 'mentionedBy'>> {
  const res = await fetchWithTimeout(url, 15_000, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

  const html = await res.text();
  const title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') ||
    decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()) ||
    new URL(url).hostname;

  const desc = extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
  const cleanDesc = desc.replace(/\s+/g, ' ').trim();

  return {
    title: title.slice(0, 200),
    description: cleanDesc ? cleanDesc.slice(0, 300) : undefined,
    platform: detectPlatform(url),
  };
}

async function enrichSingleUrl(entry: UrlEntry): Promise<LinkedContentMeta> {
  const { url, source, mentionedBy } = entry;
  const meta = await enrichWebPage(url);
  return { url, source, mentionedBy, ...meta };
}

/**
 * Fetch lightweight metadata for a batch of URLs.
 * Each URL has its own timeout; partial failures are silently dropped.
 */
export async function enrichLinkedUrls(entries: UrlEntry[]): Promise<LinkedContentMeta[]> {
  if (entries.length === 0) return [];
  const results = await Promise.allSettled(entries.map((e) => enrichSingleUrl(e)));
  return results
    .filter((r): r is PromiseFulfilledResult<LinkedContentMeta> => r.status === 'fulfilled')
    .map((r) => r.value);
}
