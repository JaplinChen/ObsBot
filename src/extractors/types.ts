/** Supported platform identifiers ??add new platforms here */
export type Platform =
  | 'x' | 'threads' | 'youtube' | 'github' | 'reddit' | 'web'
  | 'weibo' | 'xiaohongshu' | 'bilibili' | 'douyin' | 'tiktok';

/** A single comment or reply on a post */
export interface ThreadComment {
  author: string;
  authorHandle: string;
  text: string;
  date: string;
  likes?: number;
  replies?: ThreadComment[];
}

/** Unified content extracted from any platform */
export interface VideoInfo {
  url: string;
  thumbnailUrl?: string;
  /** Local file path for downloaded video (e.g. TikTok mp4) ??copied to vault by saver */
  localPath?: string;
  type?: 'video' | 'gif';
}

/** Unified content extracted from any platform */
export interface ExtractedContent {
  platform: Platform;
  author: string;
  authorHandle: string;
  /** Short descriptive title (article title or first line of text) */
  title: string;
  text: string;
  images: string[];
  videos: VideoInfo[];
  date: string;
  url: string;
  likes?: number;
  reposts?: number;
  /** AI-assigned category for Obsidian sub-folder organization */
  category?: string;
  /** AI-enriched keywords (overrides classifier-matched keywords in formatter) */
  enrichedKeywords?: string[];
  /** AI-enriched summary (overrides text truncation in formatter) */
  enrichedSummary?: string;
  /** AI-enriched deeper analysis text */
  enrichedAnalysis?: string;
  /** AI-enriched key takeaway bullets */
  enrichedKeyPoints?: string[];
  /** Extra tags from platform metadata (e.g. GitHub topics) */
  extraTags?: string[];
  /** Star/engagement count (e.g. GitHub stargazers) */
  stars?: number;
  /** Long-form body content separate from short text (e.g. GitHub README) */
  body?: string;
  /** Comments/replies fetched from the post */
  comments?: ThreadComment[];
  /** Total comment count reported by the platform (may exceed fetched) */
  commentCount?: number;
  /** URLs found in post/comments with fetched metadata (post-processing) */
  linkedContent?: LinkedContentMeta[];
  /** Translation to Traditional Chinese when source is non-zh-TW (post-processing) */
  translation?: TranslationResult;
  /** Video transcript (subtitles / STT) ??used for AI summary, not rendered in note */
  transcript?: string;
  /** Temp directory to clean up after saving (used by TikTok extractor for local screenshots) */
  tempDir?: string;
}

/** Lightweight metadata fetched from a URL found in content or comments */
export interface LinkedContentMeta {
  url: string;
  source: 'post' | 'comment';
  mentionedBy?: string;
  title: string;
  description?: string;
  platform?: string;
  stars?: number;
  language?: string;
}

/** Translation result for non-Traditional-Chinese content */
export interface TranslationResult {
  detectedLanguage: 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'other';
  translatedText: string;
  translatedTitle?: string;
}

/** Each platform extractor must implement this interface */
export interface Extractor {
  platform: Platform;
  /** Test whether a URL belongs to this platform */
  match(url: string): boolean;
  /** Extract post ID from URL */
  parseId(url: string): string | null;
  /** Fetch and extract content from the URL */
  extract(url: string): Promise<ExtractedContent>;
}

/** Optional extension for extractors that support comment fetching */
export interface ExtractorWithComments extends Extractor {
  extractComments(url: string, limit?: number): Promise<ThreadComment[]>;
}


