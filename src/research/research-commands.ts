/**
 * 研究模組 Telegram 指令 — /research, /slides, /anki。
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { scanVaultNotes, searchNotes, buildNoteContext, loadNoteBody } from './vault-reader.js';
import { analyzeNotes, chatWithNotes, generateAnkiCards, generateResearchReport } from './chat-service.js';
import { buildSlideSpec } from './slide-spec.js';
import { buildPptx } from './slide-pptx.js';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NoteRecord } from './types.js';

/** 取得與主題最相關的筆記（最多 8 篇）。 */
async function findRelevantNotes(vaultPath: string, topic: string): Promise<NoteRecord[]> {
  const allNotes = await scanVaultNotes(vaultPath);
  const matched = searchNotes(allNotes, topic);
  const selected = matched.slice(0, 8);
  for (const note of selected) {
    if (!note.body) note.body = await loadNoteBody(vaultPath, note.path);
  }
  return selected;
}

/**
 * /research <topic> — 快速研究摘要
 */
export async function handleResearch(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const topic = text.replace(/^\/research\s*/i, '').trim();

  if (!topic) {
    await ctx.reply(
      '📚 **研究模組**\n\n'
      + '用法：`/research <主題>`\n'
      + '範例：`/research AI agents`\n\n'
      + '其他指令：\n'
      + '• `/slides <主題>` — 生成投影片\n'
      + '• `/anki <主題>` — 生成 Anki 閃卡\n\n'
      + `🌐 研究界面：http://localhost:3001/research`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const vaultPath = config.vaultPath;
  if (!vaultPath) {
    await ctx.reply('❌ 尚未設定 Vault 路徑');
    return;
  }

  const typing = await ctx.reply('🔍 正在搜尋相關筆記...');

  const notes = await findRelevantNotes(vaultPath, topic);
  if (notes.length === 0) {
    await ctx.telegram.editMessageText(ctx.chat!.id, typing.message_id, undefined,
      `找不到與「${topic}」相關的筆記。`);
    return;
  }

  await ctx.telegram.editMessageText(ctx.chat!.id, typing.message_id, undefined,
    `📖 找到 ${notes.length} 篇相關筆記，正在分析...`);

  const overview = await analyzeNotes(topic, notes);
  if (!overview) {
    await ctx.telegram.editMessageText(ctx.chat!.id, typing.message_id, undefined,
      '⚠️ 分析失敗，請確認 LLM 服務是否正常。');
    return;
  }

  const noteList = notes.map((n) => `• ${n.name}`).join('\n');
  const questions = (overview.keyQuestions ?? []).map((q, i) => `${i + 1}. ${q}`).join('\n');
  const concepts = (overview.keyConcepts ?? []).join('、');

  await ctx.telegram.editMessageText(ctx.chat!.id, typing.message_id, undefined,
    `📚 **${topic}** 研究摘要\n\n`
    + `${overview.summary}\n\n`
    + `**核心概念**：${concepts}\n\n`
    + `**關鍵問題**\n${questions}\n\n`
    + `**參考筆記**（${notes.length} 篇）\n${noteList}\n\n`
    + `🌐 深入研究：http://localhost:3001/research`,
    { parse_mode: 'Markdown' },
  );
}

/**
 * /slides <topic> — 生成 PPTX 投影片
 */
export async function handleSlides(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const topic = text.replace(/^\/slides\s*/i, '').trim();

  if (!topic) {
    await ctx.reply('用法：`/slides <主題>`\n範例：`/slides AI agents 架構比較`', { parse_mode: 'Markdown' });
    return;
  }

  const vaultPath = config.vaultPath;
  if (!vaultPath) { await ctx.reply('❌ 尚未設定 Vault 路徑'); return; }

  const typing = await ctx.reply('🎨 正在生成投影片...');

  const notes = await findRelevantNotes(vaultPath, topic);
  const content = notes.map((n) => `## ${n.name}\n${(n.body || n.preview).slice(0, 2000)}`).join('\n\n');
  const spec = buildSlideSpec(content, topic);
  const buf = await buildPptx(spec);

  // 寫入暫存檔後傳送
  const tmpPath = join(tmpdir(), `knowpipe-slides-${Date.now()}.pptx`);
  await writeFile(tmpPath, buf);

  await ctx.telegram.deleteMessage(ctx.chat!.id, typing.message_id).catch(() => {});
  await ctx.replyWithDocument(
    { source: tmpPath, filename: `${topic.slice(0, 30)}.pptx` },
    { caption: `📊 ${topic} — ${(spec.slides as unknown[]).length} 張投影片` },
  );

  await unlink(tmpPath).catch(() => {});
}

/**
 * /anki <topic> — 生成 Anki 閃卡
 */
export async function handleAnki(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const topic = text.replace(/^\/anki\s*/i, '').trim();

  if (!topic) {
    await ctx.reply('用法：`/anki <主題>`\n範例：`/anki 機器學習基礎`', { parse_mode: 'Markdown' });
    return;
  }

  const vaultPath = config.vaultPath;
  if (!vaultPath) { await ctx.reply('❌ 尚未設定 Vault 路徑'); return; }

  const typing = await ctx.reply('🃏 正在生成 Anki 閃卡...');

  const notes = await findRelevantNotes(vaultPath, topic);
  const result = await generateAnkiCards(topic, notes);

  await ctx.telegram.editMessageText(ctx.chat!.id, typing.message_id, undefined,
    `🃏 **${topic}** Anki 閃卡\n\n${result}`,
    { parse_mode: 'Markdown' },
  );
}
