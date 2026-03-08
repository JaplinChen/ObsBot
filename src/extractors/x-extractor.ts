import type { ExtractedContent, ExtractorWithComments, ThreadComment, VideoInfo } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';

const X_URL_PATTERN = /(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/i;

function parseCount(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  const m = t.match(/([\d.]+)\s*([km])?/i);
  if (!m) return undefined;
  const base = Number(m[1]);
  if (Number.isNaN(base)) return undefined;
  if (m[2] === 'k') return Math.round(base * 1_000);
  if (m[2] === 'm') return Math.round(base * 1_000_000);
  return Math.round(base);
}

export const xExtractor: ExtractorWithComments = {
  platform: 'x',

  match(url: string): boolean {
    return X_URL_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    const match = url.match(X_URL_PATTERN);
    return match?.[2] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const match = url.match(X_URL_PATTERN);
    if (!match) throw new Error(`Invalid X.com URL: ${url}`);

    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('[data-testid="tweet"]', { timeout: 15_000 });

      const tweet = page.locator('[data-testid="tweet"]').first();
      const text = await tweet.locator('[data-testid="tweetText"]').innerText().catch(() => '');
      if (!text.trim()) {
        throw new Error('X page loaded but tweet text is empty');
      }

      const author = await tweet.locator('[data-testid="User-Name"] span').first().innerText().catch(() => match[1]);
      const handleHref = await tweet.locator('[data-testid="User-Name"] a').last().getAttribute('href').catch(() => `/${match[1]}`);
      const authorHandle = `@${(handleHref ?? `/${match[1]}`).replace('/', '')}`;

      const timeAttr = await tweet.locator('time').getAttribute('datetime').catch(() => null);
      const date = timeAttr
        ? new Date(timeAttr).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const likesText = await tweet.locator('[data-testid="like"] span').last().innerText().catch(() => '');
      const repostsText = await tweet.locator('[data-testid="retweet"] span').last().innerText().catch(() => '');

      const images = await tweet.locator('img').evaluateAll((els) =>
        els
          .map((el) => (el as HTMLImageElement).src)
          .filter((src) => src && !src.includes('profile_images') && !src.includes('emoji')),
      );

      const videoEntries = await tweet.locator('video').evaluateAll((els) =>
        els
          .map((el) => {
            const v = el as HTMLVideoElement;
            const source = v.querySelector('source')?.getAttribute('src') ?? v.getAttribute('src') ?? '';
            const poster = v.getAttribute('poster') ?? '';
            return source ? { source, poster } : null;
          })
          .filter((x) => x !== null),
      );

      const videos: VideoInfo[] = videoEntries.map((v) => ({
        url: v.source,
        thumbnailUrl: v.poster || undefined,
        type: 'video',
      }));

      return {
        platform: 'x',
        author: author.trim() || match[1],
        authorHandle,
        title: text.split('\n')[0].slice(0, 80),
        text,
        images: [...new Set(images)],
        videos,
        date,
        url,
        likes: parseCount(likesText),
        reposts: parseCount(repostsText),
      };
    } finally {
      await release();
    }
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    const { page, release } = await camoufoxPool.acquire();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('[data-testid="tweet"]', { timeout: 15_000 });

      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(1200);
      }

      const tweetEls = await page.locator('[data-testid="tweet"]').all();
      const comments: ThreadComment[] = [];

      for (const el of tweetEls.slice(1)) {
        if (comments.length >= limit) break;
        try {
          const author = await el.locator('[data-testid="User-Name"] span').first().innerText();
          const handle = await el.locator('[data-testid="User-Name"] a').last().getAttribute('href') ?? '';
          const text = await el.locator('[data-testid="tweetText"]').innerText().catch(() => '');
          const timeEl = await el.locator('time').getAttribute('datetime').catch(() => '');
          const date = timeEl ? new Date(timeEl).toISOString().split('T')[0] : '';

          if (text.trim()) {
            comments.push({
              author: author.trim(),
              authorHandle: `@${handle.replace('/', '')}`,
              text: text.trim(),
              date,
            });
          }
        } catch {
          // skip malformed tweet elements
        }
      }

      return comments;
    } finally {
      await release();
    }
  },
};

