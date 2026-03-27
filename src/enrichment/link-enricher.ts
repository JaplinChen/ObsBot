/**
 * URL metadata + deep content fetcher for URLs found in post text or comments.
 * API-free implementation: fetches target web page directly and parses metadata.
 * High-value URLs (X Articles, web articles) get full text extraction for AI analysis.
 * Each URL gets its own timeout; partial failures are OK.
 */

import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { htmlToMarkdown } from '../utils/html-to-markdown.js';
import { stripHtmlTags } from '../extractors/web-cleaner.js';
import type { LinkedContentMeta } from '../extractors/types.js';

/** Entry describing a URL to enrich and where it was found */
export interface UrlEntry {
  url: string;
  source: 'post' | 'comment';
  mentionedBy?: string;
}

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi;
const X_STATUS_RE = /(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/i;
const DEEP_FETCH_MAX_CHARS = 3000;

/** URL patterns to skip deep fetch (media, binary files) */
const SKIP_DEEP_RE = /\.(jpe?g|png|gif|webp|svg|mp4|webm|mov|pdf|zip|tar|gz)(\?.*)?$/i;

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

/** Check if a URL is worth deep-fetching for full text */
function isDeepFetchCandidate(url: string): boolean {
  if (SKIP_DEEP_RE.test(url)) return false;
  // YouTube pages don't have useful article text
  const platform = detectPlatform(url);
  if (platform === 'youtube') return false;
  return true;
}

/** Deep fetch X/Twitter status via fxtwitter API — returns article/tweet text */
async function deepFetchXStatus(url: string): Promise<string | undefined> {
  const match = url.match(X_STATUS_RE);
  if (!match) return undefined;
  const [, screenName, tweetId] = match;
  const apiUrl = `https://api.fxtwitter.com/${screenName}/status/${tweetId}`;
  const res = await fetchWithTimeout(apiUrl, 15_000);
  if (!res.ok) return undefined;

  const data = await res.json() as {
    code: number;
    tweet: {
      text: string;
      article?: {
        title?: string;
        content?: {
          blocks?: Array<{ text: string; type: string }>;
        };
      };
    };
  };
  if (data.code !== 200) return undefined;

  const { tweet } = data;
  // Prefer article content (long-form) over tweet text
  if (tweet.article?.content?.blocks?.length) {
    const lines: string[] = [];
    if (tweet.article.title) lines.push(`# ${tweet.article.title}`, '');
    for (const block of tweet.article.content.blocks) {
      if (!block.text.trim() && block.type === 'atomic') continue;
      switch (block.type) {
        case 'header-one': lines.push(`## ${block.text}`, ''); break;
        case 'header-two': lines.push(`### ${block.text}`, ''); break;
        case 'unordered-list-item': lines.push(`- ${block.text}`); break;
        case 'ordered-list-item': lines.push(`- ${block.text}`); break;
        case 'blockquote': lines.push(`> ${block.text}`, ''); break;
        default:
          if (block.text.trim()) lines.push(block.text, '');
      }
    }
    return lines.join('\n').slice(0, DEEP_FETCH_MAX_CHARS);
  }

  // Fall back to tweet text
  return tweet.text ? tweet.text.slice(0, DEEP_FETCH_MAX_CHARS) : undefined;
}

/** Deep fetch general web page — Readability extraction with regex fallback */
async function deepFetchWebPage(url: string, html: string): Promise<string | undefined> {
  // Try Readability first
  const parsed = htmlToMarkdown(html, url);
  if (parsed?.markdown) {
    return parsed.markdown.slice(0, DEEP_FETCH_MAX_CHARS);
  }
  // Regex fallback: strip scripts/styles, extract <article>/<main> or full body
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const articleMatch = cleaned.match(/<(article|main)[^>]*>([\s\S]*?)<\/(article|main)>/i);
  const source = articleMatch?.[2] ?? cleaned;
  const text = decodeHtml(stripHtmlTags(source)).replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 50 ? text.slice(0, DEEP_FETCH_MAX_CHARS) : undefined;
}

type MetaResult = Omit<LinkedContentMeta, 'url' | 'source' | 'mentionedBy'>;

async function enrichWebPage(url: string): Promise<MetaResult> {
  const platform = detectPlatform(url);

  // X/Twitter: use fxtwitter API for both metadata and deep content
  if (platform === 'x') {
    const fullText = await deepFetchXStatus(url).catch(() => undefined);
    return {
      title: fullText?.split('\n')[0]?.slice(0, 200) ?? new URL(url).hostname,
      description: fullText?.slice(0, 300),
      platform,
      fullText,
    };
  }

  // General web: fetch HTML for metadata + optional deep content
  const res = await fetchWithTimeout(url, 15_000, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (ObsBot)',
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

  // Deep fetch full text if candidate
  let fullText: string | undefined;
  if (isDeepFetchCandidate(url)) {
    fullText = await deepFetchWebPage(url, html).catch(() => undefined);
  }

  return {
    title: title.slice(0, 200),
    description: cleanDesc ? cleanDesc.slice(0, 300) : undefined,
    platform,
    fullText,
  };
}

async function enrichSingleUrl(entry: UrlEntry): Promise<LinkedContentMeta> {
  const { url, source, mentionedBy } = entry;
  const meta = await enrichWebPage(url);
  return { url, source, mentionedBy, ...meta };
}

/**
 * Fetch metadata + deep content for a batch of URLs.
 * Each URL has its own timeout; partial failures are silently dropped.
 */
export async function enrichLinkedUrls(entries: UrlEntry[]): Promise<LinkedContentMeta[]> {
  if (entries.length === 0) return [];
  const results = await Promise.allSettled(entries.map((e) => enrichSingleUrl(e)));
  return results
    .filter((r): r is PromiseFulfilledResult<LinkedContentMeta> => r.status === 'fulfilled')
    .map((r) => r.value);
}
