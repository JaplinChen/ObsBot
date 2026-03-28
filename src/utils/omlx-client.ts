/**
 * oMLX local inference client.
 * Calls the OpenAI-compatible REST API served by `omlx serve`.
 * No SDK — pure native fetch.
 */
import { fetchWithTimeout } from './fetch-with-timeout.js';
import type { ModelTier } from './local-llm.js';

const OMLX_BASE = 'http://127.0.0.1:8000';
const AVAILABILITY_CACHE_MS = 30_000;

/** Read API key lazily so dotenv has time to load .env first. */
function getApiKey(): string {
  return process.env['OMLX_API_KEY'] ?? '';
}

/**
 * Map model tiers to oMLX model directory names.
 * flash: 4B Claude-distilled (fast, structured output)
 * standard: 9B Qwen3.5 (balanced)
 * deep: 27B Qwen3.5 (high quality, user-initiated only — batch mode caps to 9B)
 */
const OMLX_MODELS: Record<ModelTier, string> = {
  flash: 'MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-4bit',
  standard: 'Qwen3.5-9B-MLX-4bit',
  deep: 'Qwen3.5-27B-4bit',
};

/** Per-tier default timeouts (ms). Deep is longer for 27B inference. */
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
    const res = await fetchWithTimeout(`${OMLX_BASE}/v1/models`, 3_000, {
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

let _batchMode = false;

/** Enable/disable batch mode. Deep tier auto-downgrades to 9B in batch. */
export function setBatchMode(enabled: boolean): void {
  _batchMode = enabled;
}

/* ── Model selection ────────────────────────────────────────────────── */

/** Get the oMLX model ID for a given tier. Deep caps to 9B in batch mode. */
export function getOmlxModelId(tier: ModelTier): string {
  if (_batchMode && tier === 'deep') return OMLX_MODELS.standard;
  return OMLX_MODELS[tier];
}

/** Get the default timeout for a given tier. */
export function getOmlxTimeout(tier: ModelTier): number {
  if (_batchMode && tier === 'deep') return OMLX_TIMEOUTS.standard;
  return OMLX_TIMEOUTS[tier];
}

const OMLX_VISION_MODEL = 'Qwen2.5-VL-7B-Instruct-4bit';

/* ── Chat completion ────────────────────────────────────────────────── */

interface OmlxOptions {
  model?: ModelTier;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
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

  const body = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    // Disable reasoning/thinking for Qwen3.5 models — 10x+ faster
    chat_template_kwargs: { enable_thinking: false },
  });

  try {
    const res = await fetchWithTimeout(`${OMLX_BASE}/v1/chat/completions`, timeoutMs, {
      method: 'POST',
      headers: authHeaders('application/json'),
      body,
    });

    if (!res.ok) {
      console.error(`[omlx] HTTP ${res.status} for model ${modelId}`);
      invalidateCache();
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (content) {
      console.log(`[omlx] ✓ ${modelId} (${content.length} chars)`);
    }
    return content || null;
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
    const res = await fetchWithTimeout(`${OMLX_BASE}/v1/chat/completions`, timeoutMs, {
      method: 'POST',
      headers: authHeaders('application/json'),
      body,
    });

    if (!res.ok) {
      console.error(`[omlx-vision] HTTP ${res.status}`);
      invalidateCache();
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (content) {
      console.log(`[omlx-vision] ✓ ${OMLX_VISION_MODEL} (${content.length} chars)`);
    }
    return content || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('ECONNREFUSED')) {
      invalidateCache();
    }
    console.error(`[omlx-vision] error: ${msg}`);
    return null;
  }
}
