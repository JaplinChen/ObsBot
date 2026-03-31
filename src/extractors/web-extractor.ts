export const JINA_REMOVE_SELECTORS = '';
import type { ExtractedContent, Extractor } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { stripHtmlTags } from './web-cleaner.js';
import { htmlToMarkdown, htmlToMarkdownWithBrowser, htmlToMarkdownWithBrowserUse } from '../utils/html-to-markdown.js';


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

function extractTitle(html: string): string {
  const ogTitle = extractMeta(html, 'og:title');
  if (ogTitle) return ogTitle.slice(0, 100);
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return 'Untitled';
  return decodeHtml(m[1]).replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
}

/** Regex-based fallback when Readability cannot extract article content */
function extractBodyFallback(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const articleMatch = noScript.match(/<(article|main)[^>]*>([\s\S]*?)<\/(article|main)>/i);
  const source = articleMatch?.[2] ?? noScript;
  const text = decodeHtml(stripHtmlTags(source)).replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 6000 ? text.slice(0, 6000) + '\n\n...(truncated)' : text;
}

function absolutizeImage(url: string, pageUrl: string): string {
  try {
    return new URL(url, pageUrl).toString();
  } catch {
    return url;
  }
}

export const webExtractor: Extractor = {
  platform: 'web',

  match(_url: string): boolean {
    return true;
  },

  parseId(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  },

  async extract(url: string): Promise<ExtractedContent> {
    // Tier 0: try fast server-side fetch
    let html: string | null = null;
    let finalUrl = url;

    try {
      const res = await fetchWithTimeout(url, 30_000, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        // Skip binary responses (video, audio, images, etc.) — not parseable as HTML
        if (ct && !ct.includes('text/') && !ct.includes('html') && !ct.includes('xml') && !ct.includes('json')) {
          // Binary content (e.g. video/mp4) — cannot extract article text
          html = null;
        } else {
          html = await res.text();
          finalUrl = res.url || url;
          if (!html || html.length < 100) html = null;
        }
      }
      // 403/4xx/5xx → html stays null, fall through to browser
    } catch {
      // Network error → fall through to browser
    }

    // Tier 1: Readability + Turndown on fetched HTML
    let parsed = html ? htmlToMarkdown(html, finalUrl) : null;

    // Tier 2: Camoufox browser rendering (WAF bypass / JS-rendered pages)
    if (!parsed) {
      try {
        parsed = await htmlToMarkdownWithBrowser(url);
      } catch {
        // Tier 3: Browser Use CLI fallback
        try {
          parsed = await htmlToMarkdownWithBrowserUse(url);
        } catch {
          // All browser methods unavailable
        }
      }
    }

    // Tier 4: Regex extraction on raw HTML (if we have it)
    let title: string;
    let text: string;

    if (parsed) {
      title = parsed.title || (html ? extractTitle(html) : 'Untitled');
      const description = html
        ? (extractMeta(html, 'description') || extractMeta(html, 'og:description'))
        : '';
      text = [description, parsed.markdown].filter(Boolean).join('\n\n').trim();
    } else if (html) {
      title = extractTitle(html);
      const description = extractMeta(html, 'description') || extractMeta(html, 'og:description');
      const body = extractBodyFallback(html);
      text = [description, body].filter(Boolean).join('\n\n').trim();
    } else {
      throw new Error(`無法擷取此網頁（fetch 和瀏覽器均失敗）：${url}`);
    }

    if (!text) text = '[No readable text]';

    const imageSet = new Set<string>();
    if (html) {
      const ogImage = extractMeta(html, 'og:image');
      if (ogImage) imageSet.add(absolutizeImage(ogImage, finalUrl));

      const imgMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
      for (const m of imgMatches) {
        const src = m[1];
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
        imageSet.add(absolutizeImage(src, finalUrl));
        if (imageSet.size >= 8) break;
      }
    }

    let domain = url;
    try {
      domain = new URL(finalUrl).hostname.replace(/^www\./, '');
    } catch {
      // keep original
    }

    return {
      platform: 'web',
      author: domain,
      authorHandle: domain,
      title,
      text,
      images: [...imageSet],
      videos: [],
      date: new Date().toISOString().split('T')[0],
      url,
    };
  },
};

