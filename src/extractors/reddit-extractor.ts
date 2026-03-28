import type { ExtractedContent, ExtractorWithComments, ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

const REDDIT_PATTERN = /reddit\.com\/r\/([\w]+)\/comments\/([\w]+)/i;
const REDDIT_SHORT_PATTERN = /reddit\.com\/r\/[\w]+\/s\/([\w]+)/i;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeDate(iso?: string | null): string {
  if (!iso) return new Date().toISOString().split('T')[0];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  return d.toISOString().split('T')[0];
}

function normalizeDateFromEpoch(epoch?: number | null): string {
  if (!epoch) return new Date().toISOString().split('T')[0];
  return new Date(epoch * 1000).toISOString().split('T')[0];
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** Extract via Reddit's public .json API (no browser needed) */
async function extractViaJson(url: string): Promise<ExtractedContent | null> {
  try {
    // Normalize URL: strip trailing slash, append .json
    const jsonUrl = url.replace(/\/+$/, '') + '.json';
    const res = await fetchWithTimeout(jsonUrl, 15_000, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || !data[0]?.data?.children?.[0]?.data) return null;

    const post = data[0].data.children[0].data;
    const title = post.title;
    if (!title?.trim()) return null;

    const subreddit = post.subreddit || '';
    const author = post.author || 'unknown';
    const selftext = post.selftext || '';
    const date = normalizeDateFromEpoch(post.created_utc);
    const commentCount = post.num_comments || undefined;

    const images: string[] = [];
    if (post.url_overridden_by_dest &&
        /\.(jpg|jpeg|png|gif|webp)/i.test(post.url_overridden_by_dest)) {
      images.push(post.url_overridden_by_dest);
    }
    if (post.preview?.images) {
      for (const img of post.preview.images) {
        const src = img.source?.url?.replace(/&amp;/g, '&');
        if (src) images.push(src);
      }
    }

    const text = [
      subreddit ? `**r/${subreddit}**` : '**Reddit**',
      '',
      selftext || '[No body text]',
    ].join('\n');

    return {
      platform: 'reddit',
      author,
      authorHandle: `u/${author}`,
      title: title.trim(),
      text,
      images: [...new Set(images)].slice(0, 8),
      videos: [],
      date,
      url,
      commentCount,
    };
  } catch {
    return null;
  }
}

/** Fallback: extract via Camoufox browser rendering */
async function extractViaBrowser(url: string): Promise<ExtractedContent> {
  const { page, release } = await camoufoxPool.acquire();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    if (!REDDIT_PATTERN.test(currentUrl)) {
      throw new Error(`Invalid or redirected Reddit URL: ${url}`);
    }

    const title = await page.locator('h1').first().innerText().catch(() => '');
    if (!title.trim()) throw new Error('Reddit post title not found');

    const author = firstNonEmpty([
      await page.locator('shreddit-post').first().getAttribute('author').catch(() => ''),
      await page.locator('a[href*="/user/"]').first().innerText().catch(() => ''),
      await page.locator('[data-testid="post_author_link"]').first().innerText().catch(() => ''),
    ]) || 'unknown';

    const subreddit = firstNonEmpty([
      await page.locator('a[href^="/r/"]').first().innerText().catch(() => ''),
    ]).replace(/^r\//, '');

    const body = firstNonEmpty([
      await page.locator('[data-click-id="text"]').first().innerText().catch(() => ''),
      await page.locator('[data-post-click-location="text-body"]').first().innerText().catch(() => ''),
      await page.locator('[slot="text-body"]').first().innerText().catch(() => ''),
      await page.locator('shreddit-post [slot="text-body"]').first().innerText().catch(() => ''),
    ]);

    const text = [
      subreddit ? `**r/${subreddit}**` : '**Reddit**',
      '',
      body || '[No body text]',
    ].join('\n');

    const images = await page.locator('img').evaluateAll((els) =>
      els
        .map((el) => (el as HTMLImageElement).src)
        .filter((src) => src && (src.includes('preview.redd.it') || src.includes('i.redd.it'))),
    );

    const dateIso = await page.locator('time').first().getAttribute('datetime').catch(() => null);
    const date = normalizeDate(dateIso);

    const commentCountText = await page
      .locator('a[href$="#comments"], [data-testid="comments-page-link-num-comments"]')
      .first().innerText().catch(() => '');
    const commentCount = Number(commentCountText.replace(/[^\d]/g, '')) || undefined;

    return {
      platform: 'reddit',
      author: author.replace(/^u\//, ''),
      authorHandle: author.startsWith('u/') ? author : `u/${author}`,
      title: title.trim(),
      text,
      images: [...new Set(images)],
      videos: [],
      date,
      url,
      commentCount,
    };
  } finally {
    await release();
  }
}

export const redditExtractor: ExtractorWithComments = {
  platform: 'reddit',

  match(url: string): boolean {
    return REDDIT_PATTERN.test(url) || REDDIT_SHORT_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    return url.match(REDDIT_PATTERN)?.[2] ?? url.match(REDDIT_SHORT_PATTERN)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    // Tier 1: Reddit .json API (fast, no browser)
    const jsonResult = await extractViaJson(url);
    if (jsonResult) return jsonResult;

    // Tier 2: Camoufox browser rendering (fallback)
    return extractViaBrowser(url);
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    // Try JSON API first for comments
    try {
      const jsonUrl = url.replace(/\/+$/, '') + '.json';
      const res = await fetchWithTimeout(jsonUrl, 15_000, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        redirect: 'follow',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data[1]?.data?.children) {
          const comments: ThreadComment[] = [];
          for (const child of data[1].data.children) {
            if (comments.length >= limit) break;
            if (child.kind !== 't1' || !child.data?.body) continue;
            const author = child.data.author || 'unknown';
            comments.push({
              author,
              authorHandle: `u/${author}`,
              text: child.data.body.trim().slice(0, 3000),
              date: normalizeDateFromEpoch(child.data.created_utc),
            });
          }
          if (comments.length > 0) return comments;
        }
      }
    } catch {
      // fall through to browser
    }

    // Fallback: browser-based comment extraction
    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1500);

      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(800);
      }

      const nodes = await page.locator('shreddit-comment, [data-testid="comment"]').all();
      const comments: ThreadComment[] = [];

      for (const node of nodes) {
        if (comments.length >= limit) break;

        const text = firstNonEmpty([
          await node.locator('[slot="comment"] p').allInnerTexts().then((arr) => arr.join('\n')).catch(() => ''),
          await node.locator('p').first().innerText().catch(() => ''),
        ]);
        if (!text || text.length < 3) continue;

        const author = firstNonEmpty([
          await node.locator('a[href*="/user/"]').first().innerText().catch(() => ''),
          await node.getAttribute('author').catch(() => ''),
        ]) || 'unknown';

        const timeIso = await node.locator('time').first().getAttribute('datetime').catch(() => null);

        comments.push({
          author: author.replace(/^u\//, ''),
          authorHandle: author.startsWith('u/') ? author : `u/${author}`,
          text: text.trim().slice(0, 3000),
          date: normalizeDate(timeIso),
        });
      }

      return comments;
    } finally {
      await release();
    }
  },
};
