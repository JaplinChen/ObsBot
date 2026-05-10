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

/* ── open-design daemon 動態 port 發現 ─────────────────────────── */
// OD 每次啟動的 port 不固定，透過讀取 daemon log 取最新 URL
const OD_DAEMON_LOG = '/Users/japlin/Works/open-design/.tmp/tools-dev/default/logs/daemon/latest.log';
const OD_FALLBACK_PORT = '7456';
let _odBaseUrlCache: string | null = null;
let _odBaseUrlCacheTs = 0;

function getOdBaseUrl(): string {
  const now = Date.now();
  if (_odBaseUrlCache && now - _odBaseUrlCacheTs < 5_000) return _odBaseUrlCache;
  try {
    const log = readFileSync(OD_DAEMON_LOG, 'utf-8');
    // 取最後一個 "url" 欄位（最新啟動的 port）
    const matches = [...log.matchAll(/"url"\s*:\s*"(http:\/\/127\.0\.0\.1:\d+)"/g)];
    if (matches.length > 0) {
      _odBaseUrlCache = matches[matches.length - 1][1];
      _odBaseUrlCacheTs = now;
      return _odBaseUrlCache;
    }
  } catch { /* log 不存在時 fallback */ }
  return `http://127.0.0.1:${OD_FALLBACK_PORT}`;
}

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
    const TMP_PREFIX = '/tmp/od-artifact-';
    const OD_ROOT = '/Users/japlin/Works/open-design/';
    const allowed = filePath.startsWith(OD_PROJECTS) || filePath.startsWith(TMP_PREFIX) || filePath.startsWith(OD_ROOT);
    if (!filePath || !allowed || !filePath.endsWith('.html')) {
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

  // 重啟 open-design daemon
  if (url === '/api/research/opendesign/restart' && method === 'POST') {
    try {
      const { spawn } = await import('node:child_process');
      const OD_DIR = '/Users/japlin/Works/open-design';
      // 強制清除舊快取，讓下次 health check 重新讀 log
      _odBaseUrlCache = null;
      _odBaseUrlCacheTs = 0;
      const proc = spawn('pnpm', ['tools-dev', 'start', 'web'], {
        cwd: OD_DIR,
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      json(res, { ok: true, message: 'open-design 重啟中，請稍後 10 秒再試' });
    } catch (err) {
      json(res, { error: String(err) }, 500);
    }
    return true;
  }

  // Health check：確認 open-design 是否在運行，同時回傳可用 deck skill
  if (url === '/api/research/opendesign/health' && method === 'GET') {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(`${getOdBaseUrl()}/api/skills`, { signal: ctrl.signal });
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
    const body = parseBody<{ content: string; topic: string; agentId?: string; skillId?: string; stylePreset?: string; model?: string; slideCount?: number }>(await readBody(req), res);
    if (!body) return true;

    const STYLE_PRESETS: Record<string, { direction: string; color: string }> = {
      'wired-tech':    { direction: 'WIRED Tech · 數據 + 工程感（深色背景，大 serif 標題，monospace 數字）', color: '靛藍瓷（深藍底色 #1a2744，白字，靛藍 accent）' },
      'minimal-white': { direction: '極簡主義 · 留白 + 乾淨線條（白底，深藍文字，細邊框）',                color: '純白底 + 深海藍（#0f1e3c）' },
      'warm-magazine': { direction: '雜誌排版 · 故事感（暖白背景，橙金 accent，人文感字體）',             color: '暖白 + 橙金（#c97d2a）' },
      'dark-minimal':  { direction: '暗色極簡 · 高端感（深黑背景，金色 accent，大量留白）',               color: '炭黑（#111111）+ 金色（#d4a843）' },
    };
    const preset = STYLE_PRESETS[body.stylePreset ?? 'wired-tech'] ?? STYLE_PRESETS['wired-tech'];

    // 快速模式（3 張）或標準模式（5 張）
    const slideCount = Math.max(3, Math.min(7, body.slideCount ?? 5));
    const contentLimit = slideCount <= 3 ? 1500 : 2500;
    const contentSnippet = body.content.slice(0, contentLimit);
    const paragraphs = contentSnippet.split(/\n{2,}/).filter(p => p.trim().length > 20);
    const maxTopics = slideCount - 1; // 第 1 張是封面，剩餘給正文
    const slideTopics = paragraphs.slice(0, maxTopics).map((p, i) => `第${i + 2}張：${p.trim().slice(0, 60)}`).join('\n');

    // 快速模式預設結構
    const defaultTopics3 = `第2張：核心洞察與關鍵數據\n第3張：結論與行動建議`;
    const defaultTopics5 = `第2張：核心概念\n第3張：關鍵數據\n第4張：技術架構\n第5張：結論`;
    const defaultTopics = slideCount <= 3 ? defaultTopics3 : defaultTopics5;

    const message = [
      `請根據以下研究內容，製作一份關於「${body.topic}」的專業投影片簡報。`,
      '',
      '【設計規格 — 以下已確認，略過所有詢問，直接生成 HTML】',
      `視覺方向：${preset.direction}`,
      `主題色：${preset.color}`,
      `投影片數量：${slideCount} 張（固定），16:9 格式`,
      '目標受眾：企業技術主管',
      '語言：繁體中文（標題可保留英文關鍵字）',
      '圖片素材：無，用顏色色塊替代',
      '',
      '【投影片結構 — 直接用以下結構，不需重新規劃】',
      `第1張：封面 — 標題「${body.topic}」`,
      slideTopics || defaultTopics,
      '',
      '研究內容（摘要）：',
      contentSnippet,
    ].join('\n');

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 300_000); // 5 min max

      const r = await fetch(`${getOdBaseUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: body.agentId ?? 'claude',
          skillId: body.skillId ?? 'magazine-web-ppt',
          model: body.model ?? 'sonnet',   // 預設 Sonnet，省額度；前端可傳 'opus' 切換
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

      // 雙軌策略：讀 SSE + 輪詢檔案系統，哪個先完成就回傳
      const startTs = Date.now();
      let fullOutput = '';
      const decoder = new TextDecoder();
      const reader = (r.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      const deadline = Date.now() + 720_000; // 12 分鐘上限
      const OD_WATCH_DIR = '/Users/japlin/Works/open-design';
      let earlyHtmlPath: string | null = null;

      // 記錄生成開始時間，後續只抓「在此之後修改過」的 HTML
      const genStartTs = Date.now();

      let lastPollTs = Date.now();
      while (Date.now() < deadline) {
        // 以 race 方式取下一個 SSE chunk（最多等 3 秒）
        const chunkP = reader.next();
        const timeoutP = new Promise<null>(resolve => setTimeout(() => resolve(null), 3_000));
        const result = await Promise.race([chunkP, timeoutP]);

        if (result && result !== null && 'done' in result) {
          if (result.done) break;
          fullOutput += decoder.decode(result.value, { stream: true });
          if (fullOutput.includes('event: end')) break;
          if (fullOutput.includes("You've hit your limit") || fullOutput.includes('hit your limit')) {
            const resetMatch = fullOutput.match(/resets\s+(?:at\s+)?([^\n"]+)/);
            let resetTime = '稍後';
            if (resetMatch) {
              resetTime = resetMatch[1].trim();
              // 移除不完整的括號結尾（如 "10:30pm (Asia/Saigo"）
              resetTime = resetTime.replace(/\s*\([^)]*$/, '').trim() || resetTime;
              // 移除結尾標點
              resetTime = resetTime.replace(/[.)]+$/, '').trim();
            }
            json(res, { error: `Claude 使用額度已耗盡，將於 ${resetTime} 重置。請稍後再試。`, limitHit: true }, 503);
            return true;
          }
        }

        // 每 5 秒輪詢一次 OD 根目錄，看有沒有新的 HTML 寫入
        if (Date.now() - lastPollTs > 5_000) {
          lastPollTs = Date.now();
          try {
            const { readdirSync, statSync } = await import('node:fs');
            const newHtml = readdirSync(OD_WATCH_DIR)
              .filter(f => f.endsWith('.html'))
              .map(f => ({ name: f, mtime: statSync(join(OD_WATCH_DIR, f)).mtimeMs }))
              .filter(f => f.mtime > genStartTs)   // 在生成開始後才修改的
              .sort((a, b) => b.mtime - a.mtime);
            if (newHtml.length > 0) {
              earlyHtmlPath = join(OD_WATCH_DIR, newHtml[0].name);
              break; // 提早結束，不等 event: end
            }
          } catch { /* ignore */ }
        }
      }

      // 提早偵測到檔案 → 直接用，跳過後續解析
      if (earlyHtmlPath) {
        const elapsed = Math.round((Date.now() - startTs) / 1000);
        json(res, { ok: true, artifactHtmlPath: earlyHtmlPath, elapsed, earlyDetect: true });
        return true;
      }

      // 從 SSE 串流取出 sessionId，讀 Claude session JSONL 提取 <artifact> HTML
      let artifactHtmlPath: string | null = null;
      try {
        const sessionMatch = fullOutput.match(/"sessionId"\s*:\s*"([0-9a-f-]{36})"/);
        if (sessionMatch) {
          const sessionId = sessionMatch[1];
          const sessionFile = join(
            process.env['HOME'] ?? '/Users/japlin',
            '.claude/projects/-Users-japlin-Works-open-design',
            `${sessionId}.jsonl`,
          );
          if (existsSync(sessionFile)) {
            const lines = readFileSync(sessionFile, 'utf-8').split('\n');
            // 倒序找最後一個包含 <artifact type="text/html"> 的 assistant 訊息
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (!line || !line.includes('artifact') || !line.includes('text/html')) continue;
              try {
                const parsed = JSON.parse(line) as { message?: { content?: Array<{ type: string; text?: string }> } };
                const textBlock = (parsed.message?.content ?? []).find(b => b.type === 'text' && b.text?.includes('<artifact'));
                if (!textBlock?.text) continue;
                const m = textBlock.text.match(/<artifact[^>]*>([\s\S]*?)<\/artifact>/);
                if (!m) continue;
                const html = m[1].trim();
                // 存到 /tmp 供 serve proxy 回傳
                const slug = (body.topic ?? 'deck').toLowerCase().replace(/[^\w一-鿿]/g, '-').slice(0, 20);
                const outPath = join('/tmp', `od-artifact-${slug}-${sessionId.slice(0, 8)}.html`);
                writeFileSync(outPath, html, 'utf-8');
                artifactHtmlPath = outPath;
                break;
              } catch { continue; }
            }
          }
        }
      } catch { /* 提取失敗不影響主流程 */ }

      // fallback：掃 OD root 和 .od/projects/ 找最近 HTML
      if (!artifactHtmlPath) {
        try {
          const { readdirSync, statSync } = await import('node:fs');
          const OD_DIR = '/Users/japlin/Works/open-design';
          const RECENCY_MS = 15 * 60 * 1000;
          // 1. 先掃 OD root（agent 常寫到 CWD）
          const rootHtml = readdirSync(OD_DIR)
            .filter(f => f.endsWith('.html') && !f.startsWith('.'))
            .map(f => ({ path: join(OD_DIR, f), mtime: statSync(join(OD_DIR, f)).mtimeMs }))
            .filter(f => Date.now() - f.mtime < RECENCY_MS)
            .sort((a, b) => b.mtime - a.mtime);
          if (rootHtml.length > 0) { artifactHtmlPath = rootHtml[0].path; }
          // 2. 再掃 .od/projects/
          if (!artifactHtmlPath) {
            const projectsBase = join(OD_DIR, '.od', 'projects');
            if (existsSync(projectsBase)) {
              const projectDirs = readdirSync(projectsBase)
                .map(d => ({ id: d, mtime: statSync(join(projectsBase, d)).mtimeMs }))
                .filter(d => Date.now() - d.mtime < RECENCY_MS)
                .sort((a, b) => b.mtime - a.mtime);
              for (const proj of projectDirs) {
                const projDir = join(projectsBase, proj.id);
                const htmlFiles = readdirSync(projDir)
                  .filter(f => f.endsWith('.html') && !f.startsWith('.'))
                  .map(f => ({ name: f, mtime: statSync(join(projDir, f)).mtimeMs }))
                  .filter(f => Date.now() - f.mtime < RECENCY_MS)
                  .sort((a, b) => b.mtime - a.mtime);
                if (htmlFiles.length > 0) { artifactHtmlPath = join(projDir, htmlFiles[0].name); break; }
              }
            }
          }
        } catch { /* ignore */ }
      }

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
