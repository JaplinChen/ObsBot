/**
 * /reformat — Batch reformat vault notes for better readability.
 * Fixes wall-of-text, inline numbered items, and missing paragraph breaks.
 *
 * Usage:
 *   /reformat --dry-run          Scan and report, no changes
 *   /reformat --all              Fix all notes with formatting issues
 *   /reformat --all --since 30d  Fix notes from the last 30 days
 *   /reformat --llm              Use LLM for complex cases (after rules)
 *   /reformat AI/工具/xxx.md     Fix a single note
 */
import type { Context } from 'telegraf';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../utils/config.js';
import { logger } from '../core/logger.js';
import { scanVaultNotes } from '../knowledge/knowledge-store.js';
import { reformatNoteBody } from '../formatters/body-reformatter.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { isOmlxAvailable, omlxChatCompletion } from '../utils/omlx-client.js';

interface ParsedArgs {
  mode: 'single' | 'batch';
  path?: string;
  sinceDays?: number;
  dryRun: boolean;
  useLlm: boolean;
}

function parseArgs(text: string): ParsedArgs | null {
  const args = text.replace(/^\/reformat\s*/, '').replace(/\u2014/g, '--').replace(/\u2013/g, '--').trim();
  if (!args) return null;

  if (args.startsWith('--')) {
    const dryRun = args.includes('--dry-run');
    const useLlm = args.includes('--llm');
    const sinceMatch = args.match(/--since\s+(\d+)d/);
    const sinceDays = sinceMatch ? parseInt(sinceMatch[1], 10) : undefined;
    return { mode: 'batch', sinceDays, dryRun, useLlm };
  }

  return { mode: 'single', path: args, dryRun: false, useLlm: false };
}

/** Check if a note body still has wall-of-text after rule-based reformat */
function hasRemainingWall(content: string): boolean {
  const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
  if (fmEnd === -1) return false;
  const firstHeading = content.indexOf('\n## ', fmEnd + 3);
  const bodyEnd = firstHeading !== -1 ? firstHeading : content.length;
  const body = content.slice(fmEnd + 3, bodyEnd);

  return body.split(/\n\n+/).some(p => p.replace(/\n/g, '').trim().length > 500);
}

/** LLM-based reformat for complex cases */
async function reformatWithLlm(noteContent: string): Promise<string | null> {
  if (!(await isOmlxAvailable())) return null;

  const fmEnd = noteContent.indexOf('---', noteContent.indexOf('---') + 3);
  if (fmEnd === -1) return null;
  const afterFm = fmEnd + 3;
  const firstHeading = noteContent.indexOf('\n## ', afterFm);
  const bodyEnd = firstHeading !== -1 ? firstHeading : noteContent.length;
  const body = noteContent.slice(afterFm, bodyEnd).trim();
  if (body.length < 300) return null;

  const prompt = [
    '你是 Markdown 排版助手。請將以下內容重新排版，讓閱讀體驗更好。',
    '規則：',
    '- 不改變任何文字內容，只調整換行和格式',
    '- 將內嵌的編號項目拆分為正式 Markdown 列表',
    '- 長段落在句子邊界處斷行',
    '- 保持所有 URL 連結不變',
    '- 只回傳排版後的文字，不加任何說明',
    '',
    '原文：',
    body,
  ].join('\n');

  const response = await omlxChatCompletion(prompt, { timeoutMs: 30_000 });
  if (!response || response.trim().length < body.length * 0.5) return null;

  return noteContent.slice(0, afterFm) + '\n\n' + response.trim() + '\n' + noteContent.slice(bodyEnd);
}

/** Reformat a single note file */
async function reformatSingle(
  filePath: string, useLlm: boolean,
): Promise<{ changed: boolean; usedLlm?: boolean; error?: string }> {
  try {
    const raw = await readFile(filePath, 'utf-8');

    // Rule-based reformat
    const reformatted = reformatNoteBody(raw);
    if (!reformatted) return { changed: false };

    let final = reformatted;
    let usedLlm = false;

    // LLM fallback for remaining wall-of-text
    if (useLlm && hasRemainingWall(reformatted)) {
      const llmResult = await reformatWithLlm(reformatted);
      if (llmResult) {
        final = llmResult;
        usedLlm = true;
      }
    }

    await writeFile(filePath, final, 'utf-8');
    return { changed: true, usedLlm };
  } catch (err) {
    return { changed: false, error: (err as Error).message };
  }
}

/** Batch reformat with progress */
async function reformatBatch(
  config: AppConfig,
  args: ParsedArgs,
  onProgress: (processed: number, total: number) => Promise<void>,
): Promise<{ total: number; changed: number; llm: number; skipped: number; errors: string[] }> {
  const notes = await scanVaultNotes(config.vaultPath);

  let targets = notes;
  if (args.sinceDays != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - args.sinceDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    targets = notes.filter(n => {
      const fm = n.rawContent.split('\n').slice(0, 15).join('\n');
      const dateMatch = fm.match(/^date:\s*(.+)$/m);
      return dateMatch && dateMatch[1].trim() >= cutoffStr;
    });
  }

  const result = { total: targets.length, changed: 0, llm: 0, skipped: 0, errors: [] as string[] };
  let processed = 0;

  for (const note of targets) {
    if (args.dryRun) {
      const raw = await readFile(note.filePath, 'utf-8');
      const reformatted = reformatNoteBody(raw);
      if (reformatted) result.changed++;
      else result.skipped++;
    } else {
      const res = await reformatSingle(note.filePath, args.useLlm);
      if (res.error) {
        result.errors.push(`${note.title}: ${res.error}`);
      } else if (res.changed) {
        result.changed++;
        if (res.usedLlm) result.llm++;
      } else {
        result.skipped++;
      }
    }

    processed++;
    if (processed % 20 === 0 || processed === targets.length) {
      await onProgress(processed, targets.length);
    }
  }

  return result;
}

export async function handleReformat(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const parsed = parseArgs(text);

  if (!parsed) {
    await ctx.reply(
      tagForceReply('reformat', [
        '請選擇排版修復模式：',
        '• 掃描報告：--dry-run',
        '• 全部修復：--all',
        '• 近 N 天：--all --since 30d',
        '• LLM 加強：--all --llm',
        '• 單篇：AI/工具/xxx.md',
      ].join('\n')),
      forceReplyMarkup('--dry-run 或 --all…'),
    );
    return;
  }

  if (parsed.mode === 'single') {
    const filePath = join(config.vaultPath, 'GetThreads', parsed.path!);
    const status = await ctx.reply(`正在排版修復：${parsed.path}...`);
    const result = await reformatSingle(filePath, false);
    try { await ctx.deleteMessage(status.message_id); } catch { /* */ }

    if (result.changed) {
      await ctx.reply(`✅ 已修復排版：${parsed.path}`);
    } else if (result.error) {
      await ctx.reply(`❌ 修復失敗：${result.error}`);
    } else {
      await ctx.reply(`ℹ️ 無需修復：${parsed.path}`);
    }
    return;
  }

  // Batch mode
  const dayLabel = parsed.sinceDays != null ? `近 ${parsed.sinceDays} 天` : '全部';
  const modeLabel = parsed.dryRun ? '（掃描模式）' : parsed.useLlm ? '（含 LLM）' : '';
  const status = await ctx.reply(`正在掃描${dayLabel}的筆記排版${modeLabel}...`);

  const result = await reformatBatch(config, parsed, async (processed, total) => {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `排版處理中 ${processed}/${total}...`,
      );
    } catch { /* rate limit */ }
  });

  try { await ctx.deleteMessage(status.message_id); } catch { /* */ }

  const verb = parsed.dryRun ? '需修復' : '已修復';
  const lines = [
    `排版${parsed.dryRun ? '掃描' : '修復'}完成${modeLabel}（${dayLabel}）`,
    `總計：${result.total} 篇`,
    `${verb}：${result.changed} | 略過：${result.skipped}`,
  ];
  if (result.llm > 0) lines.push(`LLM 處理：${result.llm} 篇`);
  if (result.errors.length > 0) {
    lines.push('', '失敗清單：');
    for (const e of result.errors.slice(0, 5)) lines.push(`• ${e}`);
    if (result.errors.length > 5) lines.push(`...及其他 ${result.errors.length - 5} 項`);
  }

  await ctx.reply(lines.join('\n'));
  logger.info('reformat', '批次完成', {
    total: result.total, changed: result.changed, llm: result.llm, dryRun: parsed.dryRun,
  });
}
