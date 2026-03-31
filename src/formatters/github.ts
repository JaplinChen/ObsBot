import type { VideoInfo, ExtractedContent } from '../extractors/types.js';
import type { PlatformFormatter, FormatBodyResult } from './types.js';
import { linkifyUrls } from './shared.js';

/** Strip GitHub badge/shield images and broken badge remnants from README */
function stripBadges(text: string): string {
  return text
    // Badge images: [![alt](badge-url)](link-url) on their own line
    .replace(/^\[?!?\[(?:[^\]]*)\]\(https?:\/\/(?:camo\.githubusercontent\.com|img\.shields\.io|.*?shields\.io\/badge)[^)]*\)\]?(?:\([^)]*\))?\s*$/gm, '')
    // Broken badge remnants: lines that are just "[!" or "["
    .replace(/^\[!?\s*$/gm, '')
    // Lines containing only camo.githubusercontent.com image links
    .replace(/^!\[.*?\]\(https?:\/\/camo\.githubusercontent\.com\/[^)]+\)\s*$/gm, '')
    // Animated GIF decorators from user-images.githubusercontent.com
    .replace(/^!\[.*?\]\(https?:\/\/user-images\.githubusercontent\.com\/[^)]+\.gif\)\s*$/gm, '')
    // Orphaned link-only lines wrapping badge images
    .replace(/^\[?\[?\]\(https?:\/\/[^)]+\)\s*$/gm, '')
    // Empty HTML tags like <tbody>
    .replace(/<tbody>(?:<tbody>)?<\/tbody>/g, '')
    // Compress resulting blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** GitHub formatter — README body section + project overview */
export const githubFormatter: PlatformFormatter = {
  formatBody(text: string): FormatBodyResult {
    // text = og:description + "\n\n" + README; README is already shown in extraSections
    // Only keep the description part (before the first markdown h1 or hr)
    const readmeStart = text.search(/\n\n#\s|\n\n---\n/);
    const desc = readmeStart > 0 ? text.slice(0, readmeStart).trim() : text;
    return { text: linkifyUrls(desc), usedPaths: new Set() };
  },

  formatVideos(videos: VideoInfo[], localVideoPaths: string[]): string[] {
    const lines: string[] = [];
    for (const vp of localVideoPaths) {
      lines.push(`![](${vp})`, '');
    }
    for (let i = 0; i < videos.length; i++) {
      if (i < localVideoPaths.length) continue;
      const v = videos[i];
      const label = v.type === 'gif' ? 'GIF' : `Video ${i + 1}`;
      lines.push(`- [${label}](${v.url})`, '');
    }
    return lines;
  },

  extraSections(content: ExtractedContent): string[] {
    const sections: string[] = [];

    // GitHub deep analysis section (from AI enricher)
    if (content.githubAnalysis) {
      sections.push('## 項目概覽', '', content.githubAnalysis, '');
    }

    // Structured metadata summary
    const meta: string[] = [];
    if (content.stars != null) meta.push(`**Stars:** ${content.stars.toLocaleString()}`);
    if (content.language) meta.push(`**Language:** ${content.language}`);
    if (content.extraTags?.length) {
      meta.push(`**Topics:** ${content.extraTags.map(t => `\`${t}\``).join(' ')}`);
    }
    if (meta.length > 0) {
      sections.push('## 項目資訊', '', meta.join(' | '), '');
    }

    // README section (strip badges and shields)
    if (content.body) {
      sections.push('## README', '', stripBadges(content.body), '');
    }

    return sections;
  },

  filterRemainingImages(localImagePaths: string[]): string[] {
    return localImagePaths;
  },
};
