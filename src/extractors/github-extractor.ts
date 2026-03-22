import type { ExtractedContent, Extractor } from './types.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { htmlFragmentToMarkdown } from '../utils/html-to-markdown.js';

const GITHUB_PATTERN = /github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:issues|pull)\/(\d+))?/i;

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractMeta(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeHtml(m[1]).trim();
  }
  return '';
}

function extractReadmeMarkdown(html: string, baseUrl?: string): string {
  const m = html.match(/<article[^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (!m?.[1]) return '';
  return htmlFragmentToMarkdown(m[1], baseUrl);
}

function extractDefaultBranch(html: string): string {
  const m = html.match(/"defaultBranch":"([^"]+)"/);
  return m?.[1] || 'main';
}

/** Extract stargazer count from GitHub page HTML */
function extractStars(html: string): number | undefined {
  // Try JSON-LD or embedded data first
  const jsonMatch = html.match(/"stargazerCount"\s*:\s*(\d+)/);
  if (jsonMatch) return parseInt(jsonMatch[1], 10);
  // Try aria-label on star button
  const ariaMatch = html.match(/aria-label="(\d[\d,]*)\s*star/i);
  if (ariaMatch) return parseInt(ariaMatch[1].replace(/,/g, ''), 10);
  return undefined;
}

/** Extract primary programming language */
function extractLanguage(html: string): string | undefined {
  const m = html.match(/itemprop="programmingLanguage"[^>]*>([^<]+)</i)
    ?? html.match(/<span[^>]*class="[^"]*color-fg-default[^"]*"[^>]*>([A-Za-z+#]+)<\/span>/);
  return m?.[1]?.trim() || undefined;
}

/** Extract repository topics */
function extractTopics(html: string): string[] {
  const topics: string[] = [];
  const re = /class="topic-tag[^"]*"[^>]*>([^<]+)</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const topic = m[1].trim();
    if (topic && !topics.includes(topic)) topics.push(topic);
  }
  return topics.slice(0, 10);
}

/** Scan README for a 繁體中文 link and return the filename (e.g. README_TW.md) */
function findTraditionalChineseReadme(readme: string): string | null {
  const m = readme.match(/\[繁體中文\]\(([^)]+)\)/);
  if (!m?.[1]) return null;
  const filename = m[1].split('/').pop();
  return filename?.endsWith('.md') ? filename : null;
}

async function fetchChineseReadme(
  owner: string, repo: string, branch: string, filename: string,
): Promise<string | null> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`;
    const res = await fetchWithTimeout(rawUrl, 10_000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (GetThreads Bot)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export const githubExtractor: Extractor = {
  platform: 'github',

  match(url: string): boolean {
    return GITHUB_PATTERN.test(url);
  },

  parseId(url: string): string | null {
    const m = url.match(GITHUB_PATTERN);
    if (!m) return null;
    return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  },

  async extract(url: string): Promise<ExtractedContent> {
    const m = url.match(GITHUB_PATTERN);
    if (!m) throw new Error(`Invalid GitHub URL: ${url}`);

    const [, owner, repo, number] = m;
    const res = await fetchWithTimeout(url, 30_000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (GetThreads Bot)' },
    });
    if (!res.ok) {
      throw new Error(`GitHub page error: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const isIssue = url.includes('/issues/');
    const isPR = url.includes('/pull/');

    const ogTitle = extractMeta(html, 'og:title');
    const ogDescription = extractMeta(html, 'og:description');
    const ogImage = extractMeta(html, 'og:image');

    let title = ogTitle || `${owner}/${repo}`;
    let text = ogDescription || '[No description]';
    let body: string | undefined;

    if ((isIssue || isPR) && number) {
      const kind = isPR ? 'PR' : 'Issue';
      title = `[${kind} #${number}] ${title}`;
    } else {
      let readme = extractReadmeMarkdown(html, url);
      if (readme) {
        const twFile = findTraditionalChineseReadme(readme);
        if (twFile) {
          const branch = extractDefaultBranch(html);
          const twReadme = await fetchChineseReadme(owner, repo, branch, twFile);
          if (twReadme) readme = twReadme;
        }
        text = `${text}\n\n${readme}`;
        body = readme;
      }
    }

    const stars = extractStars(html);
    const language = extractLanguage(html);
    const topics = extractTopics(html);

    return {
      platform: 'github',
      author: owner,
      authorHandle: `@${owner}`,
      title: title.slice(0, 120),
      text,
      body,
      images: ogImage ? [ogImage] : [],
      videos: [],
      date: new Date().toISOString().split('T')[0],
      url,
      stars,
      language,
      extraTags: topics.length > 0 ? topics : undefined,
    };
  },
};
