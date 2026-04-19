/**
 * Action Suggester — after enrichment, find semantically related past notes
 * via keyword overlap and prompt LLM to derive an actionable next step.
 * Appends to {vaultPath}/action-inbox.md when a suggestion is generated.
 *
 * Only runs for actionable categories (AI, 創業, 知識管理).
 * Uses flash tier — must not block main enrichment pipeline.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

const ACTION_INBOX = 'action-inbox.md';
const ACTION_CATEGORIES = ['AI', '創業商業', '知識管理', '生產力'];
const MAX_CANDIDATES = 200;   // 掃描最多筆記數，避免過慢
const TOP_MATCHES = 3;

interface NoteMeta {
  relPath: string;
  title: string;
  keywords: string[];
  summary: string;
  category: string;
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map(k => k.toLowerCase()));
  return a.filter(k => setB.has(k.toLowerCase())).length;
}

function isActionableCategory(category: string): boolean {
  return ACTION_CATEGORIES.some(c => category.includes(c));
}

async function loadNoteMetas(vaultPath: string): Promise<NoteMeta[]> {
  const rootDir = join(vaultPath, 'KnowPipe');
  let files: string[];
  try {
    files = await getAllMdFiles(rootDir);
  } catch {
    return [];
  }

  // Sample at most MAX_CANDIDATES (newest first, already sorted by mtime from getAllMdFiles)
  const sample = files.slice(0, MAX_CANDIDATES);
  const metas: NoteMeta[] = [];

  await Promise.all(sample.map(async (fp) => {
    try {
      const raw = await readFile(fp, 'utf-8');
      const fm = parseFrontmatter(raw);
      const category = fm.get('category') ?? '';
      if (!isActionableCategory(category)) return;
      metas.push({
        relPath: fp.replace(/.*KnowPipe[\\/]/, ''),
        title: fm.get('title') ?? '',
        keywords: parseArrayField(fm.get('keywords') ?? ''),
        summary: fm.get('summary') ?? '',
        category,
      });
    } catch { /* skip unreadable */ }
  }));

  return metas;
}

async function appendToInbox(vaultPath: string, entry: string): Promise<void> {
  const inboxPath = join(vaultPath, ACTION_INBOX);
  let existing = '';
  try { existing = await readFile(inboxPath, 'utf-8'); } catch { /* first write */ }
  const today = new Date().toISOString().slice(0, 10);
  const block = `\n## ${today}\n\n${entry}\n`;
  await writeFile(inboxPath, existing + block, 'utf-8');
}

export async function suggestAction(
  vaultPath: string,
  newNoteTitle: string,
  newNoteCategory: string,
  newNoteKeywords: string[],
  newNoteSummary: string,
): Promise<void> {
  if (!isActionableCategory(newNoteCategory)) return;
  if (newNoteKeywords.length === 0) return;

  try {
    const metas = await loadNoteMetas(vaultPath);
    if (metas.length === 0) return;

    // Rank by keyword overlap, exclude the note itself
    const ranked = metas
      .filter(m => m.title !== newNoteTitle)
      .map(m => ({ ...m, score: overlapScore(newNoteKeywords, m.keywords) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_MATCHES);

    if (ranked.length === 0) return;

    const relatedText = ranked.map((m, i) =>
      `[${i + 1}] 《${m.title}》（${m.category}）\n摘要：${m.summary.slice(0, 80)}`
    ).join('\n\n');

    const prompt = [
      'CAVEMAN RULE: 回覆純文字，不要 JSON，不要 markdown 標題符號(#)。',
      '你是知識行動助理。根據一篇新筆記和它的相關舊筆記，判斷是否有值得追蹤的行動建議。',
      '',
      `新筆記：《${newNoteTitle}》`,
      `分類：${newNoteCategory}`,
      `摘要：${newNoteSummary.slice(0, 120)}`,
      '',
      '相關舊筆記：',
      relatedText,
      '',
      '請判斷：這組知識組合是否能衍生出一個具體可執行的行動（side project、功能點子、工作流改進、深入研究方向）？',
      '如果有：用一句話描述行動，格式「行動：{行動描述}（靈感：{新筆記標題} + {舊筆記標題}）」',
      '如果沒有：只輸出「無」',
      '使用繁體中文。',
    ].join('\n');

    const raw = await runLocalLlmPrompt(prompt, { timeoutMs: 20_000, model: 'flash' });
    if (!raw || raw.trim() === '無' || !raw.includes('行動：')) return;

    await appendToInbox(vaultPath, raw.trim());
    logger.info('action-suggester', '行動建議已寫入 action-inbox', { title: newNoteTitle });
  } catch (err) {
    logger.warn('action-suggester', '行動建議生成失敗', { err: (err as Error).message });
  }
}
