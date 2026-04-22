/**
 * 從 macOS Chrome 的 SQLite cookie 資料庫讀取登入 Cookie。
 * 解密流程：Keychain 取得密碼 → PBKDF2 衍生 AES key → AES-128-CBC 解密。
 * 提供 X cookie 直接 fetch，以及通用 injectChromeCookies 供 Camoufox 使用。
 */
import { execSync } from 'child_process';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { cpSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

const CHROME_COOKIE_DB = join(
  homedir(),
  'Library/Application Support/Google/Chrome/Default/Cookies',
);
const SALT = 'saltysalt';
const IV = Buffer.alloc(16, 0x20);

export interface XCookies {
  ct0: string;
  auth_token: string;
}

function deriveKey(): Buffer {
  const password = execSync('security find-generic-password -s "Chrome Safe Storage" -w 2>/dev/null')
    .toString().trim();
  return pbkdf2Sync(password, SALT, 1003, 16, 'sha1');
}

function decrypt(encrypted: Buffer, key: Buffer): string {
  if (!encrypted?.length) return '';
  if (encrypted.slice(0, 3).toString() !== 'v10') return encrypted.toString();
  const decipher = createDecipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([decipher.update(encrypted.slice(3)), decipher.final()]).toString();
}

interface RawCookieRow {
  name: string;
  encrypted_value: Buffer;
  host_key: string;
  path: string;
  is_httponly: number;
  is_secure: number;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
}

async function openChromeDb() {
  const tmp = join(tmpdir(), 'kp-chrome-cookies.db');
  cpSync(CHROME_COOKIE_DB, tmp);
  const { default: Database } = await import('better-sqlite3');
  return new Database(tmp, { readonly: true });
}

/** 讀取指定 host 的所有 Chrome cookie（含 HttpOnly） */
export async function readCookiesForDomain(hostPattern: string): Promise<BrowserCookie[]> {
  if (!existsSync(CHROME_COOKIE_DB)) return [];
  try {
    const key = deriveKey();
    const db = await openChromeDb();
    const rows = db.prepare(
      `SELECT name, encrypted_value, host_key, path, is_httponly, is_secure
       FROM cookies WHERE host_key LIKE ?`
    ).all(`%${hostPattern}`) as RawCookieRow[];
    db.close();
    return rows
      .map(r => ({ name: r.name, value: decrypt(r.encrypted_value, key), domain: r.host_key, path: r.path, httpOnly: r.is_httponly === 1, secure: r.is_secure === 1 }))
      .filter(c => c.value);
  } catch { return []; }
}

/** 將 Chrome cookie 注入 Camoufox page context（呼叫前 page 尚未 goto） */
export async function injectChromeCookies(
  page: import('playwright-core').Page,
  hostPattern: string,
): Promise<void> {
  const cookies = await readCookiesForDomain(hostPattern);
  if (cookies.length > 0) await page.context().addCookies(cookies);
}

export async function readXCookiesFromChrome(): Promise<XCookies | null> {
  if (!existsSync(CHROME_COOKIE_DB)) return null;
  try {
    const key = deriveKey();
    const db = await openChromeDb();
    const rows = db.prepare(
      `SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%x.com' AND name IN ('ct0','auth_token')`
    ).all() as Array<{ name: string; encrypted_value: Buffer }>;
    db.close();
    const map: Record<string, string> = {};
    for (const row of rows) map[row.name] = decrypt(row.encrypted_value, key);
    if (!map.ct0 || !map.auth_token) return null;
    return { ct0: map.ct0, auth_token: map.auth_token };
  } catch { return null; }
}
