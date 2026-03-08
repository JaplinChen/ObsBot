import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const ENV_PATH = join(__dirname, '../../.env');
const RAW_HTML = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

// One-time session token ??invalidates when the server restarts
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

// Validate session token for API requests
function isAuthorized(req: IncomingMessage): boolean {
  return req.headers['x-session-token'] === SESSION_TOKEN;
}

// è§?? .env æª”æ?
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

// å¯«å…¥ .env æª”æ?
function writeEnv(data: Record<string, string>): void {
  const lines = Object.entries(data)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(ENV_PATH, lines + '\n', 'utf-8');
}

// ?ƒæ? Obsidian Vaultï¼ˆå« .obsidian è³‡æ?å¤¾ç??®é?ï¼?
function findVaults(): string[] {
  const home = homedir();
  const searchPaths = [
    join(home, 'Documents'),
    join(home, 'OneDrive'),
    join(home, 'Desktop'),
    home,
  ];
  const vaults: string[] = [];
  for (const base of searchPaths) {
    if (!existsSync(base)) continue;
    try {
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const vaultPath = join(base, entry.name);
        if (existsSync(join(vaultPath, '.obsidian'))) {
          vaults.push(vaultPath.replace(/\\/g, '/'));
        }
      }
    } catch { /* è·³é??¡æ??ç›®??*/ }
  }
  return vaults;
}

// æ¸¬è©¦ Telegram Bot Token
async function testToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (data.ok && data.result) return { ok: true, username: data.result.username };
    return { ok: false, error: 'Token ?¡æ?ï¼Œè?ç¢ºè??¯å¦è¤‡è£½å®Œæ•´' };
  } catch {
    return { ok: false, error: '???å¤±æ?ï¼Œè?ç¢ºè?ç¶²è·¯???' };
  }
}

// è®€??request body
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

// ?‹å??è¦½?¨ï?Windowsï¼‰â€?ä½¿ç”¨ spawn ?¿å? shell æ³¨å…¥
function openBrowser(url: string): void {
  try {
    new URL(url); // é©—è? URL ?¼å?
  } catch {
    return;
  }
  // cmd /c start "" <url> ??ç©ºå?ä¸?title ?¿å? start èª¤åˆ¤ URL ?«ç‰¹æ®Šå???  spawn('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = (req.url ?? '/').split('?')[0]; // strip query string for routing
  const method = req.method ?? 'GET';

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // è¨­å??é¢ï¼ˆä??€ token ??HTML è¼‰å…¥å¾Œæ?å¾?URL ?–å? tokenï¼?
  if (url === '/' && method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(UI_HTML);
    return;
  }

  // ?€??/api/ ç«¯é??€è¦æ??ˆç? session token
  if (url.startsWith('/api/') && !isAuthorized(req)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // è®€?–ç¾?‰è¨­å®šï?Token ?®è”½é¡¯ç¤ºï¼?
  if (url === '/api/config' && method === 'GET') {
    const env = readEnv();
    res.end(JSON.stringify({
      BOT_TOKEN_set: !!env.BOT_TOKEN,
      VAULT_PATH: env.VAULT_PATH ?? '',
      ALLOWED_USER_IDS: env.ALLOWED_USER_IDS ?? '',
    }));
    return;
  }

  // ?²å?è¨­å?
  if (url === '/api/config' && method === 'POST') {
    const body = await readBody(req);
    const data = JSON.parse(body) as {
      BOT_TOKEN?: string;
      VAULT_PATH?: string;
      ALLOWED_USER_IDS?: string;
    };
    const existing = readEnv();
    const updated: Record<string, string> = {
      BOT_TOKEN: data.BOT_TOKEN || existing.BOT_TOKEN || '',
      VAULT_PATH: data.VAULT_PATH || existing.VAULT_PATH || '',
    };
    // Sanitize: keep only digits and commas
    const rawIds = (data.ALLOWED_USER_IDS ?? existing.ALLOWED_USER_IDS ?? '').replace(/[^0-9,]/g, '');
    if (rawIds) updated.ALLOWED_USER_IDS = rawIds;
    writeEnv(updated);
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => server.close(), 2000);
    return;
  }

  // ?ƒæ? Obsidian Vaults
  if (url === '/api/vaults' && method === 'GET') {
    res.end(JSON.stringify({ vaults: findVaults() }));
    return;
  }

  // æ¸¬è©¦ Telegram Token
  if (url === '/api/test-token' && method === 'POST') {
    const body = await readBody(req);
    const { token } = JSON.parse(body) as { token: string };
    const result = await testToken(token);
    res.end(JSON.stringify(result));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n??è¨­å??é¢å·²é??Ÿï?http://localhost:${PORT}/?token=${SESSION_TOKEN}`);
  console.log('   ï¼ˆè‹¥?è¦½?¨æœª?ªå??‹å?ï¼Œè??‹å??å?ä¸Šæ–¹ç¶²å?ï¼‰\n');
  openBrowser(`http://localhost:${PORT}/?token=${SESSION_TOKEN}`);
});




