/**
 * Wiki Compiler — Karpathy-inspired folder-based knowledge compilation.
 *
 * 讀取指定資料夾（或整個 Vault）的全部筆記，
 * 用 LLM 聚類主題並為每個主題產出結構化 wiki 文章，
 * 含雙向連結（[[wikilink]]）。
 *
 * 使用方式：/vault compile karpathy
 *           /vault compile --all
 */
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { getAllMdFiles, parseFrontmatter } from '../vault/frontmatter-utils.js';
import { saveReportToVault } from './report-saver.js';

/* ── Types ────────────────────────────────────────────────── */

export interface WikiNote {
  title: string;
  summary: string;
  keywords: string[];
  filePath: string;
  fileName: string;
}

export interface WikiArticle {
  theme: string;
  noteCount: number;
  content: string;
}

export interface WikiCompileResult {
  folder: string;
  totalNotes: number;
  articles: WikiArticle[];
  skippedNotes: number;
  savedPath?: string;
}

/* ── Note loading ─────────────────────────────────────────── */

async function loadNotesFromFolder(folderPath: string): Promise<WikiNote[]> {
  let files: string[];
  try {
    files = await getAllMdFiles(folderPath);
  } catch {
    return [];
  }

  const notes: WikiNote[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fm = parseFrontmatter(raw);
      const title = fm.get('title') ?? basename(f, '.md');
      const summary = fm.get('summary') ?? '';
      const kwRaw = fm.get('keywords') ?? '';
      const keywords = kwRaw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(k => k.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);

      notes.push({ title, summary, keywords, filePath: f, fileName: basename(f) });
    } catch {
      // skip unreadable files
    }
  }
  return notes;
}

/* ── Theme clustering prompt ──────────────────────────────── */

function buildClusterPrompt(notes: WikiNote[]): string {
  const list = notes
    .map((n, i) => `[${i}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 80)}` : ''}`)
    .join('\n');

  return [
    '你是知識架構師。將以下筆記依主題聚類，輸出 JSON 格式。',
    '',
    '規則：',
    '- 每個群組應有 2-8 篇筆記',
    '- 主題名稱用繁體中文，精確描述核心概念（5-15 字）',
    '- 同一個工具/方法論的不同角度應歸同一群',
    '- 輸出純 JSON，不要其他文字',
    '',
    '輸出格式：',
    '[',
    '  { "theme": "主題名稱", "indices": [0, 3, 7] },',
    '  ...',
    ']',
    '',
    '筆記清單：',
    list,
  ].join('\n');
}

interface ThemeCluster {
  theme: string;
  indices: number[];
}

async function clusterNotes(notes: WikiNote[]): Promise<ThemeCluster[]> {
  if (notes.length === 0) return [];

  // For small sets, treat as single group
  if (notes.length <= 4) {
    return [{ theme: '綜合概覽', indices: notes.map((_, i) => i) }];
  }

  const prompt = buildClusterPrompt(notes);
  const result = await runLocalLlmPrompt(prompt, {
    timeoutMs: 60_000,
    model: 'flash',
    maxTokens: 1024,
  });

  if (!result) return [{ theme: '全部筆記', indices: notes.map((_, i) => i) }];

  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('no JSON array found');
    return JSON.parse(jsonMatch[0]) as ThemeCluster[];
  } catch {
    logger.warn('wiki-compiler', '聚類 JSON 解析失敗，使用單群組 fallback');
    return [{ theme: '全部筆記', indices: notes.map((_, i) => i) }];
  }
}

/* ── Wiki article prompt ──────────────────────────────────── */

function buildWikiPrompt(theme: string, notes: WikiNote[]): string {
  const noteList = notes
    .map(n => {
      const parts = [`**${n.title}**`];
      if (n.summary) parts.push(n.summary.slice(0, 150));
      if (n.keywords.length) parts.push(`關鍵詞：${n.keywords.slice(0, 5).join('、')}`);
      return parts.join(' — ');
    })
    .join('\n');

  const wikiLinks = notes.map(n => `[[${n.title}]]`).join('、');

  return [
    `你是知識編譯器。為主題「${theme}」撰寫一篇結構化 wiki 文章。`,
    `來源筆記（${notes.length} 篇）：${wikiLinks}`,
    '',
    '必須繁體中文。嚴格按照以下結構：',
    '',
    '## 核心概念',
    '2-3 句話定義此主題的本質（引用至少 2 篇來源筆記）',
    '',
    '## 主要方法與工具',
    '| 方法/工具 | 核心特點 | 來源 |',
    '|-----------|----------|------|',
    '（3-6 行，「來源」用 [[筆記標題]] 格式）',
    '',
    '## 關鍵洞察',
    '- 跨筆記的交叉發現（每條附 [[來源]]）',
    '- 2-4 條，有具體依據',
    '',
    '## 與 KnowPipe 的連結',
    '- 此主題如何影響 KnowPipe 的設計或功能（1-3 條具體建議）',
    '',
    '## 延伸閱讀',
    notes.map(n => `- [[${n.title}]]`).join('\n'),
    '',
    '注意：不要捏造筆記中沒有的資訊。',
    '',
    '筆記內容：',
    noteList,
  ].join('\n');
}

async function compileWikiArticle(theme: string, notes: WikiNote[]): Promise<WikiArticle | null> {
  const prompt = buildWikiPrompt(theme, notes);
  const result = await runLocalLlmPrompt(prompt, {
    timeoutMs: 120_000,
    model: 'deep',
    maxTokens: 2048,
  });

  if (!result) {
    logger.warn('wiki-compiler', '主題 wiki 產生失敗', { theme });
    return null;
  }

  return { theme, noteCount: notes.length, content: result.trim() };
}

/* ── Assemble report ─────────────────────────────────────── */

function assembleWikiReport(folder: string, articles: WikiArticle[], total: number): string {
  const lines: string[] = [
    `> 資料夾：\`${folder}\` | 共 ${total} 篇筆記 | 編譯 ${articles.length} 個主題`,
    '',
  ];

  for (const art of articles) {
    lines.push(`# ${art.theme}（${art.noteCount} 篇）`);
    lines.push('');
    lines.push(art.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/* ── Main export ─────────────────────────────────────────── */

export async function compileWiki(
  vaultPath: string,
  folderName: string,
): Promise<WikiCompileResult> {
  // Resolve folder path
  const isAll = folderName === '--all';
  const scanPath = isAll
    ? join(vaultPath, 'KnowPipe')
    : join(vaultPath, 'KnowPipe', '生產力', folderName);

  logger.info('wiki-compiler', '開始 wiki 編譯', { folder: folderName });

  const notes = await loadNotesFromFolder(scanPath);
  if (notes.length === 0) {
    return { folder: folderName, totalNotes: 0, articles: [], skippedNotes: 0 };
  }

  // Cluster into themes
  const clusters = await clusterNotes(notes);

  // Compile each theme
  const articles: WikiArticle[] = [];
  let skipped = 0;
  for (const cluster of clusters) {
    const clusterNotes = cluster.indices
      .filter(i => i >= 0 && i < notes.length)
      .map(i => notes[i]);
    if (clusterNotes.length < 2) { skipped += clusterNotes.length; continue; }

    const article = await compileWikiArticle(cluster.theme, clusterNotes);
    if (article) articles.push(article);
  }

  let savedPath: string | undefined;
  if (articles.length > 0) {
    const date = new Date().toISOString().slice(0, 10);
    const label = isAll ? 'Vault' : folderName;
    const content = assembleWikiReport(folderName, articles, notes.length);
    savedPath = await saveReportToVault(vaultPath, {
      title: `Wiki 編譯 ${label} ${date}`,
      date,
      content,
      tags: ['wiki', 'compiled', 'auto-generated', folderName],
      filePrefix: 'wiki',
      subtitle: `${articles.length} 個主題 | ${notes.length} 篇筆記`,
    });
  }

  return {
    folder: folderName,
    totalNotes: notes.length,
    articles,
    skippedNotes: skipped,
    savedPath,
  };
}
