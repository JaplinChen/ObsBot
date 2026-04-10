/** Supported platform identifiers ??add new platforms here */
export type Platform =
  | 'x' | 'threads' | 'youtube' | 'github' | 'web'
  | 'weibo' | 'xhs' | 'bilibili' | 'douyin' | 'tiktok' | 'ithome'
  | 'zhihu';

/** A single comment or reply on a post */
export interface ThreadComment {
  author: string;
  authorHandle: string;
  text: string;
  date: string;
  likes?: number;
  replies?: ThreadComment[];
}

/** A transcript segment with timing information */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/** A chapter in a video (from platform or AI-generated) */
export interface ChapterInfo {
  startTime: string;   // "00:05:10"
  endTime?: string;    // "00:12:00"
  title: string;
  summary?: string;
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
  /** LLM-suggested semantic tags (from enricher classification, not used as category) */
  suggestedTags?: string[];
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
  /** Video transcript (subtitles / STT) — used for AI summary, not rendered in note */
  transcript?: string;
  /** Timed transcript segments for chapter generation (from whisper STT) */
  timedTranscript?: TranscriptSegment[];
  /** Video chapters (from platform metadata or AI-generated) */
  chapters?: ChapterInfo[];
  /** Sub-folder under category for grouping series articles (e.g. "Obsidian雙向連結系列教學") */
  subFolder?: string;
  /** Temp directory to clean up after saving (used by TikTok extractor for local screenshots) */
  tempDir?: string;
  /** Transcripts for YouTube videos embedded in web articles */
  embeddedVideoTranscripts?: Array<{ url: string; transcript: string }>;
}

/** Metadata fetched from a URL found in content or comments */
export interface LinkedContentMeta {
  url: string;
  source: 'post' | 'comment';
  mentionedBy?: string;
  title: string;
  description?: string;
  platform?: string;
  stars?: number;
  language?: string;
  /** Full text content from deep fetch (truncated to ~3000 chars) */
  fullText?: string;
  /** Obsidian note name (without .md) if this URL is already saved in Vault */
  vaultNote?: string;
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


