/**
 * vault-hub-ext — extended /vault subcommand handlers.
 * Imported by vault-hub.ts to keep that file under 300 lines.
 * Covers: graph, dreaming, memoir, analyze rules, bookmark-gap, draft.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTyping, stopTyping } from '../utils/typing-indicator.js';
import { splitMessage } from '../utils/telegram.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { collectRecentNotes } from './digest-command.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { formatGraph } from '../knowledge/knowledge-graph.js';
import { runDreaming } from '../knowledge/dreaming-engine.js';
import { generateMemoir } from '../knowledge/memoir-generator.js';
import { runRulesSuggester } from '../knowledge/rules-suggester.js';
import { analyzeBookmarkGaps } from '../knowledge/bookmark-analyzer.js';

/** /vault graph [--topic <kw>] [--top N] */
export async function handleVaultGraph(ctx: Context, config: AppConfig, args: string): Promise<void> {
  const topMatch = args.match(/--top\s+(\d+)/);
  const topN = topMatch ? parseInt(topMatch[1], 10) : 20;
  const topicMatch = args.match(/--topic\s+(\S+)/);
  const cleanArgs = args.replace(/--top\s+\d+|--topic\s+\S+/g, '').trim();
  const filterTopic = topicMatch?.[1] ?? (cleanArgs || undefined);

  const typing = startTyping(ctx);
  try {
    const knowledge = await loadKnowledge();
    if (Object.keys(knowledge.notes).length === 0) {
      stopTyping(typing);
      await ctx.reply('知識庫尚未建立，請先執行 /vault analyze 建立實體圖譜。');
      return;
    }
    const output = formatGraph(knowledge, topN, filterTopic);
    stopTyping(typing);
    for (const chunk of splitMessage(output)) await ctx.reply(chunk);
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`知識圖譜失敗：${String(err)}`);
  }
}

/** /vault dreaming [--days N] [--apply] */
export async function handleVaultDreaming(ctx: Context, config: AppConfig, args: string): Promise<void> {
  const daysMatch = args.match(/--days\s+(\d+)/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 7;
  const apply = args.includes('--apply');

  const typing = startTyping(ctx);
  await ctx.reply(`🌙 正在執行 dreaming（最近 ${days} 天${apply ? '，套用模式' : '，dry-run'}）…`);

  try {
    const result = await runDreaming(config.vaultPath, days, !apply);
    stopTyping(typing);
    const lines = [
      `✅ Dreaming 完成`,
      `掃描筆記：${result.scannedNotes} 篇`,
      `發現連結：${result.notesWithLinks} 篇，${result.totalNewLinks} 條新關聯`,
      apply ? '已套用 related: 欄位' : '（dry-run，未修改筆記）',
    ];
    if (result.savedPath) lines.push(`報告：${result.savedPath.split('/').slice(-3).join('/')}`);
    await ctx.reply(lines.join('\n'));
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`Dreaming 失敗：${String(err)}`);
  }
}

/** /vault memoir [--since YYYY-MM-DD] */
export async function handleVaultMemoir(ctx: Context, config: AppConfig, args: string): Promise<void> {
  const sinceMatch = args.match(/--since\s+(\d{4}-\d{2}-\d{2})/);
  const since = sinceMatch?.[1];

  const typing = startTyping(ctx);
  await ctx.reply(`📖 正在生成 ObsBot 開發史${since ? ` (${since} 起)` : ''}…`);

  try {
    const result = await generateMemoir(config.vaultPath, since);
    stopTyping(typing);
    await ctx.reply([
      `✅ 開發史生成完成`,
      `提交記錄：${result.commitCount} 筆`,
      `記憶脈絡：${result.hasMemory ? '已載入' : '未找到'}`,
      `報告：${result.savedPath.split('/').slice(-3).join('/')}`,
    ].join('\n'));
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`開發史生成失敗：${String(err)}`);
  }
}

/** /vault analyze rules */
export async function handleVaultAnalyzeRules(ctx: Context, config: AppConfig, _args: string): Promise<void> {
  const typing = startTyping(ctx);
  await ctx.reply('🔍 正在分析 Vault 決策筆記，比對 CLAUDE.md…');

  try {
    const result = await runRulesSuggester(config.vaultPath);
    stopTyping(typing);
    await ctx.reply([
      `✅ 規則建議完成`,
      `分析筆記：${result.relevantNotes} 篇`,
      `建議條目：${result.suggestionsCount} 條`,
      `報告：${result.savedPath.split('/').slice(-3).join('/')}`,
      '',
      '⚠️ 以上為建議，需手動確認後才套用至 CLAUDE.md',
    ].join('\n'));
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`規則建議失敗：${String(err)}`);
  }
}

/** /vault bookmark-gap */
export async function handleVaultBookmarkGap(ctx: Context, config: AppConfig, _args: string): Promise<void> {
  const typing = startTyping(ctx);
  await ctx.reply('🔖 正在分析 X 書籤知識缺口…');

  try {
    const result = await analyzeBookmarkGaps(config.vaultPath);
    stopTyping(typing);
    if (result.error) {
      await ctx.reply(`⚠️ ${result.error}\n\n報告已存入 Vault，包含安裝說明。`);
      return;
    }
    await ctx.reply([
      `✅ 書籤分析完成`,
      `書籤總數：${result.bookmarkCount} 條`,
      `知識缺口：${result.gapCount} 個主題`,
      result.savedPath ? `報告：${result.savedPath.split('/').slice(-3).join('/')}` : '',
    ].filter(Boolean).join('\n'));
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`書籤分析失敗：${String(err)}`);
  }
}

/**
 * /vault draft <category> [--days N]
 * 從指定分類（或近 N 天全體）的筆記生成一篇有觀點的文章草稿，
 * 存入 Vault/Drafts/ 並回傳路徑。
 */
export async function handleVaultDraft(ctx: Context, config: AppConfig, args: string): Promise<void> {
  const daysMatch = args.match(/--days\s+(\d+)/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 14;
  const category = args.replace(/--days\s+\d+/, '').trim() || 'AI';

  const typing = startTyping(ctx);
  await ctx.reply(`📝 正在從「${category}」近 ${days} 天筆記生成草稿…`);

  try {
    // 嘗試先讀該 category 的 wiki.md 作為素材骨架
    const wikiPath = join(config.vaultPath, 'ObsBot', ...category.split('/'), 'wiki.md');
    let wikiContext = '';
    try { wikiContext = await readFile(wikiPath, 'utf-8'); } catch { /* wiki 不存在時略過 */ }

    // 取最近 N 天筆記的摘要
    const notes = await collectRecentNotes(config.vaultPath, days);
    const catNotes = notes.filter(n => n.category.startsWith(category)).slice(0, 12);
    if (catNotes.length === 0) {
      stopTyping(typing);
      await ctx.reply(`近 ${days} 天「${category}」無筆記，無法生成草稿。`);
      return;
    }

    const noteLines = catNotes
      .map((n, i) => `${i + 1}. ${n.title}${n.summary ? '：' + n.summary : ''}`)
      .join('\n');

    const wikiSection = wikiContext
      ? `\n參考 wiki 摘要：\n${wikiContext.slice(0, 800)}`
      : '';

    const prompt = `你是知識管理助手。請根據以下筆記，用繁體中文撰寫一篇 800-1200 字的深度文章草稿，要有獨立觀點，不要只是列清單。

分類：${category}
近期 ${catNotes.length} 篇筆記：
${noteLines}
${wikiSection}

文章結構：
1. 引言（點出核心問題或矛盾）
2. 主要觀點（2-3 節，有論據）
3. 實作或應用啟示
4. 結語（留一個開放問題）

直接輸出 Markdown 正文，不要 frontmatter，不要前言。`;

    const draft = await runLocalLlmPrompt(prompt, { task: 'summarize' });
    if (!draft) {
      stopTyping(typing);
      await ctx.reply('LLM 未回傳內容，請確認 oMLX 服務正在執行。');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const catSlug = category.replace(/\//g, '-');
    const filename = `draft-${catSlug}-${today}.md`;
    const outDir = join(config.vaultPath, 'Drafts');
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, filename);

    const fullContent = `---\ntitle: "${category} 草稿 ${today}"\ndate: ${today}\ncategory: draft\nsource_notes: ${catNotes.length}\n---\n\n${draft}\n`;
    await writeFile(outPath, fullContent, 'utf-8');

    stopTyping(typing);
    await ctx.reply(`✅ 草稿已生成（${catNotes.length} 篇筆記 → 1 篇草稿）\n📄 ${filename}\n\n在 Obsidian 中開啟 Drafts/${filename} 編輯。`);
  } catch (err) {
    stopTyping(typing);
    await ctx.reply(`草稿生成失敗：${String(err)}`);
  }
}
