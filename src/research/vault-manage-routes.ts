/**
 * Vault 筆記管理 API — 查看、改名、刪除、移動筆記。
 * 掛載於 /api/vault/* 路由，由 research-routes.ts 呼叫。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, rename, unlink, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, basename, relative, resolve } from 'node:path';

const SKIP_FOLDERS = new Set(['.obsidian', '.trash', 'attachments', 'node_modules', '.git', 'MOC', '知識整合']);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => res(body));
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function getVaultPath(): string {
  return process.env['VAULT_PATH'] || '';
}

/** 驗證路徑不超出 vault 範圍 */
function safeFull(vaultPath: string, notePath: string): string | null {
  const full = resolve(join(vaultPath, notePath));
  if (!full.startsWith(resolve(vaultPath) + '/') && full !== resolve(vaultPath)) return null;
  return full;
}

/** 遞迴取得 Vault 所有子資料夾（相對路徑） */
async function getFolders(vaultPath: string): Promise<string[]> {
  const folders: string[] = ['.'];

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || SKIP_FOLDERS.has(e.name) || e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        folders.push(relative(vaultPath, full));
        await walk(full);
      }
    } catch { /* skip inaccessible */ }
  }

  await walk(vaultPath);
  return folders.sort();
}

/* ── 路由 ──────────────────────────────────────────────────── */

export async function handleVaultManageRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';
  const params = new URL(`http://x${req.url ?? '/'}`).searchParams;

  // GET /api/vault/folders — 取得所有資料夾清單（用於移動選單）
  if (url === '/api/vault/folders' && method === 'GET') {
    const vp = getVaultPath();
    if (!vp) { json(res, []); return true; }
    json(res, await getFolders(vp));
    return true;
  }

  // GET /api/vault/note?path=... — 讀取筆記 body
  if (url === '/api/vault/note' && method === 'GET') {
    const vp = getVaultPath();
    const notePath = params.get('path') ?? '';
    if (!vp || !notePath) { json(res, { error: '缺少參數' }, 400); return true; }
    const full = safeFull(vp, notePath);
    if (!full) { json(res, { error: '非法路徑' }, 400); return true; }
    try {
      const raw = await readFile(full, 'utf-8');
      const fmMatch = raw.match(/^---\n[\s\S]*?\n---/);
      const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
      json(res, { body });
    } catch { json(res, { error: '讀取失敗' }, 500); }
    return true;
  }

  // PUT /api/vault/note?path=... body:{name} — 改名（保留原資料夾）
  if (url === '/api/vault/note' && method === 'PUT') {
    const vp = getVaultPath();
    const notePath = params.get('path') ?? '';
    if (!vp || !notePath) { json(res, { error: '缺少參數' }, 400); return true; }
    const body = JSON.parse(await readBody(req)) as { name?: string };
    const newName = (body.name ?? '').trim().replace(/\.md$/i, '');
    if (!newName) { json(res, { error: '名稱不可為空' }, 400); return true; }
    const full = safeFull(vp, notePath);
    if (!full) { json(res, { error: '非法路徑' }, 400); return true; }
    try {
      const newRelPath = join(dirname(notePath), newName + '.md');
      const newFull = safeFull(vp, newRelPath);
      if (!newFull) { json(res, { error: '目標路徑非法' }, 400); return true; }
      await rename(full, newFull);
      json(res, { newPath: newRelPath });
    } catch (e) { json(res, { error: String(e) }, 500); }
    return true;
  }

  // DELETE /api/vault/note?path=... — 刪除筆記
  if (url === '/api/vault/note' && method === 'DELETE') {
    const vp = getVaultPath();
    const notePath = params.get('path') ?? '';
    if (!vp || !notePath) { json(res, { error: '缺少參數' }, 400); return true; }
    const full = safeFull(vp, notePath);
    if (!full) { json(res, { error: '非法路徑' }, 400); return true; }
    try {
      await unlink(full);
      json(res, { ok: true });
    } catch (e) { json(res, { error: String(e) }, 500); }
    return true;
  }

  // POST /api/vault/note/move?path=... body:{folder} — 移動到其他資料夾
  if (url === '/api/vault/note/move' && method === 'POST') {
    const vp = getVaultPath();
    const notePath = params.get('path') ?? '';
    if (!vp || !notePath) { json(res, { error: '缺少參數' }, 400); return true; }
    const body = JSON.parse(await readBody(req)) as { folder?: string };
    const targetFolder = (body.folder ?? '.').trim();
    const oldFull = safeFull(vp, notePath);
    if (!oldFull) { json(res, { error: '非法路徑' }, 400); return true; }
    try {
      const fileName = basename(notePath);
      const newDir = targetFolder === '.' ? vp : join(vp, targetFolder);
      await mkdir(newDir, { recursive: true });
      const newFull = join(newDir, fileName);
      if (!newFull.startsWith(resolve(vp))) { json(res, { error: '目標路徑非法' }, 400); return true; }
      await rename(oldFull, newFull);
      json(res, { newPath: relative(vp, newFull) });
    } catch (e) { json(res, { error: String(e) }, 500); }
    return true;
  }

  return false;
}
