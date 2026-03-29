/**
 * /consolidate — discover cross-note connections and generate knowledge insights.
 * Hybrid: statistical entity graph for connections + LLM for semantic synthesis.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { scanVaultNotes, loadKnowledge, saveKnowledge } from '../knowledge/knowledge-store.js';
import { consolidateVault } from '../knowledge/consolidator.js';
import { formatConsolidationReport, saveConsolidationNote } from '../knowledge/consolidation-report.js';
import { replyEmptyKnowledge } from './reply-buttons.js';
import { splitMessage } from '../utils/telegram.js';

/** /consolidate handler */
export async function handleConsolidate(ctx: Context, config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('🧠 正在整合最近 7 天的知識…');

  const notes = await scanVaultNotes(config.vaultPath);
  const report = await consolidateVault(notes, knowledge);

  if (report.clusterCount === 0 && report.newNoteCount === 0) {
    await ctx.reply('近 7 天沒有新筆記。');
    return;
  }

  // Save Vault note
  const notePath = await saveConsolidationNote(config.vaultPath, report);

  // Persist lastConsolidatedAt
  await saveKnowledge(knowledge);

  // Send Telegram summary
  const text = formatConsolidationReport(report);
  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }

  await ctx.reply(`📝 整合筆記已存到 Vault：${notePath.split('ObsBot')[1] ?? notePath}`);
}
