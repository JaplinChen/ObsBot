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

  /* ── open-design 整合 ──────────────────────────────────────── */

  // 代理服務：讀取本機 HTML artifact 並回傳（繞過 file:// 限制）
  if (url === '/api/research/opendesign/serve' && method === 'GET') {
    const filePath = new URL(`http://x${req.url}`).searchParams.get('p') ?? '';
    const OD_PROJECTS = '/Users/japlin/Works/open-design/.od/projects/';
    if (!filePath || !filePath.startsWith(OD_PROJECTS) || !filePath.endsWith('.html')) {
      json(res, { error: '無效路徑' }, 400); return true;
    }
    try {
      const content = readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(content);
    } catch { json(res, { error: '找不到檔案' }, 404); }
    return true;
  }

  // Health check：確認 open-design 是否在 port 7456 運行，同時回傳可用 deck skill
  if (url === '/api/research/opendesign/health' && method === 'GET') {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch('http://127.0.0.1:7456/api/skills', { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const raw = await r.json() as { skills?: unknown[] } | unknown[];
        const skills = (Array.isArray(raw) ? raw : (raw as { skills?: unknown[] }).skills ?? []) as Array<{ id: string; mode?: string; name?: string }>;
        const deckSkills = skills.filter(s => s.mode === 'deck').map(s => ({ id: s.id, name: s.name ?? s.id }));
        json(res, { available: true, skillCount: skills.length, deckSkills });
      } else {
        json(res, { available: false, error: `HTTP ${r.status}` });
      }
    } catch {
      json(res, { available: false, error: 'service_not_running' });
    }
    return true;
  }

  // 生成進階簡報：呼叫 open-design /api/chat，agentId=claude，skillId 由前端傳入
  if (url === '/api/research/opendesign/generate' && method === 'POST') {
    const body = parseBody<{ content: string; topic: string; agentId?: string; skillId?: string; stylePreset?: string }>(await readBody(req), res);
    if (!body) return true;

    const STYLE_PRESETS: Record<string, { direction: string; color: string }> = {
      'wired-tech':    { direction: 'WIRED Tech · 數據 + 工程感（深色背景，大 serif 標題，monospace 數字）', color: '靛藍瓷（深藍底色 #1a2744，白字，靛藍 accent）' },
      'minimal-white': { direction: '極簡主義 · 留白 + 乾淨線條（白底，深藍文字，細邊框）',                color: '純白底 + 深海藍（#0f1e3c）' },
      'warm-magazine': { direction: '雜誌排版 · 故事感（暖白背景，橙金 accent，人文感字體）',             color: '暖白 + 橙金（#c97d2a）' },
      'dark-minimal':  { direction: '暗色極簡 · 高端感（深黑背景，金色 accent，大量留白）',               color: '炭黑（#111111）+ 金色（#d4a843）' },
    };
    const preset = STYLE_PRESETS[body.stylePreset ?? 'wired-tech'] ?? STYLE_PRESETS['wired-tech'];

    const message = [
      `請根據以下研究內容，製作一份關於「${body.topic}」的專業投影片簡報。`,
      '',
      '【設計規格 — 以下參數已確認，請勿再詢問，直接開始生成】',
      `視覺方向：${preset.direction}`,
      `主題色：${preset.color}`,
      '原始素材：無，使用佔位色塊',
      '圖片素材：無（用顏色色塊替代圖片）',
      '硬性約束：無',
      '投影片數量：8-10 張，16:9 格式',
      '目標受眾：企業技術主管',
      '語言：繁體中文（標題可保留英文關鍵字）',
      '',
      '研究內容如下：',
      '',
      body.content.slice(0, 6000),
    ].join('\n');

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300_000); // 5 min max

      const r = await fetch('http://127.0.0.1:7456/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: body.agentId ?? 'claude',       // open-design 的 Claude Code agent ID
          skillId: body.skillId ?? 'magazine-web-ppt', // guizang-ppt 在 open-design 的實際 ID
          message,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        json(res, { error: `open-design 回傳 HTTP ${r.status}`, detail: errText.slice(0, 300) }, 502);
        return true;
      }

      // 讀取 SSE 串流直到 event: end（最長 10 分鐘）
      const startTs = Date.now();
      let fullOutput = '';
      const decoder = new TextDecoder();
      const reader = (r.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      const deadline = Date.now() + 600_000;

      while (Date.now() < deadline) {
        const { done, value } = await reader.next();
        if (done) break;
        fullOutput += decoder.decode(value, { stream: true });
        if (fullOutput.includes('event: end')) break;
        // 偵測 Claude 額度耗盡
        if (fullOutput.includes("You've hit your limit") || fullOutput.includes('hit your limit')) {
          const resetMatch = fullOutput.match(/resets\s+([^\\"\\n]+)/);
          const resetTime = resetMatch ? resetMatch[1].trim() : '稍後';
          json(res, { error: `Claude 使用額度已耗盡，將於 ${resetTime} 重置。請稍後再試。`, limitHit: true }, 503);
          return true;
        }
      }

      // 掃 .od/projects/ 找最近修改過的 HTML artifact
      const OD_DIR = '/Users/japlin/Works/open-design';
      const projectsBase = join(OD_DIR, '.od', 'projects');
      let artifactHtmlPath: string | null = null;
      const RECENCY_MS = 10 * 60 * 1000; // 10 分鐘內建立的視為本次生成

      try {
        const { readdirSync, statSync } = await import('node:fs');
        if (existsSync(projectsBase)) {
          // 找最近修改的 project 目錄
          const projectDirs = readdirSync(projectsBase)
            .map(d => ({ id: d, mtime: statSync(join(projectsBase, d)).mtimeMs }))
            .filter(d => Date.now() - d.mtime < RECENCY_MS)
            .sort((a, b) => b.mtime - a.mtime);

          for (const proj of projectDirs) {
            const projDir = join(projectsBase, proj.id);
            // 找最新的 .html 檔（排除範本檔）
            const htmlFiles = readdirSync(projDir)
              .filter(f => f.endsWith('.html') && !f.startsWith('.'))
              .map(f => ({ name: f, mtime: statSync(join(projDir, f)).mtimeMs }))
              .filter(f => Date.now() - f.mtime < RECENCY_MS)
              .sort((a, b) => b.mtime - a.mtime);
            if (htmlFiles.length > 0) {
              artifactHtmlPath = join(projDir, htmlFiles[0].name);
              break;
            }
          }
        }
      } catch { /* 掃目錄失敗不影響回傳 */ }

      const elapsed = Math.round((Date.now() - startTs) / 1000);
      json(res, {
        ok: true,
        artifactHtmlPath,  // 本機路徑，前端用 /api/research/opendesign/serve?p= 讀取
        elapsed,
        rawOutput: fullOutput.slice(0, 3000),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = msg.includes('abort') || msg.includes('timeout');
      json(res, { error: isTimeout ? '生成超時（5 分鐘）' : msg }, 500);
    }
    return true;
  }

  return false;
}
