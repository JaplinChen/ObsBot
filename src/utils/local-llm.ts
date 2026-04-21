/**
 * LLM prompt runner with multi-provider routing.
 * Priority: oMLX (local) → OpenCode CLI (remote) → DDG AI Chat (fallback).
 */
import { spawn } from 'node:child_process';
import { runViaDdgChat } from './ddg-chat.js';
import { isOmlxAvailable, omlxChatCompletion } from './omlx-client.js';
import { resolveModelTier, type TaskType } from './model-router.js';
import { getUserConfig } from './user-config.js';
import {
  isProviderAvailable, openaiChatCompletion, geminiChatCompletion,
} from './openai-client.js';
import { loadSoul } from './soul-loader.js';
import { recordCost } from '../core/cost-tracker.js';

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
  /** Optional system prompt. Merged with SOUL.md when soul=true. */
  systemPrompt?: string;
  /** Inject SOUL.md personality. Default: false (opt-in). */
  soul?: boolean;
}

/* ── CLI provider (OpenCode + multi-model routing) ───────────────────── */

/** Concurrency semaphore: max 2 simultaneous opencode processes. */
let _cliActive = 0;
const _cliQueue: Array<() => void> = [];
const CLI_MAX_CONCURRENT = 2;

function acquireCli(): Promise<void> {
  return new Promise((resolve) => {
    if (_cliActive < CLI_MAX_CONCURRENT) {
      _cliActive++;
      resolve();
    } else {
      _cliQueue.push(() => { _cliActive++; resolve(); });
    }
  });
}

function releaseCli(): void {
  _cliActive--;
  const next = _cliQueue.shift();
  if (next) next();
}

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

  await acquireCli();
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val: string | null) => { if (!resolved) { resolved = true; resolve(val); } };

    const proc = spawn(
      'opencode',
      ['run', '-m', model],
      { timeout, stdio: ['pipe', 'pipe', 'pipe'], detached: true },
    );

    // Hard kill safety net: kill entire process group (opencode spawns inner binary)
    const killTimer = setTimeout(() => {
      try { process.kill(-proc.pid!, 'SIGKILL'); } catch { /* already dead */ }
      done(null);
    }, timeout + 5_000);

    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', () => {});

    proc.on('error', () => { clearTimeout(killTimer); releaseCli(); done(null); });
    proc.on('close', () => {
      clearTimeout(killTimer);
      releaseCli();
      const out = cleanOpenCodeOutput(stdout);
      done(out || null);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Run a prompt against LLM providers with tier-based model selection.
 * Priority chain (configurable via user-config.json):
 *   auto: oMLX → Ollama → OpenAI → Gemini → OpenCode CLI → DDG Chat
 *   specific: use only the selected provider, then DDG fallback
 *
 * A shared deadline (timeoutMs) applies across ALL provider attempts combined,
 * so sequential fallbacks cannot accumulate beyond the caller-specified limit.
 */
export async function runLocalLlmPrompt(prompt: string, options: RunOptions = {}): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const rawTier = options.task
    ? resolveModelTier(options.task, options.model)
    : (options.model ?? 'standard');
  // COST_OPTIMIZED mode: downgrade to flash unless caller explicitly forces higher tier
  const tier: ModelTier = process.env.COST_OPTIMIZED === 'true' && rawTier !== 'deep'
    ? 'flash'
    : rawTier;

  // Non-blocking cost tracking
  recordCost(tier, prompt).catch(() => { /* silent */ });
  const ocModel = getLlmModels()[tier];
  const llmCfg = getUserConfig().llm;

  // Build effective system prompt: SOUL.md (opt-in) + caller systemPrompt
  const soulText = options.soul ? await loadSoul() : '';
  const effectiveSystem = [soulText, options.systemPrompt].filter(Boolean).join('\n\n');

  const messages = [
    ...(effectiveSystem ? [{ role: 'system' as const, content: effectiveSystem }] : []),
    { role: 'user' as const, content: prompt },
  ];
  const compOpts = { timeoutMs, maxTokens: options.maxTokens };

  // Shared deadline: the entire provider chain must finish within timeoutMs.
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  // Provider attempt functions (each receives the remaining budget, not the full timeoutMs)
  const providers: Record<string, () => Promise<string | null>> = {
    omlx: async () => {
      if (!await isOmlxAvailable()) return null;
      // 507 OOM 自動降級：deep → standard → flash（flash 4B 通常可用）
      const tierOrder: ModelTier[] = ['deep', 'standard', 'flash'];
      const startIdx = tierOrder.indexOf(tier);
      const tiersToTry = startIdx >= 0 ? tierOrder.slice(startIdx) : [tier];
      for (const t of tiersToTry) {
        if (remaining() <= 0) return null;
        const result = await omlxChatCompletion(prompt, {
          model: t, timeoutMs: remaining(), maxTokens: options.maxTokens,
          systemPrompt: effectiveSystem || undefined,
        });
        if (result) return result;
      }
      return null;
    },
    ollama: async () => {
      if (!await isProviderAvailable('ollama')) return null;
      const m = llmCfg.ollama.models[tier] || llmCfg.ollama.model;
      return m ? openaiChatCompletion('ollama', m, messages, { ...compOpts, timeoutMs: remaining() }) : null;
    },
    openai: async () => {
      if (!llmCfg.openai.apiKey) return null;
      const m = llmCfg.openai.models[tier] || llmCfg.openai.model;
      return m ? openaiChatCompletion('openai', m, messages, { ...compOpts, timeoutMs: remaining() }) : null;
    },
    gemini: async () => {
      if (!llmCfg.gemini.apiKey) return null;
      return geminiChatCompletion(llmCfg.gemini.model || 'gemini-2.5-flash', messages, { ...compOpts, timeoutMs: remaining() });
    },
    opencode: async () => {
      const fullPrompt = effectiveSystem ? `${effectiveSystem}\n\n${prompt}` : prompt;
      return runViaCli(fullPrompt, remaining(), ocModel);
    },
    ddg: async () => {
      const fullPrompt = effectiveSystem ? `${effectiveSystem}\n\n${prompt}` : prompt;
      return runViaDdgChat(fullPrompt, remaining());
    },
  };

  // Walk the user-defined order, skip disabled providers or exhausted budget
  for (const key of llmCfg.order) {
    if (remaining() <= 0) break;
    if (!llmCfg.enabled[key]) continue;
    const fn = providers[key];
    if (!fn) continue;
    const result = await fn();
    if (result) return result;
  }

  return null;
}
