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
}

/**
 * Save a report as an Obsidian-compatible markdown note.
 * @returns The absolute path of the saved file.
 */
export async function saveReportToVault(
  vaultPath: string,
  report: ReportMeta,
): Promise<string> {
  const outDir = join(vaultPath, 'ObsBot', '知識整合');
  const outPath = join(outDir, `${report.filePrefix}-${report.date}.md`);

  const escaped = (s: string) => s.replace(/"/g, '\\"');

  const lines: string[] = [
    '---',
    `title: "${escaped(report.title)}"`,
    `date: ${report.date}`,
    `category: 知識整合`,
    `tags: [${report.tags.join(', ')}]`,
    '---',
    '',
    `# ${report.title}`,
  ];

  if (report.subtitle) {
    lines.push(`> ${report.subtitle}`);
    lines.push('');
  }

  lines.push(report.content);
  lines.push('');
  lines.push('---');
  lines.push(`*自動產生 by ObsBot — ${new Date().toISOString().slice(0, 19)}*`);

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, lines.join('\n'), 'utf-8');
  logger.info('report-saver', '報告已存入 Vault', { path: outPath });

  return outPath;
}
