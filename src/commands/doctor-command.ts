/**
 * /doctor — on-demand comprehensive system diagnostics.
 * Probes all extractors, checks CLI dependencies, browser pool, and vault stats.
 */
import type { Context } from 'telegraf';
import { VAULT_SUBFOLDER, ATTACHMENTS_SUBFOLDER, type AppConfig } from '../utils/config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getRegisteredExtractors } from '../extractors/index.js';
import { probeAllExtractors } from '../monitoring/extractor-probe.js';
import { loadMonitorConfig, saveMonitorConfig } from '../monitoring/monitor-store.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { logger } from '../core/logger.js';

const execFileAsync = promisify(execFile);

interface CliStatus {
  name: string;
  available: boolean;
  version: string;
}

async function checkCli(name: string, bin: string, args: string[]): Promise<CliStatus> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 5_000 });
    const version = stdout.trim().split('\n')[0].slice(0, 60);
    return { name, available: true, version };
  } catch {
    return { name, available: false, version: '未安裝' };
  }
}

async function countFiles(dir: string, ext: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(ext)) count++;
    }
  } catch { /* dir may not exist */ }
  return count;
}

export async function handleDoctor(ctx: Context, config: AppConfig): Promise<void> {
  await ctx.reply('🩺 正在執行全面診斷，請稍候…');
  const t0 = Date.now();

  // 1. Probe all extractors
  const extractors = getRegisteredExtractors();
  const monConfig = await loadMonitorConfig();
  const health = await probeAllExtractors(extractors, monConfig.extractorHealth);
  monConfig.extractorHealth = health;
  monConfig.lastExtractorCheckAt = new Date().toISOString();
  await saveMonitorConfig(monConfig);

  const extractorLines: string[] = [];
  for (const ext of extractors) {
    const h = health[ext.platform];
    if (!h) {
      extractorLines.push(`⬜ ${ext.platform} — 無探測 URL`);
      continue;
    }
    const icon = h.status === 'ok' ? '✅' : h.status === 'degraded' ? '⚠️' : '❌';
    const detail = h.status === 'ok'
      ? ''
      : ` — ${h.lastError?.slice(0, 50) ?? h.status}`;
    extractorLines.push(`${icon} ${ext.platform}${detail}`);
  }

  // 2. Check CLI dependencies
  const browserUseBin = join(homedir(), '.browser-use-env', 'bin', 'browser-use');
  const cliChecks = await Promise.all([
    checkCli('yt-dlp', 'yt-dlp', ['--version']),
    checkCli('ffmpeg', 'ffmpeg', ['-version']),
    checkCli('browser-use', browserUseBin, ['doctor']),
  ]);

  const cliLines = cliChecks.map((c) => {
    const icon = c.available ? '✅' : '❌';
    return `${icon} ${c.name}: ${c.version}`;
  });

  // 3. Camoufox pool
  const pool = camoufoxPool.getStats();

  // 4. Vault stats
  const vaultPath = config.vaultPath;
  const gtPath = join(vaultPath, VAULT_SUBFOLDER);
  const attachPath = join(vaultPath, 'attachments', ATTACHMENTS_SUBFOLDER);
  const [noteCount, attachCount] = await Promise.all([
    countFiles(gtPath, '.md'),
    countFiles(attachPath, ''),
  ]);

  // 5. Format report
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const lines = [
    '🩺 系統診斷報告',
    '',
    '━━ Extractor 探測 ━━',
    ...extractorLines,
    '',
    '━━ 外部工具 ━━',
    ...cliLines,
    '',
    '━━ 瀏覽器池 ━━',
    `🦊 ${pool.inUse}/${pool.total} 使用中`,
    '',
    '━━ Vault ━━',
    `📁 ${noteCount} 筆記 | ${attachCount} 附件`,
    '',
    `⏱ 診斷耗時 ${elapsed}s`,
  ];

  logger.info('doctor', '診斷完成', { elapsed, noteCount, attachCount });
  await ctx.reply(lines.join('\n').slice(0, 4000));
}
