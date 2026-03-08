/**
 * /analyze and /knowledge commands — deep vault knowledge extraction.
 * /analyze: tries API if available, otherwise guides user to Claude Code skill.
 * /knowledge: reads pre-computed knowledge from vault-knowledge.json.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { analyzeNote } from '../knowledge/analyzer.js';
import {
  loadKnowledge, saveKnowledge, computeContentHash,
  shouldAnalyze, buildNoteAnalysis, updateNoteAnalysis,
  cleanupDeletedNotes, scanVaultNotes,
} from '../knowledge/knowledge-store.js';
import { aggregateKnowledge, formatKnowledgeSummary } from '../knowledge/knowledge-aggregator.js';

const CONCURRENCY = 3;
const DELAY_MS = 500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** /analyze — full vault deep analysis */
export async function handleAnalyze(ctx: Context, config: AppConfig): Promise<void> {
  if (!config.anthropicApiKey) {
    await ctx.reply(
      '知識分析有兩種方式：\n\n' +
      '1️⃣ 在 Claude Code 中執行 /vault-analyze（推薦，免費）\n' +
      '2️⃣ 設定 ANTHROPIC_API_KEY 後在此執行 /analyze',
    );
    return;
  }

  const status = await ctx.reply('🔍 開始深度分析 Vault...');

  try {
    const result = await runFullAnalysis(config.vaultPath, config.anthropicApiKey);
    const lines = [
      '✅ Vault 知識分析完成',
      '',
      `掃描：${result.scanned} 篇`,
      `新分析：${result.analyzed} 篇`,
      `跳過（未改變）：${result.skipped} 篇`,
      `失敗：${result.failed} 篇`,
      `清理已刪除：${result.cleaned} 篇`,
    ];

    // If all failed, suggest Claude Code skill
    if (result.failed > 0 && result.analyzed === 0) {
      lines.push('', '💡 API 呼叫失敗，建議在 Claude Code 中執行 /vault-analyze');
    } else if (result.analyzed > 0) {
      lines.push('', '使用 /knowledge 查看知識庫摘要。');
    }
    await ctx.reply(lines.join('\n'));
  } catch (err) {
    await ctx.reply(`知識分析失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

/** /knowledge — show knowledge summary */
export async function handleKnowledge(ctx: Context, _config: AppConfig): Promise<void> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    await ctx.reply(
      '知識庫為空。\n\n' +
      '請在 Claude Code 中執行 /vault-analyze 進行深度分析。',
    );
    return;
  }
  aggregateKnowledge(knowledge);
  await ctx.reply(formatKnowledgeSummary(knowledge));
}

interface AnalysisResult {
  scanned: number; analyzed: number; skipped: number; failed: number; cleaned: number;
}

/** Run full vault analysis with API (fallback path when API key is available) */
async function runFullAnalysis(vaultPath: string, apiKey: string): Promise<AnalysisResult> {
  const knowledge = await loadKnowledge();
  const notes = await scanVaultNotes(vaultPath);
  const result: AnalysisResult = {
    scanned: notes.length, analyzed: 0, skipped: 0, failed: 0, cleaned: 0,
  };

  const toAnalyze: typeof notes = [];
  for (const note of notes) {
    const hash = computeContentHash(note.rawContent);
    if (shouldAnalyze(note.noteId, hash, knowledge)) {
      toAnalyze.push(note);
    } else {
      result.skipped++;
    }
  }

  for (let i = 0; i < toAnalyze.length; i += CONCURRENCY) {
    const batch = toAnalyze.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (note) => {
      const bodyStart = note.rawContent.indexOf('---', 4);
      const body = bodyStart > 0 ? note.rawContent.slice(bodyStart + 3).trim() : note.rawContent;
      const response = await analyzeNote(note.title, body, note.category, apiKey);
      if (!response) { result.failed++; return; }
      const hash = computeContentHash(note.rawContent);
      const analysis = buildNoteAnalysis(
        note.noteId, note.filePath, note.title, note.category, hash, response,
      );
      updateNoteAnalysis(knowledge, analysis);
      result.analyzed++;
    });
    await Promise.allSettled(promises);
    if (i + CONCURRENCY < toAnalyze.length) await sleep(DELAY_MS);
  }

  const existingIds = new Set(notes.map(n => n.noteId));
  result.cleaned = cleanupDeletedNotes(knowledge, existingIds);
  aggregateKnowledge(knowledge);
  await saveKnowledge(knowledge);
  return result;
}

/**
 * Incrementally analyze a single note after saving.
 * Called from saver.ts as fire-and-forget (only when API key available).
 */
export async function analyzeNewNote(
  url: string, filePath: string, title: string,
  text: string, category: string, apiKey: string,
): Promise<void> {
  const noteId = normaliseUrl(url);
  const knowledge = await loadKnowledge();
  const response = await analyzeNote(title, text, category, apiKey);
  if (!response) return;
  const hash = computeContentHash(text);
  const analysis = buildNoteAnalysis(noteId, filePath, title, category, hash, response);
  updateNoteAnalysis(knowledge, analysis);
  aggregateKnowledge(knowledge);
  await saveKnowledge(knowledge);
  console.log(`[knowledge] 增量分析完成：${title.slice(0, 40)}`);
}

function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch { return raw; }
}
