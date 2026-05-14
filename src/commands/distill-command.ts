/**
 * /preferences — show user preference profile from Vault metadata.
 * /distill [conflicts|gaps] — knowledge distillation report and analysis tools.
 *   /distill          → existing distillation report (core principles + archive candidates)
 *   /distill conflicts → 矛盾偵測：找出 Vault 中互相衝突的觀點
 *   /distill gaps      → 知識缺口地圖：找出覆蓋不足的領域
 */
import type { Context } from 'telegraf';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../utils/config.js';
import { scanVaultNotes, loadKnowledge } from '../knowledge/knowledge-store.js';
import { extractPreferences, formatDetailedReport } from '../knowledge/preference-extractor.js';
import { distillVault, formatDistillReport, generateDistillVisualPrompt } from '../knowledge/distiller.js';
import { findConflicts, formatConflictsReport } from '../knowledge/conflict-analyzer.js';
import { findGaps, formatGapsReport } from '../knowledge/gap-analyzer.js';
import { replyEmptyKnowledge } from './reply-buttons.js';
import { splitMessage } from '../utils/telegram.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

const SPARKLINE_CHARS = '▁▂▃▄▅▆▇█';

function getQuarterKey(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  return values.map((v) => {
    const idx = range === 0 ? 4 : Math.round(((v - min) / range) * (SPARKLINE_CHARS.length - 1));
    return SPARKLINE_CHARS[idx];
  }).join('');
}

/** Scan Vault frontmatter to build quarterly skill depth report */
export async function buildSkillGrowthReport(vaultPath: string): Promise<string> {
  const notesDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(notesDir);

  // quarterKey → category → keywordCounts[]
  const data = new Map<string, Map<string, number[]>>();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);

  for (const fp of files) {
    try {
      const raw = await readFile(fp, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const fmText = fmMatch[1];

      const getField = (f: string) => fmText.match(new RegExp(`^${f}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? '';
      const dateStr = getField('date');
      if (!dateStr) continue;
      const date = new Date(dateStr);
      if (isNaN(date.getTime()) || date < cutoff) continue;

      const root = (getField('category') || '其他').split('/')[0] ?? '其他';
      const qKey = getQuarterKey(date);
      const kwMatch = fmText.match(/^keywords:\s*\[(.+)\]/m);
      const kwCount = kwMatch ? kwMatch[1].split(',').filter((s) => s.trim().length > 0).length : 0;

      if (!data.has(qKey)) data.set(qKey, new Map());
      const catMap = data.get(qKey)!;
      const arr = catMap.get(root) ?? [];
      arr.push(kwCount);
      catMap.set(root, arr);
    } catch { /* skip */ }
  }

  if (data.size === 0) return '';

  const quarters = [...data.keys()].sort().slice(-4);

  // Top 5 categories by total note count across selected quarters
  const catTotals = new Map<string, number>();
  for (const q of quarters) {
    for (const [cat, counts] of (data.get(q) ?? new Map()).entries()) {
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + counts.length);
    }
  }
  const topCats = [...catTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);

  const lines = ['', '---', '📈 技能成長趨勢（近 4 季）', '', `季度：${quarters.join(' → ')}`, ''];
  for (const cat of topCats) {
    const depths = quarters.map((q) => {
      const counts = data.get(q)?.get(cat) ?? [];
      return counts.length > 0 ? counts.reduce((s, n) => s + n, 0) / counts.length : 0;
    });
    const total = quarters.reduce((s, q) => s + (data.get(q)?.get(cat)?.length ?? 0), 0);
    lines.push(`${cat}（${total} 篇）${sparkline(depths)}`);
  }
  lines.push('', '深度指數 = 平均 keywords 數（越高 = 記錄越精細）');
  return lines.join('\n');
}

/** /preferences — user preference profile */
export async function handlePreferences(ctx: Context, config: AppConfig): Promise<void> {
  await ctx.reply('📊 正在分析 Vault 偏好模型…');

  const notes = await scanVaultNotes(config.vaultPath);
  if (notes.length === 0) {
    await ctx.reply('Vault 中沒有找到筆記。');
    return;
  }

  const knowledge = await loadKnowledge();
  const hasKnowledge = Object.keys(knowledge.notes).length > 0;
  const profile = extractPreferences(notes, hasKnowledge ? knowledge : undefined);
  const report = formatDetailedReport(profile);

  for (const chunk of splitMessage(report)) {
    await ctx.reply(chunk);
  }
}

/** /distill — knowledge distillation report (core mode) */
export async function handleDistill(ctx: Context, config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('🧪 正在蒸餾知識…');

  const notes = await scanVaultNotes(config.vaultPath);
  const report = distillVault(notes, knowledge);
  const text = formatDistillReport(report);

  for (const chunk of splitMessage(text)) {
    await ctx.reply(chunk);
  }

  // Visual prompt: generate async, send as follow-up if successful
  const visualPrompt = await generateDistillVisualPrompt(report).catch(() => null);
  if (visualPrompt) {
    await ctx.reply(`🎨 視覺化提示詞（可直接用於 Midjourney / DALL-E / 通義萬相）：\n\n${visualPrompt}`);
  }

  const growthReport = await buildSkillGrowthReport(config.vaultPath).catch(() => '');
  if (growthReport) {
    await ctx.reply(growthReport);
  }
}

/** /distill conflicts — 矛盾偵測 */
export async function handleDistillConflicts(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('⚡ 正在掃描 Vault 矛盾點…');
  const conflicts = findConflicts(knowledge);
  const report = formatConflictsReport(conflicts);

  for (const chunk of splitMessage(report)) {
    await ctx.reply(chunk);
  }
}

/** /distill gaps — 知識缺口地圖 */
export async function handleDistillGaps(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  await ctx.reply('🗺 正在繪製知識缺口地圖…');
  const gaps = findGaps(knowledge);
  const report = formatGapsReport(gaps);

  for (const chunk of splitMessage(report)) {
    await ctx.reply(chunk);
  }
}

/** /distill 路由 — 根據參數分派子指令 */
export async function handleDistillRouter(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const arg = text.replace(/^\/distill\s*/i, '').trim().toLowerCase();

  if (arg === 'conflicts') return handleDistillConflicts(ctx, config);
  if (arg === 'gaps') return handleDistillGaps(ctx, config);

  // No arg or unrecognised → existing distill report
  return handleDistill(ctx, config);
}
