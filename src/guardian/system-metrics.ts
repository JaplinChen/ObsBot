import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessSnapshot {
  pid: number | null;
  rssGb: number;
}

export async function findProcess(pattern: string): Promise<ProcessSnapshot> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern]);
    const pid = Number.parseInt(stdout.split('\n')[0] ?? '', 10);
    if (!Number.isFinite(pid)) return { pid: null, rssGb: 0 };
    const { stdout: rssOut } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
    const rssKb = Number.parseInt(rssOut.trim(), 10);
    return { pid, rssGb: Number((rssKb / 1024 / 1024).toFixed(2)) };
  } catch {
    return { pid: null, rssGb: 0 };
  }
}

export async function readSwapUsedGb(): Promise<number> {
  try {
    const { stdout } = await execFileAsync('sysctl', ['vm.swapusage']);
    const match = stdout.match(/used = ([0-9.]+)([MG])?/);
    if (!match) return 0;
    const value = Number.parseFloat(match[1]);
    return Number(((match[2] ?? 'M') === 'G' ? value : value / 1024).toFixed(2));
  } catch {
    return 0;
  }
}

export async function checkHealth(url?: string): Promise<boolean> {
  if (!url) return true;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}
