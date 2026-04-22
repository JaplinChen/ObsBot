/**
 * X TweetDetail GraphQL 串文抓取。
 * 優先順序：① Chrome cookie 直接 fetch（有登入、最快）→ ② Camoufox 帶 guest ct0（備援）
 */
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { readXCookiesFromChrome } from '../utils/chrome-cookies.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import type { ThreadComment } from './types.js';

interface XTweetData {
  id: string;
  text: string;
  screenName: string;
  name: string;
  date: string;
}

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
// X GraphQL query hash（偶爾更新，若 API 回 400/403 需同步更新）
const GQL_HASH = 'tCivIG3o9ls-9cLxTsdxZQ';

function buildApiUrl(tweetId: string): string {
  const vars = JSON.stringify({
    focalTweetId: tweetId, with_rux_injections: false, rankingMode: 'Relevance',
    includePromotedContent: false, withCommunity: true, withBirdwatchNotes: false, withVoice: false,
  });
  return [
    `https://x.com/i/api/graphql/${GQL_HASH}/TweetDetail`,
    `?variables=${encodeURIComponent(vars)}`,
    `&features=${encodeURIComponent(JSON.stringify({ rweb_video_screen_enabled: false }))}`,
    `&fieldToggles=${encodeURIComponent(JSON.stringify({ withArticleRichContentState: false }))}`,
  ].join('');
}

function extractFromResult(result: Record<string, unknown>): XTweetData | null {
  const r = (result.tweet as Record<string, unknown> | undefined) ?? result;
  const legacy = r.legacy as Record<string, unknown> | undefined;
  const userLegacy = (
    ((r.core as Record<string, unknown>)?.user_results as Record<string, unknown>)
      ?.result as Record<string, unknown>
  )?.legacy as Record<string, unknown> | undefined;
  if (!legacy?.full_text || !legacy?.id_str) return null;
  return {
    id: legacy.id_str as string,
    text: legacy.full_text as string,
    screenName: (userLegacy?.screen_name as string) ?? '',
    name: (userLegacy?.name as string) ?? '',
    date: legacy.created_at ? new Date(legacy.created_at as string).toISOString().split('T')[0] : '',
  };
}

function parseTweets(data: unknown): XTweetData[] {
  const tweets: XTweetData[] = [];
  const d = data as Record<string, unknown>;
  const conv = (d?.data as Record<string, unknown>)
    ?.threaded_conversation_with_injections_v2 as Record<string, unknown> | undefined;
  const entries = (
    ((conv?.instructions ?? []) as Array<Record<string, unknown>>)
      .find(i => i.type === 'TimelineAddEntries')?.entries ?? []
  ) as Array<Record<string, unknown>>;

  for (const entry of entries) {
    const content = entry.content as Record<string, unknown>;
    if (!content) continue;
    if (content.entryType === 'TimelineTimelineItem') {
      const result = ((content.itemContent as Record<string, unknown>)
        ?.tweet_results as Record<string, unknown>)?.result as Record<string, unknown>;
      const t = result && extractFromResult(result);
      if (t) tweets.push(t);
    } else if (content.entryType === 'TimelineTimelineModule') {
      for (const item of (content.items as Array<Record<string, unknown>>) ?? []) {
        const result = ((((item.item as Record<string, unknown>)
          ?.itemContent as Record<string, unknown>)
          ?.tweet_results as Record<string, unknown>)?.result as Record<string, unknown>);
        const t = result && extractFromResult(result);
        if (t) tweets.push(t);
      }
    }
  }
  return tweets;
}

function toComments(allTweets: XTweetData[], focalId: string, opHandle: string, limit: number): ThreadComment[] {
  const comments: ThreadComment[] = [];
  let threadEnded = false;
  for (const t of allTweets) {
    if (t.id === focalId || comments.length >= limit) continue;
    const isOp = t.screenName.toLowerCase() === opHandle.toLowerCase();
    if (!isOp) threadEnded = true;
    comments.push({
      author: t.name || t.screenName,
      authorHandle: `@${t.screenName}`,
      text: t.text,
      date: t.date,
      isThreadContinuation: (isOp && !threadEnded) || undefined,
    });
  }
  return comments;
}

/** ① Chrome cookie 直接 fetch（無需瀏覽器，最快） */
async function fetchViaChromeCookies(tweetId: string, opScreenName: string, limit: number): Promise<ThreadComment[]> {
  const cookies = await readXCookiesFromChrome();
  if (!cookies) return [];
  const res = await fetchWithTimeout(buildApiUrl(tweetId), 15_000, {
    headers: {
      'Authorization': `Bearer ${BEARER}`,
      'x-csrf-token': cookies.ct0,
      'Cookie': `ct0=${cookies.ct0}; auth_token=${cookies.auth_token}`,
    },
  });
  if (!res.ok) return [];
  const data = await res.json() as unknown;
  return toComments(parseTweets(data), tweetId, opScreenName, limit);
}

/** ② Camoufox + guest ct0 備援 */
async function fetchViaCamoufox(tweetId: string, opScreenName: string, limit: number): Promise<ThreadComment[]> {
  const { page, release } = await camoufoxPool.acquire();
  try {
    await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2000);
    const cookies = await page.context().cookies(['https://x.com']);
    const ct0 = cookies.find(c => c.name === 'ct0')?.value;
    if (!ct0) return [];
    const raw = await page.evaluate(
      async ({ url, ct0, bearer }: { url: string; ct0: string; bearer: string }) => {
        const res = await fetch(url, { credentials: 'include', headers: { 'x-csrf-token': ct0, 'Authorization': `Bearer ${bearer}` } });
        return res.ok ? res.text() : null;
      },
      { url: buildApiUrl(tweetId), ct0, bearer: BEARER },
    );
    if (!raw) return [];
    return toComments(parseTweets(JSON.parse(raw) as unknown), tweetId, opScreenName, limit);
  } catch { return []; }
  finally { await release(); }
}

export async function extractThreadViaGraphQL(
  tweetId: string,
  opScreenName: string,
  limit: number,
): Promise<ThreadComment[]> {
  try {
    const chromResults = await fetchViaChromeCookies(tweetId, opScreenName, limit);
    if (chromResults.length > 0) return chromResults;
  } catch { /* fall through */ }
  return fetchViaCamoufox(tweetId, opScreenName, limit);
}
