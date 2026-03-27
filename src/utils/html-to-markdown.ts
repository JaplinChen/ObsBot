/**
 * HTML → Markdown conversion using Readability + Turndown.
 *
 * Provides three entry points:
 *   - htmlToMarkdown(): full-page article extraction via Readability + Turndown
 *   - htmlToMarkdownWithBrowser(): Camoufox fallback for JS-rendered pages
 *   - htmlFragmentToMarkdown(): direct Turndown on an HTML snippet (e.g. GitHub README)
 */

import { parseHTML } from 'linkedom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import TurndownService from 'turndown';
// @ts-expect-error — no type declarations for turndown-plugin-gfm
import { gfm } from 'turndown-plugin-gfm';
import { camoufoxPool } from './camoufox-pool.js';

export interface HtmlToMarkdownResult {
  title: string;
  markdown: string;
  excerpt: string;
  byline: string | null;
}

const MAX_MARKDOWN_LENGTH = 8000;

/** Resolve a base URL to its origin (protocol + host) */
function resolveBaseOrigin(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Create a configured Turndown instance (shared config) */
function createTurndown(baseUrl?: string): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.use(gfm);

  const origin = baseUrl ? resolveBaseOrigin(baseUrl) : null;

  // Resolve relative links to absolute URLs
  if (origin) {
    td.addRule('resolveRelativeLinks', {
      filter: (node: HTMLElement) => {
        if (node.nodeName !== 'A') return false;
        const href = node.getAttribute('href') || '';
        return href.startsWith('/') && !href.startsWith('//');
      },
      replacement: (content: string, node: HTMLElement) => {
        const href = node.getAttribute('href') || '';
        const resolved = `${origin}${href}`;
        return content ? `[${content}](${resolved})` : '';
      },
    });

    td.addRule('resolveRelativeImages', {
      filter: (node: HTMLElement) => {
        if (node.nodeName !== 'IMG') return false;
        const src = node.getAttribute('src') || '';
        return src.startsWith('/') && !src.startsWith('//');
      },
      replacement: (_content: string, node: HTMLElement) => {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        const resolved = `${origin}${src}`;
        return `![${alt}](${resolved})`;
      },
    });
  }

  // Remove badge images (shields.io etc.)
  td.addRule('removeBadges', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'IMG') return false;
      const src = node.getAttribute('src') || '';
      return /shields\.io|badge|img\.shields/i.test(src);
    },
    replacement: () => '',
  });

  // Remove empty anchor links (GitHub heading anchors like [](#section))
  td.addRule('removeEmptyAnchors', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'A') return false;
      return !node.textContent?.trim() && !!node.getAttribute('href')?.startsWith('#');
    },
    replacement: () => '',
  });

  return td;
}

/**
 * Extract article content from a full HTML page using Readability,
 * then convert to Markdown via Turndown.
 *
 * Returns null if the page is not article-like or Readability fails,
 * allowing the caller to fall back to regex-based extraction.
 *
 * @param skipHeuristic - if true, skip isProbablyReaderable check (used for browser-rendered HTML)
 */
export function htmlToMarkdown(
  html: string,
  url: string,
  skipHeuristic = false,
): HtmlToMarkdownResult | null {
  const { document } = parseHTML(html);

  if (!skipHeuristic && !isProbablyReaderable(document)) return null;

  const article = new Readability(document, { charThreshold: 200 }).parse();
  if (!article?.content) return null;

  const td = createTurndown(url);
  let markdown = td.turndown(article.content);

  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    markdown = markdown.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n...(truncated)';
  }

  return {
    title: (article.title || '').slice(0, 100),
    markdown,
    excerpt: (article.excerpt || '').slice(0, 300),
    byline: article.byline ?? null,
  };
}

/**
 * Fallback: render page with Camoufox browser, then extract with Readability + Turndown.
 * Used when fetch() HTML fails Readability (JS-rendered content).
 */
export async function htmlToMarkdownWithBrowser(url: string): Promise<HtmlToMarkdownResult | null> {
  const { page, release } = await camoufoxPool.acquire();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Wait for main content to render
    await page.waitForTimeout(3000);
    const html = await page.content();
    return htmlToMarkdown(html, url, true);
  } finally {
    await release();
  }
}

/**
 * Fallback: render page with Browser Use CLI (headless Chromium), then extract.
 * Used when Camoufox is unavailable or fails. Does not require login — suitable
 * for public JS-rendered pages only.
 */
export async function htmlToMarkdownWithBrowserUse(url: string): Promise<HtmlToMarkdownResult | null> {
  const { BrowserUseClient } = await import('./browser-use-client.js');
  const client = new BrowserUseClient('obsbot-web');
  try {
    await client.open(url);
    // Wait for JS rendering
    await new Promise((r) => setTimeout(r, 3000));
    const html = await client.html();
    if (!html || html.length < 200) return null;
    return htmlToMarkdown(html, url, true);
  } catch {
    return null;
  }
}

/**
 * Convert an HTML fragment (not a full page) to Markdown.
 * Used for pre-extracted content like GitHub README <article> blocks.
 * @param baseUrl — optional source URL for resolving relative links/images
 */
export function htmlFragmentToMarkdown(htmlFragment: string, baseUrl?: string): string {
  const td = createTurndown(baseUrl);
  let markdown = td.turndown(htmlFragment);

  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    markdown = markdown.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n...(truncated)';
  }

  return markdown;
}
