import type { ChapterInfo, ExtractedContent, LinkedContentMeta, ThreadComment } from '../extractors/types.js';
import { extractKeywords } from '../classifier.js';
import { PIPELINE_VERSION } from '../pipeline/version-config.js';

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X (Twitter)',
  threads: 'Threads',
  youtube: 'YouTube',
  github: 'GitHub',
  reddit: 'Reddit',
  weibo: '微博',
  bilibili: 'Bilibili',
  xhs: '小紅書',
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
  // Protect existing markdown links and angle-bracket links with placeholders
  const placeholders: string[] = [];
  let protected_ = text.replace(/\[([^\]]*)\]\([^)]+\)/g, (match) => {
    placeholders.push(match);
    return `\x00LINK${placeholders.length - 1}\x00`;
  });
  protected_ = protected_.replace(/<(https?:\/\/[^>]+)>/g, (match) => {
    placeholders.push(match);
    return `\x00LINK${placeholders.length - 1}\x00`;
  });

  // Linkify remaining bare URLs
  protected_ = protected_.replace(
    /(https?:\/\/[^\s)\]>,'"]+)/g,
    '[$1]($1)',
  );

  // Restore placeholders
  return protected_.replace(/\x00LINK(\d+)\x00/g, (_, i) => placeholders[Number(i)]);
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

/** Format a linked content entry as a Markdown bullet, with optional content preview */
export function formatLinkedMeta(link: LinkedContentMeta): string {
  const parts: string[] = [];
  if (link.stars != null) parts.push(`⭐ ${link.stars}`);
  if (link.language) parts.push(link.language);
  const suffix = parts.length > 0 ? ` | ${parts.join(' | ')}` : '';
  const desc = link.description ? ` — ${link.description}` : '';
  const header = `- **[${link.title}](${link.url})**${desc}${suffix}`;

  const lines: string[] = [header];

  // Show content preview when deep-fetched fullText is available
  if (link.fullText && link.fullText.length > 100) {
    const preview = link.fullText
      .replace(/^#.*\n/gm, '')      // strip headings
      .replace(/\n{2,}/g, '\n')     // collapse blank lines
      .trim()
      .slice(0, 300);
    const truncated = preview.length >= 300 ? preview + '…' : preview;
    const indented = truncated.split('\n').map(l => `  > ${l}`).join('\n');
    lines.push(indented);
  }

  // Link to existing Vault note if this URL was already saved
  if (link.vaultNote) {
    lines.push(`  → [[${link.vaultNote}]]`);
  }

  return lines.join('\n');
}

/** Build frontmatter lines */
export function buildFrontmatter(
  content: ExtractedContent,
  displayTitle: string,
  displayText: string,
): string[] {
  const platformLabel = PLATFORM_LABELS[content.platform] ?? content.platform;
  const category = content.category ?? '其他';
  // suggestedTags：enricher 的語意分類結果，轉為 tag（不加 category 本身，避免 'inbox' 出現在 tags）
  const semanticTags = (content.suggestedTags ?? []).map(t => t.replace(/\s+/g, '-'));
  const allTags = [content.platform, 'archive', ...semanticTags, ...(content.extraTags ?? [])];

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
  if (content.language) lines.push(`language: ${content.language}`);
  lines.push(`pipeline_version: "${PIPELINE_VERSION}"`);
  lines.push('---');
  return lines;
}

/** URLs that are badges/shields, not real content links */
const BADGE_URL_RE = /camo\.githubusercontent\.com|img\.shields\.io|shields\.io\/badge|badge\.fury\.io|badgen\.net|forthebadge\.com/i;

/** Build linked content section lines */
export function buildLinkedContent(linkedContent?: LinkedContentMeta[]): string[] {
  const filtered = linkedContent?.filter(l => !BADGE_URL_RE.test(l.url));
  if (!filtered || filtered.length === 0) return [];
  const lines: string[] = ['## 相關連結', ''];
  const postLinks = filtered.filter(l => l.source === 'post');
  const commentLinks = filtered.filter(l => l.source === 'comment');
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

/** Detect promotional / ad content in comments */
function isAdComment(text: string): boolean {
  const t = text.toLowerCase();
  // Self-promotion / affiliate patterns
  if (/(追蹤|關注)(我|我們|頻道|帳號|主頁)/.test(t)) return true;
  if (/(商務合作|商業合作|合作邀約|業配|贊助|廣告)/.test(t)) return true;
  if (/(私訊|dm\s*me|加我|聯繫我|contact\s*me)/.test(t)) return true;
  if (/(點我|點擊|連結在|link in|bio|promo|折扣碼|discount\s*code)/.test(t)) return true;
  if (/(免費領取|限時優惠|立即搶購|下載app|掃碼)/.test(t)) return true;
  // Spam patterns
  if (/https?:\/\/\S{30,}/.test(text) && text.replace(/https?:\/\/\S+/g, '').trim().length < 20) return true;
  return false;
}

/** Check if a comment has substantive content beyond pure praise/thanks/ads */
function isSubstantiveComment(text: string): boolean {
  const t = text.trim();
  if (t.length < 5) return false;
  if (isAdComment(t)) return false;
  // Strip praise/thanks phrases and emoji, check if meaningful content remains
  const stripped = t
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/(好用|太棒|太強|太香|推推|給讚|讚讚|大推|推了|神器|超讚|超推|收藏|支持|辛苦了|加油|期待|厲害)/g, '')
    .replace(/(謝謝|感謝|感恩|謝囉|多謝)(分享|開發|推薦|你們?|大大|作者)?/g, '')
    .replace(/(幫助很大|受益良多|學到很多|受教了|獲益匪淺|太有用|真的有用)/g, '')
    .replace(/[！!？?。，、～~👍🙏❤️💪🥰😊😍🔥✅💯]+/g, '')
    .trim();
  return stripped.length >= 10;
}

/** Check if a comment has enough depth to be in "精選討論" */
function isFeaturedComment(c: ThreadComment): boolean {
  if (!isSubstantiveComment(c.text)) return false;
  // High engagement
  if ((c.likes ?? 0) >= 10) return true;
  // Technical depth signals: code blocks, specific technical discussion
  if (/```|`[^`]+`/.test(c.text)) return true;
  if (c.text.length >= 120 && /[a-zA-Z]{3,}/.test(c.text)) return true;
  if (/為什麼|原因|比較|差異|建議|問題|怎麼|如何|vs\.?|versus|因為|所以/.test(c.text) && c.text.length >= 60) return true;
  return false;
}

/** Build image descriptions section */
export function buildImageDescriptions(imageDescriptions?: string): string[] {
  if (!imageDescriptions?.trim()) return [];
  return ['## 插圖說明', '', imageDescriptions.trim(), ''];
}

/** Build comments section lines — sorted by likes, ad-filtered, with 精選討論 */
export function buildComments(comments?: ThreadComment[], commentCount?: number): string[] {
  if (!comments || comments.length === 0) return [];

  const substantive = comments
    .filter(c => isSubstantiveComment(c.text))
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));

  if (substantive.length === 0) return [];

  const featured = substantive.filter(isFeaturedComment);
  const regular = substantive.filter(c => !isFeaturedComment(c));
  const lines: string[] = [];

  function renderComment(c: ThreadComment): void {
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

  if (featured.length > 0) {
    lines.push('## 精選討論', '');
    for (const c of featured.slice(0, 8)) renderComment(c);
  }

  if (regular.length > 0) {
    lines.push('## 評論', '');
    for (const c of regular.slice(0, 15)) renderComment(c);
  }

  if (commentCount && commentCount > comments.length) {
    lines.push(`_共 ${commentCount} 則，顯示前 ${comments.length} 則_`, '');
  }
  return lines;
}

/** Build chapters section as Markdown table */
export function buildChapters(chapters?: ChapterInfo[]): string[] {
  if (!chapters || chapters.length === 0) return [];
  const lines: string[] = ['## 章節', ''];
  lines.push('| 時間 | 章節 | 摘要 |');
  lines.push('|------|------|------|');
  for (const ch of chapters) {
    const time = ch.startTime;
    const summary = ch.summary ?? '';
    lines.push(`| ${time} | ${ch.title} | ${summary} |`);
  }
  lines.push('');
  return lines;
}
