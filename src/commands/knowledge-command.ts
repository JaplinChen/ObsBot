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
import { generateHealthReport, formatHealthReportTelegram, saveHealthReportNote } from '../knowledge/health-report.js';
import { runCompilationManual, type CompilationMode } from '../proactive/compilation-cycle.js';
import { compileTopics } from '../knowledge/topic-compiler.js';
import { replyEmptyKnowledge, replyWithNextSteps, NEXT_STEPS } from './reply-buttons.js';
import { startTyping, stopTyping } from '../utils/typing-indicator.js';
import { withTypingIndicator } from './command-runner.js';

/** /knowledge [subcommand] — direct or menu */
export async function handleKnowledge(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
  const arg = text.replace(/^\/knowledge\s*/i, '').trim().toLowerCase();

  // Direct subcommand shortcuts
  if (arg === 'gaps' || arg === '缺口') { await handleGaps(ctx, config); return; }
  if (arg === 'skills' || arg === '技能') { await handleSkills(ctx, config); return; }
  if (arg === 'analyze' || arg === '分析') { await handleAnalyze(ctx, config); return; }
  if (arg === 'dashboard' || arg === '儀表板') { await handleDashboard(ctx, config); return; }
  if (arg === 'health' || arg === '健康') { await handleHealth(ctx, config); return; }

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
      Markup.button.callback('🏥 知識健康', 'kb:health'),
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
  await withTypingIndicator(ctx, '🔍 正在分析 Vault 知識庫…', async () => {
    const typing = startTyping(ctx);
    const result = await runVaultAnalysis(config.vaultPath);
    stopTyping(typing);

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
  }, '分析失敗');
}

/** /compile — manual knowledge compilation trigger */
export async function handleCompile(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
  const arg = text.replace(/^\/compile\s*/i, '').trim();

  // /compile topics [days] [category] — Karpathy-style topic compilation
  if (arg.startsWith('topics') || arg.match(/^\d+$/) || arg === '') {
    await handleTopicCompile(ctx, config, arg);
    return;
  }

  // /compile full / /compile weekly — legacy full compilation
  const mode: CompilationMode = arg.includes('full') || arg.includes('weekly') ? 'weekly' : 'daily';
  const status = await ctx.reply(`🔄 正在執行系統編譯（${mode === 'weekly' ? '完整版' : '輕量版'}）…`);

  const typing = startTyping(ctx);
  try {
    const { report, summary } = await runCompilationManual(config, mode);
    await ctx.reply(`✅ 系統編譯完成\n${summary}\n\n${formatHealthReportTelegram(report)}`.slice(0, 4000));
  } catch (err) {
    await ctx.reply(`編譯失敗：${(err as Error).message}`);
  } finally {
    stopTyping(typing);
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

/** /compile [days] [category] — Karpathy-style topic compilation */
async function handleTopicCompile(ctx: Context, config: AppConfig, arg: string): Promise<void> {
  // Parse: /compile topics 14 AI  or  /compile 14  or  /compile AI  or  /compile
  const cleaned = arg.replace(/^topics\s*/i, '').trim();
  const dayMatch = cleaned.match(/^(\d+)/);
  const daysBack = dayMatch ? parseInt(dayMatch[1], 10) : 7;
  const filterCategory = cleaned.replace(/^\d+\s*/, '').trim() || undefined;

  const label = filterCategory
    ? `最近 ${daysBack} 天 · 篩選「${filterCategory}」`
    : `最近 ${daysBack} 天`;
  const status = await ctx.reply(`📚 正在編譯主題知識（${label}）…`);
  const typing = startTyping(ctx);

  try {
    const result = await compileTopics(config.vaultPath, { daysBack, filterCategory });

    const lines = [`✅ 主題知識編譯完成`, ''];
    lines.push(`📊 ${result.totalNotes} 篇筆記 → ${result.compiledTopics.length} 個主題`);

    for (const t of result.compiledTopics) {
      lines.push(`  • ${t.topic}（${t.noteCount} 篇）`);
    }

    if (result.skippedTopics.length > 0) {
      lines.push('', `⏭ 跳過（不足 3 篇）：${result.skippedTopics.slice(0, 5).join('、')}`);
    }

    if (result.savedPath) {
      lines.push('', `💾 已存入 Vault`);
    }

    await ctx.reply(lines.join('\n').slice(0, 4000));
  } catch (err) {
    await ctx.reply(`主題編譯失敗：${(err as Error).message}`);
  } finally {
    stopTyping(typing);
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

/** kb:health callback — knowledge health report */
export async function handleHealth(ctx: Context, config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  const typing = startTyping(ctx);
  try {
    const report = generateHealthReport(knowledge);
    await ctx.reply(formatHealthReportTelegram(report));
    await saveHealthReportNote(config.vaultPath, report);
  } finally {
    stopTyping(typing);
  }
}
