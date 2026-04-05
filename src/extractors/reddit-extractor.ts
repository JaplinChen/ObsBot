import type { ExtractedContent, ExtractorWithComments, ThreadComment } from './types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import {
  BROWSER_UA,
  firstNonEmpty,
  normalizeDate,
  extractPostId,
  extractVideoPostId,
  resolveShortUrl,
  extractViaArcticShift,
  extractViaOldReddit,
  extractViaJson,
  extractViaWiki,
  fetchCommentsViaArcticShift,
  fetchCommentsViaJson,
} from './reddit-api.js';

const REDDIT_PATTERN = /reddit\.com\/r\/([\w]+)\/comments\/([\w]+)/i;
const REDDIT_SHORT_PATTERN = /reddit\.com\/r\/[\w]+\/s\/([\w]+)/i;
const REDDIT_WIKI_PATTERN = /reddit\.com\/r\/([\w]+)\/wiki\//i;
const REDDIT_VIDEO_PATTERN = /reddit\.com\/video\/([\w]+)/i;

/** Tier 3 (最終備用): Camoufox 瀏覽器渲染 */
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

/** Camoufox 瀏覽器留言擷取 */
async function fetchCommentsViaBrowser(url: string, limit: number): Promise<ThreadComment[]> {
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
}

export const redditExtractor: ExtractorWithComments = {
  platform: 'reddit',

  match(url: string): boolean {
    return (
      REDDIT_PATTERN.test(url) ||
      REDDIT_SHORT_PATTERN.test(url) ||
      REDDIT_WIKI_PATTERN.test(url) ||
      REDDIT_VIDEO_PATTERN.test(url)
    );
  },

  parseId(url: string): string | null {
    return (
      url.match(REDDIT_PATTERN)?.[2] ??
      url.match(REDDIT_SHORT_PATTERN)?.[1] ??
      url.match(REDDIT_VIDEO_PATTERN)?.[1] ??
      null
    );
  },

  async extract(url: string): Promise<ExtractedContent> {
    // Wiki 頁面走專用路徑
    if (REDDIT_WIKI_PATTERN.test(url)) {
      const wikiResult = await extractViaWiki(url);
      if (wikiResult) return wikiResult;
      throw new Error(`Reddit wiki 擷取失敗: ${url}`);
    }

    const resolvedUrl = await resolveShortUrl(url);
    // video URL 的 id 即 postId
    const postId = extractPostId(resolvedUrl) ?? extractVideoPostId(resolvedUrl);

    // Tier 0: Arctic Shift（最快，不需瀏覽器，無認證）
    if (postId) {
      const result = await extractViaArcticShift(postId, resolvedUrl);
      if (result) return result;
    }

    // Tier 1: old.reddit.com JSON
    const oldResult = await extractViaOldReddit(resolvedUrl);
    if (oldResult) return oldResult;

    // Tier 2: www.reddit.com JSON（帶退避重試）
    const jsonResult = await extractViaJson(resolvedUrl);
    if (jsonResult) return jsonResult;

    // Tier 3: Camoufox 瀏覽器
    return extractViaBrowser(resolvedUrl);
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    const resolvedUrl = await resolveShortUrl(url);
    const postId = extractPostId(resolvedUrl);

    // Tier 0: Arctic Shift 留言
    if (postId) {
      try {
        const items = await fetchCommentsViaArcticShift(postId, limit);
        if (items.length > 0) return items;
      } catch {
        // 繼續下一層
      }
    }

    // Tier 1/2: old.reddit / www.reddit JSON 留言
    const jsonComments = await fetchCommentsViaJson(resolvedUrl, limit);
    if (jsonComments.length > 0) return jsonComments;

    // Tier 3: Camoufox 瀏覽器留言
    return fetchCommentsViaBrowser(resolvedUrl, limit);
  },
};
