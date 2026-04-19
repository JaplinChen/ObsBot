/**
 * /doctor — on-demand comprehensive system diagnostics.
 * Probes all extractors, checks CLI dependencies, browser pool, and vault stats.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
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
  const statusMsg = await ctx.reply('🩺 正在執行全面診斷…\n⏳ [1/4] 探測 Extractors');
  const chatId = statusMsg.chat.id;
  const msgId = statusMsg.message_id;
  const t0 = Date.now();

  const updateProgress = async (step: number, label: string): Promise<void> => {
    const bar = ['Extractors', '外部工具', '瀏覽器池', 'Vault 統計'];
    const lines = bar.map((name, i) => {
      if (i < step - 1) return `✅ ${name}`;
      if (i === step - 1) return `⏳ ${name}`;
      return `⬜ ${name}`;
    });
    try {
      await ctx.telegram.editMessageText(
        chatId, msgId, undefined,
        `🩺 正在執行全面診斷…\n${lines.join('\n')}\n\n${label}`,
      );
    } catch { /* ignore edit race / same-content errors */ }
  };

  // 1. Probe all extractors
  await updateProgress(1, '正在探測各平台…');
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
    const detail = h.status === 'ok' ? '' : ` — ${h.lastError?.slice(0, 50) ?? h.status}`;
    const hint = h.status === 'down' ? '（可能被封鎖或平台變更）' : '';
    extractorLines.push(`${icon} ${ext.platform}${detail}${hint}`);
  }

  // 2. Check CLI dependencies
  await updateProgress(2, '正在檢查 CLI 工具…');
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const browserUseBin = isWin
    ? join(homedir(), '.browser-use-env', 'Scripts', 'browser-use.exe')
    : join(homedir(), '.browser-use-env', 'bin', 'browser-use');
  const cliChecks = await Promise.all([
    checkCli('yt-dlp', 'yt-dlp', ['--version']),
    checkCli('ffmpeg', 'ffmpeg', ['-version']),
    checkCli('browser-use', browserUseBin, ['doctor']),
  ]);

  const installHints: Record<string, string> = {
    'yt-dlp': isWin ? '安裝：winget install yt-dlp' : isMac ? '安裝：brew install yt-dlp' : '安裝：pip install yt-dlp',
    'ffmpeg': isWin ? '安裝：winget install ffmpeg' : isMac ? '安裝：brew install ffmpeg' : '安裝：apt install ffmpeg',
    'browser-use': '安裝：見 browser-use 文件',
  };

  const cliLines = cliChecks.map((c) => {
    const icon = c.available ? '✅' : '❌';
    const hint = !c.available ? ` → ${installHints[c.name] ?? ''}` : '';
    return `${icon} ${c.name}: ${c.version}${hint}`;
  });

  // 3. Camoufox pool
  await updateProgress(3, '正在檢查瀏覽器池…');
  const pool = camoufoxPool.getStats();

  // 4. Vault stats
  await updateProgress(4, '正在統計 Vault…');
  const vaultPath = config.vaultPath;
  const gtPath = join(vaultPath, 'KnowPipe');
  const attachPath = join(vaultPath, 'attachments', 'knowpipe');
  const [noteCount, attachCount] = await Promise.all([
    countFiles(gtPath, '.md'),
    countFiles(attachPath, ''),
  ]);

  // 5. Process & port snapshot
  const processLines: string[] = [];
  try {
    if (isWin) {
      // Windows: 用 tasklist 列出 node 進程
      const { stdout: taskOut } = await execFileAsync(
        'tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV'], { timeout: 3_000 },
      ).catch(() => ({ stdout: '' }));
      const rows = taskOut.split('\n').slice(1).filter(Boolean);
      for (const row of rows.slice(0, 3)) {
        const cols = row.split('","').map(s => s.replace(/"/g, ''));
        const pid = cols[1] ?? '?';
        const mem = cols[4] ? cols[4].replace(/[^\d]/g, '') : '?';
        processLines.push(`• PID ${pid} (${mem}KB) node.exe`);
      }
      // Windows port: netstat
      const { stdout: netOut } = await execFileAsync(
        'netstat', ['-ano', '-p', 'TCP'], { timeout: 3_000 },
      ).catch(() => ({ stdout: '' }));
      const portLines = netOut.split('\n')
        .filter(l => l.includes('LISTENING'))
        .slice(0, 5)
        .map(l => {
          const cols = l.trim().split(/\s+/);
          return `• ${cols[1] ?? '?'} PID:${cols[4] ?? '?'}`;
        });
      if (portLines.length > 0) processLines.push('', ...portLines);
    } else {
      // Unix: ps aux + lsof
      const { stdout: psOut } = await execFileAsync(
        'ps', ['aux'], { timeout: 3_000 },
      );
      const botProcs = psOut.split('\n').filter(
        l => /tsx.*index|node.*dist\/index/.test(l) && !l.includes('grep'),
      );
      for (const p of botProcs.slice(0, 3)) {
        const cols = p.split(/\s+/);
        const pid = cols[1];
        const mem = cols[5] ? `${Math.round(Number(cols[5]) / 1024)}MB` : '?';
        const cmd = cols.slice(10).join(' ').slice(0, 50);
        processLines.push(`• PID ${pid} (${mem}) ${cmd}`);
      }
      const { stdout: lsofOut } = await execFileAsync(
        'lsof', ['-Pan', '-iTCP:LISTEN', '-n'], { timeout: 3_000 },
      ).catch(() => ({ stdout: '' }));
      const portLines = lsofOut.split('\n')
        .filter(l => l.includes('node') || l.includes('omlx') || l.includes('tsx'))
        .slice(0, 5)
        .map(l => {
          const cols = l.split(/\s+/);
          return `• ${cols[0]} PID:${cols[1]} → ${cols[8] ?? '?'}`;
        });
      if (portLines.length > 0) processLines.push('', ...portLines);
    }
  } catch { /* 略過，不影響主報告 */ }

  // 6. Format final report (edit the same message)
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
    `🦊 ${pool.inUse}/${pool.total} 使用中${pool.inUse === pool.total && pool.total > 0 ? '（已滿，考慮 /restart）' : ''}`,
    '',
    '━━ Vault ━━',
    `📁 ${noteCount} 筆記 | ${attachCount} 附件`,
    '',
    '━━ 進程與連接埠 ━━',
    ...(processLines.length > 0 ? processLines : ['（無 KnowPipe 進程偵測到）']),
    '',
    `⏱ 診斷耗時 ${elapsed}s`,
  ];

  logger.info('doctor', '診斷完成', { elapsed, noteCount, attachCount });
  try {
    await ctx.telegram.editMessageText(
      chatId, msgId, undefined,
      lines.join('\n').slice(0, 4000),
    );
  } catch {
    await ctx.reply(lines.join('\n').slice(0, 4000));
  }
}
