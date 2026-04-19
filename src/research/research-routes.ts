/**
 * 研究模組 HTTP API 路由 — 整合進 admin server (port 3001)。
 * 處理 /research 和 /api/research/* 的所有請求。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanVaultNotes, searchNotes, loadNoteBody } from './vault-reader.js';
import { compressBatch, getCacheStats } from './compress-cache.js';
import { preprocessText } from './text-cleaner.js';
import { analyzeNotes, chatWithNotes, streamChatWithNotes, generateResearchReport, generateComparisonTable, generateAnkiCards, generateTeachingOutline, generateDiagram, analyzeForDiagrams } from './chat-service.js';
import type { DiagramType } from './chat-service.js';
import type { NoteRecord, ChatMessage, CleanLevel } from './types.js';
import { handleVaultManageRequest } from './vault-manage-routes.js';
import { handleIORequest } from './research-routes-io.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_RESEARCH_HTML = readFileSync(join(__dirname, 'research-ui.html'), 'utf-8');
let UI_HTML = RAW_RESEARCH_HTML;

/** 注入 locale 資料到 research UI（由 admin server 呼叫） */
export function injectResearchLocales(localesJson: string): void {
  UI_HTML = RAW_RESEARCH_HTML.replace('/* __LOCALES_INJECT__ */', 'var _locales = ' + localesJson + ';');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function parseBody<T>(raw: string, res: ServerResponse): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    json(res, { error: '請求格式錯誤（非有效 JSON）' }, 400);
    return null;
  }
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

/** 取得 vault 路徑 */
function getVaultPath(): string {
  return process.env['VAULT_PATH'] || '';
}

/** 暫存已掃描的筆記（避免每次請求都重掃） */
let cachedNotes: NoteRecord[] = [];
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 分鐘快取

async function getNotes(): Promise<NoteRecord[]> {
  if (Date.now() - cacheTime < CACHE_TTL && cachedNotes.length > 0) return cachedNotes;
  const vp = getVaultPath();
  if (!vp) return [];
  cachedNotes = await scanVaultNotes(vp);
  cacheTime = Date.now();
  return cachedNotes;
}

/* ── 路由處理 ────────────────────────────────────────────────── */

export async function handleResearchRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';

  // 研究界面
  if (url === '/research' && method === 'GET') {
    html(res, UI_HTML);
    return true;
  }

  // 筆記列表
  if (url === '/api/research/notes' && method === 'GET') {
    const query = new URL(`http://x${req.url}`).searchParams.get('q') ?? '';
    const notes = await getNotes();
    const filtered = query ? searchNotes(notes, query) : notes;
    // 回傳簡化版（不含 body 以節省頻寬）
    json(res, filtered.map((n) => ({ name: n.name, path: n.path, folder: n.folder, tags: n.tags, category: n.category, preview: n.preview })));
    return true;
  }

  // 初始分析
  if (url === '/api/research/analyze' && method === 'POST') {
    const body = parseBody<{ topic: string; paths: string[] }>(await readBody(req), res);
    if (!body) return true;
    const notes = await getNotes();
    const vp = getVaultPath();
    const selected = notes.filter((n) => body.paths.includes(n.path));
    // 載入完整 body
    for (const note of selected) {
      if (!note.body) note.body = await loadNoteBody(vp, note.path);
    }
    const overview = await analyzeNotes(body.topic, selected);
    json(res, { overview, noteCount: selected.length });
    return true;
  }

  // SSE 串流對話
  if (url === '/api/research/chat/stream' && method === 'POST') {
    const body = parseBody<{ topic: string; paths: string[]; history: ChatMessage[]; message: string; autodiagramA?: boolean; allowedDiagramTypes?: string[] }>(await readBody(req), res);
    if (!body) return true;
    const notes = await getNotes();
    const vp = getVaultPath();
    const selected = notes.filter((n) => body.paths.includes(n.path));
    for (const note of selected) {
      if (!note.body) note.body = await loadNoteBody(vp, note.path);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      for await (const chunk of streamChatWithNotes(body.topic, selected, body.history, body.message, {
        autodiagramA: body.autodiagramA,
        allowedTypes: body.allowedDiagramTypes,
      })) {
        res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
      }
    } catch { /* ignore mid-stream errors */ }
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  // 模式B：後處理自動插圖分析
  if (url === '/api/research/auto-diagram' && method === 'POST') {
    const body = parseBody<{ replyText: string; allowedTypes: DiagramType[]; maxDiagrams: number }>(await readBody(req), res);
    if (!body) return true;
    const suggestions = await analyzeForDiagrams(
      body.replyText,
      body.allowedTypes ?? ['flowchart'],
      Math.min(body.maxDiagrams ?? 2, 3),
    );
    json(res, { suggestions });
    return true;
  }

  // 對話
  if (url === '/api/research/chat' && method === 'POST') {
    const body = parseBody<{ topic: string; paths: string[]; history: ChatMessage[]; message: string }>(await readBody(req), res);
    if (!body) return true;
    const notes = await getNotes();
    const vp = getVaultPath();
    const selected = notes.filter((n) => body.paths.includes(n.path));
    for (const note of selected) {
      if (!note.body) note.body = await loadNoteBody(vp, note.path);
    }
    const reply = await chatWithNotes(body.topic, selected, body.history, body.message);
    json(res, { reply });
    return true;
  }

  // 文本預處理
  if (url === '/api/research/preprocess' && method === 'POST') {
    const body = parseBody<{ text: string; topic?: string; level?: CleanLevel }>(await readBody(req), res);
    if (!body) return true;
    const compressed = preprocessText(body.text, body.topic, body.level);
    const ratio = body.text.length > 0 ? compressed.length / body.text.length : 1;
    json(res, { compressed, ratio: Math.round(ratio * 100) / 100 });
    return true;
  }

  // 壓縮筆記
  if (url === '/api/research/compress' && method === 'POST') {
    const body = parseBody<{ paths: string[]; topic?: string }>(await readBody(req), res);
    if (!body) return true;
    const notes = await getNotes();
    const vp = getVaultPath();
    const selected = notes.filter((n) => body.paths.includes(n.path));
    for (const note of selected) {
      if (!note.body) note.body = await loadNoteBody(vp, note.path);
    }
    const result = await compressBatch(
      selected.map((n) => ({ path: n.path, body: n.body })),
      body.topic,
    );
    const stats = await getCacheStats();
    json(res, { compressed: result.size, stats });
    return true;
  }

  // 投影片/儲存/sessions — 委派給 IO 模組
  if (url.startsWith('/api/research/export/') || url === '/api/research/save-report'
      || url === '/api/research/save-all' || url === '/api/research/sessions') {
    return handleIORequest(url, method, req, res, getVaultPath());
  }

  // 知識工具
  if (url.startsWith('/api/research/tools/') && method === 'POST') {
    const tool = url.split('/').pop();
    const body = parseBody<{ topic: string; paths: string[]; diagramStyle?: string }>(await readBody(req), res);
    if (!body) return true;
    const notes = await getNotes();
    const vp = getVaultPath();
    const selected = notes.filter((n) => body.paths.includes(n.path));
    for (const note of selected) {
      if (!note.body) note.body = await loadNoteBody(vp, note.path);
    }
    let result = '';
    const archStyle = (['dark', 'sketch', 'minimal', 'retro', 'blueprint', 'pastel'].includes(body.diagramStyle ?? '') ? body.diagramStyle : 'sketch') as import('./arch-svg-builder.js').ArchStyle;
    switch (tool) {
      case 'report': result = await generateResearchReport(body.topic, selected); break;
      case 'compare': result = await generateComparisonTable(body.topic, selected); break;
      case 'anki': result = await generateAnkiCards(body.topic, selected); break;
      case 'outline': result = await generateTeachingOutline(body.topic, selected); break;
      default: {
        // 圖表工具：diagram:flowchart、diagram:mindmap 等
        if (tool && tool.startsWith('diagram:')) {
          const diagramType = tool.slice('diagram:'.length) as DiagramType;
          result = await generateDiagram(diagramType, body.topic, selected, archStyle);
          break;
        }
        json(res, { error: `未知工具：${tool}` }, 400); return true;
      }
    }
    json(res, { result });
    return true;
  }

  // 筆記 HTML 預覽（wikilink 點擊用）
  if (url === '/api/research/note-view' && method === 'GET') {
    const params = new URL(`http://x${req.url}`).searchParams;
    const noteName = params.get('name') ?? '';
    if (!noteName) { json(res, { error: '缺少 name 參數' }, 400); return true; }
    const notes = await getNotes();
    const vp = getVaultPath();
    const q = noteName.toLowerCase();
    // 精確 → 不分大小寫 → 包含 → 被包含
    let note = notes.find((n) => n.name === noteName)
      || notes.find((n) => n.name.toLowerCase() === q)
      || notes.find((n) => n.name.toLowerCase().includes(q))
      || notes.find((n) => q.includes(n.name.toLowerCase()));
    // 關鍵字模糊搜尋：將查詢拆成片段，找最多匹配的筆記
    if (!note) {
      const keywords = q.split(/[-_\s]+/).filter((w) => w.length >= 2);
      if (keywords.length > 0) {
        let bestScore = 0;
        for (const n of notes) {
          const nl = n.name.toLowerCase();
          const score = keywords.filter((kw) => nl.includes(kw)).length;
          if (score > bestScore) { bestScore = score; note = n; }
        }
        if (bestScore < Math.ceil(keywords.length * 0.4)) note = undefined;
      }
    }
    if (!note) { json(res, { error: `找不到筆記：${noteName}` }, 404); return true; }
    if (!note.body) note.body = await loadNoteBody(vp, note.path);
    const body = note.body || '';
    json(res, { name: note.name, path: note.path, body });
    return true;
  }

  // 快取統計
  if (url === '/api/research/cache-stats' && method === 'GET') {
    json(res, await getCacheStats());
    return true;
  }

  // 重新掃描
  if (url === '/api/research/rescan' && method === 'POST') {
    cacheTime = 0;
    cachedNotes = [];
    const notes = await getNotes();
    json(res, { count: notes.length });
    return true;
  }

  // Vault 筆記管理（查看、改名、刪除、移動）
  if (url.startsWith('/api/vault/')) {
    return handleVaultManageRequest(req, res);
  }

  return false;
}
