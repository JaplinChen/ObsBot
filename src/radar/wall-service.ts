/**
 * Tool Wall Service — scheduled push engine for the AI agent intelligence wall.
 * Generates reports on tool activity, dormant tools, and new tool matches.
 */
import type { Telegraf } from 'telegraf';
import { type AppConfig, getOwnerUserId } from '../utils/config.js';
import type { WallConfig, WallReport, ToolActivity, ToolMatchResult } from './wall-types.js';
import { DEFAULT_WALL_CONFIG } from './wall-types.js';
import { buildToolIndex, computeToolActivity, matchNewTool } from './wall-index.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { logger } from '../core/logger.js';
import { join } from 'node:path';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';

const WALL_CONFIG_PATH = join(process.cwd(), 'data', 'wall-config.json');
const MAX_PENDING_MATCHES = 20;

/** Load wall config from disk */
export async function loadWallConfig(): Promise<WallConfig> {
  const loaded = await safeReadJSON<Partial<WallConfig>>(WALL_CONFIG_PATH, {});
  return { ...DEFAULT_WALL_CONFIG, ...loaded };
}

/** Save wall config to disk */
export async function saveWallConfig(config: WallConfig): Promise<void> {
  await safeWriteJSON(WALL_CONFIG_PATH, config);
}

/** Generate a full wall report */
export async function generateWallReport(wallConfig: WallConfig): Promise<WallReport> {
  const knowledge = await loadKnowledge();
  const tools = buildToolIndex(knowledge);
  const activities = computeToolActivity(tools, wallConfig.dormantThresholdDays);

  const activeTools = activities.filter(a => a.status === 'active');
  const dormantTools = activities.filter(a => a.status === 'dormant');
  const risingTools = activities.filter(a => a.status === 'rising');
  const newTools = activities.filter(a => a.status === 'new');

  // Sort by relevance
  activeTools.sort((a, b) => b.recentMentions - a.recentMentions);
  dormantTools.sort((a, b) => b.daysSinceLastMention - a.daysSinceLastMention);
  risingTools.sort((a, b) => b.recentMentions - a.recentMentions);

  return {
    generatedAt: new Date().toISOString(),
    totalTools: tools.length,
    activeTools,
    dormantTools,
    risingTools,
    newTools,
    recentMatches: wallConfig.pendingMatches.slice(0, 10),
  };
}

/** Format full wall report for Telegram */
export function formatWallMessage(report: WallReport): string {
  const lines: string[] = ['🧱 AI 工具情報牆', ''];
  lines.push(`📊 追蹤中：${report.totalTools} 個工具/框架`);
  lines.push('');

  // Rising tools
  if (report.risingTools.length > 0) {
    lines.push('🚀 【快速上升】');
    for (const t of report.risingTools.slice(0, 5)) {
      lines.push(`  • ${t.name}：近期 ${t.recentMentions} 次提及（共 ${t.totalMentions} 次）`);
    }
    lines.push('');
  }

  // New tools
  if (report.newTools.length > 0) {
    lines.push('🆕 【新收藏】');
    for (const t of report.newTools.slice(0, 5)) {
      lines.push(`  • ${t.name}（${t.totalMentions} 次提及）`);
    }
    lines.push('');
  }

  // Active tools
  if (report.activeTools.length > 0) {
    lines.push('✅ 【活躍工具】');
    for (const t of report.activeTools.slice(0, 5)) {
      lines.push(`  • ${t.name}：近期 ${t.recentMentions} 次（共 ${t.totalMentions} 次）`);
    }
    lines.push('');
  }

  // Dormant tools
  if (report.dormantTools.length > 0) {
    lines.push('💤 【沉睡工具】（超過 30 天未提及）');
    for (const t of report.dormantTools.slice(0, 5)) {
      lines.push(`  • ${t.name}：已 ${t.daysSinceLastMention} 天未提及`);
    }
    if (report.dormantTools.length > 5) {
      lines.push(`  ...還有 ${report.dormantTools.length - 5} 個`);
    }
    lines.push('');
  }

  // Recent matches from radar
  if (report.recentMatches.length > 0) {
    lines.push('🔗 【新發現比對】');
    for (const m of report.recentMatches.slice(0, 5)) {
      const top = m.matchedExisting[0];
      if (!top) continue;
      const rel = top.relation === 'alternative' ? '可取代' : '可補強';
      lines.push(`  • ${m.newToolName} → ${rel} ${top.name}（相似度 ${Math.round(top.similarity * 100)}%）`);
    }
    lines.push('');
  }

  if (report.summary) {
    lines.push('💡 【AI 洞察】');
    lines.push(report.summary);
  }

  return lines.join('\n');
}

/** Format a short summary section for proactive digest integration */
export function formatWallSummaryForDigest(wallConfig: WallConfig): string[] {
  const matches = wallConfig.pendingMatches;
  if (matches.length === 0) return [];

  const lines: string[] = ['🧱 【情報牆發現】'];
  for (const m of matches.slice(0, 3)) {
    const top = m.matchedExisting[0];
    if (!top) continue;
    const rel = top.relation === 'alternative' ? '取代' : '補強';
    lines.push(`  • ${m.newToolName} → ${rel} ${top.name}`);
  }
  if (matches.length > 3) lines.push(`  ...共 ${matches.length} 個比對`);
  lines.push('');
  return lines;
}

/** Strip LLM thinking/reasoning blocks from output, keep only the actual content. */
function stripThinkingBlocks(text: string): string {
  // Remove <think>...</think> blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove "Thinking Process:" or similar English reasoning headers and everything after
  cleaned = cleaned.replace(/\n*(?:Thinking Process|思考過程|Reasoning|Analysis):[\s\S]*/i, '');
  // Remove markdown bold/header artifacts
  cleaned = cleaned.replace(/^[#*\s]+/gm, '').trim();
  return cleaned;
}

/** Generate optional AI insight for the wall report */
async function generateWallInsight(report: WallReport): Promise<string | undefined> {
  if (report.totalTools < 5) return undefined;

  const rising = report.risingTools.slice(0, 3).map(t => t.name).join('、');
  const dormant = report.dormantTools.slice(0, 3).map(t => t.name).join('、');
  const prompt = [
    '你是知識管理助手。請直接用繁體中文回覆，不要輸出任何思考過程或分析步驟。',
    '根據以下工具追蹤資料，寫一段 80 字以內的洞察摘要。只輸出摘要本身，不要加標題或前綴。',
    '',
    rising ? `快速上升工具：${rising}` : '',
    dormant ? `沉睡工具：${dormant}` : '',
    `追蹤中工具總數：${report.totalTools}`,
    '重點：用戶的工具使用趨勢、建議關注或清理的方向。',
  ].filter(Boolean).join('\n');

  try {
    const raw = await runLocalLlmPrompt(prompt, { timeoutMs: 20_000, model: 'flash', maxTokens: 256 });
    if (!raw) return undefined;
    const cleaned = stripThinkingBlocks(raw);
    return cleaned || undefined;
  } catch {
    return undefined;
  }
}

/** Run scheduled wall push cycle */
async function runWallPushCycle(
  bot: Telegraf, config: AppConfig, wallConfig: WallConfig,
): Promise<void> {
  const now = Date.now();
  const intervalMs = wallConfig.pushIntervalHours * 3_600_000;

  if (wallConfig.lastPushAt) {
    const lastTs = new Date(wallConfig.lastPushAt).getTime();
    if (now - lastTs < intervalMs) return;
  }

  logger.info('wall', '開始生成情報牆推送');

  try {
    const report = await generateWallReport(wallConfig);
    report.summary = await generateWallInsight(report);

    const userId = getOwnerUserId(config);
    if (userId && report.totalTools > 0) {
      const msg = formatWallMessage(report);
      await bot.telegram.sendMessage(userId, msg.slice(0, 4000));
    }

    // Clear pending matches after push
    wallConfig.pendingMatches = [];
    wallConfig.lastPushAt = new Date().toISOString();
    await saveWallConfig(wallConfig);
    logger.info('wall', '情報牆推送完成', { tools: report.totalTools });
  } catch (err) {
    logger.warn('wall', '情報牆推送失敗', { message: (err as Error).message });
  }
}

/** Start the wall background service */
export async function startWallService(
  bot: Telegraf, config: AppConfig,
): Promise<NodeJS.Timeout[]> {
  const wallConfig = await loadWallConfig();
  if (!wallConfig.enabled) {
    logger.info('wall', '情報牆已停用');
    return [];
  }

  const checkMs = 4 * 60 * 60 * 1000; // Check every 4 hours
  const timer = setInterval(
    () => { runWallPushCycle(bot, config, wallConfig).catch(() => {}); },
    checkMs,
  );

  logger.info('wall', '情報牆服務啟動', { interval: `${wallConfig.pushIntervalHours}h` });
  return [timer];
}

/** Add match results to pending in batch (called from radar-service) */
export async function addPendingMatches(matches: ToolMatchResult[]): Promise<void> {
  if (matches.length === 0) return;
  const wallConfig = await loadWallConfig();
  wallConfig.pendingMatches.push(...matches);
  if (wallConfig.pendingMatches.length > MAX_PENDING_MATCHES) {
    wallConfig.pendingMatches = wallConfig.pendingMatches.slice(-MAX_PENDING_MATCHES);
  }
  await saveWallConfig(wallConfig);
}
