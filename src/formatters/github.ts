import type { VideoInfo, ExtractedContent } from '../extractors/types.js';
import type { PlatformFormatter, FormatBodyResult } from './types.js';
import { linkifyUrls } from './shared.js';

/** GitHub formatter — README body section + project overview */
export const githubFormatter: PlatformFormatter = {
  formatBody(text: string): FormatBodyResult {
    return { text: linkifyUrls(text), usedPaths: new Set() };
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

    // README section
    if (content.body) {
      sections.push('## README', '', content.body, '');
    }

    return sections;
  },

  filterRemainingImages(localImagePaths: string[]): string[] {
    return localImagePaths;
  },
};
