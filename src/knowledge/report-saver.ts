/**
 * Generic report saver — writes any structured report as an Obsidian Vault note.
 * Reusable by digest, explore, and proactive modules.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../core/logger.js';

export interface ReportMeta {
  /** Report title (used in frontmatter and H1) */
  title: string;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Markdown body content */
  content: string;
  /** Frontmatter tags */
  tags: string[];
  /** File name prefix (e.g. 'weekly', 'compare') */
  filePrefix: string;
  /** Optional subtitle shown as blockquote under H1 */
  subtitle?: string;
  /** Optional tool type written to frontmatter (e.g. 'report', 'anki') */
  tool?: string;
}

/** CJK 字元視為 2 個寬度單位 */
function charWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    const cp = c.codePointAt(0) ?? 0;
    w += (cp >= 0x1100 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7ff) || (cp >= 0xf900 && cp <= 0xfaff) ? 2 : 1;
  }
  return w;
}

function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - charWidth(s)));
}

/**
 * 標準化 Markdown 表格：對齊欄位，確保分隔行存在。
 * 只處理連續的表格行（以 | 開頭結尾的行）。
 */
function normalizeTable(rows: string[]): string[] {
  const cells = rows.map((r) =>
    r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()),
  );
  const colCount = Math.max(...cells.map((r) => r.length));
  // 確保每行欄數一致
  const padded = cells.map((r) => [...r, ...Array(colCount - r.length).fill('')]);
  // 偵測並移除分隔行（---、:---: 等）
  const sepIdx = padded.findIndex((r) => r.every((c) => /^:?-+:?$/.test(c)));
  const dataRows = sepIdx >= 0 ? padded.filter((_, i) => i !== sepIdx) : padded;
  if (dataRows.length === 0) return rows;
  // 計算各欄最大寬度（最少 3，讓分隔行有效）
  const widths = Array.from({ length: colCount }, (_, ci) =>
    Math.max(3, ...dataRows.map((r) => charWidth(r[ci] ?? ''))),
  );
  const result: string[] = [];
  dataRows.forEach((r, ri) => {
    result.push('| ' + r.map((c, ci) => padEnd(c, widths[ci])).join(' | ') + ' |');
    if (ri === 0) result.push('| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |');
  });
  return result;
}

/** 對內容中所有表格區段套用標準化 */
function formatTables(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let tableRows: string[] = [];

  const isTableRow = (l: string) => /^\s*\|.+\|/.test(l);

  const flush = () => {
    if (tableRows.length > 0) {
      out.push(...normalizeTable(tableRows));
      tableRows = [];
    }
  };

  for (const line of lines) {
    if (isTableRow(line)) {
      tableRows.push(line.trim());
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/**
 * Save a report as an Obsidian-compatible markdown note.
 * @returns The absolute path of the saved file.
 */
export async function saveReportToVault(
  vaultPath: string,
  report: ReportMeta,
): Promise<string> {
  const outDir = join(vaultPath, '知識整合');
  const outPath = join(outDir, `${report.filePrefix}-${report.date}.md`);

  const escaped = (s: string) => s.replace(/"/g, '\\"');

  const lines: string[] = [
    '---',
    `title: "${escaped(report.title)}"`,
    `date: ${report.date}`,
    `category: 知識整合`,
    `tags: [${report.tags.join(', ')}]`,
    ...(report.tool ? [`tool: ${report.tool}`] : []),
    '---',
    '',
    `# ${report.title}`,
  ];

  if (report.subtitle) {
    lines.push(`> ${report.subtitle}`);
    lines.push('');
  }

  const body = formatTables(report.content.replace(/\n+$/, ''));
  lines.push(body);
  lines.push('');
  lines.push('');
  lines.push('---');
  lines.push(`*自動產生 by KnowPipe — ${new Date().toISOString().slice(0, 19)}*`);

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, lines.join('\n'), 'utf-8');
  logger.info('report-saver', '報告已存入 Vault', { path: outPath });

  return outPath;
}
