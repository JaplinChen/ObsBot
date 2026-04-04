/**
 * 研究模組 HTTP API 路由 — 整合進 admin server (port 3001)。
 * 處理 /research 和 /api/research/* 的所有請求。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanVaultNotes, searchNotes, loadNoteBody } from './vault-reader.js';
import { compressNote, compressBatch, getCacheStats } from './compress-cache.js';
import { preprocessText } from './text-cleaner.js';
import { analyzeNotes, chatWithNotes, generateResearchReport, generateComparisonTable, generateAnkiCards, generateTeachingOutline } from './chat-service.js';
import { buildSlideSpec, parseSlideSpecPayload } from './slide-spec.js';
import { buildPptx } from './slide-pptx.js';
import { renderSlidePreviewHtml } from './slide-preview.js';
import type { NoteRecord, ChatMessage, CleanLevel } from './types.js';

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
    const body = JSON.parse(await readBody(req)) as { topic: string; paths: string[] };
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

  // 對話
  if (url === '/api/research/chat' && method === 'POST') {
    const body = JSON.parse(await readBody(req)) as { topic: string; paths: string[]; history: ChatMessage[]; message: string };
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
    const body = JSON.parse(await readBody(req)) as { text: string; topic?: string; level?: CleanLevel };
    const compressed = preprocessText(body.text, body.topic, body.level);
    const ratio = body.text.length > 0 ? compressed.length / body.text.length : 1;
    json(res, { compressed, ratio: Math.round(ratio * 100) / 100 });
    return true;
  }

  // 壓縮筆記
  if (url === '/api/research/compress' && method === 'POST') {
    const body = JSON.parse(await readBody(req)) as { paths: string[]; topic?: string };
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

  // PPTX 匯出
  if (url === '/api/research/export/pptx' && method === 'POST') {
    const body = JSON.parse(await readBody(req)) as { spec?: Record<string, unknown>; content?: string; topic?: string };
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
    const body = JSON.parse(await readBody(req)) as { spec?: Record<string, unknown>; content?: string; topic?: string };
    const spec = body.spec ?? (body.content ? buildSlideSpec(body.content, body.topic ?? '') : null);
    if (!spec) { json(res, { error: '缺少投影片規格或內容' }, 400); return true; }
    html(res, renderSlidePreviewHtml(spec));
    return true;
  }

  // 知識工具
  if (url.startsWith('/api/research/tools/') && method === 'POST') {
    const tool = url.split('/').pop();
    const body = JSON.parse(await readBody(req)) as { topic: string; paths: string[] };
    const notes = await getNotes();
    const vp = getVaultPath();
    const selected = notes.filter((n) => body.paths.includes(n.path));
    for (const note of selected) {
      if (!note.body) note.body = await loadNoteBody(vp, note.path);
    }
    let result = '';
    switch (tool) {
      case 'report': result = await generateResearchReport(body.topic, selected); break;
      case 'compare': result = await generateComparisonTable(body.topic, selected); break;
      case 'anki': result = await generateAnkiCards(body.topic, selected); break;
      case 'outline': result = await generateTeachingOutline(body.topic, selected); break;
      default: json(res, { error: `未知工具：${tool}` }, 400); return true;
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

  return false;
}
