/**
 * /preferences — show user preference profile from Vault metadata.
 * /distill — show knowledge distillation report (core principles + archive candidates).
 * Both are fire-and-forget: reply "處理中" → run analysis → send result.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { scanVaultNotes, loadKnowledge } from '../knowledge/knowledge-store.js';
import { extractPreferences, formatDetailedReport } from '../knowledge/preference-extractor.js';
import { distillVault, formatDistillReport } from '../knowledge/distiller.js';

const TELEGRAM_MSG_LIMIT = 4096;

/** Split long message into chunks respecting Telegram's 4096 char limit */
function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > TELEGRAM_MSG_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

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

/** /distill — knowledge distillation report */
export async function handleDistill(ctx: Context, config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /vault analyze 進行深度分析。');
    return;
  }

  await ctx.reply('🧪 正在蒸餾知識…');

  const notes = await scanVaultNotes(config.vaultPath);
  const report = distillVault(notes, knowledge);
  const text = formatDistillReport(report);

  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }
}
