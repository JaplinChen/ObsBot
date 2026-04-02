/**
 * OpenAI-compatible inference client.
 * Works with OpenAI, Ollama, oMLX, and any OpenAI-compatible API.
 * No SDK — pure native fetch.
 */
import { fetchWithTimeout } from './fetch-with-timeout.js';
import { getUserConfig } from './user-config.js';
import type { OpenAIProviderConfig, LlmProviderKey } from './user-config.js';
import { logger } from '../core/logger.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Availability cache per provider. */
const _availCache = new Map<string, { ts: number; ok: boolean }>();
const CACHE_TTL = 30_000;

/** Check if a provider is reachable (cached). */
export async function isProviderAvailable(provider: LlmProviderKey): Promise<boolean> {
  if (provider === 'opencode' || provider === 'ddg') return false;

  const cached = _availCache.get(provider);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.ok;

  try {
    const cfg = getProviderConfig(provider);
    if (!cfg) return false;

    const url = provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models?key=${getUserConfig().llm.gemini.apiKey}`
      : `${cfg.baseUrl}/v1/models`;

    const headers: Record<string, string> = {};
    if (provider !== 'gemini' && cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetchWithTimeout(url, 5_000, { headers });
    const ok = res.ok;
    _availCache.set(provider, { ts: Date.now(), ok });
    return ok;
  } catch {
    _availCache.set(provider, { ts: Date.now(), ok: false });
    return false;
  }
}

function getProviderConfig(provider: LlmProviderKey): OpenAIProviderConfig | null {
  const llm = getUserConfig().llm;
  if (provider === 'omlx') return llm.omlx;
  if (provider === 'ollama') return llm.ollama;
  if (provider === 'openai') return llm.openai;
  return null;
}

/** Run chat completion via OpenAI-compatible API. */
export async function openaiChatCompletion(
  provider: LlmProviderKey,
  model: string,
  messages: ChatMessage[],
  opts: CompletionOptions = {},
): Promise<string | null> {
  const cfg = getProviderConfig(provider);
  if (!cfg) return null;

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');

  // Ollama uses /v1/chat/completions (OpenAI-compatible mode)
  const endpoint = provider === 'ollama'
    ? `${baseUrl}/v1/chat/completions`
    : `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.3,
  });

  try {
    const res = await fetchWithTimeout(endpoint, timeoutMs, {
      method: 'POST', headers, body,
    });
    if (!res.ok) {
      logger.warn('openai-client', `${provider} API error`, { status: res.status });
      return null;
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    logger.warn('openai-client', `${provider} request failed`, { error: (e as Error).message });
    return null;
  }
}

/** Run chat completion via Google Gemini API. */
export async function geminiChatCompletion(
  model: string,
  messages: ChatMessage[],
  opts: CompletionOptions = {},
): Promise<string | null> {
  const apiKey = getUserConfig().llm.gemini.apiKey;
  if (!apiKey) return null;

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Convert ChatMessage[] to Gemini format
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const systemText = messages.find((m) => m.role === 'system')?.content;
  const body: Record<string, unknown> = { contents };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }
  body.generationConfig = {
    maxOutputTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.3,
  };

  try {
    const res = await fetchWithTimeout(url, timeoutMs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn('gemini', 'API error', { status: res.status });
      return null;
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (e) {
    logger.warn('gemini', 'request failed', { error: (e as Error).message });
    return null;
  }
}
