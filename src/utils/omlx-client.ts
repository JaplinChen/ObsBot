/**
 * oMLX local inference client.
 * Calls the OpenAI-compatible REST API served by `omlx serve`.
 * No SDK — pure native fetch.
 */
import { fetchWithTimeout } from './fetch-with-timeout.js';
import type { ModelTier } from './local-llm.js';

import { getUserConfig } from './user-config.js';

const AVAILABILITY_CACHE_MS = 30_000;

/** Read base URL from user config (falls back to env var → default). */
function getOmlxBase(): string {
  return getUserConfig().llm.omlx.baseUrl;
}

/** Read API key lazily so dotenv has time to load .env first. */
function getApiKey(): string {
  return process.env['OMLX_API_KEY'] ?? '';
}

/** Read model names from user config. */
function getOmlxModels(): Record<ModelTier, string> {
  return getUserConfig().llm.omlx.models;
}

/** Per-tier default timeouts (ms). Deep is longer for large model inference. */
const OMLX_TIMEOUTS: Record<ModelTier, number> = {
  flash: 15_000,
  standard: 30_000,
  deep: 120_000,
};

/** Build common headers (Content-Type + optional Authorization). */
function authHeaders(contentType?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (contentType) h['Content-Type'] = contentType;
  const key = getApiKey();
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}

/* ── Availability probe with cache ──────────────────────────────────── */

let _available: boolean | null = null;
let _checkedAt = 0;

/** Check whether oMLX serve is running (cached for 30 s). */
export async function isOmlxAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_available !== null && now - _checkedAt < AVAILABILITY_CACHE_MS) {
    return _available;
  }

  try {
    const res = await fetchWithTimeout(`${getOmlxBase()}/v1/models`, 3_000, {
      headers: authHeaders(),
    });
    _available = res.ok;
  } catch {
    _available = false;
  }
  _checkedAt = now;
  return _available;
}

/** Reset availability cache (e.g. after oMLX goes down mid-request). */
function invalidateCache(): void {
  _available = null;
  _checkedAt = 0;
}

/* ── Batch mode guard ──────────────────────────────────────────────── */


/* ── Model selection ────────────────────────────────────────────────── */

/** Get the oMLX model ID for a given tier. */
export function getOmlxModelId(tier: ModelTier): string {
  return getOmlxModels()[tier];
}

/** Get the default timeout for a given tier. */
export function getOmlxTimeout(tier: ModelTier): number {
  return OMLX_TIMEOUTS[tier];
}

const OMLX_VISION_MODEL = 'Qwen2.5-VL-7B-Instruct-4bit';

/* ── Shared response parser ─────────────────────────────────────────── */

async function parseOmlxContent(res: Response, label: string): Promise<string | null> {
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (content) {
    console.log(`[${label}] ✓ (${content.length} chars)`);
  }
  return content || null;
}

/* ── Chat completion ────────────────────────────────────────────────── */

interface OmlxOptions {
  model?: ModelTier;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  /** Optional system prompt injected before the user message. */
  systemPrompt?: string;
}

/**
 * Send a prompt to oMLX and return the assistant reply.
 * Returns null on any error (caller should fallback).
 */
export async function omlxChatCompletion(
  prompt: string,
  options: OmlxOptions = {},
): Promise<string | null> {
  const tier = options.model ?? 'standard';
  const modelId = getOmlxModelId(tier);
  const timeoutMs = options.timeoutMs ?? getOmlxTimeout(tier);

  const isQwenModel = modelId.toLowerCase().includes('qwen');
  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });
  const body = JSON.stringify({
    model: modelId,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    // Disable reasoning/thinking for Qwen models — 10x+ faster
    ...(isQwenModel ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  });

  try {
    const res = await fetchWithTimeout(`${getOmlxBase()}/v1/chat/completions`, timeoutMs, {
      method: 'POST',
      headers: authHeaders('application/json'),
      body,
    });

    if (!res.ok) {
      console.error(`[omlx] HTTP ${res.status} for model ${modelId}`);
      invalidateCache();
      return null;
    }

    return parseOmlxContent(res, `omlx:${modelId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // AbortError = timeout; ECONNREFUSED = server down
    if (msg.includes('abort') || msg.includes('ECONNREFUSED')) {
      invalidateCache();
    }
    console.error(`[omlx] error: ${msg}`);
    return null;
  }
}

/* ── Streaming completion ───────────────────────────────────────────── */

/**
 * Stream a chat completion from oMLX via SSE.
 * Yields partial text chunks as they arrive.
 * Returns immediately (yields nothing) on any connection error.
 */
export async function* omlxStreamCompletion(
  prompt: string,
  options: OmlxOptions = {},
): AsyncGenerator<string> {
  const tier = options.model ?? 'standard';
  const modelId = getOmlxModelId(tier);
  const timeoutMs = options.timeoutMs ?? getOmlxTimeout(tier);
  const isQwenModel = modelId.toLowerCase().includes('qwen');

  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const body = JSON.stringify({
    model: modelId,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
    ...(isQwenModel ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${getOmlxBase()}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders('application/json'),
      body,
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) { invalidateCache(); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch { /* skip malformed SSE line */ }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED')) invalidateCache();
    // AbortError (timeout) — stop silently
  } finally {
    clearTimeout(timer);
  }
}

/* ── Vision completion ──────────────────────────────────────────────── */

/**
 * Analyze a local image via oMLX vision model (Qwen2.5-VL).
 * Reads the file as base64 and sends via OpenAI vision API format.
 * Returns null on any error (caller should fallback).
 */
export async function omlxVisionCompletion(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  timeoutMs = 30_000,
): Promise<string | null> {
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const body = JSON.stringify({
    model: OMLX_VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    temperature: 0.3,
    max_tokens: 1024,
  });

  try {
    const res = await fetchWithTimeout(`${getOmlxBase()}/v1/chat/completions`, timeoutMs, {
      method: 'POST',
      headers: authHeaders('application/json'),
      body,
    });

    if (!res.ok) {
      console.error(`[omlx-vision] HTTP ${res.status}`);
      invalidateCache();
      return null;
    }

    return parseOmlxContent(res, `omlx-vision:${OMLX_VISION_MODEL}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('ECONNREFUSED')) {
      invalidateCache();
    }
    console.error(`[omlx-vision] error: ${msg}`);
    return null;
  }
}
