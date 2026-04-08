/**
 * Admin server utilities — env I/O, vault discovery, token validation,
 * browser launcher, and LLM model detection.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import type { IncomingMessage } from 'node:http';
import { getUserConfig } from '../utils/user-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ENV_PATH = join(__dirname, '../../.env');

// ── .env helpers ─────────────────────────────────────────────────────────────

export function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

export function writeEnv(data: Record<string, string>): void {
  const lines = Object.entries(data)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(ENV_PATH, lines + '\n', 'utf-8');
}

// ── Vault discovery ───────────────────────────────────────────────────────────

export function findVaults(): string[] {
  const home = homedir();
  const searchPaths = [join(home, 'Documents'), join(home, 'Desktop'), home];
  const vaults: string[] = [];
  for (const base of searchPaths) {
    if (!existsSync(base)) continue;
    try {
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const vaultPath = join(base, entry.name);
        if (existsSync(join(vaultPath, '.obsidian'))) vaults.push(vaultPath);
      }
    } catch { /* skip */ }
  }
  return vaults;
}

// ── Telegram token test ───────────────────────────────────────────────────────

export async function testToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (data.ok && data.result) return { ok: true, username: data.result.username };
    return { ok: false, error: 'Token 無效，請確認是否複製完整' };
  } catch {
    return { ok: false, error: '連線失敗，請確認網路連線' };
  }
}

// ── HTTP body reader ──────────────────────────────────────────────────────────

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

// ── Browser launcher ──────────────────────────────────────────────────────────

const ADMIN_TAB_FLAG = join(tmpdir(), 'obsbot-admin-tab');
const TAB_REUSE_TTL_MS = 5 * 60 * 1000;

export function openBrowser(url: string): void {
  try { new URL(url); } catch { return; }
  if (existsSync(ADMIN_TAB_FLAG)) {
    const age = Date.now() - statSync(ADMIN_TAB_FLAG).mtimeMs;
    if (age < TAB_REUSE_TTL_MS) return;
  }
  writeFileSync(ADMIN_TAB_FLAG, String(Date.now()));
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

// ── LLM model detection ───────────────────────────────────────────────────────

export async function detectModels(
  provider: string, baseUrl?: string, apiKey?: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const cfg = getUserConfig().llm;
    const resolveKey = (envName: string, cfgKey?: string) =>
      apiKey || cfgKey || process.env[envName] || '';

    if (provider === 'omlx') {
      const url = (baseUrl || cfg.omlx.baseUrl) + '/v1/models';
      const key = resolveKey('OMLX_API_KEY', cfg.omlx.apiKey);
      const headers: Record<string, string> = {};
      if (key) headers['Authorization'] = `Bearer ${key}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { data?: Array<{ id: string }> };
      return { ok: true, models: (data.data ?? []).map((m) => m.id) };
    }
    if (provider === 'ollama') {
      const url = (baseUrl || cfg.ollama.baseUrl) + '/api/tags';
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { models?: Array<{ name: string }> };
      return { ok: true, models: (data.models ?? []).map((m) => m.name) };
    }
    if (provider === 'openai') {
      const key = resolveKey('OPENAI_API_KEY', cfg.openai.apiKey);
      const url = (baseUrl || cfg.openai.baseUrl) + '/models';
      const headers: Record<string, string> = {};
      if (key) headers['Authorization'] = `Bearer ${key}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { data?: Array<{ id: string }> };
      return { ok: true, models: (data.data ?? []).map((m) => m.id).sort() };
    }
    return { ok: false, models: [], error: `不支援的 provider: ${provider}` };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}
