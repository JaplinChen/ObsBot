import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateUserConfig, getUserConfig } from '../utils/user-config.js';
import { getMetricsSummary } from '../core/metrics.js';
import { getBreakerStatus } from '../monitoring/circuit-breaker.js';
import { handleResearchRequest, injectResearchLocales } from '../research/research-routes.js';
import {
  readEnv, writeEnv, findVaults, testToken,
  readBody, openBrowser, detectModels,
} from './admin-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const RAW_HTML = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

/* ── i18n ───────────────────────────────────────────────────────────── */
function loadLocales(): Record<string, Record<string, string>> {
  const localeDir = join(__dirname, 'locales');
  const locales: Record<string, Record<string, string>> = {};
  for (const lang of ['zh-TW', 'en', 'vi']) {
    const file = join(localeDir, `${lang}.json`);
    if (existsSync(file)) {
      locales[lang] = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>;
    }
  }
  return locales;
}

const LOCALES = loadLocales();
const LOCALES_JSON = JSON.stringify(LOCALES);
injectResearchLocales(LOCALES_JSON);
const UI_HTML = RAW_HTML.replace(
  '/* __LOCALES_INJECT__ */',
  `var _locales = ${JSON.stringify(LOCALES)};`,
);

/* ── Access control ─────────────────────────────────────────────────── */
function isAllowed(req: IncomingMessage): boolean {
  if (BIND_HOST === '0.0.0.0') return true;
  const remote = req.socket.remoteAddress ?? '';
  return remote === '127.0.0.1' || remote === '::1' || remote.startsWith('::ffff:127.');
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

  if (url === '/research' || url.startsWith('/api/research/')) {
    if (url.startsWith('/api/') && !isAllowed(req)) {
      res.statusCode = 403; res.end(JSON.stringify({ error: 'Unauthorized' })); return;
    }
    if (await handleResearchRequest(req, res)) return;
  }

  if (url.startsWith('/api/') && !isAllowed(req)) {
    res.statusCode = 403; res.end(JSON.stringify({ error: 'Unauthorized' })); return;
  }

  // .env config (setup)
  if (url === '/api/config' && method === 'GET') {
    const env = readEnv();
    res.end(JSON.stringify({ BOT_TOKEN_set: !!env.BOT_TOKEN, VAULT_PATH: env.VAULT_PATH ?? '', ALLOWED_USER_IDS: env.ALLOWED_USER_IDS ?? '' }));
    return;
  }
  if (url === '/api/config' && method === 'POST') {
    const data = JSON.parse(await readBody(req)) as { BOT_TOKEN?: string; VAULT_PATH?: string; ALLOWED_USER_IDS?: string };
    const existing = readEnv();
    const updated: Record<string, string> = { BOT_TOKEN: data.BOT_TOKEN || existing.BOT_TOKEN || '', VAULT_PATH: data.VAULT_PATH || existing.VAULT_PATH || '' };
    const rawIds = (data.ALLOWED_USER_IDS ?? existing.ALLOWED_USER_IDS ?? '').replace(/[^0-9,]/g, '');
    if (rawIds) updated.ALLOWED_USER_IDS = rawIds;
    writeEnv(updated);
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url === '/api/vaults' && method === 'GET') { res.end(JSON.stringify({ vaults: findVaults() })); return; }
  if (url === '/api/test-token' && method === 'POST') {
    const { token } = JSON.parse(await readBody(req)) as { token: string };
    res.end(JSON.stringify(await testToken(token)));
    return;
  }

  // LLM model detection
  if (url === '/api/llm/models' && method === 'POST') {
    const { provider, baseUrl, apiKey: reqKey } = JSON.parse(await readBody(req)) as { provider: string; baseUrl?: string; apiKey?: string };
    res.end(JSON.stringify(await detectModels(provider, baseUrl, reqKey)));
    return;
  }

  // User config (runtime)
  if (url === '/api/user-config' && method === 'GET') {
    const cfg = JSON.parse(JSON.stringify(getUserConfig())) as Record<string, unknown>;
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
    res.end(JSON.stringify(updateUserConfig(JSON.parse(await readBody(req)) as Record<string, unknown>)));
    return;
  }

  // Dashboard (runtime monitoring)
  if (url === '/api/status' && method === 'GET') {
    const mem = process.memoryUsage();
    res.end(JSON.stringify({ uptime: Math.round(process.uptime()), heapMB: Math.round(mem.heapUsed / 1024 / 1024), rssMB: Math.round(mem.rss / 1024 / 1024), pid: process.pid, nodeVersion: process.version, breakers: getBreakerStatus() }));
    return;
  }
  if (url === '/api/metrics' && method === 'GET') {
    const hours = parseInt(new URL(`http://x${req.url}`).searchParams.get('hours') ?? '24');
    res.end(JSON.stringify(await getMetricsSummary(hours)));
    return;
  }
  if (url === '/api/health' && method === 'GET') {
    const mem = process.memoryUsage();
    const openBreakers = getBreakerStatus().filter(b => b.status === 'open');
    const healthy = openBreakers.length < 5 && mem.heapUsed < 1024 * 1024 * 1024;
    res.statusCode = healthy ? 200 : 503;
    res.end(JSON.stringify({ status: healthy ? 'healthy' : 'degraded', uptime: Math.round(process.uptime()), heapMB: Math.round(mem.heapUsed / 1024 / 1024), openBreakers: openBreakers.length }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}

/* ── Server lifecycle ───────────────────────────────────────────────── */
const BIND_HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

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

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[admin] 端口 ${PORT} 已被佔用，管理介面略過（Bot 其他功能正常運行）`);
    } else {
      console.error('[admin] 伺服器錯誤：', err.message);
    }
  });

  server.listen(PORT, BIND_HOST, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`[admin] 管理介面已啟動：${url}`);
    if (BIND_HOST === '127.0.0.1') openBrowser(`${url}research`);
  });
}

const isMainModule = process.argv[1]?.endsWith('admin/server.js') || process.argv[1]?.endsWith('admin/server.ts');
if (isMainModule) startAdminServer();
