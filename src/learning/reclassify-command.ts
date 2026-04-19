/** Reclassify all Markdown notes in the Vault by comparing stored category to fresh classification. */

import { classifyContent } from '../classifier.js';
import type { AppConfig } from '../utils/config.js';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { recordFeedback } from './feedback-tracker.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { cleanEmptyDirs } from '../vault/reprocess-helpers.js';

export interface ReclassifyResult {
  total: number;
  moved: number;
  changes: Array<{ file: string; from: string; to: string }>;
}

/**
 * Extract the value of a frontmatter field (e.g. "title" or "category").
 * Handles both quoted and unquoted values.
 */
function extractFrontmatterField(content: string, field: string): string | null {
  const re = new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm');
  const match = content.match(re);
  return match ? match[1].trim() : null;
}

/** Replace the value of a frontmatter field in the file content. */
function replaceFrontmatterField(content: string, field: string, newValue: string): string {
  const re = new RegExp(`^(${field}:\\s*).*$`, 'm');
  return content.replace(re, `$1${newValue}`);
}

/**
 * Scan all .md files under {vaultPath}/KnowPipe/, reclassify each by title,
 * and move files whose top-level category has changed to the new folder.
 */
export async function executeReclassify(config: AppConfig): Promise<ReclassifyResult> {
  const baseDir = join(config.vaultPath, 'KnowPipe');
  const allFiles = await getAllMdFiles(baseDir);

  let moved = 0;
  const changes: Array<{ file: string; from: string; to: string }> = [];

  for (const filePath of allFiles) {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const title = extractFrontmatterField(raw, 'title') ?? '';
    const storedCategory = extractFrontmatterField(raw, 'category');
    if (!storedCategory) continue;

    // 取得正文（frontmatter 結束後的內容）供分類使用
    const bodyMatch = raw.match(/^---[\s\S]*?---\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1].slice(0, 800) : '';

    const newCategory = await classifyContent(title, body);

    if (storedCategory === newCategory) continue;

    // Compute the new path based on full category path
    // e.g. baseDir/AI/工具/foo.md → baseDir/AI/研究對話/Claude/foo.md
    const relativeTail = filePath.slice(baseDir.length).replace(/\\/g, '/');
    const segments = relativeTail.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1];
    // Build new path from new category parts + original filename
    const newCategoryParts = newCategory
      .split('/')
      .slice(0, 3)
      .map(p => p.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\-_ &]/g, '').replace(/\s{2,}/g, ' ').trim())
      .filter(p => p.length > 0);
    const newFilePath = join(baseDir, ...newCategoryParts, fileName);
    const newDir = dirname(newFilePath);

    // Update frontmatter category
    const updatedRaw = replaceFrontmatterField(raw, 'category', newCategory);

    try {
      await mkdir(newDir, { recursive: true });
      await writeFile(filePath, updatedRaw, 'utf-8');
      await rename(filePath, newFilePath);
      // 清理舊目錄（搬移後若為空則刪除，防止空目錄堆積）
      await cleanEmptyDirs(dirname(filePath));
    } catch {
      continue;
    }

    moved++;
    changes.push({
      file: segments.slice(-1)[0] ?? filePath,
      from: storedCategory,
      to: newCategory,
    });

    // Record feedback for learning loop reinforcement
    const kwField = extractFrontmatterField(raw, 'keywords');
    const keywords = kwField
      ? kwField.replace(/[\[\]"]/g, '').split(',').map(k => k.trim()).filter(Boolean)
      : [];
    recordFeedback({
      from: storedCategory,
      to: newCategory,
      title,
      keywords,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  return { total: allFiles.length, moved, changes };
}
