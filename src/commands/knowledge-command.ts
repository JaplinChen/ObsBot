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
import { runVaultAnalysis } from '../knowledge/vault-analyzer.js';
import { replyEmptyKnowledge, replyWithNextSteps, NEXT_STEPS } from './reply-buttons.js';

/** /knowledge — show summary + sub-function buttons */
export async function handleKnowledge(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
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
    await replyEmptyKnowledge(ctx);
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
    await replyEmptyKnowledge(ctx);
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
    await replyEmptyKnowledge(ctx);
    return;
  }
  aggregateKnowledge(knowledge);
  const dashboard = buildToolDashboard(knowledge);
  await ctx.reply(formatToolDashboard(dashboard).slice(0, 4000));
}

/** kb:analyze callback — run vault analysis directly */
export async function handleAnalyze(ctx: Context, config: AppConfig): Promise<void> {
  const status = await ctx.reply('🔍 正在分析 Vault 知識庫…');

  try {
    const result = await runVaultAnalysis(config.vaultPath);

    const lines = [
      '✅ 知識分析完成',
      '',
      `📊 新分析 ${result.processed} 篇 | 跳過 ${result.skipped} 篇（未變更）`,
      `🏷 共 ${result.totalEntities} 個實體`,
      '',
      '🔥 Top 實體：',
    ];

    for (const e of result.topEntities.slice(0, 10)) {
      lines.push(`  • ${e.name}（${e.mentions} 次）`);
    }

    await replyWithNextSteps(ctx, lines.join('\n'), [...NEXT_STEPS.afterAnalyze]);
  } catch (err) {
    await ctx.reply(`分析失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
