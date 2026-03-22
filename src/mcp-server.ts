#!/usr/bin/env node
/**
 * GetThreads MCP Server — 讓 Claude Code 直接搜尋 Vault 知識庫
 *
 * 安裝：claude mcp add getthreads-vault -- npx tsx src/mcp-server.ts
 *
 * 提供的 tools：
 *   search_vault(query)     搜尋 Vault 筆記（比對標題、摘要、關鍵詞）
 *   get_recent_notes(days)  取得最近 N 天的筆記
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from './vault/frontmatter-utils.js';

// ── Types ──

interface NoteMeta {
  path: string;
  title: string;
  category: string;
  date: string;
  author: string;
  keywords: string[];
  summary: string;
  url: string;
}

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

// ── Vault scanning ──

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
  process.stderr.write('❌ VAULT_PATH 未設定\n');
  process.exit(1);
}

let notesCache: NoteMeta[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分鐘快取

async function loadNotes(): Promise<NoteMeta[]> {
  if (notesCache && Date.now() - cacheTimestamp < CACHE_TTL_MS) return notesCache;

  const rootDir = join(VAULT_PATH!, 'GetThreads');
  const files = await getAllMdFiles(rootDir);
  const notes: NoteMeta[] = [];

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(raw);
      if (!fm.has('title')) continue;

      notes.push({
        path: filePath,
        title: fm.get('title')?.replace(/^"|"$/g, '') ?? '',
        category: fm.get('category') ?? '',
        date: fm.get('date') ?? '',
        author: fm.get('author')?.replace(/^"|"$/g, '') ?? '',
        keywords: parseArrayField(fm.get('keywords') ?? ''),
        summary: fm.get('summary')?.replace(/^"|"$/g, '') ?? '',
        url: fm.get('url')?.replace(/^"|"$/g, '') ?? '',
      });
    } catch { /* skip */ }
  }

  notesCache = notes;
  cacheTimestamp = Date.now();
  return notes;
}

// ── Tool implementations ──

async function searchVault(query: string, limit = 10): Promise<NoteMeta[]> {
  const notes = await loadNotes();
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = notes.map(note => {
    let score = 0;
    const titleL = note.title.toLowerCase();
    const summaryL = note.summary.toLowerCase();
    const kwL = note.keywords.join(' ').toLowerCase();
    const catL = note.category.toLowerCase();

    for (const term of terms) {
      if (titleL.includes(term)) score += 3;
      if (kwL.includes(term)) score += 2;
      if (catL.includes(term)) score += 2;
      if (summaryL.includes(term)) score += 1;
    }
    return { note, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.note);
}

async function getRecentNotes(days = 7, limit = 20): Promise<NoteMeta[]> {
  const notes = await loadNotes();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return notes
    .filter(n => n.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

function formatNoteResult(note: NoteMeta): Record<string, string> {
  return {
    title: note.title,
    category: note.category,
    date: note.date,
    author: note.author,
    keywords: note.keywords.join(', '),
    summary: note.summary,
    url: note.url,
  };
}

// ── MCP Protocol (JSON-RPC over stdio) ──

const TOOLS = [
  {
    name: 'search_vault',
    description: '搜尋 GetThreads Vault 知識庫（比對標題、摘要、關鍵詞、分類）',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '搜尋關鍵字' },
        limit: { type: 'number', description: '最多回傳筆數（預設 10）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_notes',
    description: '取得 Vault 中最近 N 天的筆記',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: '天數範圍（預設 7）' },
        limit: { type: 'number', description: '最多回傳筆數（預設 20）' },
      },
    },
  },
];

function jsonRpcResponse(id: number | string, result: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id: number | string, code: number, message: string) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(req: McpRequest): Promise<string> {
  switch (req.method) {
    case 'initialize':
      return jsonRpcResponse(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'getthreads-vault', version: '1.0.0' },
      });

    case 'notifications/initialized':
      return ''; // no response needed

    case 'tools/list':
      return jsonRpcResponse(req.id, { tools: TOOLS });

    case 'tools/call': {
      const params = req.params as { name: string; arguments?: Record<string, unknown> };
      const args = params.arguments ?? {};

      if (params.name === 'search_vault') {
        const results = await searchVault(
          args.query as string,
          (args.limit as number) ?? 10,
        );
        const text = results.length === 0
          ? '未找到匹配的筆記'
          : results.map(n => JSON.stringify(formatNoteResult(n), null, 2)).join('\n---\n');
        return jsonRpcResponse(req.id, {
          content: [{ type: 'text', text }],
        });
      }

      if (params.name === 'get_recent_notes') {
        const results = await getRecentNotes(
          (args.days as number) ?? 7,
          (args.limit as number) ?? 20,
        );
        const text = results.length === 0
          ? '指定期間內無筆記'
          : results.map(n => JSON.stringify(formatNoteResult(n), null, 2)).join('\n---\n');
        return jsonRpcResponse(req.id, {
          content: [{ type: 'text', text }],
        });
      }

      return jsonRpcError(req.id, -32601, `Unknown tool: ${params.name}`);
    }

    default:
      return jsonRpcError(req.id, -32601, `Unknown method: ${req.method}`);
  }
}

// ── stdio transport ──

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', async (chunk: string) => {
  buffer += chunk;

  // MCP uses Content-Length headers or newline-delimited JSON
  let newlineIdx: number;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);

    // Skip Content-Length headers
    if (!line || line.startsWith('Content-Length')) continue;

    try {
      const req = JSON.parse(line) as McpRequest;
      const response = await handleRequest(req);
      if (response) {
        const responseBytes = Buffer.byteLength(response, 'utf-8');
        process.stdout.write(`Content-Length: ${responseBytes}\r\n\r\n${response}`);
      }
    } catch {
      // Skip malformed lines
    }
  }
});

process.stderr.write('GetThreads MCP Server 已啟動\n');
