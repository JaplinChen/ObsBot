/**
 * /reprocess — Re-enrich existing vault notes without re-extracting from source.
 * Single mode:  /reprocess AI/Claude-Code/xxx.md
 * Batch mode:   /reprocess --all [--since 7d]
 * Refetch mode: /reprocess --refetch [--since 7d]  (re-extracts from URL, best for GitHub)
 */
import type { Context } from 'telegraf';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { AppConfig } from '../utils/config.js';
import { logger } from '../core/logger.js';
import { parseVaultNote, parsedNoteToExtractedContent } from '../vault/note-parser.js';
import { enrichExtractedContent } from '../messages/services/enrich-content-service.js';
import { saveToVault } from '../saver.js';
import { scanVaultNotes } from '../knowledge/knowledge-store.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { findExtractor } from '../utils/url-parser.js';
import { deleteOldFileIfMoved, cleanEmptyDirs } from '../vault/reprocess-helpers.js';
import { setBatchMode } from '../utils/omlx-client.js';
import type { ExtractorWithComments } from '../extractors/types.js';

interface ParsedArgs {
  mode: 'single' | 'batch';
  path?: string;
  sinceDays?: number;
  refetch?: boolean;
}

/** Parse command arguments into execution mode */
function parseArgs(text: string): ParsedArgs | null {
  // Normalize em-dash → double hyphen (iOS/macOS auto-corrects -- to —)
  const args = text.replace(/^\/reprocess\s*/, '').replace(/\u2014/g, '--').replace(/\u2013/g, '--').trim();
  if (!args) return null;

  if (args.startsWith('--all') || args.startsWith('--refetch')) {
    const refetch = args.includes('--refetch');
    const sinceMatch = args.match(/--since\s+(\d+)d/);
    // No --since means process ALL notes (sinceDays = undefined)
    const sinceDays = sinceMatch ? parseInt(sinceMatch[1], 10) : undefined;
    return { mode: 'batch', sinceDays, refetch };
  }

  return { mode: 'single', path: args };
}

/** Re-extract content from source URL (for GitHub: gets fresh stars/language/topics) */
async function refetchFromUrl(url: string): Promise<import('../extractors/types.js').ExtractedContent | null> {
  try {
    const extractor = findExtractor(url);
    if (!extractor) return null;
    const content = await (extractor as ExtractorWithComments).extract(url);
    return content;
  } catch (err) {
    logger.warn('reprocess', 'refetch failed', { url, error: (err as Error).message });
    return null;
  }
}

/** Reprocess a single vault note by file path */
async function reprocessSingle(
  filePath: string, config: AppConfig, refetch?: boolean,
): Promise<{ success: boolean; title?: string; error?: string }> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseVaultNote(raw);
    if (!parsed) return { success: false, error: '無法解析筆記 frontmatter' };

    let content = parsedNoteToExtractedContent(parsed);

    // Refetch: re-extract from URL for fresh metadata
    if (refetch) {
      const fresh = await refetchFromUrl(parsed.url);
      if (fresh) {
        content = fresh;
      }
    }

    await enrichExtractedContent(content, config);
    const result = await saveToVault(content, config.vaultPath, { forceOverwrite: true, saveVideos: config.saveVideos });

    // Delete old file if reprocess produced a different path (slug/category changed)
    if (result.mdPath && result.mdPath !== filePath) {
      await deleteOldFileIfMoved(filePath, result.mdPath);
      await cleanEmptyDirs(dirname(filePath));
    }

    return { success: true, title: content.title };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

const BATCH_CONCURRENCY = 3;

/** Reprocess batch: all vault notes with concurrency control */
async function reprocessBatch(
  config: AppConfig,
  sinceDays: number | undefined,
  refetch: boolean,
  onProgress: (processed: number, total: number, current: string) => Promise<void>,
): Promise<{ total: number; success: number; failed: number; errors: string[] }> {
  const notes = await scanVaultNotes(config.vaultPath);

  let targets = notes;
  if (sinceDays != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    targets = notes.filter(n => {
      const fm = n.rawContent.split('\n').slice(0, 15).join('\n');
      const dateMatch = fm.match(/^date:\s*(.+)$/m);
      return dateMatch && dateMatch[1].trim() >= cutoffStr;
    });
  }

  const result = { total: targets.length, success: 0, failed: 0, errors: [] as string[] };
  let processed = 0;

  // Phase 1: Concurrent processing (deep tier capped to 9B to avoid 27B timeouts)
  setBatchMode(true);
  const failedNotes: typeof targets = [];
  const queue = [...targets];
  const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const note = queue.shift()!;
      const res = await reprocessSingle(note.filePath, config, refetch);

      if (res.success) {
        result.success++;
      } else {
        failedNotes.push(note);
      }

      processed++;
      if (processed % 5 === 0 || processed === targets.length) {
        await onProgress(processed, targets.length, note.title);
      }
    }
  });
  await Promise.all(workers);
  setBatchMode(false);

  // Phase 2: Retry failed notes sequentially (no resource contention)
  if (failedNotes.length > 0) {
    logger.info('reprocess', `並發失敗 ${failedNotes.length} 筆，序列重試中`);
    for (const note of failedNotes) {
      const res = await reprocessSingle(note.filePath, config, refetch);
      if (res.success) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(`${note.title}: ${res.error}`);
      }
    }
  }

  return result;
}

/** Main command handler */
export async function handleReprocess(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const parsed = parseArgs(text);

  if (!parsed) {
    await ctx.reply(
      tagForceReply('reprocess', [
        '請輸入筆記路徑或批次選項：',
        '• 單篇：AI/Claude-Code/xxx.md',
        '• 全部重新豐富：--all',
        '• 近 N 天：--all --since 7d',
        '• 重新抓取（含 GitHub 元資料）：--refetch',
        '• 近 N 天重新抓取：--refetch --since 7d',
      ].join('\n')),
      forceReplyMarkup('筆記路徑或 --all…'),
    );
    return;
  }

  if (parsed.mode === 'single') {
    const vaultNotesDir = join(config.vaultPath, 'ObsBot');
    const filePath = join(vaultNotesDir, parsed.path!);
    const status = await ctx.reply(`正在重新處理：${parsed.path}...`);

    const result = await reprocessSingle(filePath, config);
    try { await ctx.deleteMessage(status.message_id); } catch { /* */ }

    if (result.success) {
      await ctx.reply(`✅ 已重新豐富：${result.title}`);
    } else {
      await ctx.reply(`❌ 處理失敗：${result.error}`);
    }
    return;
  }

  // Batch mode
  const refetch = parsed.refetch ?? false;
  const dayLabel = parsed.sinceDays != null ? `近 ${parsed.sinceDays} 天` : '全部';
  const modeLabel = refetch ? '（重新抓取模式）' : '';
  const status = await ctx.reply(`正在掃描並重新處理${dayLabel}的筆記${modeLabel}...`);

  const result = await reprocessBatch(config, parsed.sinceDays, refetch, async (processed, total, current) => {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id, status.message_id, undefined,
        `處理中 ${processed}/${total}：${current.slice(0, 40)}`,
      );
    } catch { /* rate limit or unchanged text */ }
  });

  try { await ctx.deleteMessage(status.message_id); } catch { /* */ }

  const lines = [
    `重新處理完成${modeLabel}（${dayLabel}）`,
    `總計：${result.total} 篇`,
    `成功：${result.success} | 失敗：${result.failed}`,
  ];
  if (result.errors.length > 0) {
    lines.push('', '失敗清單：');
    for (const e of result.errors.slice(0, 5)) lines.push(`• ${e}`);
    if (result.errors.length > 5) lines.push(`...及其他 ${result.errors.length - 5} 項`);
  }
  await ctx.reply(lines.join('\n'));
  logger.info('reprocess', '批次完成', { total: result.total, success: result.success, failed: result.failed, refetch });
}
