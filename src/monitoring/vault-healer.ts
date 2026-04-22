/**
 * Vault self-healer — scans notes for common issues and auto-fixes them.
 * Fixes: empty summaries, HTML remnants, missing frontmatter fields, untranslated content.
 * Quality audit: short summaries, too few keywords → tag pending-review.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';
import { extractKeywords } from '../classifier.js';
import { detectLanguage, translateIfNeeded } from '../enrichment/translator.js';
import type { VaultIssue, CorrectionEvent } from './health-types.js';
import { logger } from '../core/logger.js';

const CORRECTIONS_LOG = join('data', 'corrections-log.json');

async function appendCorrections(events: CorrectionEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    let existing: CorrectionEvent[] = [];
    try {
      const raw = await readFile(CORRECTIONS_LOG, 'utf-8');
      existing = JSON.parse(raw) as CorrectionEvent[];
    } catch { /* 首次建立 */ }
    // 保留最近 500 筆，避免無限增長
    const updated = [...existing, ...events].slice(-500);
    await writeFile(CORRECTIONS_LOG, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('vault-healer', '修正日誌寫入失敗', { err: (err as Error).message });
  }
}

/** 每次 heal 最多翻譯幾篇，避免週期過長 */
const MAX_TRANSLATIONS_PER_RUN = 5;

const HTML_TAG_RE = /<(?:div|span|br|p|a|img|table|tr|td|th|ul|ol|li|h[1-6])\b[^>]*\/?>/gi;
const HTML_CLOSE_RE = /<\/(?:div|span|p|a|table|tr|td|th|ul|ol|li|h[1-6])>/gi;

const SUMMARY_MIN_CHARS = 20;
const KEYWORDS_MIN_COUNT = 3;
const PENDING_REVIEW_TAG = 'pending-review';

/** Strip HTML tags from text, preserving content */
function stripHtml(text: string): string {
  return text
    .replace(HTML_TAG_RE, '')
    .replace(HTML_CLOSE_RE, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse frontmatter and body from raw markdown */
function splitNote(raw: string): { frontmatter: string; body: string; fmEnd: number } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return {
    frontmatter: match[1],
    body: raw.slice(match[0].length),
    fmEnd: match[0].length,
  };
}

/** 從正文提取摘要（前 150 字有意義的文字） */
function extractSummaryFromBody(body: string): string {
  const lines = body.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^[#>*\-|]/.test(l) && !/^!\[/.test(l));
  const text = lines.join(' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
  return text.slice(0, 150).replace(/\n/g, ' ');
}

/** 替換或插入 frontmatter 中的 keywords 行 */
function replaceKeywords(raw: string, keywords: string[]): string {
  const newLine = `keywords: [${keywords.join(', ')}]`;
  if (/^keywords:/m.test(raw)) {
    return raw.replace(/^keywords:\s*\[.*\]/m, newLine);
  }
  // 欄位不存在 → 插入到 frontmatter 結尾前
  return raw.replace(/(\r?\n---(?:\r?\n|$))/, `\n${newLine}$1`);
}

/** 替換或插入 frontmatter 中的 summary 行 */
function replaceSummary(raw: string, summary: string): string {
  const escaped = summary.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const newLine = `summary: "${escaped}"`;
  if (/^summary:/m.test(raw)) {
    return raw.replace(/^summary:\s*".*"/m, newLine);
  }
  // 欄位不存在 → 插入到 frontmatter 結尾前
  return raw.replace(/(\r?\n---(?:\r?\n|$))/, `\n${newLine}$1`);
}

/**
 * 為低品質筆記加上 pending-review tag。
 * 只修改 frontmatter 的 tags 行，不動其他欄位。
 */
function addPendingReviewTag(raw: string): string {
  // 找到 tags: [...] 行並插入 pending-review
  return raw.replace(
    /^(tags:\s*\[)(.*?)(\])/m,
    (_m, open, inner, close) => {
      const existing = inner.split(',').map((t: string) => t.trim()).filter(Boolean);
      if (existing.includes(PENDING_REVIEW_TAG)) return _m; // 已有則跳過
      const updated = [...existing, PENDING_REVIEW_TAG].join(', ');
      return `${open}${updated}${close}`;
    },
  );
}

interface ScanResult {
  issues: VaultIssue[];
  totalNotes: number;
  autoFixed: number;
  pendingReviewTagged: number;
  translated: number;
}

/** Scan and auto-fix vault issues */
export async function healVault(vaultPath: string, dryRun: boolean = false): Promise<ScanResult> {
  const rootDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(rootDir);
  const issues: VaultIssue[] = [];
  const corrections: CorrectionEvent[] = [];
  const now = new Date().toISOString();
  let autoFixed = 0;
  let pendingReviewTagged = 0;
  let translated = 0;

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = splitNote(raw);
      if (!parsed) continue;

      const relPath = filePath.replace(/.*KnowPipe[\\/]/, '');
      let modified = false;
      let newContent = raw;

      // Fix 1: HTML remnants in body
      if (HTML_TAG_RE.test(parsed.body)) {
        HTML_TAG_RE.lastIndex = 0; // reset regex state
        const cleanBody = stripHtml(parsed.body);
        if (cleanBody !== parsed.body) {
          newContent = raw.slice(0, parsed.fmEnd) + cleanBody;
          modified = true;
          issues.push({ file: relPath, issue: 'HTML 殘留（已修復）', autoFixable: true, fixed: true, severity: 'auto_fixed' });
          corrections.push({ file: relPath, field: 'html', timestamp: now, reason: 'html_remnants' });
        }
      }

      // Fix 2: Broken image links (![](path) where path has backslashes)
      const brokenImgRe = /!\[([^\]]*)\]\(([^)]*\\[^)]*)\)/g;
      if (brokenImgRe.test(newContent)) {
        brokenImgRe.lastIndex = 0;
        newContent = newContent.replace(brokenImgRe, (_m, alt, path) => {
          return `![${alt}](${path.replace(/\\/g, '/')})`;
        });
        modified = true;
        issues.push({ file: relPath, issue: '圖片路徑反斜線（已修復）', autoFixable: true, fixed: true, severity: 'auto_fixed' });
      }

      // Fix 3: Excess blank lines (>3 consecutive)
      const excessBlankRe = /\n{4,}/g;
      if (excessBlankRe.test(newContent)) {
        newContent = newContent.replace(excessBlankRe, '\n\n\n');
        modified = true;
        issues.push({ file: relPath, issue: '過多空行（已修復）', autoFixable: true, fixed: true, severity: 'auto_fixed' });
      }

      // Quality audit: evaluate and auto-fix frontmatter fields
      const fm = parseFrontmatter(newContent);

      // 壓縮封存檔（含 compress_source）不做品質審計
      if (fm.get('compress_source')) {
        if (modified && !dryRun) {
          await writeFile(filePath, newContent, 'utf-8');
          autoFixed++;
        }
        continue;
      }

      const unfixableIssues: string[] = [];
      const title = fm.get('title') ?? '';
      const bodyText = parsed.body;

      // Fix 4: 摘要過短 → 從正文提取
      const summary = fm.get('summary') ?? '';
      if (summary.length < SUMMARY_MIN_CHARS) {
        const extracted = extractSummaryFromBody(bodyText);
        if (extracted.length >= SUMMARY_MIN_CHARS) {
          newContent = replaceSummary(newContent, extracted);
          modified = true;
          issues.push({ file: relPath, issue: `摘要過短（${summary.length} 字→已修復）`, autoFixable: true, fixed: true, severity: 'auto_fixed' });
          corrections.push({ file: relPath, field: 'summary', timestamp: now, reason: 'summary_too_short' });
        } else {
          unfixableIssues.push('摘要過短');
          issues.push({ file: relPath, issue: `摘要過短（${summary.length} 字）`, autoFixable: false, severity: 'needs_review' });
        }
      }

      // Fix 5: 關鍵字不足 → 從正文提取並合併
      const keywordsRaw = fm.get('keywords') ?? '';
      const keywords = parseArrayField(keywordsRaw);
      if (keywords.length < KEYWORDS_MIN_COUNT) {
        const extracted = extractKeywords(title, bodyText);
        const merged = [...new Set([...keywords, ...extracted])].slice(0, 5);
        if (merged.length >= KEYWORDS_MIN_COUNT) {
          newContent = replaceKeywords(newContent, merged);
          modified = true;
          issues.push({ file: relPath, issue: `關鍵字不足（${keywords.length}→${merged.length} 個，已修復）`, autoFixable: true, fixed: true, severity: 'auto_fixed' });
          corrections.push({ file: relPath, field: 'keywords', timestamp: now, reason: 'keywords_insufficient' });
        } else {
          unfixableIssues.push('關鍵字不足');
          issues.push({ file: relPath, issue: `關鍵字不足（${keywords.length} 個）`, autoFixable: false, severity: 'needs_review' });
        }
      }

      // Fix 6: 未翻譯的英文或簡體內容 → 翻譯為繁體中文
      const hasTranslatedMarker = /^>\s*Translated from:/m.test(newContent);
      if (!hasTranslatedMarker && translated < MAX_TRANSLATIONS_PER_RUN) {
        const bodyForLangCheck = parsed.body.replace(/^>\s*\*\*.*?\*\*.*\n/m, '').trim();
        const lang = detectLanguage(bodyForLangCheck.slice(0, 500));
        if (lang === 'en' || lang === 'zh-CN') {
          try {
            const rawTitle = (fm.get('title') ?? title).replace(/^"|"$/g, '');
            const result = await translateIfNeeded(rawTitle, bodyForLangCheck);
            if (result) {
              // 更新 frontmatter title
              const escapedTitle = result.translatedTitle?.replace(/"/g, '\\"') ?? rawTitle;
              newContent = newContent.replace(
                /^(title:\s*)".*"/m,
                `$1"${escapedTitle}"`,
              );
              // 在 author/date 行後插入翻譯標記與翻譯正文
              const langLabel: Record<string, string> = {
                en: 'English', 'zh-CN': 'Chinese (Simplified)',
              };
              const marker = `> Translated from: ${langLabel[result.detectedLanguage] ?? result.detectedLanguage}`;
              newContent = newContent.replace(
                /(^>\s*\*\*.*?\*\*.*$)/m,
                `$1\n\n${marker}\n\n${result.translatedText}`,
              );
              modified = true;
              translated++;
              issues.push({ file: relPath, issue: `未翻譯（${lang}→已翻譯為繁體中文）`, autoFixable: true, fixed: true, severity: 'auto_fixed' });
              corrections.push({ file: relPath, field: 'translation', timestamp: now, reason: 'missing_translation' });
              logger.info('vault-healer', '翻譯完成', { file: relPath, lang });
            }
          } catch (err) {
            logger.warn('vault-healer', '翻譯失敗', { file: relPath, err: (err as Error).message });
          }
        }
      }

      // 只有真正無法修復的才標記 pending-review
      if (unfixableIssues.length > 0) {
        const tagged = addPendingReviewTag(newContent);
        if (tagged !== newContent) {
          newContent = tagged;
          modified = true;
          pendingReviewTagged++;
          logger.info('vault-healer', '標記低品質筆記', { file: relPath, issues: unfixableIssues });
        }
      }

      if (modified && !dryRun) {
        await writeFile(filePath, newContent, 'utf-8');
        autoFixed++;
      }
    } catch {
      // Skip unreadable files
    }
  }

  logger.info('vault-healer', '掃描完成', {
    total: files.length,
    issues: issues.length,
    fixed: autoFixed,
    pendingReviewTagged,
    translated,
    corrections: corrections.length,
  });

  if (!dryRun) await appendCorrections(corrections);

  return { issues, totalNotes: files.length, autoFixed, pendingReviewTagged, translated };
}
