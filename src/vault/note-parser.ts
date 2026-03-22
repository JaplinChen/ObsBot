/**
 * Parse Obsidian vault notes back into ExtractedContent for re-enrichment.
 * Used by /reprocess to update AI-generated fields without re-extracting.
 */
import type { ExtractedContent, Platform } from '../extractors/types.js';
import { PLATFORM_LABELS } from '../formatters/shared.js';

/** Reverse map: "X (Twitter)" → "x", "Threads" → "threads", etc. */
const LABEL_TO_PLATFORM: Record<string, Platform> = {};
for (const [key, label] of Object.entries(PLATFORM_LABELS)) {
  LABEL_TO_PLATFORM[label.toLowerCase()] = key as Platform;
}

export interface ParsedNote {
  url: string;
  platform: Platform;
  author: string;
  authorHandle: string;
  title: string;
  text: string;
  date: string;
  category: string;
  images: string[];
  keywords: string[];
  summary: string;
  stars?: number;
  language?: string;
  body?: string;
  extraTags?: string[];
}

/** Extract a frontmatter field value (handles quoted and unquoted) */
function fm(raw: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*"?(.*?)"?\\s*$`, 'm');
  const match = raw.match(re);
  return match?.[1]?.replace(/\\"/g, '"') ?? '';
}

/** Extract frontmatter array field like keywords: [a, b, c] or tags: [x, y] */
function fmArray(raw: string, field: string): string[] {
  const re = new RegExp(`^${field}:\\s*\\[(.*)\\]`, 'm');
  const match = raw.match(re);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

/** Extract a numeric frontmatter field */
function fmNumber(raw: string, field: string): number | undefined {
  const re = new RegExp(`^${field}:\\s*(\\d+)`, 'm');
  const match = raw.match(re);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Extract README section body from note markdown */
function extractReadmeSection(body: string): string | undefined {
  const readmeMatch = body.match(/^## README\s*\n([\s\S]*?)(?=\n## |\n---\s*$|$)/m);
  return readmeMatch?.[1]?.trim() || undefined;
}

/** Parse a vault markdown note into structured fields */
export function parseVaultNote(rawMarkdown: string): ParsedNote | null {
  // Split frontmatter from body
  const fmMatch = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const bodyStart = fmMatch[0].length;
  const body = rawMarkdown.slice(bodyStart);

  const url = fm(frontmatter, 'url');
  if (!url) return null;

  const sourceLabel = fm(frontmatter, 'source');
  const platform = LABEL_TO_PLATFORM[sourceLabel.toLowerCase()] ?? 'web';

  // Extract text: content between frontmatter and first enriched section header
  const enrichedSectionRe = /^## (?:重點摘要|內容分析|重點整理|項目概覽|項目資訊|README|摘要|分析|重點|關鍵觀點|Key Points|Analysis|Summary|AI 摘要)/m;
  const enrichIdx = body.search(enrichedSectionRe);
  const sectionIdx = body.search(/^## /m);
  const cutoff = enrichIdx >= 0 ? enrichIdx : (sectionIdx >= 0 ? sectionIdx : body.length);
  const rawText = body.slice(0, cutoff);
  // Clean: remove author line (> **@...**), translation tags, empty lines
  const text = rawText
    .replace(/^>\s*\*\*@.*$/gm, '')
    .replace(/^>\s*🌐.*$/gm, '')
    .replace(/^>\s*📝.*$/gm, '')
    .replace(/^>\s*Translated from:.*$/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract local image paths from the full body
  const images: string[] = [];
  const imgRegex = /!\[.*?\]\((attachments\/[^)]+)\)/g;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(body)) !== null) {
    images.push(imgMatch[1]);
  }

  // Extract optional fields
  const stars = fmNumber(frontmatter, 'stars');
  const language = fm(frontmatter, 'language') || undefined;
  const tags = fmArray(frontmatter, 'tags');
  // Filter out standard tags to get platform-specific extraTags
  const standardTags = new Set([platform, 'archive', (fm(frontmatter, 'category') || '其他').replace(/\s+/g, '-')]);
  const extraTags = tags.filter(t => !standardTags.has(t));

  // Extract README body for GitHub notes
  const readmeBody = platform === 'github' ? extractReadmeSection(body) : undefined;

  return {
    url,
    platform,
    author: fm(frontmatter, 'author'),
    authorHandle: fm(frontmatter, 'author'),
    title: fm(frontmatter, 'title'),
    date: fm(frontmatter, 'date'),
    category: fm(frontmatter, 'category') || '其他',
    keywords: fmArray(frontmatter, 'keywords'),
    summary: fm(frontmatter, 'summary'),
    images,
    stars,
    language,
    body: readmeBody,
    extraTags: extraTags.length > 0 ? extraTags : undefined,
    text,
  };
}

/** Convert a ParsedNote to ExtractedContent with enriched fields cleared */
export function parsedNoteToExtractedContent(parsed: ParsedNote): ExtractedContent {
  return {
    platform: parsed.platform,
    author: parsed.author,
    authorHandle: parsed.authorHandle,
    title: parsed.title,
    text: parsed.text,
    images: parsed.images,
    videos: [],
    date: parsed.date,
    url: parsed.url,
    category: parsed.category,
    stars: parsed.stars,
    language: parsed.language,
    body: parsed.body,
    extraTags: parsed.extraTags,
    // Clear all enriched fields so pipeline regenerates them
    enrichedKeywords: undefined,
    enrichedSummary: undefined,
    enrichedAnalysis: undefined,
    enrichedKeyPoints: undefined,
    githubAnalysis: undefined,
  };
}
