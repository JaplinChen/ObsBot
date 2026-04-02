/**
 * LLM prompt runner with multi-provider routing.
 * Priority: oMLX (local) → OpenCode CLI (remote) → DDG AI Chat (fallback).
 */
import { spawn } from 'node:child_process';
import { runViaDdgChat } from './ddg-chat.js';
import { isOmlxAvailable, omlxChatCompletion } from './omlx-client.js';
import { resolveModelTier, type TaskType } from './model-router.js';
import { getUserConfig } from './user-config.js';

/** Read CLI timeout from user config. */
function getCliTimeout(): number {
  return getUserConfig().llm.opencode.timeoutMs;
}

/** Read OpenCode model names from user config. */
function getLlmModels(): Record<ModelTier, string> {
  return getUserConfig().llm.opencode.models;
}

export type ModelTier = 'flash' | 'standard' | 'deep';
export type { TaskType } from './model-router.js';

interface RunOptions {
  timeoutMs?: number;
  /** Model tier for routing. Default: 'standard'. */
  model?: ModelTier;
  /** Semantic task type — auto-resolves to optimal tier via model-router. */
  task?: TaskType;
  /** Max tokens for oMLX inference. Default: 4096. */
  maxTokens?: number;
}

/* ── CLI provider (OpenCode + multi-model routing) ───────────────────── */

/** Strip ANSI escape codes and opencode banner lines from output. */
export function cleanOpenCodeOutput(raw: string): string {
  const noAnsi = raw.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = noAnsi.split('\n').filter(
    (line) => !line.startsWith('> ') && line.trim().length > 0,
  );
  return lines.join('\n').trim();
}

/** Run prompt via OpenCode CLI using stdin pipe. */
async function runViaCli(prompt: string, timeoutMs: number, model: string): Promise<string | null> {
  const timeout = Math.min(timeoutMs, getCliTimeout());

  return new Promise((resolve) => {
    let resolved = false;
    const done = (val: string | null) => { if (!resolved) { resolved = true; resolve(val); } };

    const proc = spawn(
      'opencode',
      ['run', '-m', model],
      { timeout, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // Hard kill safety net: SIGKILL if spawn's timeout (SIGTERM) didn't work
    const killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      done(null);
    }, timeout + 5_000);

    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', () => {});

    proc.on('error', () => { clearTimeout(killTimer); done(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      const out = cleanOpenCodeOutput(stdout);
      done(out || null);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Run a prompt against LLM providers with tier-based model selection.
 * Priority: oMLX (local, tier-aware) → OpenCode CLI (remote) → DDG AI Chat.
 */
export async function runLocalLlmPrompt(prompt: string, options: RunOptions = {}): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const tier = options.task
    ? resolveModelTier(options.task, options.model)
    : (options.model ?? 'standard');
  const model = getLlmModels()[tier];

  // 1) oMLX local inference (tier-aware: flash→4B, standard→9B, deep→27B)
  if (await isOmlxAvailable()) {
    const omlxResult = await omlxChatCompletion(prompt, { model: tier, timeoutMs, maxTokens: options.maxTokens });
    if (omlxResult) return omlxResult;
  }

  // 2) OpenCode CLI with best-performing model per tier
  const cliResult = await runViaCli(prompt, timeoutMs, model);
  if (cliResult) return cliResult;

  // 3) Fallback to DuckDuckGo AI Chat via Camoufox (free, slower)
  const ddgResult = await runViaDdgChat(prompt, timeoutMs);
  if (ddgResult) return ddgResult;

  return null;
}
