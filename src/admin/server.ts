import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { getUserConfig, updateUserConfig } from '../utils/user-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const ENV_PATH = join(__dirname, '../../.env');
const RAW_HTML = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

// One-time session token — invalidates when the server restarts
const SESSION_TOKEN = randomBytes(16).toString('hex');

// Inject a fetch interceptor that forwards the token from the URL to all /api/ calls
const TOKEN_SCRIPT = `<script>
(function(){
  var _tok=new URLSearchParams(location.search).get('token')||'';
  var _orig=window.fetch.bind(window);
  window.fetch=function(url,opts){
    opts=opts||{};
    if(typeof url==='string'&&url.startsWith('/api/')){
      opts=Object.assign({},opts,{headers:Object.assign({},opts.headers,{'x-session-token':_tok})});
    }
    return _orig(url,opts);
  };
})();
</script>`;
const UI_HTML = RAW_HTML.replace('</head>', TOKEN_SCRIPT + '</head>');

function isAuthorized(req: IncomingMessage): boolean {
  return req.headers['x-session-token'] === SESSION_TOKEN;
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
  provider: string, baseUrl?: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    if (provider === 'omlx') {
      const url = (baseUrl || 'http://127.0.0.1:8000') + '/v1/models';
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => m.id);
      return { ok: true, models };
    }
    if (provider === 'ollama') {
      const url = (baseUrl || 'http://127.0.0.1:11434') + '/api/tags';
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name);
      return { ok: true, models };
    }
    if (provider === 'openai') {
      const apiKey = process.env['OPENAI_API_KEY'] ?? '';
      const url = (baseUrl || 'https://api.openai.com/v1') + '/models';
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
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

  if (url.startsWith('/api/') && !isAuthorized(req)) {
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
    const { provider, baseUrl } = JSON.parse(body) as { provider: string; baseUrl?: string };
    res.end(JSON.stringify(await detectModels(provider, baseUrl)));
    return;
  }

  // --- User config endpoints (runtime) ---
  if (url === '/api/user-config' && method === 'GET') {
    res.end(JSON.stringify(getUserConfig()));
    return;
  }

  if (url === '/api/user-config' && method === 'POST') {
    const body = await readBody(req);
    const patch = JSON.parse(body) as Record<string, unknown>;
    const updated = updateUserConfig(patch);
    res.end(JSON.stringify(updated));
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
    const url = `http://localhost:${PORT}/?token=${SESSION_TOKEN}`;
    console.log(`[admin] 管理介面已啟動：${url}`);
    if (BIND_HOST === '127.0.0.1') openBrowser(url);
  });
}

// Allow standalone execution (first-time setup)
const isMainModule = process.argv[1]?.endsWith('admin/server.js')
  || process.argv[1]?.endsWith('admin/server.ts');
if (isMainModule) startAdminServer();
