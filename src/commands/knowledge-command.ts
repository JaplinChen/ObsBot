/**
 * /analyze and /knowledge commands — deep vault knowledge extraction.
 * /analyze: guides user to Claude Code /vault-analyze skill.
 * /knowledge: reads pre-computed knowledge from vault-knowledge.json.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { aggregateKnowledge, formatKnowledgeSummary } from '../knowledge/knowledge-aggregator.js';

/** /analyze — guide user to Claude Code skill */
export async function handleAnalyze(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  const noteCount = Object.keys(knowledge.notes).length;

  const lines = [
    '🔍 知識分析請在 Claude Code 中執行：',
    '',
    '```',
    '/vault-analyze              # 增量分析',
    '/vault-analyze --full       # 全量重新分析',
    '```',
    '',
    '分析完成後會自動：',
    '• 更新 vault-knowledge.json',
    '• 產生 Obsidian 知識庫摘要筆記',
    '',
    '使用 /knowledge 查看目前知識庫。',
  ];

  if (noteCount > 0) {
    lines.push('', `📊 目前知識庫：${knowledge.stats.analyzedNotes} 篇已分析，${knowledge.stats.totalEntities} 個實體`);
  }

  await ctx.reply(lines.join('\n'));
}

/** /knowledge — show knowledge summary */
export async function handleKnowledge(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply(
      '知識庫為空。\n\n' +
      '請在 Claude Code 中執行 /vault-analyze 進行深度分析。',
    );
    return;
  }
  aggregateKnowledge(knowledge);
  await ctx.reply(formatKnowledgeSummary(knowledge));
}
