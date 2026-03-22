/** Supported platform identifiers ??add new platforms here */
export type Platform =
  | 'x' | 'threads' | 'youtube' | 'github' | 'reddit' | 'web'
  | 'weibo' | 'xhs' | 'bilibili' | 'douyin' | 'tiktok' | 'ithome';

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
  /** Primary programming language (e.g. GitHub repos) */
  language?: string;
  /** AI-generated deep analysis for GitHub projects (use cases, comparison, pros/cons) */
  githubAnalysis?: string;
  /** Comments/replies fetched from the post */
  comments?: ThreadComment[];
  /** Total comment count reported by the platform (may exceed fetched) */
  commentCount?: number;
  /** URLs found in post/comments with fetched metadata (post-processing) */
  linkedContent?: LinkedContentMeta[];
  /** Translation to Traditional Chinese when source is non-zh-TW (post-processing) */
  translation?: TranslationResult;
  /** AI-generated descriptions of images from vision model */
  imageDescriptions?: string;
  /** Video transcript (subtitles / STT) ??used for AI summary, not rendered in note */
  transcript?: string;
  /** Sub-folder under category for grouping series articles (e.g. "Obsidian雙向連結系列教學") */
  subFolder?: string;
  /** Temp directory to clean up after saving (used by TikTok extractor for local screenshots) */
  tempDir?: string;
  /** Pipeline 處理日誌——記錄擷取管線各階段的執行資訊 */
  processingLog?: ProcessingLog;
}

/** Pipeline 處理日誌 */
export interface ProcessingLog {
  extractorUsed: string;
  wasFallback?: boolean;
  classifierConfidence?: number;
  processingTimeMs?: number;
  enrichmentScore?: number;
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

/** Metadata for a single article in a series (used by ITHome 鐵人賽 etc.) */
export interface SeriesArticle {
  title: string;
  url: string;
  day?: number;
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

/** Extension for extractors that handle series/collection pages */
export interface ExtractorWithSeries extends Extractor {
  /** Check if this URL is a series index (not a single article) */
  isSeries(url: string): boolean;
  /** Extract the list of article URLs from a series index page */
  extractSeriesArticles(url: string): Promise<{ seriesTitle: string; author: string; articles: SeriesArticle[] }>;
}


