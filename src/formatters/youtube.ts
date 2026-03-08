import type { VideoInfo } from '../extractors/types.js';
import type { PlatformFormatter, FormatBodyResult } from './types.js';
import { linkifyUrls, replaceInlineImages } from './shared.js';

/** YouTube formatter — inline thumbnails + inline video embeds for playlists */
export const youtubeFormatter: PlatformFormatter = {
  formatBody(text: string, imageUrlMap?: Map<string, string>, localVideoPaths?: string[]): FormatBodyResult {
    const { text: replaced, usedPaths } = replaceInlineImages(text, imageUrlMap);
    let result = linkifyUrls(replaced);

    // Replace {{VIDEO:i}} markers with local video embeds
    if (localVideoPaths) {
      result = result.replace(/\{\{VIDEO:(\d+)\}\}/g, (_, idx) => {
        const path = localVideoPaths[parseInt(idx)];
        if (path) {
          usedPaths.add(path);
          return `![](${path})`;
        }
        return '';
      });
    }

    return { text: result, usedPaths };
  },

  formatVideos(videos: VideoInfo[], localVideoPaths: string[]): string[] {
    const lines: string[] = [];
    for (const vp of localVideoPaths) {
      lines.push(`![](${vp})`, '');
    }
    for (let i = 0; i < videos.length; i++) {
      if (i < localVideoPaths.length) continue;
      const v = videos[i];
      const label = v.type === 'gif' ? 'GIF' : '▶ 在 YouTube 觀看';
      lines.push(`- [${label}](${v.url})`, '');
    }
    return lines;
  },

  extraSections(): string[] {
    return [];
  },

  filterRemainingImages(localImagePaths: string[], usedPaths: Set<string>): string[] {
    return localImagePaths.filter(p => !usedPaths.has(p));
  },
};
