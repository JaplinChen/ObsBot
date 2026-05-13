import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export interface GuardianScore {
  total: number;
  breakdown: {
    summaryDepth: number;
    keywordRelevance: number;
    categoryFit: number;
    transcriptUsage: number;
    adPollution: number;
    metadataCompleteness: number;
  };
  issues: string[];
  isMoc: boolean;
}

const MOC_PATTERNS = /_index|MOC|地圖|索引|目錄/i;
const AD_PATTERNS = [
  /訂閱.*頻道/i, /點擊.*連結/i, /優惠碼/i, /折扣碼/i,
  /affiliate/i, /sponsored/i, /此影片由.*贊助/i, /coupon\s*code/i,
];
const VIDEO_PLATFORMS = ['youtube', 'bilibili', 'tiktok', 'douyin', 'direct-video'];

export function isMocFile(filePath: string, fm: Record<string, string>): boolean {
  if (MOC_PATTERNS.test(basename(filePath))) return true;
  if (fm.type === 'moc' || fm.type === 'index') return true;
  // Auto-generated system reports (health report, knowledge map, etc.)
  if (fm.tags?.includes('auto-generated')) return true;
  return false;
}

function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) fm[key] = val;
  }
  return { fm, body: match[2] };
}

function scoreSummaryDepth(summary: string): { score: number; issue?: string } {
  const len = summary?.length ?? 0;
  if (len < 20) return { score: 0, issue: '空白摘要（< 20 字）' };
  if (len < 50) return { score: 4, issue: '摘要過短（< 50 字）' };
  if (len < 100) return { score: 7 };
  return { score: 10 };
}

function scoreKeywordRelevance(keywords: string, title: string, summary: string): { score: number; issue?: string } {
  const raw = keywords?.replace(/[\[\]"']/g, '') ?? '';
  const list = raw.split(',').map(k => k.trim()).filter(Boolean);
  if (list.length === 0) return { score: 0, issue: '缺少關鍵字' };
  if (list.length < 3) return { score: 5 };
  const text = `${title} ${summary}`.toLowerCase();
  const matchCount = list.filter(k => text.includes(k.toLowerCase())).length;
  return { score: Math.round((matchCount / list.length) * 10) };
}

function scoreCategoryFit(category: string, title: string, summary: string): { score: number; issue?: string } {
  if (!category) return { score: 0, issue: '缺少分類' };
  const parts = category.toLowerCase().split('/').filter(p => p.length > 2);
  const text = `${title} ${summary}`.toLowerCase();
  const matchCount = parts.filter(p => text.includes(p)).length;
  if (parts.length > 1 && matchCount === 0) return { score: 5, issue: '分類可能不符' };
  return { score: 8 };
}

function scoreTranscriptUsage(platform: string, body: string): { score: number; issue?: string } {
  const isVideo = VIDEO_PLATFORMS.some(p => platform?.toLowerCase().includes(p));
  if (!isVideo) return { score: 10 };
  if (body.includes('## 逐字稿') || body.includes('## Transcript') || body.length > 500) return { score: 10 };
  return { score: 4, issue: '影片平台但缺乏逐字稿內容' };
}

function scoreAdPollution(body: string): { score: number; issue?: string } {
  const hitCount = AD_PATTERNS.filter(p => p.test(body)).length;
  if (hitCount >= 3) return { score: 2, issue: `廣告污染（${hitCount} 個模式）` };
  if (hitCount >= 1) return { score: 6, issue: '輕微廣告污染' };
  return { score: 10 };
}

function scoreMetadata(fm: Record<string, string>): { score: number; issue?: string } {
  const required = ['title', 'url', 'date', 'category'];
  const missing = required.filter(k => !fm[k] || fm[k] === 'undefined' || fm[k] === '');
  if (missing.length === 0) return { score: 10 };
  return { score: Math.round((1 - missing.length / required.length) * 10), issue: `缺少欄位：${missing.join(', ')}` };
}

export async function scoreArticle(filePath: string): Promise<GuardianScore> {
  const content = await readFile(filePath, 'utf-8');
  const { fm, body } = parseFrontmatter(content);

  if (isMocFile(filePath, fm)) {
    return {
      total: 10,
      breakdown: { summaryDepth: 10, keywordRelevance: 10, categoryFit: 10, transcriptUsage: 10, adPollution: 10, metadataCompleteness: 10 },
      issues: [],
      isMoc: true,
    };
  }

  const s = scoreSummaryDepth(fm.summary ?? '');
  const k = scoreKeywordRelevance(fm.keywords ?? '', fm.title ?? '', fm.summary ?? '');
  const c = scoreCategoryFit(fm.category ?? '', fm.title ?? '', fm.summary ?? '');
  const t = scoreTranscriptUsage(fm.platform ?? fm.source ?? '', body);
  const a = scoreAdPollution(body);
  const m = scoreMetadata(fm);

  const total = Math.round(
    s.score * 0.25 + k.score * 0.15 + c.score * 0.20 +
    t.score * 0.15 + a.score * 0.15 + m.score * 0.10,
  );

  return {
    total,
    breakdown: {
      summaryDepth: s.score,
      keywordRelevance: k.score,
      categoryFit: c.score,
      transcriptUsage: t.score,
      adPollution: a.score,
      metadataCompleteness: m.score,
    },
    issues: [s.issue, k.issue, c.issue, t.issue, a.issue, m.issue].filter((x): x is string => Boolean(x)),
    isMoc: false,
  };
}
