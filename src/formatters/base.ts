import type { ExtractedContent } from '../extractors/types.js';
import type { PlatformFormatter } from './types.js';
import {
  buildFrontmatter,
  buildLinkedContent,
  buildStats,
  buildComments,
} from './shared.js';

/** Assemble a complete Obsidian Markdown note using shared + platform sections */
export function assembleNote(
  content: ExtractedContent,
  localImagePaths: string[],
  localVideoPaths: string[],
  imageUrlMap: Map<string, string> | undefined,
  formatter: PlatformFormatter,
): string {
  // Resolve translated text
  const t = content.translation;
  const displayTitle = t?.translatedTitle ?? content.title;
  const displayText = t ? t.translatedText : content.text;

  // 1. Frontmatter
  const lines: string[] = [
    ...buildFrontmatter(content, displayTitle, displayText),
    '',
    `> **${content.authorHandle}** | ${content.date}`,
    '',
  ];

  // 2. Language annotation (when translated)
  if (t) {
    const langLabel: Record<string, string> = {
      en: 'English', 'zh-CN': '簡體中文', ja: '日文', ko: '韓文', other: '其他',
    };
    lines.push(`> 原文語言：${langLabel[t.detectedLanguage] ?? '其他'}`, '');
  }

  // 3. Main body (platform-specific — may inline videos via {{VIDEO:i}} markers)
  const { text: bodyText, usedPaths } = formatter.formatBody(displayText, imageUrlMap, localVideoPaths);
  lines.push(bodyText, '');

  // 4. AI summary
  if (content.enrichedSummary) {
    const summaryText = content.enrichedSummary.slice(0, 300);
    lines.push('## 重點摘要', '', summaryText.replace(/\n/g, ' ').trim(), '');
  }

  // 5. Extra sections (platform-specific: README, transcript, etc.)
  lines.push(...formatter.extraSections(content));

  // 6. Linked content
  lines.push(...buildLinkedContent(content.linkedContent));

  // 7. Images (platform-specific filtering)
  const remainingImages = formatter.filterRemainingImages(localImagePaths, usedPaths);
  if (remainingImages.length > 0) {
    lines.push('## Images', '');
    for (const imgPath of remainingImages) {
      lines.push(`![](${imgPath})`, '');
    }
  }

  // 8. Videos (platform-specific — filter out already-inlined videos)
  const inlinedVideoIndices = new Set<number>();
  for (let i = 0; i < localVideoPaths.length; i++) {
    if (usedPaths.has(localVideoPaths[i])) inlinedVideoIndices.add(i);
  }
  const remainingVideos = content.videos.filter((_, i) => !inlinedVideoIndices.has(i));
  const remainingVideoPaths = localVideoPaths.filter((_, i) => !inlinedVideoIndices.has(i));
  const videoLines = formatter.formatVideos(remainingVideos, remainingVideoPaths);
  if (videoLines.length > 0) {
    lines.push('## Videos', '', ...videoLines);
  }

  // 9. Stats + Comments (shared)
  lines.push(...buildStats(content.reposts));
  lines.push(...buildComments(content.comments, content.commentCount));

  // 10. Footer
  const category = content.category ?? '其他';
  const categoryLink = category.replace(/\//g, '-');
  lines.push(`分類：[[${categoryLink}]]`, '');
  lines.push(`[View original](${content.url})`, '');

  return lines.join('\n');
}
