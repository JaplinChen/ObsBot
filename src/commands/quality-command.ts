/**
 * /quality — Vault quality report.
 * Scans all vault notes and reports issues: empty summary, missing keywords,
 * short content, missing category, HTML remnants.
 */
import type { Context } from 'telegraf';
import { readFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { VAULT_SUBFOLDER, type AppConfig } from '../utils/config.js';
import { logger } from '../core/logger.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

interface QualityIssue {
  file: string;
  issues: string[];
}

interface QualityReport {
  totalNotes: number;
  issueNoteCount: number;
  issueBreakdown: Record<string, number>;
  worstOffenders: QualityIssue[];
}

const HTML_TAG_RE = /<(?:div|span|br|p|a|img|table|tr|td|th|ul|ol|li|h[1-6])\b/i;
const SKIP_FILES = new Set(['知識地圖.md', '知識庫摘要.md']);

async function scanAllNotes(rootDir: string, results: QualityIssue[]): Promise<number> {
  const files = await getAllMdFiles(rootDir);
  let total = 0;

  for (const fullPath of files) {
    if (SKIP_FILES.has(basename(fullPath))) continue;
    total++;
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const issues = checkNote(raw);
      if (issues.length > 0) {
        const relPath = fullPath.replace(new RegExp('.*' + VAULT_SUBFOLDER + '[\\\\/]'), '');
        results.push({ file: relPath, issues });
      }
    } catch { /* skip unreadable */ }
  }
  return total;
}

function checkNote(raw: string): string[] {
  const issues: string[] = [];
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    issues.push('缺少 frontmatter');
    return issues;
  }

  const fm = fmMatch[1];
  const body = raw.slice(fmMatch[0].length).trim();

  // Frontmatter checks
  if (!fm.match(/^title:\s*.+/m)) issues.push('缺少 title');
  if (!fm.match(/^url:\s*.+/m)) issues.push('缺少 url');
  if (!fm.match(/^date:\s*.+/m)) issues.push('缺少 date');
  if (!fm.match(/^category:\s*.+/m)) issues.push('缺少 category');

  const summaryMatch = fm.match(/^summary:\s*"?(.*?)"?\s*$/m);
  if (!summaryMatch || summaryMatch[1].trim().length === 0) issues.push('空白摘要');

  const kwMatch = fm.match(/^keywords:\s*\[(.*)\]/m);
  if (!kwMatch || kwMatch[1].trim().length === 0) issues.push('缺少關鍵字');

  // Body checks
  if (body.length < 50) issues.push('空正文');
  if (HTML_TAG_RE.test(body)) issues.push('HTML 殘留');

  return issues;
}

async function generateReport(vaultPath: string): Promise<QualityReport> {
  const rootDir = join(vaultPath, VAULT_SUBFOLDER);
  const issues: QualityIssue[] = [];
  const totalNotes = await scanAllNotes(rootDir, issues);

  // Build breakdown
  const breakdown: Record<string, number> = {};
  for (const item of issues) {
    for (const issue of item.issues) {
      breakdown[issue] = (breakdown[issue] ?? 0) + 1;
    }
  }

  // Sort by most issues
  issues.sort((a, b) => b.issues.length - a.issues.length);

  return { totalNotes, issueNoteCount: issues.length, issueBreakdown: breakdown, worstOffenders: issues.slice(0, 10) };
}

export async function handleQuality(ctx: Context, config: AppConfig): Promise<void> {
  const status = await ctx.reply('正在掃描 Vault 品質...');

  try {
    const report = await generateReport(config.vaultPath);

    const lines = [
      'Vault 品質報告',
      `掃描：${report.totalNotes} 篇筆記`,
      '',
    ];

    const breakdownEntries = Object.entries(report.issueBreakdown).sort((a, b) => b[1] - a[1]);
    if (breakdownEntries.length === 0) {
      lines.push('✅ 所有筆記品質良好！');
    } else {
      lines.push(`問題筆記：${report.issueNoteCount} 篇${report.issueNoteCount > report.worstOffenders.length ? '（顯示前 ' + report.worstOffenders.length + ' 篇）' : ''}`);
      lines.push('');
      for (const [issue, count] of breakdownEntries) {
        const bar = '█'.repeat(Math.min(Math.round(count / report.totalNotes * 20), 20));
        lines.push(`${issue}：${count} 篇 ${bar}`);
      }

      if (report.worstOffenders.length > 0) {
        lines.push('', '最嚴重（前 10）：');
        for (const item of report.worstOffenders) {
          lines.push(`• ${item.file} — ${item.issues.join('、')}`);
        }
      }

      lines.push('', '建議：/reprocess --all --since 30d 更新 AI 豐富內容');
    }

    await ctx.reply(lines.join('\n'));
    logger.info('quality', '報告完成', { total: report.totalNotes, issues: breakdownEntries.length });
  } catch (err) {
    await ctx.reply(`品質掃描失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
