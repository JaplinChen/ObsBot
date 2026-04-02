import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { getUserConfig, updateUserConfig } from '../utils/user-config.js';
import { getMetricsSummary } from '../core/metrics.js';
import { getBreakerStatus } from '../monitoring/circuit-breaker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const ENV_PATH = join(__dirname, '../../.env');
const RAW_HTML = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

const UI_HTML = RAW_HTML;

/** Access control: Docker (production) allows all; local dev restricts to localhost. */
function isAllowed(req: IncomingMessage): boolean {
  // Docker: port mapping is the access control, allow all connections
  if (BIND_HOST === '0.0.0.0') return true;
  // Local dev: only allow localhost
  const remote = req.socket.remoteAddress ?? '';
  return remote === '127.0.0.1' || remote === '::1' || remote.startsWith('::ffff:127.');
}

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

function writeEnv(data: Record<string, string>): void {
  const lines = Object.entries(data)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(ENV_PATH, lines + '\n', 'utf-8');
}

function findVaults(): string[] {
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

async function testToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function openBrowser(url: string): void {
  try { new URL(url); } catch { return; }
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

/* ── LLM model detection ────────────────────────────────────────────── */

async function detectModels(
  provider: string, baseUrl?: string, apiKey?: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    // Resolve API key: request param → user-config → env var
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
      const models = (data.data ?? []).map((m) => m.id);
      return { ok: true, models };
    }
    if (provider === 'ollama') {
      const url = (baseUrl || cfg.ollama.baseUrl) + '/api/tags';
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name);
      return { ok: true, models };
    }
    if (provider === 'openai') {
      const key = resolveKey('OPENAI_API_KEY', cfg.openai.apiKey);
      const url = (baseUrl || cfg.openai.baseUrl) + '/models';
      const headers: Record<string, string> = {};
      if (key) headers['Authorization'] = `Bearer ${key}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => m.id).sort();
      return { ok: true, models };
    }
    return { ok: false, models: [], error: `不支援的 provider: ${provider}` };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}

/* ── Request handler ────────────────────────────────────────────────── */

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (url === '/' && method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(UI_HTML);
    return;
  }

  if (url.startsWith('/api/') && !isAllowed(req)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // --- .env config endpoints (setup) ---
  if (url === '/api/config' && method === 'GET') {
    const env = readEnv();
    res.end(JSON.stringify({
      BOT_TOKEN_set: !!env.BOT_TOKEN,
      VAULT_PATH: env.VAULT_PATH ?? '',
      ALLOWED_USER_IDS: env.ALLOWED_USER_IDS ?? '',
    }));
    return;
  }

  if (url === '/api/config' && method === 'POST') {
    const body = await readBody(req);
    const data = JSON.parse(body) as { BOT_TOKEN?: string; VAULT_PATH?: string; ALLOWED_USER_IDS?: string };
    const existing = readEnv();
    const updated: Record<string, string> = {
      BOT_TOKEN: data.BOT_TOKEN || existing.BOT_TOKEN || '',
      VAULT_PATH: data.VAULT_PATH || existing.VAULT_PATH || '',
    };
    const rawIds = (data.ALLOWED_USER_IDS ?? existing.ALLOWED_USER_IDS ?? '').replace(/[^0-9,]/g, '');
    if (rawIds) updated.ALLOWED_USER_IDS = rawIds;
    writeEnv(updated);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === '/api/vaults' && method === 'GET') {
    res.end(JSON.stringify({ vaults: findVaults() }));
    return;
  }

  if (url === '/api/test-token' && method === 'POST') {
    const body = await readBody(req);
    const { token } = JSON.parse(body) as { token: string };
    res.end(JSON.stringify(await testToken(token)));
    return;
  }

  // --- LLM model detection ---
  if (url === '/api/llm/models' && method === 'POST') {
    const body = await readBody(req);
    const { provider, baseUrl, apiKey: reqKey } = JSON.parse(body) as { provider: string; baseUrl?: string; apiKey?: string };
    res.end(JSON.stringify(await detectModels(provider, baseUrl, reqKey)));
    return;
  }

  // --- User config endpoints (runtime) ---
  if (url === '/api/user-config' && method === 'GET') {
    const cfg = JSON.parse(JSON.stringify(getUserConfig())) as Record<string, unknown>;
    // Merge .env API keys into response so UI shows them pre-filled
    const llm = cfg.llm as Record<string, unknown>;
    const omlx = llm.omlx as Record<string, string>;
    const openai = llm.openai as Record<string, string>;
    const gemini = llm.gemini as Record<string, string>;
    if (!omlx.apiKey && process.env['OMLX_API_KEY']) omlx.apiKey = process.env['OMLX_API_KEY'];
    if (!openai.apiKey && process.env['OPENAI_API_KEY']) openai.apiKey = process.env['OPENAI_API_KEY'];
    if (!gemini.apiKey && process.env['GEMINI_API_KEY']) gemini.apiKey = process.env['GEMINI_API_KEY'];
    res.end(JSON.stringify(cfg));
    return;
  }

  if (url === '/api/user-config' && method === 'POST') {
    const body = await readBody(req);
    const patch = JSON.parse(body) as Record<string, unknown>;
    const updated = updateUserConfig(patch);
    res.end(JSON.stringify(updated));
    return;
  }

  // --- Dashboard endpoints (runtime monitoring) ---
  if (url === '/api/status' && method === 'GET') {
    const mem = process.memoryUsage();
    res.end(JSON.stringify({
      uptime: Math.round(process.uptime()),
      heapMB: Math.round(mem.heapUsed / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      pid: process.pid,
      nodeVersion: process.version,
      breakers: getBreakerStatus(),
    }));
    return;
  }

  if (url === '/api/metrics' && method === 'GET') {
    const hours = parseInt(new URL(`http://x${req.url}`).searchParams.get('hours') ?? '24');
    res.end(JSON.stringify(await getMetricsSummary(hours)));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}

/* ── Server lifecycle ───────────────────────────────────────────────── */

const BIND_HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

/** Start Admin Server. Safe to call multiple times — only first call binds. */
let _started = false;
export function startAdminServer(): void {
  if (_started) return;
  _started = true;

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(err) }));
    });
  });

  server.listen(PORT, BIND_HOST, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`[admin] 管理介面已啟動：${url}`);
    if (BIND_HOST === '127.0.0.1') openBrowser(url);
  });
}

// Allow standalone execution (first-time setup)
const isMainModule = process.argv[1]?.endsWith('admin/server.js')
  || process.argv[1]?.endsWith('admin/server.ts');
if (isMainModule) startAdminServer();
