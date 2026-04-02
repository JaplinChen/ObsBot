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

/** Token store: short token → { mdPath, oldCategory, title, keywords } */
const pendingReclassify = new Map<string, {
  mdPath: string;
  oldCategory: string;
  title: string;
  keywords: string[];
}>();

let tokenCounter = 0;

/** Top-level category groups for quick selection */
const TOP_CATEGORIES = [
  'AI/研究對話', 'AI/圖像生成', 'AI/影片製作', 'AI/自動化',
  'AI/設計', 'AI/寫作', 'AI/語音', 'AI/RAG',
  'Obsidian', 'Programming', 'Tech', 'Design',
  'Finance', 'Business', 'Marketing', 'Media',
  'Productivity', 'News', 'Lifestyle', '其他',
];

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
  await ctx.answerCbQuery(`移動至 ${newCategory}…`);
  pendingReclassify.delete(token);

  try {
    const raw = await readFile(pending.mdPath, 'utf-8');
    // Update frontmatter category
    const updated = raw.replace(/^(category:\s*).*$/m, `$1${newCategory}`);

    // Compute new path
    const vaultObsBotDir = pending.mdPath.split('/ObsBot/')[0] + '/ObsBot';
    const fileName = basename(pending.mdPath);
    const newCategoryParts = newCategory.split('/').filter(Boolean);
    const newDir = join(vaultObsBotDir, ...newCategoryParts);
    const newPath = join(newDir, fileName);

    await mkdir(newDir, { recursive: true });
    await writeFile(pending.mdPath, updated, 'utf-8');
    await rename(pending.mdPath, newPath);

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
