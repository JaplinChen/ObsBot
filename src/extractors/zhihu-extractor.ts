/**
 * Zhihu Extractor
 *
 * Handles two URL patterns:
 *   - Question: zhihu.com/question/{id} — extracts question + top answer
 *   - Article:  zhuanlan.zhihu.com/p/{id} — extracts article content
 */

import { parseHTML } from 'linkedom';
import type { ExtractedContent, Extractor, ExtractorWithComments, ThreadComment } from './types.js';
import { fetchWithTimeout, retry } from '../utils/fetch-with-timeout.js';
import { htmlFragmentToMarkdown } from '../utils/html-to-markdown.js';
import { logger } from '../core/logger.js';

const QUESTION_RE = /zhihu\.com\/question\/(\d+)/;
const ARTICLE_RE = /zhuanlan\.zhihu\.com\/p\/(\d+)/;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};

/** Zhuanlan article API response shape */
interface ZhuanlanArticle {
  id: number;
  title: string;
  content: string;
  author: { name: string; urlToken: string };
  created: number;
  updated: number;
  voteupCount: number;
  commentCount: number;
  imageUrl?: string;
  excerpt?: string;
}

/** Extract article via zhuanlan API (public, no login required) */
async function extractArticle(articleId: string, url: string): Promise<ExtractedContent> {
  const apiUrl = `https://zhuanlan.zhihu.com/api/articles/${articleId}`;
  const res = await retry(async () => {
    const r = await fetchWithTimeout(apiUrl, 15_000, { headers: HEADERS });
    if (!r.ok) throw new Error(`Zhihu article API HTTP ${r.status}`);
    return r;
  }, 3, 1000);

  const data = await res.json() as ZhuanlanArticle;

  const text = data.content
    ? htmlFragmentToMarkdown(data.content)
    : data.excerpt || '[No content]';

  return {
    platform: 'zhihu',
    author: data.author.name,
    authorHandle: data.author.urlToken || data.author.name,
    title: data.title,
    text: text.slice(0, 8000),
    images: data.imageUrl ? [data.imageUrl] : [],
    videos: [],
    date: new Date(data.created * 1000).toISOString().split('T')[0],
    url,
    likes: data.voteupCount,
    commentCount: data.commentCount,
  };
}

/** Extract question via HTML scraping (API requires auth) */
async function extractQuestion(questionId: string, url: string): Promise<ExtractedContent> {
  const pageUrl = `https://www.zhihu.com/question/${questionId}`;
  const res = await retry(async () => {
    const r = await fetchWithTimeout(pageUrl, 15_000, { headers: HEADERS });
    if (!r.ok) throw new Error(`Zhihu question fetch HTTP ${r.status}`);
    return r;
  }, 3, 1000);

  const html = await res.text();
  const { document: doc } = parseHTML(html);

  // Try extracting from initialData JSON embedded in page
  const initialData = extractInitialData(html);

  const title =
    initialData?.question?.title
    || doc.querySelector('h1.QuestionHeader-title')?.textContent?.trim()
    || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
    || doc.querySelector('title')?.textContent?.trim()?.replace(/ - 知乎$/, '')
    || 'Untitled';

  const questionDetail =
    initialData?.question?.detail
    || doc.querySelector('.QuestionRichText')?.innerHTML
    || '';

  // Extract top answer
  const topAnswer = initialData?.topAnswer;
  let answerText = '';
  let answerAuthor = '';
  let answerVotes = 0;

  if (topAnswer) {
    answerText = topAnswer.content
      ? htmlFragmentToMarkdown(topAnswer.content)
      : topAnswer.excerpt || '';
    answerAuthor = topAnswer.author?.name || '';
    answerVotes = topAnswer.voteupCount || 0;
  } else {
    // Fallback: scrape from HTML
    const answerEl = doc.querySelector('.RichContent-inner, .AnswerItem .RichText');
    if (answerEl) {
      answerText = htmlFragmentToMarkdown(answerEl.innerHTML || '');
    }
    const authorEl = doc.querySelector('.AnswerItem .AuthorInfo meta[itemprop="name"]');
    answerAuthor = authorEl?.getAttribute('content') || '';
  }

  const questionMd = questionDetail ? htmlFragmentToMarkdown(questionDetail) : '';
  const sections: string[] = [];
  if (questionMd.trim()) sections.push(`## 問題描述\n\n${questionMd}`);
  if (answerText.trim()) {
    const header = answerAuthor
      ? `## 最佳回答 by ${answerAuthor}${answerVotes ? ` (${answerVotes.toLocaleString()} 贊同)` : ''}`
      : '## 最佳回答';
    sections.push(`${header}\n\n${answerText}`);
  }

  const text = sections.join('\n\n---\n\n') || '[No readable content]';

  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const answerCount = initialData?.question?.answerCount;
  const followerCount = initialData?.question?.followerCount;

  const author = answerAuthor || '知乎';

  return {
    platform: 'zhihu',
    author,
    authorHandle: author,
    title,
    text: text.slice(0, 8000),
    images: ogImage ? [ogImage] : [],
    videos: [],
    date: new Date().toISOString().split('T')[0],
    url,
    likes: answerVotes,
    commentCount: answerCount ?? undefined,
    extraTags: followerCount ? [`${followerCount.toLocaleString()} followers`] : undefined,
  };
}

interface InitialData {
  question?: {
    title?: string;
    detail?: string;
    answerCount?: number;
    followerCount?: number;
  };
  topAnswer?: {
    content?: string;
    excerpt?: string;
    author?: { name: string };
    voteupCount?: number;
  };
}

/** Try to extract initialData JSON from Zhihu page scripts */
function extractInitialData(html: string): InitialData | null {
  try {
    // Zhihu embeds data in a <script id="js-initialData"> tag
    const match = html.match(/<script\s+id="js-initialData"[^>]*>([\s\S]*?)<\/script>/);
    if (!match?.[1]) return null;

    const raw = JSON.parse(match[1]);
    const entities = raw?.initialState?.entities;
    if (!entities) return null;

    // Extract question
    const questions = entities.questions;
    const questionId = Object.keys(questions || {})[0];
    const q = questionId ? questions[questionId] : null;

    // Extract top answer
    const answers = entities.answers;
    const answerId = Object.keys(answers || {})[0];
    const a = answerId ? answers[answerId] : null;

    return {
      question: q ? {
        title: q.title,
        detail: q.detail,
        answerCount: q.answerCount,
        followerCount: q.followerCount,
      } : undefined,
      topAnswer: a ? {
        content: a.content,
        excerpt: a.excerpt,
        author: a.author ? { name: a.author.name } : undefined,
        voteupCount: a.voteupCount,
      } : undefined,
    };
  } catch (err) {
    logger.warn('zhihu', 'failed to parse initialData', {
      message: (err as Error).message,
    });
    return null;
  }
}

/** Zhihu comment API response shape */
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

async function fetchZhihuComments(apiUrl: string, limit: number): Promise<ThreadComment[]> {
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

export const zhihuExtractor: ExtractorWithComments = {
  platform: 'zhihu',

  match(url: string): boolean {
    return QUESTION_RE.test(url) || ARTICLE_RE.test(url);
  },

  parseId(url: string): string | null {
    return url.match(QUESTION_RE)?.[1] ?? url.match(ARTICLE_RE)?.[1] ?? null;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const articleId = url.match(ARTICLE_RE)?.[1];
    if (articleId) {
      logger.info('zhihu', `extracting article ${articleId}`);
      return extractArticle(articleId, url);
    }

    const questionId = url.match(QUESTION_RE)?.[1];
    if (questionId) {
      logger.info('zhihu', `extracting question ${questionId}`);
      return extractQuestion(questionId, url);
    }

    throw new Error(`Unsupported Zhihu URL: ${url}`);
  },

  async extractComments(url: string, limit = 20): Promise<ThreadComment[]> {
    const articleId = url.match(ARTICLE_RE)?.[1];
    if (articleId) {
      return fetchZhihuComments(
        `https://www.zhihu.com/api/v4/articles/${articleId}/comments`,
        limit,
      );
    }
    // For questions, we'd need the answer ID which requires a prior extract() call.
    // Return empty — question comments are deprioritised vs article comments.
    return [];
  },
};
