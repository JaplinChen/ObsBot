/**
 * /radar wall command handler — display tool wall reports.
 * Invoked as sub-command of /radar.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadWallConfig } from './wall-service.js';
import { generateWallReport, formatWallMessage } from './wall-service.js';

/** Handle /radar wall [subcommand] */
export async function handleWall(ctx: Context, config: AppConfig, subArg: string): Promise<void> {
  const wallConfig = await loadWallConfig();

  if (!wallConfig.enabled) {
    await ctx.reply('⏸️ 情報牆已停用。使用 /radar wall on 啟用。');
    return;
  }

  // /radar wall on/off
  if (subArg === 'on' || subArg === 'off') {
    const { saveWallConfig } = await import('./wall-service.js');
    wallConfig.enabled = subArg === 'on';
    await saveWallConfig(wallConfig);
    await ctx.reply(wallConfig.enabled ? '✅ 情報牆已啟用' : '⏸️ 情報牆已停用');
    return;
  }

  await ctx.reply('🧱 正在生成情報牆報告...');

  const report = await generateWallReport(wallConfig);

  // Filter by subcommand
  if (subArg === 'active') {
    if (report.activeTools.length === 0 && report.risingTools.length === 0) {
      await ctx.reply('📭 目前沒有活躍的工具。');
      return;
    }
    const lines = ['✅ 活躍工具', ''];
    for (const t of [...report.risingTools, ...report.activeTools].slice(0, 15)) {
      const tag = t.status === 'rising' ? '🚀' : '✅';
      lines.push(`${tag} ${t.name}：近期 ${t.recentMentions} 次（共 ${t.totalMentions} 次）`);
    }
    await ctx.reply(lines.join('\n'));
    return;
  }

  if (subArg === 'dormant') {
    if (report.dormantTools.length === 0) {
      await ctx.reply('✅ 沒有沉睡的工具，全部都很活躍！');
      return;
    }
    const lines = ['💤 沉睡工具（超過 30 天未提及）', ''];
    for (const t of report.dormantTools.slice(0, 20)) {
      lines.push(`• ${t.name}：已 ${t.daysSinceLastMention} 天未提及（共 ${t.totalMentions} 次）`);
    }
    lines.push('', `共 ${report.dormantTools.length} 個沉睡工具`);
    await ctx.reply(lines.join('\n').slice(0, 4000));
    return;
  }

  if (subArg === 'match') {
    if (report.recentMatches.length === 0) {
      await ctx.reply('📭 最近沒有新的工具比對結果。');
      return;
    }
    const lines = ['🔗 最近工具比對', ''];
    for (const m of report.recentMatches) {
      lines.push(`📌 ${m.newToolName}`);
      for (const e of m.matchedExisting) {
        const rel = e.relation === 'alternative' ? '可取代' : '可補強';
        lines.push(`  → ${rel} ${e.name}（相似度 ${Math.round(e.similarity * 100)}%）`);
      }
      lines.push('');
    }
    await ctx.reply(lines.join('\n').slice(0, 4000));
    return;
  }

  // Default: full report
  const msg = formatWallMessage(report);
  await ctx.reply(msg.slice(0, 4000));
}
