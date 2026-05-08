/**
 * 研究模組 IO 路由 — 投影片匯出、Vault 儲存、Session 持久化。
 * 由 research-routes.ts 委派處理。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSlideSpec } from './slide-spec.js';
import { buildPptx } from './slide-pptx.js';
import { renderSlidePreviewHtml } from './slide-preview.js';
import { saveReportToVault } from '../knowledge/report-saver.js';

/* ── 共用工具 ────────────────────────────────────────────────── */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, content: string): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(content);
}

function parseBody<T>(raw: string, res: ServerResponse): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    json(res, { error: '請求格式錯誤（非有效 JSON）' }, 400);
    return null;
  }
}

/* ── Sessions 持久化 ──────────────────────────────────────────── */

const SESSIONS_FILE = join(process.cwd(), 'data', 'research-sessions.json');

function readSessions(): unknown[] {
  try {
    if (!existsSync(SESSIONS_FILE)) return [];
    return JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) as unknown[];
  } catch { return []; }
}

function writeSessions(sessions: unknown[]): void {
  try { writeFileSync(SESSIONS_FILE, JSON.stringify(sessions), 'utf-8'); } catch { /* ignore */ }
}

/* ── 路由 ────────────────────────────────────────────────────── */

export async function handleIORequest(
  url: string, method: string, req: IncomingMessage, res: ServerResponse, vaultPath: string,
): Promise<boolean> {

  // PPTX 匯出
  if (url === '/api/research/export/pptx' && method === 'POST') {
    const body = parseBody<{ spec?: Record<string, unknown>; content?: string; topic?: string }>(await readBody(req), res);
    if (!body) return true;
    const spec = body.spec ?? (body.content ? buildSlideSpec(body.content, body.topic ?? '') : null);
    if (!spec) { json(res, { error: '缺少投影片規格或內容' }, 400); return true; }
    const buf = await buildPptx(spec);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="research.pptx"');
    res.end(buf);
    return true;
  }

  // HTML 預覽
  if (url === '/api/research/export/preview' && method === 'POST') {
    const body = parseBody<{ spec?: Record<string, unknown>; content?: string; topic?: string }>(await readBody(req), res);
    if (!body) return true;
    const spec = body.spec ?? (body.content ? buildSlideSpec(body.content, body.topic ?? '') : null);
    if (!spec) { json(res, { error: '缺少投影片規格或內容' }, 400); return true; }
    html(res, renderSlidePreviewHtml(spec));
    return true;
  }

  // Sessions
  if (url === '/api/research/sessions' && method === 'GET') {
    json(res, readSessions());
    return true;
  }
  if (url === '/api/research/sessions' && method === 'POST') {
    const sessions = parseBody<unknown[]>(await readBody(req), res);
    if (!sessions) return true;
    writeSessions(sessions);
    json(res, { ok: true });
    return true;
  }

  // 存入 Vault — 單一工具結果
  if (url === '/api/research/save-report' && method === 'POST') {
    const body = parseBody<{ topic: string; content: string; toolType?: string }>(await readBody(req), res);
    if (!body) return true;
    if (!vaultPath) { json(res, { error: '未設定 VAULT_PATH' }, 500); return true; }
    const toolLabel: Record<string, string> = {
      report: '研究報告', compare: '比較表', anki: 'Anki 卡片',
      outline: '教學大綱', overview: '分析概覽',
    };
    const label = toolLabel[body.toolType ?? ''] ?? '研究結果';
    const slug = body.topic.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 30);
    const now = new Date();
    const path = await saveReportToVault(vaultPath, {
      title: `${body.topic} — ${label}`,
      date: now.toISOString().slice(0, 10),
      content: body.content,
      tags: ['research-generated', slug],
      filePrefix: `research-${slug}-${now.toTimeString().slice(0, 5).replace(':', '')}`,
      subtitle: `${label} · 研究主題：${body.topic}`,
      tool: body.toolType ?? 'chat',
    });
    json(res, { path });
    return true;
  }

  // 存入 Vault — 完整對話
  if (url === '/api/research/save-all' && method === 'POST') {
    const body = parseBody<{ topic: string; history: Array<{ role: string; content: string }> }>(await readBody(req), res);
    if (!body) return true;
    if (!vaultPath) { json(res, { error: '未設定 VAULT_PATH' }, 500); return true; }
    const slug = body.topic.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 30);
    const now = new Date();
    let turnIndex = 0;
    const sections = body.history
      .reduce<string[]>((acc, m, i, arr) => {
        if (m.role === 'user') {
          const answer = arr[i + 1];
          if (answer?.role === 'assistant') {
            turnIndex++;
            acc.push(`## 問題 ${turnIndex}：${m.content}\n\n${answer.content}`);
          }
        }
        return acc;
      }, [])
      .join('\n\n---\n\n');
    const path = await saveReportToVault(vaultPath, {
      title: `${body.topic} — 完整研究對話`,
      date: now.toISOString().slice(0, 10),
      content: sections,
      tags: ['research-generated', 'research-full', slug],
      filePrefix: `research-${slug}-full-${now.toTimeString().slice(0, 5).replace(':', '')}`,
      subtitle: `完整對話紀錄 · 研究主題：${body.topic}`,
      tool: 'full',
    });
    json(res, { path });
    return true;
  }

  return false;
}
