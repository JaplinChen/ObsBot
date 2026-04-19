/**
 * Batch-translate existing Vault notes that lack a Traditional Chinese translation.
 * Scans all .md files, detects language, and inserts a "繁中翻譯" section
 * for non-zh-TW content (opencc-js for zh-CN, local LLM CLI for en).
 */

import type { AppConfig } from '../utils/config.js';
import { detectLanguage, translateIfNeeded } from '../enrichment/translator.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BatchTranslateResult {
  total: number;
  skipped: number;      // already has translation section
  translated: number;   // successfully translated
  failed: number;       // local LLM failed
  noNeed: number;       // already zh-TW
  details: Array<{ file: string; lang: string; status: string }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TRANSLATION_HEADING = '## 繁中翻譯';
const RATE_LIMIT_DELAY_MS = 1_000;


/** Extract body text after frontmatter (skip YAML block). */
function extractBody(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const endIdx = raw.indexOf('---', 3);
  return endIdx > 0 ? raw.slice(endIdx + 3).trim() : raw;
}

/** Extract frontmatter title field. */
function extractTitle(raw: string): string {
  const m = raw.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
  return m ? m[1].trim() : '';
}

/** Build the translation section markdown. */
function buildTranslationSection(lang: string, translatedTitle: string | undefined, translatedText: string): string {
  const langLabel = lang === 'en' ? 'English' : lang === 'zh-CN' ? '简体中文' : lang;
  const parts = [TRANSLATION_HEADING, `> 原文語言：${langLabel}`, ''];
  if (translatedTitle) parts.push(`**${translatedTitle}**`, '');
  parts.push(translatedText, '');
  return parts.join('\n');
}

/**
 * Insert translation section at the right position in the markdown.
 * Priority: after "## 重點摘要" > before "## 評論"/"## 相關連結" > end of file.
 */
function insertTranslation(raw: string, section: string): string {
  // After 重點摘要
  const summaryIdx = raw.indexOf('## 重點摘要');
  if (summaryIdx >= 0) {
    const nextHeading = raw.indexOf('\n## ', summaryIdx + 10);
    const insertAt = nextHeading >= 0 ? nextHeading : raw.length;
    return raw.slice(0, insertAt) + '\n\n' + section + raw.slice(insertAt);
  }

  // Before 評論 or 相關連結
  for (const heading of ['## 評論提及', '## 評論', '## 相關連結']) {
    const idx = raw.indexOf(heading);
    if (idx >= 0) return raw.slice(0, idx) + section + '\n' + raw.slice(idx);
  }

  // Append to end
  return raw.trimEnd() + '\n\n' + section;
}

/* ------------------------------------------------------------------ */
/*  Main entry                                                         */
/* ------------------------------------------------------------------ */

export async function executeBatchTranslate(config: AppConfig): Promise<BatchTranslateResult> {
  const baseDir = join(config.vaultPath, 'KnowPipe');
  const allFiles = await getAllMdFiles(baseDir);

  const result: BatchTranslateResult = {
    total: allFiles.length, skipped: 0, translated: 0, failed: 0, noNeed: 0, details: [],
  };

  for (const filePath of allFiles) {
    const name = basename(filePath);
    let raw: string;
    try { raw = await readFile(filePath, 'utf-8'); } catch { continue; }

    // Already has translation ??skip
    if (raw.includes(TRANSLATION_HEADING)) {
      result.skipped++;
      continue;
    }

    const body = extractBody(raw);
    const sample = body.slice(0, 500);
    const lang = detectLanguage(sample);

    if (lang === 'zh-TW' || lang === 'other') {
      result.noNeed++;
      continue;
    }

    // Needs translation (en or zh-CN)
    const title = extractTitle(raw);
    try {
      const tr = await translateIfNeeded(title, body);
      if (!tr) {
        result.failed++;
        result.details.push({ file: name, lang, status: 'translation failed' });
        continue;
      }

      const section = buildTranslationSection(tr.detectedLanguage, tr.translatedTitle, tr.translatedText);
      const updated = insertTranslation(raw, section);
      await writeFile(filePath, updated, 'utf-8');

      result.translated++;
      result.details.push({ file: name, lang: tr.detectedLanguage, status: 'ok' });
    } catch (err) {
      result.failed++;
      result.details.push({ file: name, lang, status: (err as Error).message.slice(0, 60) });
    }

    // Rate limit protection
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  return result;
}


