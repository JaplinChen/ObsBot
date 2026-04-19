/**
 * Inline reclassify action — lets users correct a note's category
 * right from the save response with a two-step picker:
 * Step 1: Show top-level category groups
 * Step 2: Move file + record feedback for learning
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { logger } from '../core/logger.js';
import { recordFeedback } from '../learning/feedback-tracker.js';
import { CATEGORIES } from '../classifier-categories.js';
import { cleanEmptyDirs } from '../vault/reprocess-helpers.js';

/** Token store: short token → { mdPath, oldCategory, title, keywords } */
const pendingReclassify = new Map<string, {
  mdPath: string;
  oldCategory: string;
  title: string;
  keywords: string[];
}>();

let tokenCounter = 0;

/**
 * 合法分類白名單 — 從 classifier-categories 動態衍生，確保與分類器同步。
 * 使用 Set 供 O(1) 查詢驗證。
 */
const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.name));

/**
 * 頂層分類選單 — 從 VALID_CATEGORIES 動態建立，避免與分類器脫節。
 * 取每個分類的頂層（第一段），再加上一層子分類（若有），去重排序。
 */
const TOP_CATEGORIES: string[] = (() => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const cat of CATEGORIES) {
    const parts = cat.name.split('/');
    // 加入頂層
    if (!seen.has(parts[0])) { seen.add(parts[0]); result.push(parts[0]); }
    // 加入二層（若有）
    if (parts.length >= 2) {
      const twoLevel = `${parts[0]}/${parts[1]}`;
      if (!seen.has(twoLevel)) { seen.add(twoLevel); result.push(twoLevel); }
    }
  }

  return result;
})();

/** Create a reclassify token and return inline keyboard markup */
export function createReclassifyButton(
  mdPath: string, category: string, title: string, keywords: string[],
): { text: string; callback_data: string } {
  const token = `rc${++tokenCounter}`;
  pendingReclassify.set(token, { mdPath, oldCategory: category, title, keywords });
  // Auto-expire after 10 minutes
  setTimeout(() => pendingReclassify.delete(token), 600_000);
  return { text: '📁 改分類', callback_data: `recat:${token}` };
}

/** Step 1: Show category picker */
export async function handleReclassifyPicker(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const token = ctx.callbackQuery.data.replace('recat:', '');
  const pending = pendingReclassify.get(token);
  if (!pending) {
    await ctx.answerCbQuery('按鈕已過期');
    return;
  }
  await ctx.answerCbQuery();

  // Build 2-column category buttons
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < TOP_CATEGORIES.length; i += 2) {
    const row = [
      Markup.button.callback(TOP_CATEGORIES[i], `rcmv:${token}:${TOP_CATEGORIES[i]}`),
    ];
    if (i + 1 < TOP_CATEGORIES.length) {
      row.push(Markup.button.callback(TOP_CATEGORIES[i + 1], `rcmv:${token}:${TOP_CATEGORIES[i + 1]}`));
    }
    buttons.push(row);
  }

  await ctx.reply(
    `📁 目前分類：${pending.oldCategory}\n選擇新分類：`,
    Markup.inlineKeyboard(buttons),
  );
}

/** Step 2: Execute the move */
export async function handleReclassifyMove(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data.replace('rcmv:', '');
  const colonIdx = data.indexOf(':');
  if (colonIdx < 0) return;

  const token = data.slice(0, colonIdx);
  const newCategory = data.slice(colonIdx + 1);
  const pending = pendingReclassify.get(token);
  if (!pending) {
    await ctx.answerCbQuery('按鈕已過期');
    return;
  }

  // 白名單驗證：防止非法分類污染目錄結構
  if (!VALID_CATEGORIES.has(newCategory)) {
    logger.warn('recat', '分類不在白名單，拒絕', { newCategory });
    await ctx.answerCbQuery('⚠️ 分類無效');
    return;
  }

  await ctx.answerCbQuery(`移動至 ${newCategory}…`);
  pendingReclassify.delete(token);

  try {
    const raw = await readFile(pending.mdPath, 'utf-8');
    // Update frontmatter category
    const updated = raw.replace(/^(category:\s*).*$/m, `$1${newCategory}`);

    // Compute new path
    const vaultKnowPipeDir = pending.mdPath.split('/KnowPipe/')[0] + '/KnowPipe';
    const fileName = basename(pending.mdPath);
    const newCategoryParts = newCategory.split('/').filter(Boolean);
    const newDir = join(vaultKnowPipeDir, ...newCategoryParts);
    const newPath = join(newDir, fileName);

    const oldDir = dirname(pending.mdPath);
    await mkdir(newDir, { recursive: true });
    await writeFile(pending.mdPath, updated, 'utf-8');
    await rename(pending.mdPath, newPath);

    // 清理舊目錄（搬移後若為空則刪除）
    await cleanEmptyDirs(oldDir);

    // Record feedback for learning
    await recordFeedback({
      from: pending.oldCategory,
      to: newCategory,
      title: pending.title,
      keywords: pending.keywords,
      timestamp: new Date().toISOString(),
    });

    await ctx.editMessageText(`✅ 已從 ${pending.oldCategory} → ${newCategory}`);
    logger.info('recat', '用戶改分類', { from: pending.oldCategory, to: newCategory });
  } catch (err) {
    logger.error('recat', '改分類失敗', { err });
    await ctx.reply('❌ 改分類失敗，請稍後重試');
  }
}
