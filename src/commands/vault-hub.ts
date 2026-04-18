/**
 * /vault — unified Vault maintenance entry point.
 * Consolidates quality, dedup, reprocess, reformat, benchmark, retry, suggest,
 * compile (wiki), and tune (classifier autoresearch).
 * Old commands remain registered for backward compatibility.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { handleQuality } from './quality-command.js';
import { handleDedup } from './dedup-command.js';
import { handleReprocess } from './reprocess-command.js';
import { handleReformat } from './reformat-command.js';
import { handleBenchmark } from './benchmark-command.js';
import { handleSuggest } from './suggest-command.js';
import { compileWiki } from '../knowledge/wiki-compiler.js';
import { runClassifierTuning, formatTuneReport } from '../learning/classifier-tuner.js';
import { splitMessage } from '../utils/telegram.js';
import { startTyping, stopTyping } from '../utils/typing-indicator.js';
import type { BotStats } from '../messages/types.js';
import {
  handleVaultGraph, handleVaultDreaming, handleVaultMemoir,
  handleVaultAnalyzeRules, handleVaultBookmarkGap, handleVaultDraft,
} from './vault-hub-ext.js';
import { analyzeFailures, formatFailureReport } from '../monitoring/failure-analyzer.js';

type SubHandler = (ctx: Context, config: AppConfig) => Promise<void>;

// ── Menu builders ─────────────────────────────────────────────────────────────

const MAIN_MENU_TEXT = '🔧 *Vault 維護*\n\n選擇功能分類：';

function mainMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🩺 品質維護', 'vlt:cat:quality'),
      Markup.button.callback('⚙️ 處理操作', 'vlt:cat:ops'),
    ],
    [
      Markup.button.callback('🧠 知識分析', 'vlt:cat:knowledge'),
    ],
  ]);
}

const CAT_DEFS = {
  quality: {
    text: '🩺 *品質維護*\n\n掃描、除重、修排版、品質基準：',
    keyboard: () => Markup.inlineKeyboard([
      [Markup.button.callback('📊 品質報告', 'vlt:quality'), Markup.button.callback('🔍 重複掃描', 'vlt:dedup')],
      [Markup.button.callback('📐 修復排版', 'vlt:reformat'), Markup.button.callback('📈 品質基準', 'vlt:benchmark')],
      [Markup.button.callback('‹ 返回', 'vlt:back')],
    ]),
  },
  ops: {
    text: '⚙️ *處理操作*\n\n重新處理、重試、推薦連結、Wiki 編譯、草稿生成：',
    keyboard: () => Markup.inlineKeyboard([
      [Markup.button.callback('🔄 重新處理', 'vlt:reprocess'), Markup.button.callback('🔁 重試失敗', 'vlt:retry')],
      [Markup.button.callback('🔗 推薦連結', 'vlt:suggest'), Markup.button.callback('📚 Wiki 編譯', 'vlt:compile')],
      [Markup.button.callback('📝 生成草稿', 'vlt:draft')],
      [Markup.button.callback('‹ 返回', 'vlt:back')],
    ]),
  },
  knowledge: {
    text: '🧠 *知識分析*\n\n分類調優、圖譜、固化、開發史：',
    keyboard: () => Markup.inlineKeyboard([
      [Markup.button.callback('🎯 調優分類器', 'vlt:tune'), Markup.button.callback('🕸️ 知識圖譜', 'vlt:graph')],
      [Markup.button.callback('🌙 知識固化', 'vlt:dreaming'), Markup.button.callback('📖 開發史', 'vlt:memoir')],
      [Markup.button.callback('🔍 規則建議', 'vlt:analyze'), Markup.button.callback('🔖 書籤缺口', 'vlt:bookmark-gap')],
      [Markup.button.callback('‹ 返回', 'vlt:back')],
    ]),
  },
} as const;

type CatKey = keyof typeof CAT_DEFS;

// ── Command modes ─────────────────────────────────────────────────────────────

const MODES: Record<string, { handler: SubHandler; prefix: string }> = {
  quality: { handler: handleQuality, prefix: '/quality' },
  dedup: { handler: handleDedup, prefix: '/dedup' },
  reprocess: { handler: handleReprocess, prefix: '/reprocess' },
  reformat: { handler: handleReformat, prefix: '/reformat' },
  benchmark: { handler: handleBenchmark, prefix: '/benchmark' },
  suggest: { handler: handleSuggest, prefix: '/suggest' },
};

function rewriteText(ctx: Context, newCommand: string, args: string): void {
  const text = args ? `${newCommand} ${args}` : newCommand;
  const existingMsg = ctx.message as unknown as Record<string, unknown> | undefined;
  if (existingMsg) { existingMsg.text = text; }
  else {
    const cbMsg = (ctx.callbackQuery?.message ?? {}) as Record<string, unknown>;
    (ctx.update as unknown as Record<string, unknown>).message = { ...cbMsg, text };
  }
}

/** Build vault hub with retry handler injected at registration time */
export function createVaultHub(stats: BotStats) {
  return async function handleVaultHub(ctx: Context, config: AppConfig): Promise<void> {
    const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
    const parts = text.replace(/^\/vault\s*/i, '').trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() ?? '';
    const rest = parts.slice(1).join(' ');

    // compile — wiki compilation for a folder
    if (sub === 'compile') {
      await handleVaultCompile(ctx, config, rest);
      return;
    }

    // tune — classifier autoresearch loop
    if (sub === 'tune') {
      await handleVaultTune(ctx, config, rest);
      return;
    }

    // analyze-failures — enrichment failure pattern analysis
    if (sub === 'analyze-failures') { await handleVaultAnalyzeFailures(ctx); return; }

    // ext sub-commands (graph / dreaming / memoir / analyze / bookmark-gap / draft)
    if (sub === 'graph') { await handleVaultGraph(ctx, config, rest); return; }
    if (sub === 'dreaming') { await handleVaultDreaming(ctx, config, rest); return; }
    if (sub === 'memoir') { await handleVaultMemoir(ctx, config, rest); return; }
    if (sub === 'analyze' && rest.startsWith('rules')) { await handleVaultAnalyzeRules(ctx, config, rest); return; }
    if (sub === 'bookmark-gap') { await handleVaultBookmarkGap(ctx, config, rest); return; }
    if (sub === 'draft') { await handleVaultDraft(ctx, config, rest); return; }

    // retry needs special handling (uses stats closure)
    if (sub === 'retry') {
      const { createRetryHandler } = await import('./retry-command.js');
      const handler = createRetryHandler(stats);
      rewriteText(ctx, '/retry', rest);
      await handler(ctx, config);
      return;
    }

    const mode = MODES[sub];
    if (mode) {
      rewriteText(ctx, mode.prefix, rest);
      await mode.handler(ctx, config);
      return;
    }

    // No args → show main category menu
    await ctx.reply(MAIN_MENU_TEXT, mainMenu());
  };
}

/** /vault compile <folder> — wiki compilation */
async function handleVaultCompile(ctx: Context, config: AppConfig, args: string): Promise<void> {
  const folder = args.trim() || 'karpathy';
  const typing = startTyping(ctx);
  await ctx.reply(`📚 正在編譯「${folder}」的 wiki 知識文章…`);

  try {
    const result = await compileWiki(config.vaultPath, folder);
    stopTyping(typing);

    if (result.totalNotes === 0) {
      await ctx.reply(`找不到資料夾「${folder}」或資料夾內無筆記。\n用法：/vault compile karpathy`);
      return;
    }

    const lines = [
      `✅ Wiki 編譯完成`,
      `資料夾：${folder}`,
      `掃描筆記：${result.totalNotes} 篇`,
      `產出主題：${result.articles.length} 個`,
    ];
    if (result.skippedNotes > 0) lines.push(`略過（筆記數不足）：${result.skippedNotes} 篇`);
    if (result.savedPath) lines.push(`已儲存：${result.savedPath}`);
    if (result.articles.length > 0) {
      lines.push('', '主題清單：');
      for (const art of result.articles) lines.push(`• ${art.theme}（${art.noteCount} 篇）`);
    }

    await ctx.reply(lines.join('\n'));
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`Wiki 編譯失敗：${String(err)}`);
  }
}

/** /vault analyze-failures — enrichment failure pattern analysis */
async function handleVaultAnalyzeFailures(ctx: Context): Promise<void> {
  const typing = startTyping(ctx);
  await ctx.reply('📊 正在分析 enrichment 失敗模式…');
  try {
    const result = await analyzeFailures();
    stopTyping(typing);
    const report = formatFailureReport(result);
    for (const chunk of splitMessage(report)) {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`分析失敗：${String(err)}`);
  }
}

/** /vault tune [--apply] — classifier autoresearch tuning */
async function handleVaultTune(ctx: Context, _config: AppConfig, args: string): Promise<void> {
  const autoApply = args.includes('--apply');
  const typing = startTyping(ctx);
  await ctx.reply('🎯 正在執行分類器調優評估…');

  try {
    const result = await runClassifierTuning(autoApply);
    stopTyping(typing);
    const report = formatTuneReport(result);
    for (const chunk of splitMessage(report)) {
      await ctx.reply(chunk);
    }
    if (!autoApply && result.suggestions.length > 0 && result.improvement > 0) {
      await ctx.reply('使用 /vault tune --apply 套用建議修改。');
    }
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`調優失敗：${String(err)}`);
  }
}

/** Handle vlt:* callbacks from InlineKeyboard */
export function createVaultCallback(stats: BotStats) {
  return async function handleVaultCallback(ctx: Context & { match: RegExpExecArray }, config: AppConfig): Promise<void> {
    const mode = ctx.match[1];
    await ctx.answerCbQuery().catch(() => {});

    // Navigation: category sub-menu
    if (mode.startsWith('cat:')) {
      const cat = mode.slice(4) as CatKey;
      const def = CAT_DEFS[cat];
      if (def) {
        await (ctx as unknown as { editMessageText(t: string, e: object): Promise<unknown> })
          .editMessageText(def.text, { parse_mode: 'Markdown', ...def.keyboard() })
          .catch(() => {});
      }
      return;
    }

    // Navigation: back to main menu
    if (mode === 'back') {
      await (ctx as unknown as { editMessageText(t: string, e: object): Promise<unknown> })
        .editMessageText(MAIN_MENU_TEXT, { parse_mode: 'Markdown', ...mainMenu() })
        .catch(() => {});
      return;
    }

    // Actions
    if (mode === 'retry') {
      const { createRetryHandler } = await import('./retry-command.js');
      const handler = createRetryHandler(stats);
      rewriteText(ctx, '/retry', '');
      await handler(ctx, config);
      return;
    }

    if (mode === 'tune') {
      await handleVaultTune(ctx, config, '');
      return;
    }

    if (mode === 'compile') {
      await handleVaultCompile(ctx, config, '');
      return;
    }

    if (mode === 'draft') {
      await handleVaultDraft(ctx, config, '');
      return;
    }

    if (mode === 'graph') { await handleVaultGraph(ctx, config, ''); return; }
    if (mode === 'dreaming') { await handleVaultDreaming(ctx, config, ''); return; }
    if (mode === 'memoir') { await handleVaultMemoir(ctx, config, ''); return; }
    if (mode === 'analyze') { await handleVaultAnalyzeRules(ctx, config, 'rules'); return; }
    if (mode === 'bookmark-gap') { await handleVaultBookmarkGap(ctx, config, ''); return; }
    if (mode === 'draft') { await handleVaultDraft(ctx, config, ''); return; }

    const m = MODES[mode];
    if (m) {
      rewriteText(ctx, m.prefix, '');
      await m.handler(ctx, config);
    }
  };
}
