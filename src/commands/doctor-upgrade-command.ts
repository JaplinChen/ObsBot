/**
 * /doctor upgrade — Scan vault notes for pipeline version mismatches.
 * Reports version distribution and optionally reprocesses outdated notes.
 *
 * Usage:
 *   adm:upgrade        → version distribution report
 *   adm:upgrade-run    → reprocess all outdated notes
 *   adm:upgrade-recent → reprocess outdated notes from last 7 days
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scanVaultNotes } from '../knowledge/knowledge-store.js';
import { PIPELINE_VERSION, VERSION_LOG } from '../pipeline/version-config.js';
import { handleReprocess } from './reprocess-command.js';
import { logger } from '../core/logger.js';

interface VersionStats {
  distribution: Record<string, number>;
  outdated: number;
  total: number;
  outdatedPaths: string[];
}

/** Read pipeline_version from a note's frontmatter. */
function extractVersion(raw: string): string | undefined {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return undefined;
  const vMatch = fmMatch[1].match(/^pipeline_version:\s*"?([^"\n]+)"?/m);
  return vMatch?.[1]?.trim();
}

/** Scan all vault notes and collect version statistics. */
async function scanVersions(vaultPath: string): Promise<VersionStats> {
  const gtPath = join(vaultPath, 'ObsBot');
  const notes = await scanVaultNotes(gtPath);
  const distribution: Record<string, number> = {};
  const outdatedPaths: string[] = [];

  for (const note of notes) {
    try {
      const raw = await readFile(note.filePath, 'utf-8');
      const version = extractVersion(raw) ?? 'none';
      distribution[version] = (distribution[version] ?? 0) + 1;
      if (version !== PIPELINE_VERSION) {
        outdatedPaths.push(note.filePath);
      }
    } catch {
      distribution['error'] = (distribution['error'] ?? 0) + 1;
    }
  }

  const outdated = outdatedPaths.length;
  return { distribution, outdated, total: notes.length, outdatedPaths };
}

/** Handle /doctor upgrade — report version distribution. */
export async function handleDoctorUpgrade(ctx: Context, config: AppConfig): Promise<void> {
  const msg = await ctx.reply('🔍 正在掃描 Vault 筆記版本…');

  const stats = await scanVersions(config.vaultPath);

  const distLines = Object.entries(stats.distribution)
    .sort(([, a], [, b]) => b - a)
    .map(([ver, count]) => {
      const current = ver === PIPELINE_VERSION ? ' ✅' : '';
      const label = ver === 'none' ? '無版本標記' : `v${ver}`;
      return `  ${label}: ${count} 篇${current}`;
    });

  const changeLog = Object.entries(VERSION_LOG)
    .map(([ver, desc]) => `  v${ver}: ${desc}`)
    .join('\n');

  const lines = [
    '📊 Pipeline 版本分佈',
    '',
    `目前版本：v${PIPELINE_VERSION}`,
    `共 ${stats.total} 篇筆記，${stats.outdated} 篇需要更新`,
    '',
    '━━ 版本分佈 ━━',
    ...distLines,
    '',
    '━━ 版本紀錄 ━━',
    changeLog,
  ];

  if (stats.outdated > 0) {
    lines.push(
      '',
      `💡 使用 /reprocess --all 重新處理所有筆記`,
      `   使用 /reprocess --all --since 7d 只處理最近 7 天`,
    );
  }

  logger.info('doctor-upgrade', '版本掃描完成', {
    total: stats.total,
    outdated: stats.outdated,
    distribution: stats.distribution,
  });

  try {
    await ctx.telegram.editMessageText(
      msg.chat.id, msg.message_id, undefined,
      lines.join('\n').slice(0, 4000),
    );
  } catch {
    await ctx.reply(lines.join('\n').slice(0, 4000));
  }
}

/** Handle upgrade-run: reprocess outdated notes via existing reprocess infra. */
export async function handleDoctorUpgradeRun(
  ctx: Context, config: AppConfig, recentOnly?: boolean,
): Promise<void> {
  const sinceSuffix = recentOnly ? ' --since 7d' : '';
  const existingMsg = ctx.message as unknown as Record<string, unknown> | undefined;
  if (existingMsg) {
    existingMsg.text = `/reprocess --all${sinceSuffix}`;
  } else {
    const cbMsg = (ctx.callbackQuery?.message ?? {}) as Record<string, unknown>;
    (ctx.update as unknown as Record<string, unknown>).message = { ...cbMsg, text: `/reprocess --all${sinceSuffix}` };
  }
  await handleReprocess(ctx, config);
}
