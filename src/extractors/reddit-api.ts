/**
 * Reddit 內容擷取輔助函式：API 層（Arctic Shift / old.reddit / www.reddit JSON）
 */
import type { ExtractedContent, ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const REDDIT_PATTERN = /reddit\.com\/r\/([\w]+)\/comments\/([\w]+)/i;

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Reddit API 用 UA（較不可疑）
const API_UA = 'ObsBot/1.0 (archive reader; contact: obsbot@localhost)';

export function normalizeDate(iso?: string | null): string {
  if (!iso) return new Date().toISOString().split('T')[0];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  return d.toISOString().split('T')[0];
}

export function normalizeDateFromEpoch(epoch?: number | null): string {
  if (!epoch) return new Date().toISOString().split('T')[0];
  return new Date(epoch * 1000).toISOString().split('T')[0];
}

export function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractPostId(url: string): string | null {
  return url.match(REDDIT_PATTERN)?.[2] ?? null;
}

/** reddit.com/video/{id} 解析：id 即 postId */
export function extractVideoPostId(url: string): string | null {
  return url.match(/reddit\.com\/video\/([\w]+)/i)?.[1] ?? null;
}

/** Wiki 頁面資訊解析 */
function extractWikiInfo(url: string): { subreddit: string; page: string } | null {
  const m = url.match(/reddit\.com\/r\/([\w]+)\/wiki\/([\S]+)/i);
  if (!m) return null;
  return { subreddit: m[1], page: m[2].replace(/\/$/, '') };
}

/** Wiki 頁面擷取：使用 Reddit wiki JSON API */
export async function extractViaWiki(url: string): Promise<ExtractedContent | null> {
  const info = extractWikiInfo(url);
  if (!info) return null;
  try {
    const apiUrl = `https://www.reddit.com/r/${info.subreddit}/wiki/${info.page}.json`;
    const res = await fetchWithTimeout(apiUrl, 15_000, {
      headers: { 'User-Agent': API_UA, Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const wikiData = data?.data as Record<string, unknown> | undefined;
    if (!wikiData) return null;
    const content = String(wikiData.content_md || '');
    if (!content.trim()) return null;
    const author = String(
      (wikiData.revision_by as Record<string, Record<string, string>> | undefined)?.data?.name || 'wiki',
    );
    const date = normalizeDateFromEpoch(wikiData.revision_date as number | undefined);
    return {
      platform: 'reddit',
      author,
      authorHandle: `u/${author}`,
      title: `r/${info.subreddit} Wiki: ${info.page}`,
      text: [`**r/${info.subreddit}** Wiki: \`${info.page}\``, '', content].join('\n'),
      images: [],
      videos: [],
      date,
      url,
    };
  } catch {
    return null;
  }
}

/** 短連結預解析：HEAD 追蹤 redirect */
export async function resolveShortUrl(url: string): Promise<string> {
  const SHORT_PATTERN = /reddit\.com\/r\/[\w]+\/s\/([\w]+)/i;
  if (!SHORT_PATTERN.test(url)) return url;
  try {
    const res = await fetchWithTimeout(url, 10_000, {
      method: 'HEAD',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
    });
    if (REDDIT_PATTERN.test(res.url)) return res.url;
  } catch {
    // 無法解析就用原始 URL
  }
  return url;
}

function buildPostContent(
  post: Record<string, unknown>,
  postId: string,
  fallbackUrl: string,
): ExtractedContent {
  const subreddit = String(post.subreddit || '');
  const author = String(post.author || 'unknown');
  const selftext = String(post.selftext || '');
  const title = String(post.title || '').trim();
  const date = normalizeDateFromEpoch(post.created_utc as number | undefined);
  const commentCount = typeof post.num_comments === 'number' ? post.num_comments : undefined;

  const images: string[] = [];
  const urlDest = String(post.url_overridden_by_dest || post.url || '');
  if (urlDest && /\.(jpg|jpeg|png|gif|webp)/i.test(urlDest)) images.push(urlDest);
  if (Array.isArray((post.preview as Record<string, unknown>)?.images)) {
    for (const img of (post.preview as Record<string, unknown[]>).images as Array<Record<string, unknown>>) {
      const src = String((img.source as Record<string, string>)?.url || '').replace(/&amp;/g, '&');
      if (src) images.push(src);
    }
  }

  const permalink = String(post.permalink || '');
  const canonicalUrl = permalink
    ? `https://www.reddit.com${permalink}`
    : fallbackUrl || `https://www.reddit.com/r/${subreddit}/comments/${postId}/`;

  return {
    platform: 'reddit',
    author,
    authorHandle: `u/${author}`,
    title,
    text: [subreddit ? `**r/${subreddit}**` : '**Reddit**', '', selftext || '[No body text]'].join('\n'),
    images: [...new Set(images)].slice(0, 8),
    videos: [],
    date,
    url: canonicalUrl,
    commentCount,
  };
}

/** Tier 0: Arctic Shift 公開歸檔 API */
export async function extractViaArcticShift(
  postId: string,
  fallbackUrl: string,
): Promise<ExtractedContent | null> {
  try {
    const res = await fetchWithTimeout(
      `https://arctic-shift.photon-reddit.com/api/posts/ids?ids=${postId}`,
      15_000,
      { headers: { 'User-Agent': API_UA, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const post = data?.data?.[0];
    if (!String(post?.title || '').trim()) return null;
    return buildPostContent(post as Record<string, unknown>, postId, fallbackUrl);
  } catch {
    return null;
  }
}

/** Tier 1: old.reddit.com JSON */
export async function extractViaOldReddit(url: string): Promise<ExtractedContent | null> {
  try {
    const oldUrl = url.replace('www.reddit.com', 'old.reddit.com').replace(/\/+$/, '') + '.json';
    const res = await fetchWithTimeout(oldUrl, 15_000, {
      headers: { 'User-Agent': API_UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!String(post?.title || '').trim()) return null;
    return { ...buildPostContent(post as Record<string, unknown>, '', url), url };
  } catch {
    return null;
  }
}

/** Tier 2: www.reddit.com JSON，帶指數退避重試 */
export async function extractViaJson(url: string): Promise<ExtractedContent | null> {
  const jsonUrl = url.replace(/\/+$/, '') + '.json';
  const delays = [2_000, 8_000, 20_000];

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const res = await fetchWithTimeout(jsonUrl, 15_000, {
        headers: {
          'User-Agent': API_UA,
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
      });
      if (res.status === 429) {
        if (attempt < delays.length - 1) { await sleep(delays[attempt]); continue; }
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const post = data?.[0]?.data?.children?.[0]?.data;
      if (!String(post?.title || '').trim()) return null;
      return { ...buildPostContent(post as Record<string, unknown>, '', url), url };
    } catch {
      if (attempt < delays.length - 1) await sleep(delays[attempt]);
    }
  }
  return null;
}

/** Arctic Shift 留言 API */
export async function fetchCommentsViaArcticShift(
  postId: string,
  limit: number,
): Promise<ThreadComment[]> {
  const res = await fetchWithTimeout(
    `https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=${postId}&limit=${limit}&depth=1`,
    15_000,
    { headers: { 'User-Agent': API_UA, Accept: 'application/json' } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const items: ThreadComment[] = [];
  for (const c of (data?.data ?? []) as Array<Record<string, unknown>>) {
    if (items.length >= limit) break;
    const body = String(c.body || '');
    if (!body || body === '[deleted]' || body === '[removed]') continue;
    const author = String(c.author || 'unknown');
    items.push({
      author,
      authorHandle: `u/${author}`,
      text: body.trim().slice(0, 3000),
      date: normalizeDateFromEpoch(c.created_utc as number | undefined),
    });
  }
  return items;
}

/** old.reddit / www.reddit JSON 留言 */
export async function fetchCommentsViaJson(
  url: string,
  limit: number,
): Promise<ThreadComment[]> {
  for (const base of ['old.reddit.com', 'www.reddit.com']) {
    try {
      const jsonUrl = url
        .replace('www.reddit.com', base)
        .replace('old.reddit.com', base)
        .replace(/\/+$/, '') + '.json';
      const res = await fetchWithTimeout(jsonUrl, 15_000, {
        headers: { 'User-Agent': API_UA, Accept: 'application/json' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || !data[1]?.data?.children) continue;
      const comments: ThreadComment[] = [];
      for (const child of data[1].data.children as Array<Record<string, unknown>>) {
        if (comments.length >= limit) break;
        if (child.kind !== 't1') continue;
        const d = child.data as Record<string, unknown>;
        const body = String(d?.body || '');
        if (!body || body === '[deleted]' || body === '[removed]') continue;
        const author = String(d.author || 'unknown');
        comments.push({
          author,
          authorHandle: `u/${author}`,
          text: body.trim().slice(0, 3000),
          date: normalizeDateFromEpoch(d.created_utc as number | undefined),
        });
      }
      if (comments.length > 0) return comments;
    } catch {
      // 繼續下一層
    }
  }
  return [];
}
