/**
 * LLM prompt runner.
 * Priority: DDG AI Chat (Camoufox, free) → local CLI fallback.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runViaDdgChat } from './ddg-chat.js';

const execFileAsync = promisify(execFile);

export type LocalLlmProvider = 'claude' | 'codex' | 'opencode';

interface RunOptions {
  timeoutMs?: number;
}

/* ── Local CLI provider ──────────────────────────────────────────────── */

function providerArgs(provider: LocalLlmProvider, prompt: string): { cmd: string; args: string[] } {
  switch (provider) {
    case 'claude':
      return { cmd: 'claude', args: ['-p', prompt] };
    case 'codex':
      return { cmd: 'codex', args: ['-p', prompt] };
    case 'opencode':
      return { cmd: 'opencode', args: ['-p', prompt] };
    default:
      return { cmd: 'claude', args: ['-p', prompt] };
  }
}

function configuredProviders(): LocalLlmProvider[] {
  const raw = (process.env.LLM_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'claude' || raw === 'codex' || raw === 'opencode') {
    return [raw];
  }
  return ['claude', 'codex', 'opencode'];
}

function isRecoverableCliError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('ENOENT') ||
    msg.includes('not recognized') ||
    msg.includes('Unknown option') ||
    msg.includes('unknown option') ||
    msg.includes('Usage:')
  );
}

/**
 * Run a prompt against LLM providers.
 * Priority: DDG AI Chat (Camoufox) → local CLI tools.
 * Returns null when no provider succeeds.
 */
export async function runLocalLlmPrompt(prompt: string, options: RunOptions = {}): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  // 1) Try DuckDuckGo AI Chat via Camoufox (free, no login)
  const ddgResult = await runViaDdgChat(prompt, timeoutMs);
  if (ddgResult) return ddgResult;

  // 2) Fallback to local CLI providers
  const providers = configuredProviders();
  for (const provider of providers) {
    const { cmd, args } = providerArgs(provider, prompt);
    try {
      // 清除 CLAUDECODE 環境變數，避免嵌套限制阻擋 claude -p
      const env = { ...process.env };
      delete env.CLAUDECODE;
      const { stdout } = await execFileAsync(cmd, args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        env,
      });
      const out = stdout.trim();
      if (out) return out;
    } catch (err) {
      if (isRecoverableCliError(err)) {
        continue;
      }
    }
  }

  return null;
}
