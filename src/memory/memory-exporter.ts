/**
 * Cross-tool memory exporter — exports vault knowledge as context files
 * consumable by other AI tools (Claude Code, Cursor, etc.).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { logger } from '../core/logger.js';

export type ExportFormat = 'claude' | 'cursor' | 'json';

interface VaultStats {
  totalNotes: number;
  topCategories: Array<{ category: string; count: number }>;
  topKeywords: Array<{ keyword: string; count: number }>;
  platforms: Array<{ platform: string; count: number }>;
  dateRange: { oldest: string; newest: string };
}

/** Parse frontmatter value. */
function fm(head: string, field: string): string {
  const m = head.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function parseList(head: string, field: string): string[] {
  const m = head.match(new RegExp(`^${field}:\\s*\\[(.+?)\\]`, 'm'));
  if (!m) return [];
  return m[1].split(',').map(k => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Collect vault statistics for export. */
async function collectVaultStats(vaultPath: string): Promise<VaultStats> {
  const files = await getAllMdFiles(join(vaultPath, 'KnowPipe'));
  const catCount = new Map<string, number>();
  const kwCount = new Map<string, number>();
  const platCount = new Map<string, number>();
  let oldest = '9999-99-99';
  let newest = '0000-00-00';

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const head = fmMatch[1];

      const category = fm(head, 'category') || '其他';
      catCount.set(category, (catCount.get(category) ?? 0) + 1);

      const platform = fm(head, 'source');
      if (platform) platCount.set(platform, (platCount.get(platform) ?? 0) + 1);

      for (const kw of parseList(head, 'keywords')) {
        kwCount.set(kw, (kwCount.get(kw) ?? 0) + 1);
      }

      const date = fm(head, 'date');
      if (date) {
        if (date < oldest) oldest = date;
        if (date > newest) newest = date;
      }
    } catch { /* skip */ }
  }

  const sortMap = (m: Map<string, number>, limit: number) =>
    [...m.entries()].sort(([, a], [, b]) => b - a).slice(0, limit)
      .map(([k, v]) => ({ [k.includes('category') ? 'category' : k.includes('platform') ? 'platform' : 'keyword']: k, count: v }));

  return {
    totalNotes: files.length,
    topCategories: [...catCount.entries()].sort(([, a], [, b]) => b - a).slice(0, 15)
      .map(([category, count]) => ({ category, count })),
    topKeywords: [...kwCount.entries()].sort(([, a], [, b]) => b - a).slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count })),
    platforms: [...platCount.entries()].sort(([, a], [, b]) => b - a)
      .map(([platform, count]) => ({ platform, count })),
    dateRange: { oldest, newest },
  };
}

/** Generate CLAUDE.md context snippet. */
function formatClaude(stats: VaultStats): string {
  const cats = stats.topCategories.slice(0, 10)
    .map(c => `  - ${c.category}（${c.count} 篇）`).join('\n');
  const kws = stats.topKeywords.slice(0, 15)
    .map(k => k.keyword).join('、');
  const plats = stats.platforms
    .map(p => `${p.platform}(${p.count})`).join('、');

  return [
    '# Vault 知識上下文（自動生成）',
    '',
    `> 資料範圍：${stats.dateRange.oldest} ~ ${stats.dateRange.newest}`,
    `> 共 ${stats.totalNotes} 篇筆記`,
    '',
    '## 主要知識領域',
    cats,
    '',
    '## 常見關鍵字',
    kws,
    '',
    '## 內容來源',
    plats,
    '',
    '## 建議',
    '- 用戶主要關注 AI 工具生態和程式設計領域',
    '- 回覆請使用繁體中文',
    '- 提及工具時可參考 Vault 中已收集的相關筆記',
  ].join('\n');
}

/** Generate .cursorrules context snippet. */
function formatCursor(stats: VaultStats): string {
  const cats = stats.topCategories.slice(0, 5)
    .map(c => c.category).join('、');
  const kws = stats.topKeywords.slice(0, 10)
    .map(k => k.keyword).join('、');

  return [
    '# Project Context (auto-generated from Obsidian Vault)',
    '',
    `Knowledge base: ${stats.totalNotes} notes spanning ${stats.dateRange.oldest} to ${stats.dateRange.newest}`,
    `Primary domains: ${cats}`,
    `Key technologies: ${kws}`,
    '',
    '## Conventions',
    '- Language: Traditional Chinese (繁體中文) for all user-facing text',
    '- TypeScript preferred, no LLM SDK dependencies',
    '- File limit: 300 lines per .ts file',
  ].join('\n');
}

/** Generate JSON export. */
function formatJson(stats: VaultStats): string {
  return JSON.stringify(stats, null, 2);
}

/**
 * Export vault knowledge in the specified format.
 * @returns Path to the exported file.
 */
export async function exportMemory(
  vaultPath: string, format: ExportFormat,
): Promise<{ path: string; stats: VaultStats }> {
  const stats = await collectVaultStats(vaultPath);
  const exportDir = join(vaultPath, 'KnowPipe', '.exports');
  await mkdir(exportDir, { recursive: true });

  const formatters: Record<ExportFormat, { fn: (s: VaultStats) => string; ext: string }> = {
    claude: { fn: formatClaude, ext: 'CLAUDE-CONTEXT.md' },
    cursor: { fn: formatCursor, ext: '.cursorrules-context' },
    json: { fn: formatJson, ext: 'vault-stats.json' },
  };

  const { fn, ext } = formatters[format];
  const content = fn(stats);
  const filePath = join(exportDir, ext);
  await writeFile(filePath, content, 'utf-8');

  logger.info('memory-export', '匯出完成', { format, path: filePath, notes: stats.totalNotes });
  return { path: filePath, stats };
}

/** Export all formats at once. */
export async function exportAll(vaultPath: string): Promise<string[]> {
  const formats: ExportFormat[] = ['claude', 'cursor', 'json'];
  const paths: string[] = [];
  for (const fmt of formats) {
    const { path } = await exportMemory(vaultPath, fmt);
    paths.push(path);
  }
  return paths;
}
