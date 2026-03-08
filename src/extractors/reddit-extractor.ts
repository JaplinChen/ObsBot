import type { ExtractedContent, ExtractorWithComments, ThreadComment } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

const REDDIT_PATTERN = /reddit\.com\/r\/([\w]+)\/comments\/([\w]+)/i;
const REDDIT_SHORT_PATTERN = /reddit\.com\/r\/[\w]+\/s\/([\w]+)/i;

function normalizeDate(iso?: string | null): string {
  if (!iso) return new Date().toISOString().split('T')[0];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  return d.toISOString().split('T')[0];
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return '';
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
    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1500);

      const currentUrl = page.url();
      if (!REDDIT_PATTERN.test(currentUrl)) {
        throw new Error(`Invalid or redirected Reddit URL: ${url}`);
      }

      const title = await page.locator('h1').first().innerText().catch(() => '');
      if (!title.trim()) throw new Error('Reddit post title not found');

      const author = firstNonEmpty([
        await page.locator('a[href*="/user/"]').first().innerText().catch(() => ''),
        await page.locator('[data-testid="post_author_link"]').first().innerText().catch(() => ''),
      ]) || 'unknown';

      const subreddit = firstNonEmpty([
        await page.locator('a[href^="/r/"]').first().innerText().catch(() => ''),
      ]).replace(/^r\//, '');

      const body = firstNonEmpty([
        await page.locator('[data-click-id="text"]').first().innerText().catch(() => ''),
        await page.locator('[data-post-click-location="text-body"]').first().innerText().catch(() => ''),
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

      const commentCountText = await page.locator('a[href$="#comments"], [data-testid="comments-page-link-num-comments"]').first().innerText().catch(() => '');
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
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
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
          await node.innerText().catch(() => ''),
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
