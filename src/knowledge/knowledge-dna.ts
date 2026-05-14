/**
 * Knowledge DNA — 從 Vault frontmatter 分析用戶知識指紋。
 * 計算：全域 keyword 頻率、category 分佈、近期學習重心轉移、知識空白帶。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

interface NoteRecord {
  title: string;
  category: string;
  keywords: string[];
  date: Date | null;
}

interface DnaReport {
  totalNotes: number;
  topKeywords: Array<{ keyword: string; count: number }>;
  categoryDist: Array<{ category: string; count: number; topKeywords: string[] }>;
  recentShift: { added: string[]; fading: string[] };
  blindSpots: string[];
  generatedAt: string;
}

function parseFrontmatter(raw: string): Map<string, string> {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return new Map();
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') { end = i; break; }
  }
  if (end === -1) return new Map();
  const m = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const ci = line.indexOf(':');
    if (ci >= 0) m.set(line.slice(0, ci).trim(), line.slice(ci + 1).trim());
  }
  return m;
}

function parseKeywordsArray(val: string): string[] {
  const m = val.match(/\[(.+)\]/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter((s) => s.length >= 2);
}

async function scanNotes(vaultPath: string): Promise<NoteRecord[]> {
  const notesDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(notesDir);
  const records: NoteRecord[] = [];

  for (const fp of files) {
    try {
      const raw = await readFile(fp, 'utf-8');
      const fm = parseFrontmatter(raw);
      const title = (fm.get('title') ?? '').replace(/^["']|["']$/g, '');
      const category = (fm.get('category') ?? '其他').replace(/^["']|["']$/g, '');
      const keywords = parseKeywordsArray(fm.get('keywords') ?? '');
      const dateStr = (fm.get('date') ?? '').replace(/^["']|["']$/g, '');
      const date = dateStr ? new Date(dateStr) : null;
      if (title) records.push({ title, category, keywords, date });
    } catch { /* skip */ }
  }
  return records;
}

export async function computeKnowledgeDNA(vaultPath: string): Promise<DnaReport> {
  const notes = await scanNotes(vaultPath);
  if (notes.length === 0) {
    return {
      totalNotes: 0,
      topKeywords: [],
      categoryDist: [],
      recentShift: { added: [], fading: [] },
      blindSpots: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const now = new Date();
  const recent30 = notes.filter((n) => n.date && (now.getTime() - n.date.getTime()) < 30 * 86400_000);
  const older = notes.filter((n) => n.date && (now.getTime() - n.date.getTime()) >= 30 * 86400_000);

  // 全域 keyword 頻率
  const globalFreq = new Map<string, number>();
  for (const n of notes) {
    for (const kw of n.keywords) {
      globalFreq.set(kw, (globalFreq.get(kw) ?? 0) + 1);
    }
  }
  const topKeywords = [...globalFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([keyword, count]) => ({ keyword, count }));

  // Category 分佈 + 每個 category 的 Top 5 keywords
  const catMap = new Map<string, { count: number; kwFreq: Map<string, number> }>();
  for (const n of notes) {
    const root = n.category.split('/')[0] ?? n.category;
    const entry = catMap.get(root) ?? { count: 0, kwFreq: new Map() };
    entry.count++;
    for (const kw of n.keywords) {
      entry.kwFreq.set(kw, (entry.kwFreq.get(kw) ?? 0) + 1);
    }
    catMap.set(root, entry);
  }
  const categoryDist = [...catMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([category, { count, kwFreq }]) => ({
      category,
      count,
      topKeywords: [...kwFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([kw]) => kw),
    }));

  // 學習重心轉移：近 30 天新出現的 keyword vs 舊有但近期沒出現的
  const recentKws = new Set<string>();
  for (const n of recent30) { for (const kw of n.keywords) recentKws.add(kw); }
  const olderKws = new Set<string>();
  for (const n of older) { for (const kw of n.keywords) olderKws.add(kw); }

  const added = [...recentKws].filter((kw) => !olderKws.has(kw)).slice(0, 8);
  const fading = [...olderKws].filter((kw) => !recentKws.has(kw))
    .filter((kw) => (globalFreq.get(kw) ?? 0) >= 5)  // 只列有一定基礎的
    .slice(0, 8);

  // 知識空白帶：Top keywords 中，category 覆蓋率最低的主題
  const kwCatCoverage = new Map<string, Set<string>>();
  for (const n of notes) {
    const root = n.category.split('/')[0] ?? n.category;
    for (const kw of n.keywords) {
      const s = kwCatCoverage.get(kw) ?? new Set();
      s.add(root);
      kwCatCoverage.set(kw, s);
    }
  }
  const blindSpots = [...globalFreq.entries()]
    .filter(([kw, cnt]) => cnt >= 3 && (kwCatCoverage.get(kw)?.size ?? 0) <= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);

  return {
    totalNotes: notes.length,
    topKeywords,
    categoryDist,
    recentShift: { added, fading },
    blindSpots,
    generatedAt: new Date().toISOString(),
  };
}

export function formatDnaReport(dna: DnaReport): string {
  const lines: string[] = [
    `# 知識 DNA 報告`,
    `> 生成時間：${new Date(dna.generatedAt).toLocaleString('zh-TW')}`,
    `> 分析筆記總數：**${dna.totalNotes} 篇**`,
    '',
    '## 知識指紋 — Top 20 關鍵字',
    '',
    dna.topKeywords.map((k) => `- **${k.keyword}** (${k.count} 篇)`).join('\n'),
    '',
    '## 分類分佈',
    '',
    ...dna.categoryDist.slice(0, 10).map((c) =>
      `- **${c.category}**（${c.count} 篇）：${c.topKeywords.join('、') || '—'}`
    ),
    '',
    '## 近 30 天學習重心轉移',
    '',
    `**新出現的主題**：${dna.recentShift.added.length > 0 ? dna.recentShift.added.join('、') : '無明顯新增'}`,
    `**逐漸淡出的主題**：${dna.recentShift.fading.length > 0 ? dna.recentShift.fading.join('、') : '無'}`,
    '',
    '## 知識空白帶',
    '',
    dna.blindSpots.length > 0
      ? dna.blindSpots.map((kw) => `- ${kw}（跨類別覆蓋不足，可深化）`).join('\n')
      : '（無明顯空白帶，知識覆蓋均衡）',
  ];
  return lines.join('\n');
}
