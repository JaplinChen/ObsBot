/**
 * /preferences — show user preference profile from Vault metadata.
 * /distill [conflicts|gaps] — knowledge distillation report and analysis tools.
 *   /distill          → existing distillation report (core principles + archive candidates)
 *   /distill conflicts → 矛盾偵測：找出 Vault 中互相衝突的觀點
 *   /distill gaps      → 知識缺口地圖：找出覆蓋不足的領域
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { scanVaultNotes, loadKnowledge } from '../knowledge/knowledge-store.js';
import { extractPreferences, formatDetailedReport } from '../knowledge/preference-extractor.js';
import { distillVault, formatDistillReport, generateDistillVisualPrompt } from '../knowledge/distiller.js';
import { findConflicts, formatConflictsReport } from '../knowledge/conflict-analyzer.js';
import { findGaps, formatGapsReport } from '../knowledge/gap-analyzer.js';
import { replyEmptyKnowledge } from './reply-buttons.js';
import { splitMessage } from '../utils/telegram.js';

/** /preferences — user preference profile */
export async function handlePreferences(ctx: Context, config: AppConfig): Promise<void> {
  await ctx.reply('📊 正在分析 Vault 偏好模型…');

  const notes = await scanVaultNotes(config.vaultPath);
  if (notes.length === 0) {
    await ctx.reply('Vault 中沒有找到筆記。');
    return;
  }

  const knowledge = await loadKnowledge();
  const hasKnowledge = Object.keys(knowledge.notes).length > 0;
  const profile = extractPreferences(notes, hasKnowledge ? knowledge : undefined);
  const report = formatDetailedReport(profile);

  for (const chunk of splitMessage(report)) {
    await ctx.reply(chunk);
  }
}

/** /distill — knowledge distillation report (core mode) */
export async function handleDistill(ctx: Context, config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('🧪 正在蒸餾知識…');

  const notes = await scanVaultNotes(config.vaultPath);
  const report = distillVault(notes, knowledge);
  const text = formatDistillReport(report);

  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }

  // Visual prompt: generate async, send as follow-up if successful
  const visualPrompt = await generateDistillVisualPrompt(report).catch(() => null);
  if (visualPrompt) {
    await ctx.reply(`🎨 視覺化提示詞（可直接用於 Midjourney / DALL-E / 通義萬相）：\n\n${visualPrompt}`);
  }
}

/** /distill conflicts — 矛盾偵測 */
export async function handleDistillConflicts(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('⚡ 正在掃描 Vault 矛盾點…');
  const conflicts = findConflicts(knowledge);
  const report = formatConflictsReport(conflicts);

  for (const chunk of splitMessage(report)) {
    await ctx.reply(chunk);
  }
}

/** /distill gaps — 知識缺口地圖 */
export async function handleDistillGaps(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('🗺 正在繪製知識缺口地圖…');
  const gaps = findGaps(knowledge);
  const report = formatGapsReport(gaps);

  for (const chunk of splitMessage(report)) {
    await ctx.reply(chunk);
  }
}

/** /distill 路由 — 根據參數分派子指令 */
export async function handleDistillRouter(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const arg = text.replace(/^\/distill\s*/i, '').trim().toLowerCase();

  if (arg === 'conflicts') return handleDistillConflicts(ctx, config);
  if (arg === 'gaps') return handleDistillGaps(ctx, config);

  // No arg or unrecognised → existing distill report
  return handleDistill(ctx, config);
}
