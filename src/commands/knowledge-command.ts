/**
 * /knowledge — unified knowledge system entry point.
 * Shows knowledge summary + InlineKeyboard for sub-functions:
 * gaps, skills, preferences, analyze.
 *
 * Individual handlers are exported for callback use from register-commands.ts.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { aggregateKnowledge, formatKnowledgeSummary } from '../knowledge/knowledge-aggregator.js';
import { detectKnowledgeGaps, formatGapsSummary } from '../knowledge/knowledge-graph.js';
import { detectHighDensityTopics, formatTopicsSummary } from '../knowledge/skill-generator.js';
import { buildToolDashboard, formatToolDashboard } from '../knowledge/tool-dashboard.js';

/** /knowledge — show summary + sub-function buttons */
export async function handleKnowledge(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply(
      '知識庫為空。\n\n' +
      '請在 Claude Code 中執行 /vault analyze 進行深度分析。',
    );
    return;
  }
  aggregateKnowledge(knowledge);
  await ctx.reply(formatKnowledgeSummary(knowledge), Markup.inlineKeyboard([
    [
      Markup.button.callback('🕳 知識缺口', 'kb:gaps'),
      Markup.button.callback('🎯 高密度技能', 'kb:skills'),
    ],
    [
      Markup.button.callback('📊 偏好模型', 'kb:preferences'),
      Markup.button.callback('🛠 工具儀表板', 'kb:dashboard'),
    ],
    [
      Markup.button.callback('🔍 深度分析', 'kb:analyze'),
    ],
  ]));
}

/** kb:gaps callback — show knowledge gaps */
export async function handleGaps(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /vault analyze');
    return;
  }
  aggregateKnowledge(knowledge);
  const gaps = detectKnowledgeGaps(knowledge);
  await ctx.reply(formatGapsSummary(gaps));
}

/** kb:skills callback — show high-density topics */
export async function handleSkills(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /vault analyze');
    return;
  }
  aggregateKnowledge(knowledge);
  const topics = detectHighDensityTopics(knowledge);
  await ctx.reply(formatTopicsSummary(topics));
}

/** kb:dashboard callback — tool usage dashboard */
export async function handleDashboard(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply('知識庫為空，請先執行 /vault analyze');
    return;
  }
  aggregateKnowledge(knowledge);
  const dashboard = buildToolDashboard(knowledge);
  await ctx.reply(formatToolDashboard(dashboard).slice(0, 4000));
}

/** kb:analyze callback — guide to Claude Code */
export async function handleAnalyze(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  const noteCount = Object.keys(knowledge.notes).length;

  const lines = [
    '🔍 知識分析請在 Claude Code 中執行：',
    '',
    '```',
    '/vault analyze              # 增量分析',
    '/vault analyze --full       # 全量重新分析',
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
