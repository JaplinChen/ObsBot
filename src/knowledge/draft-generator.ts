/**
 * draft-generator — 從 Vault 筆記生成有觀點的長文草稿
 * 支援主題關鍵字搜索（跨分類）+ Obsidian [[]] 來源引用 + 字數選項
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { getAllMdFiles, parseFrontmatter, parseArrayField } from '../vault/frontmatter-utils.js';

export interface DraftNote {
  title: string;
  summary: string;
  category: string;
  date: string;
  filename: string;
  keywords: string[];
}

export interface DraftResult {
  savedPath: string;
  filename: string;
  noteCount: number;
  wordTarget: number;
}

/** 找出與主題相關的筆記（分類前綴 or 關鍵字包含） */
export async function findRelevantNotes(
  vaultPath: string,
  topic: string,
  dayLimit: number,
): Promise<DraftNote[]> {
  const rootDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(rootDir).catch(() => [] as string[]);
  const topicLower = topic.toLowerCase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dayLimit);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const results: DraftNote[] = [];

  for (const f of files) {
    if (f.includes('知識庫') || f.includes('wiki.md')) continue;
    try {
      const raw = await readFile(f, 'utf-8');
      const fm = parseFrontmatter(raw);
      const date = fm.get('date') ?? '';
      if (date && date < cutoffStr) continue;

      const title = fm.get('title') ?? '';
      const summary = fm.get('summary') ?? '';
      const category = fm.get('category') ?? '';
      const kwRaw = fm.get('keywords') ?? '';
      const keywords = parseArrayField(kwRaw);

      // 分類前綴比對 or 關鍵字比對
      const catMatch = category.toLowerCase().includes(topicLower);
      const kwMatch = keywords.some(k => k.toLowerCase().includes(topicLower) || topicLower.includes(k.toLowerCase()));
      const titleMatch = title.toLowerCase().includes(topicLower);

      if (!catMatch && !kwMatch && !titleMatch) continue;
      if (!title) continue;

      const filename = f.split('/').pop()?.replace(/\.md$/, '') ?? '';
      results.push({ title, summary, category, date, filename, keywords });
    } catch { /* skip */ }
  }

  return results
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15);
}

/** 讀取該主題的 wiki.md 作為骨架（若存在） */
async function loadTopicWiki(vaultPath: string, topic: string): Promise<string> {
  const candidates = [
    join(vaultPath, 'KnowPipe', topic, 'wiki.md'),
    join(vaultPath, 'KnowPipe', '知識庫', '概念', `${topic}.md`),
    join(vaultPath, 'KnowPipe', '知識庫', '工具', `${topic}.md`),
  ];
  for (const p of candidates) {
    try { return await readFile(p, 'utf-8'); } catch { /* try next */ }
  }
  return '';
}

/** 生成草稿 Markdown 正文 */
async function generateDraftContent(
  topic: string,
  notes: DraftNote[],
  wikiContext: string,
  wordTarget: number,
): Promise<string> {
  const noteLines = notes
    .map((n, i) => `${i + 1}. 【${n.title}】${n.summary ? '：' + n.summary.slice(0, 150) : ''}`)
    .join('\n');

  const wikiSection = wikiContext
    ? `\n參考知識背景：\n${wikiContext.slice(0, 1000)}`
    : '';

  const lengthGuide = wordTarget >= 1800
    ? '1800-2500 字，需要引言、三個主要觀點段落、實作啟示和結語，每段有充分論述'
    : '900-1200 字，有引言、兩個主要觀點、結語';

  const prompt = `你是知識管理助手。請根據以下筆記，用繁體中文撰寫一篇 ${lengthGuide} 的深度文章草稿，要有獨立觀點，不要只是列清單。

主題：${topic}
素材筆記（${notes.length} 篇）：
${noteLines}
${wikiSection}

文章結構要求：
1. 引言：點出核心問題或令人意外的矛盾（100-150 字）
2. 主要觀點（${wordTarget >= 1800 ? '三段，各 400-600 字，有具體論據' : '兩段，各 300-400 字，有論據'}）
3. 實作或應用啟示（具體可行，非泛泛而談）
4. 結語：留一個開放問題或邀請讀者思考

格式要求：
- 直接輸出 Markdown 正文，不要 frontmatter，不要前言
- 在引用特定筆記觀點時，加入 Obsidian 連結格式：[[筆記檔名|筆記標題]]
- 用二級標題（##）分節`;

  return await runLocalLlmPrompt(prompt, { task: 'summarize' }) ?? '';
}

/**
 * 主入口：生成草稿並存入 Vault/Drafts/
 */
export async function generateDraft(
  vaultPath: string,
  topic: string,
  opts: { days?: number; long?: boolean },
): Promise<DraftResult | null> {
  const days = opts.days ?? 30;
  const wordTarget = opts.long ? 2000 : 1000;

  const notes = await findRelevantNotes(vaultPath, topic, days);
  if (notes.length === 0) return null;

  const wikiContext = await loadTopicWiki(vaultPath, topic);
  const body = await generateDraftContent(topic, notes, wikiContext, wordTarget);
  if (!body) return null;

  const today = new Date().toISOString().slice(0, 10);
  const topicSlug = topic.replace(/[<>:"/\\|?* /]/g, '-').slice(0, 40);
  const filename = `draft-${topicSlug}-${today}.md`;

  const noteLinks = notes
    .map(n => `- [[${n.filename}|${n.title}]]`)
    .join('\n');

  const fullContent = [
    '---',
    `title: "${topic} 草稿 ${today}"`,
    `date: ${today}`,
    `category: draft`,
    `topic: "${topic}"`,
    `source_notes: ${notes.length}`,
    `word_target: ${wordTarget}`,
    '---',
    '',
    body,
    '',
    '---',
    '',
    '## 素材來源',
    '',
    noteLinks,
    '',
  ].join('\n');

  const outDir = join(vaultPath, 'Drafts');
  await mkdir(outDir, { recursive: true });
  const savedPath = join(outDir, filename);
  await writeFile(savedPath, fullContent, 'utf-8');

  return { savedPath, filename, noteCount: notes.length, wordTarget };
}
