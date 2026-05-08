import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getUserConfig } from '../utils/user-config.js';

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 4_000;

export interface MemoryCandidate {
  pid: number;
  rssMB: number;
  label: string;
  detail: string;
}

export interface ClaudeSessionSummary {
  pid: number;
  rssMB: number;
  cpu: number;
  elapsed: string;
  worktree: string;
}

export interface SystemHealthSnapshot {
  freeMemoryPercent: number | null;
  pressureStatus: 'healthy' | 'degraded';
  candidateCount: number;
  topCandidate: MemoryCandidate | null;
  candidates: MemoryCandidate[];
  claudeSessions: ClaudeSessionSummary[];
}

export type CleanupAction = 'omlx' | 'claude-cli' | 'trim';

export interface CleanupResult {
  action: CleanupAction;
  killedPids: number[];
}

interface PsEntry {
  pid: number;
  cpu: number;
  rssKB: number;
  elapsed: string;
  command: string;
}

function roundMB(rssKB: number): number {
  return Math.round((rssKB / 1024) * 10) / 10;
}

function parsePs(stdout: string): PsEntry[] {
  return stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        cpu: Number(match[2]),
        rssKB: Number(match[3]),
        elapsed: match[4],
        command: match[5],
      } satisfies PsEntry;
    })
    .filter((entry): entry is PsEntry => entry !== null);
}

function classifyCandidate(entry: PsEntry): MemoryCandidate | null {
  const rssMB = roundMB(entry.rssKB);
  if (/omlx serve/.test(entry.command) && rssMB >= 256) {
    return { pid: entry.pid, rssMB, label: 'oMLX', detail: 'local model server' };
  }
  if (/Virtualization\.VirtualMachine/.test(entry.command) && rssMB >= 1024) {
    return { pid: entry.pid, rssMB, label: 'Claude VM', detail: 'close Claude Desktop to reclaim' };
  }
  if (/\/claude\.app\/Contents\/MacOS\/claude /.test(entry.command) && rssMB >= 200) {
    return { pid: entry.pid, rssMB, label: 'Claude CLI', detail: 'stale worktree session' };
  }
  if (/Google Chrome Helper \(Renderer\)|Brave Browser Helper \(Renderer\)/.test(entry.command) && rssMB >= 200) {
    return { pid: entry.pid, rssMB, label: 'Browser Tab', detail: 'heavy renderer process' };
  }
  return null;
}

async function safeExec(file: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: COMMAND_TIMEOUT_MS });
    return stdout;
  } catch {
    return '';
  }
}

async function getMatchingPids(pattern: string): Promise<number[]> {
  const output = await safeExec('pgrep', ['-f', pattern]);
  return output
    .trim()
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

async function getFreeMemoryPercent(): Promise<number | null> {
  const output = await safeExec('memory_pressure', []);
  const match = output.match(/System-wide memory free percentage:\s*(\d+)%/);
  return match ? Number(match[1]) : null;
}

async function getClaudeSessions(entries: PsEntry[]): Promise<ClaudeSessionSummary[]> {
  const sessions = entries.filter((entry) => /\/claude\.app\/Contents\/MacOS\/claude /.test(entry.command));
  const results: ClaudeSessionSummary[] = [];
  for (const session of sessions) {
    const cwdOut = await safeExec('lsof', ['-a', '-d', 'cwd', '-p', String(session.pid), '-Fn']);
    const worktree = cwdOut
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1) ?? '(cwd unavailable)';
    results.push({
      pid: session.pid,
      rssMB: roundMB(session.rssKB),
      cpu: session.cpu,
      elapsed: session.elapsed,
      worktree,
    });
  }
  return results;
}

export async function getSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const [freeMemoryPercent, psOut] = await Promise.all([
    getFreeMemoryPercent(),
    safeExec('ps', ['-axo', 'pid=,%cpu=,rss=,etime=,command=']),
  ]);
  const entries = parsePs(psOut);
  const candidates = entries
    .map(classifyCandidate)
    .filter((entry): entry is MemoryCandidate => entry !== null)
    .sort((a, b) => b.rssMB - a.rssMB);
  const claudeSessions = await getClaudeSessions(entries);

  const threshold = getUserConfig().monitor.freeThresholdPercent;
  return {
    freeMemoryPercent,
    pressureStatus: freeMemoryPercent !== null && freeMemoryPercent < threshold ? 'degraded' : 'healthy',
    candidateCount: candidates.length,
    topCandidate: candidates[0] ?? null,
    candidates: candidates.slice(0, 5),
    claudeSessions,
  };
}

export async function cleanupSystemProcesses(action: CleanupAction): Promise<CleanupResult> {
  const pids = new Set<number>();
  if (action === 'omlx' || action === 'trim') {
    for (const pid of await getMatchingPids('omlx serve')) pids.add(pid);
  }
  if (action === 'claude-cli' || action === 'trim') {
    const entries = parsePs(await safeExec('ps', ['-axo', 'pid=,%cpu=,rss=,etime=,command=']));
    for (const entry of entries) {
      if (/\/claude\.app\/Contents\/MacOS\/claude /.test(entry.command)) pids.add(entry.pid);
    }
  }

  const killedPids: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      killedPids.push(pid);
    } catch {
      // ignore stale or inaccessible pids
    }
  }

  return { action, killedPids };
}
