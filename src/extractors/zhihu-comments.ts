/**
 * Zhihu comment fetching utilities.
 * Extracted from zhihu-extractor.ts to keep each file ≤ 300 lines.
 */
import type { ThreadComment } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};

interface ZhihuCommentItem {
  id: number;
  content: string;
  author: { name: string; url_token?: string };
  created_time: number;
  like_count: number;
  child_comments?: ZhihuCommentItem[];
}

interface ZhihuCommentPage {
  data: ZhihuCommentItem[];
  paging?: { is_end: boolean };
}

function mapComment(item: ZhihuCommentItem): ThreadComment {
  const replies = (item.child_comments ?? []).slice(0, 5).map(r => ({
    author: r.author.name,
    authorHandle: r.author.url_token ?? r.author.name,
    text: r.content.replace(/<[^>]+>/g, '').trim(),
    date: new Date(r.created_time * 1000).toISOString().split('T')[0],
    likes: r.like_count,
  }));
  return {
    author: item.author.name,
    authorHandle: item.author.url_token ?? item.author.name,
    text: item.content.replace(/<[^>]+>/g, '').trim(),
    date: new Date(item.created_time * 1000).toISOString().split('T')[0],
    likes: item.like_count,
    replies: replies.length > 0 ? replies : undefined,
  };
}

export async function fetchZhihuComments(apiUrl: string, limit: number): Promise<ThreadComment[]> {
  const comments: ThreadComment[] = [];
  try {
    const res = await fetchWithTimeout(
      `${apiUrl}?limit=20&order=score`,
      15_000, { headers: HEADERS },
    );
    if (!res.ok) return [];
    const data = await res.json() as ZhihuCommentPage;
    for (const item of data.data ?? []) {
      if (comments.length >= limit) break;
      comments.push(mapComment(item));
    }
  } catch {
    // API unavailable (auth required) — return empty
  }
  return comments;
}
