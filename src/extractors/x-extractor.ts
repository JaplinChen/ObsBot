import type { ExtractedContent, ExtractorWithComments, ThreadComment, VideoInfo } from './types.js';
import { fetchWithTimeout, retry } from '../utils/fetch-with-timeout.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { extractThreadViaGraphQL } from './x-graphql-thread.js';

interface ArticleBlock {
  text: string;
  type: string;
}

interface ArticleMediaEntity {
  media_info?: {
    original_img_url?: string;
  };
}

interface FxTweetThread {
  text: string;
  media?: {
    photos?: Array<{ url: string }>;
    videos?: Array<{ url: string; thumbnail_url: string; type: 'video' | 'gif' }>;
  };
}

interface FxTweetResponse {
  code: number;
  message: string;
  tweet: {
    text: string;
    author: {
      name: string;
      screen_name: string;
    };
    media?: {
      photos?: Array<{ url: string }>;
      videos?: Array<{
        url: string;
        thumbnail_url: string;
        type: 'video' | 'gif';
      }>;
    };
    article?: {
      title?: string;
      preview_text?: string;
      cover_media?: {
        media_info?: { original_img_url?: string };
      };
      content?: {
        blocks?: ArticleBlock[];
        media_entities?: ArticleMediaEntity[];
      };
    };
    thread?: {
      tweets?: FxTweetThread[];
    };
    created_at: string;
    created_timestamp: number;
    likes: number;
    retweets: number;
  };
}

const X_URL_PATTERN = /(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/i;

function extractTweetTitle(text: string): string {
  const JUNK_LINE = /^[\s#@\p{P}]*$/u;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !JUNK_LINE.test(trimmed)) {
      return trimmed.slice(0, 80);
    }
  }
  return text.split('\n')[0].slice(0, 80);
}

function blocksToMarkdown(blocks: ArticleBlock[]): string {
  const lines: string[] = [];
  let listIndex = 0;

  for (const block of blocks) {
    if (!block.text.trim() && block.type === 'atomic') continue;
    switch (block.type) {
      case 'header-one':
        lines.push(`## ${block.text}`, '');
        listIndex = 0;
        break;
      case 'header-two':
        lines.push(`### ${block.text}`, '');
        listIndex = 0;
        break;
      case 'unordered-list-item':
        lines.push(`- ${block.text}`);
        listIndex = 0;
        break;
      case 'ordered-list-item':
        listIndex++;
        lines.push(`${listIndex}. ${block.text}`);
        break;
      case 'blockquote':
        lines.push(`> ${block.text}`, '');
        listIndex = 0;
        break;
      default:
        if (block.text.trim()) {
          lines.push(block.text, '');
        }
        listIndex = 0;
    }
  }
  return lines.join('\n');
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

    const [, screenName, tweetId] = match;

    // 依序嘗試 fxtwitter → vxtwitter，各自 10s timeout、2 次嘗試
    const endpoints = [
      `https://api.fxtwitter.com/${screenName}/status/${tweetId}`,
      `https://api.vxtwitter.com/${screenName}/status/${tweetId}`,
    ];

    let data: FxTweetResponse | null = null;
    let lastError: Error = new Error('All tweet API endpoints failed');
    for (const apiUrl of endpoints) {
      try {
        const res = await retry(async () => {
          const response = await fetchWithTimeout(apiUrl, 10_000);
          if (!response.ok) {
            throw new Error(`Tweet API error: ${response.status} ${response.statusText}`);
          }
          return response;
        }, 2, 500);
        const parsed = (await res.json()) as FxTweetResponse;
        if (parsed.code === 200) {
          data = parsed;
          break;
        }
        lastError = new Error(`Tweet API returned code ${parsed.code}: ${parsed.message}`);
      } catch (e) {
        lastError = e as Error;
      }
    }
    if (!data) throw lastError;

    const { tweet } = data;
    const { article } = tweet;

    let text: string;
    let title: string;
    if (article?.content?.blocks?.length) {
      title = article.title ?? extractTweetTitle(tweet.text);
      text = blocksToMarkdown(article.content.blocks);
    } else {
      title = extractTweetTitle(tweet.text);
      text = tweet.text;
    }

    const images: string[] = [];
    if (article?.cover_media?.media_info?.original_img_url) {
      images.push(article.cover_media.media_info.original_img_url);
    }
    if (article?.content?.media_entities) {
      for (const entity of article.content.media_entities) {
        const imgUrl = entity.media_info?.original_img_url;
        if (imgUrl && !images.includes(imgUrl)) images.push(imgUrl);
      }
    }
    if (tweet.media?.photos) {
      for (const p of tweet.media.photos) {
        if (!images.includes(p.url)) images.push(p.url);
      }
    }

    const videos: VideoInfo[] = [];
    if (tweet.media?.videos) {
      for (const v of tweet.media.videos) {
        videos.push({ url: v.url, thumbnailUrl: v.thumbnail_url, type: v.type });
      }
    }

    // 附加同作者自回覆串（thread）
    const threadTweets = tweet.thread?.tweets ?? [];
    const threadParts: string[] = [];
    for (const t of threadTweets) {
      if (t.text?.trim()) threadParts.push(t.text.trim());
      for (const p of t.media?.photos ?? []) {
        if (!images.includes(p.url)) images.push(p.url);
      }
      for (const v of t.media?.videos ?? []) {
        videos.push({ url: v.url, thumbnailUrl: v.thumbnail_url, type: v.type });
      }
    }

    const fullText = threadParts.length
      ? `${text}\n\n${threadParts.join('\n\n')}`
      : text;

    return {
      platform: 'x',
      author: tweet.author.name,
      authorHandle: `@${tweet.author.screen_name}`,
      title,
      text: article?.title ? `# ${article.title}\n\n${fullText}` : fullText,
      images,
      videos,
      date: new Date(tweet.created_timestamp * 1000).toISOString().split('T')[0],
      url,
      likes: tweet.likes,
      reposts: tweet.retweets,
    };
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    const domResults: ThreadComment[] = [];
    try {
      const { page, release } = await camoufoxPool.acquire();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForSelector('[data-testid="tweet"]', { timeout: 15_000 });

        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1200);
        }

        const tweetEls = await page.locator('[data-testid="tweet"]').all();
        let opHandle = '';
        try {
          const opHref = await tweetEls[0]?.locator('[data-testid="User-Name"] a').last().getAttribute('href') ?? '';
          opHandle = opHref.replace('/', '').toLowerCase();
        } catch { /* ignore */ }

        let threadEnded = false;
        for (const el of tweetEls.slice(1)) {
          if (domResults.length >= limit) break;
          try {
            const author = await el.locator('[data-testid="User-Name"] span').first().innerText();
            const handle = await el.locator('[data-testid="User-Name"] a').last().getAttribute('href') ?? '';
            const cleanHandle = handle.replace('/', '').toLowerCase();
            const text = await el.locator('[data-testid="tweetText"]').innerText().catch(() => '');
            const timeEl = await el.locator('time').getAttribute('datetime').catch(() => '');
            const date = timeEl ? new Date(timeEl).toISOString().split('T')[0] : '';

            if (!text.trim()) continue;
            const isOp = opHandle && cleanHandle === opHandle;
            if (!isOp) threadEnded = true;

            domResults.push({
              author: author.trim(),
              authorHandle: `@${handle.replace('/', '')}`,
              text: text.trim(),
              date,
              isThreadContinuation: (isOp && !threadEnded) || undefined,
            });
          } catch { /* skip malformed */ }
        }
      } catch { /* DOM 抓取失敗，交由 GraphQL 備援 */ }
      finally { await release(); }
    } catch { /* pool 取得失敗 */ }

    if (domResults.length > 0) return domResults;

    // Playwright 抓不到回覆（X 需要登入）→ GraphQL TweetDetail API 備援
    const match = url.match(X_URL_PATTERN);
    if (!match) return [];
    const [, screenName, tweetId] = match;
    return extractThreadViaGraphQL(tweetId, screenName, limit);
  },
};
