import type { ExtractedContent, LinkedContentMeta, ThreadComment } from '../extractors/types.js';
import { extractKeywords } from '../classifier.js';

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X (Twitter)',
  threads: 'Threads',
  youtube: 'YouTube',
  github: 'GitHub',
  reddit: 'Reddit',
  weibo: '微博',
  bilibili: 'Bilibili',
  xiaohongshu: '小紅書',
  douyin: '抖音',
  tiktok: 'TikTok',
  web: 'Web',
};

/** Escape double quotes for frontmatter values */
export function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** Strip Markdown syntax for plain-text fields (summary, keywords) */
export function stripMarkdown(s: string): string {
  return s
    .replace(/!\[.*?\]\(.*?\)/g, '')        // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')  // links → text only
    .replace(/#{1,6}\s+/g, '')               // headings
    .replace(/[*_`>]/g, '')                  // bold/italic/code/quote
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert bare URLs to Markdown links, skip already-linked ones */
export function linkifyUrls(text: string): string {
  return text.replace(
    /(?<!\]\()(?<![<])(https?:\/\/[^\s\)\]\>,'"]+)/g,
    '[$1]($1)',
  );
}

/** Replace remote image URLs in text with local vault paths */
export function replaceInlineImages(
  text: string,
  imageUrlMap?: Map<string, string>,
): { text: string; usedPaths: Set<string> } {
  const usedPaths = new Set<string>();
  if (!imageUrlMap || imageUrlMap.size === 0) return { text, usedPaths };

  let result = text;
  for (const [url, localPath] of imageUrlMap) {
    if (result.includes(url)) {
      result = result.replaceAll(url, localPath);
      usedPaths.add(localPath);
    }
  }
  return { text: result, usedPaths };
}

/** Format a linked content entry as a Markdown bullet */
export function formatLinkedMeta(link: LinkedContentMeta): string {
  const parts: string[] = [];
  if (link.stars != null) parts.push(`⭐ ${link.stars}`);
  if (link.language) parts.push(link.language);
  const suffix = parts.length > 0 ? ` | ${parts.join(' | ')}` : '';
  const desc = link.description ? ` — ${link.description}` : '';
  return `- **[${link.title}](${link.url})**${desc}${suffix}`;
}

/** Build frontmatter lines */
export function buildFrontmatter(
  content: ExtractedContent,
  displayTitle: string,
  displayText: string,
): string[] {
  const platformLabel = PLATFORM_LABELS[content.platform] ?? content.platform;
  const category = content.category ?? '其他';
  const categoryTag = category.replace(/\s+/g, '-');
  const allTags = [content.platform, 'archive', categoryTag, ...(content.extraTags ?? [])];

  const lines: string[] = [
    '---',
    `title: "${escape(displayTitle)}"`,
    `source: ${platformLabel}`,
    `author: "${escape(content.authorHandle)}"`,
    `date: ${content.date}`,
    `url: "${content.url}"`,
    `tags: [${allTags.join(', ')}]`,
    `category: ${category}`,
    `keywords: [${(content.enrichedKeywords ?? extractKeywords(displayTitle, displayText)).join(', ')}]`,
    `summary: "${escape(stripMarkdown(content.enrichedSummary ?? displayText).replace(/\{\{VIDEO:\d+\}\}/g, '').slice(0, 150)).replace(/\n/g, ' ')}"`,
  ];
  if (content.stars != null) lines.push(`stars: ${content.stars}`);
  lines.push('---');
  return lines;
}

/** Build linked content section lines */
export function buildLinkedContent(linkedContent?: LinkedContentMeta[]): string[] {
  if (!linkedContent || linkedContent.length === 0) return [];
  const lines: string[] = ['## 相關連結', ''];
  const postLinks = linkedContent.filter(l => l.source === 'post');
  const commentLinks = linkedContent.filter(l => l.source === 'comment');
  if (postLinks.length > 0) {
    for (const link of postLinks) lines.push(formatLinkedMeta(link), '');
  }
  if (commentLinks.length > 0) {
    if (postLinks.length > 0) lines.push('### 評論提及', '');
    for (const link of commentLinks) {
      const mention = link.mentionedBy ? `  _提及者: ${link.mentionedBy}_` : '';
      lines.push(formatLinkedMeta(link) + mention, '');
    }
  }
  return lines;
}

/** Build engagement stats line */
export function buildStats(reposts?: number): string[] {
  const stats: string[] = [];
  if (reposts != null) stats.push(`Reposts: ${reposts}`);
  if (stats.length === 0) return [];
  return ['---', '', stats.join(' | '), ''];
}

/** Build comments section lines */
export function buildComments(comments?: ThreadComment[], commentCount?: number): string[] {
  if (!comments || comments.length === 0) return [];
  const lines: string[] = ['## 評論', ''];
  for (const c of comments.slice(0, 20)) {
    const likes = c.likes ? ` ❤️${c.likes}` : '';
    lines.push(`**${c.author}** \`${c.authorHandle}\`${likes}`);
    lines.push(c.text);
    if (c.replies?.length) {
      for (const r of c.replies.slice(0, 3)) {
        lines.push(`> **${r.author}**: ${r.text.slice(0, 200)}`);
      }
    }
    lines.push('');
  }
  if (commentCount && commentCount > comments.length) {
    lines.push(`_共 ${commentCount} 則，顯示前 ${comments.length} 則_`, '');
  }
  return lines;
}
