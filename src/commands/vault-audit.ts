/**
 * /vault audit — 平行掃描 Vault Inbox 品質報告
 * 分拆自 vault-hub-ext.ts（超過 300 行限制）
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { startTyping, stopTyping } from '../utils/typing-indicator.js';

interface AuditFinding {
  file: string;
  issueType: 'boilerplate' | 'untranslated' | 'json_embedded' | 'missing_frontmatter' | 'orphan_no_backlink';
  severity: 'P1' | 'P2' | 'P3';
  suggestedFix: string;
  autoFixable: boolean;
}

const BOILERPLATE_PATTERNS = [
  /subscribe to (our|the) newsletter/i, /rss feed/i, /all rights reserved/i,
  /follow us on (twitter|x|instagram)/i, /©\s*\d{4}/,
];
const JSON_EMBEDDED = /^\s*\{[\s\S]{0,200}"[^"]+"\s*:/m;

async function auditShard(files: string[], vaultPath: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const absPath of files) {
    const relPath = relative(vaultPath, absPath);
    let content: string;
    try { content = await readFile(absPath, 'utf-8'); } catch { continue; }

    if (!content.startsWith('---')) {
      findings.push({ file: relPath, issueType: 'missing_frontmatter', severity: 'P1', suggestedFix: '新增基本 frontmatter（title, date）', autoFixable: false });
    }
    if (BOILERPLATE_PATTERNS.some((p) => p.test(content))) {
      findings.push({ file: relPath, issueType: 'boilerplate', severity: 'P2', suggestedFix: '移除頁腳樣板文字', autoFixable: false });
    }
    if (JSON_EMBEDDED.test(content)) {
      findings.push({ file: relPath, issueType: 'json_embedded', severity: 'P1', suggestedFix: '執行 /vault heal 自動清除嵌入 JSON', autoFixable: true });
    }
    const chineseRatio = (content.match(/[一-鿿]/g) ?? []).length / Math.max(content.length, 1);
    const hasEnglishHeaders = /^#{1,3} [A-Z]/m.test(content);
    if (chineseRatio > 0.3 && hasEnglishHeaders) {
      findings.push({ file: relPath, issueType: 'untranslated', severity: 'P2', suggestedFix: '執行 /reprocess --filter untranslated', autoFixable: false });
    }
  }
  return findings;
}

/** /vault audit — 平行掃描 inbox，生成品質報告 */
export async function handleVaultAudit(ctx: Context, config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  await ctx.reply('🔍 開始平行 Vault 品質審查，請稍候…');

  try {
    const inboxPath = join(config.vaultPath, 'Inbox');
    const allRelPaths = await readdir(inboxPath, { recursive: true }) as string[];
    const mdFiles = allRelPaths
      .filter((name) => name.endsWith('.md'))
      .map((name) => join(inboxPath, name));

    if (mdFiles.length === 0) {
      stopTyping(typing);
      await ctx.reply('✅ Inbox 為空，無需審查。');
      return;
    }

    const SHARD_COUNT = Math.min(8, mdFiles.length);
    const shards: string[][] = Array.from({ length: SHARD_COUNT }, () => []);
    mdFiles.forEach((f, i) => shards[i % SHARD_COUNT].push(f));

    const allFindings = (await Promise.all(shards.map((s) => auditShard(s, config.vaultPath)))).flat();
    const p1 = allFindings.filter((f) => f.severity === 'P1');
    const p2 = allFindings.filter((f) => f.severity === 'P2');
    const autoFixable = allFindings.filter((f) => f.autoFixable);
    const byType: Record<string, number> = {};
    for (const f of allFindings) byType[f.issueType] = (byType[f.issueType] ?? 0) + 1;

    const today = new Date().toISOString().slice(0, 10);
    await mkdir(join(config.vaultPath, 'Reports'), { recursive: true });
    const reportLines = [
      `# Vault 品質審查報告 ${today}`,
      `掃描：${mdFiles.length} 篇｜發現：${allFindings.length} 個問題`,
      '', '## 依類型統計',
      ...Object.entries(byType).map(([t, n]) => `- ${t}: ${n}`),
      '', '## P1 問題（需立即處理）',
      ...p1.slice(0, 50).map((f) => `- [ ] \`${f.file}\` — ${f.issueType}：${f.suggestedFix}`),
      '', '## P2 問題',
      ...p2.slice(0, 30).map((f) => `- [ ] \`${f.file}\` — ${f.issueType}：${f.suggestedFix}`),
    ];
    await writeFile(join(config.vaultPath, 'Reports', `vault-audit-${today}.md`), reportLines.join('\n'), 'utf-8');

    stopTyping(typing);
    const summary = [
      `📊 Vault 品質審查完成`,
      `掃描 ${mdFiles.length} 篇 | 發現 ${allFindings.length} 個問題`,
      `P1 ${p1.length} 個 | P2 ${p2.length} 個 | 可自動修復 ${autoFixable.length} 個`,
      '',
      ...Object.entries(byType).map(([t, n]) => `  • ${t}: ${n}`),
      `\n📄 報告已存至 Reports/vault-audit-${today}.md`,
      autoFixable.length > 0 ? `\n💡 執行 /vault heal 自動修復 ${autoFixable.length} 個問題` : '',
    ].filter(Boolean);
    await ctx.reply(summary.join('\n'));
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`審查失敗：${String(err)}`);
  }
}
