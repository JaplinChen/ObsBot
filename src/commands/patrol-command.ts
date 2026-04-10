/**
 * /patrol — multi-platform content patrol.
 * /patrol             → run multi-platform patrol cycle
 * /patrol auto        → toggle automatic patrol
 * /patrol sources     → show/toggle enabled sources
 * /patrol topics      → show/set interest topics
 * /patrol github      → run GitHub Trending only (legacy)
 * /patrol devil [N]   → 反指標注射器：找出近 N 天熱門主題，生成反向論點筆記
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { runPatrolCycle, runMultiPatrolCycle } from '../patrol/patrol-service.js';
import { loadPatrolConfig, savePatrolConfig } from '../patrol/patrol-store.js';
import { formatPatrolNotification, buildPatrolButtons } from '../patrol/patrol-notifier.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { collectRecentNotes } from './digest-command.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';

const AVAILABLE_SOURCES = ['github-trending', 'hn', 'reddit', 'devto'];

export async function handlePatrol(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const args = text.replace(/^\/patrol\s*/i, '').trim().toLowerCase().split(/\s+/);
  const sub = args[0] || '';

  if (sub === 'auto') {
    return handleToggleAuto(ctx);
  }
  if (sub === 'sources') {
    return handleSources(ctx, args.slice(1));
  }
  if (sub === 'topics') {
    return handleTopics(ctx, args.slice(1));
  }
  if (sub === 'github') {
    return handleGitHubOnly(ctx, config);
  }
  if (sub === 'devil') {
    const days = parseInt(args[1] ?? '7', 10) || 7;
    return handleDevil(ctx, config, days);
  }

  // Default: multi-platform patrol
  const status = await ctx.reply('🔭 正在巡邏多平臺…');
  try {
    const pConfig = await loadPatrolConfig();
    const { results, notifyItems } = await runMultiPatrolCycle(config, pConfig);
    pConfig.lastPatrolAt = new Date().toISOString();
    await savePatrolConfig(pConfig);

    if (notifyItems.length === 0) {
      await ctx.reply('🔭 巡邏完成，無新內容（全部已存在或不相關）');
    } else {
      const text = formatPatrolNotification(notifyItems);
      const buttons = buildPatrolButtons(notifyItems);
      await ctx.reply(text, {
        ...buttons,
        // @ts-expect-error Telegraf type mismatch with link_preview_options
        disable_web_page_preview: true,
      });
    }

    const summary = results.map((r) => `${r.source}: ${r.found} 項`).join(', ');
    await ctx.reply(`📊 來源統計：${summary}\n\n提示：/patrol sources 管理來源 | /patrol topics 設定主題`);
  } catch (err) {
    await ctx.reply(`巡邏失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

async function handleToggleAuto(ctx: Context): Promise<void> {
  const pConfig = await loadPatrolConfig();
  pConfig.enabled = !pConfig.enabled;
  await savePatrolConfig(pConfig);
  await ctx.reply(
    pConfig.enabled
      ? `✅ 自動巡邏已啟用（每 ${pConfig.intervalHours} 小時）\n來源：${pConfig.enabledSources.join(', ')}`
      : '⏸️ 自動巡邏已停用',
  );
}

async function handleSources(ctx: Context, args: string[]): Promise<void> {
  const pConfig = await loadPatrolConfig();

  if (args.length === 0) {
    const lines = AVAILABLE_SOURCES.map((s) => {
      const enabled = pConfig.enabledSources.includes(s);
      return `${enabled ? '✅' : '⬜'} ${s}`;
    });
    await ctx.reply(`📡 巡邏來源：\n${lines.join('\n')}\n\n切換：/patrol sources <name>`);
    return;
  }

  const target = args[0];
  if (!AVAILABLE_SOURCES.includes(target)) {
    await ctx.reply(`❌ 未知來源: ${target}\n可用：${AVAILABLE_SOURCES.join(', ')}`);
    return;
  }

  const idx = pConfig.enabledSources.indexOf(target);
  if (idx >= 0) {
    pConfig.enabledSources.splice(idx, 1);
    await savePatrolConfig(pConfig);
    await ctx.reply(`⬜ 已停用 ${target}`);
  } else {
    pConfig.enabledSources.push(target);
    await savePatrolConfig(pConfig);
    await ctx.reply(`✅ 已啟用 ${target}`);
  }
}

async function handleTopics(ctx: Context, args: string[]): Promise<void> {
  const pConfig = await loadPatrolConfig();

  if (args.length === 0) {
    await ctx.reply(
      `🎯 目前主題：${pConfig.topics.join(', ') || '（未設定）'}\n\n` +
      `設定：/patrol topics ai,obsidian,typescript`,
    );
    return;
  }

  pConfig.topics = args.join(' ').split(',').map((t) => t.trim()).filter(Boolean);
  await savePatrolConfig(pConfig);
  await ctx.reply(`✅ 主題已更新：${pConfig.topics.join(', ')}`);
}

async function handleGitHubOnly(ctx: Context, config: AppConfig): Promise<void> {
  const status = await ctx.reply('🔭 正在巡邏 GitHub Trending...');
  try {
    const pConfig = await loadPatrolConfig();
    const result = await runPatrolCycle(config, pConfig.languages);
    pConfig.lastPatrolAt = new Date().toISOString();
    await savePatrolConfig(pConfig);
    await ctx.reply(
      `🔭 GitHub Trending 巡邏完成\n找到 ${result.found} 個專案\n` +
      `✅ 新儲存 ${result.saved} 篇 | ⏭️ 跳過 ${result.skipped} 篇`,
    );
  } catch (err) {
    await ctx.reply(`巡邏失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

/**
 * /patrol devil [N]
 * 找出近 N 天（預設 7 天）筆記數 > 4 的熱門主題，
 * 對每個主題用 LLM 生成「如果這個趨勢是錯的？」反向論點筆記，
 * 存入 Vault/inbox/反向論點/。
 */
async function handleDevil(ctx: Context, config: AppConfig, days: number): Promise<void> {
  const status = await ctx.reply(`😈 正在掃描近 ${days} 天熱門主題…`);
  try {
    const notes = await collectRecentNotes(config.vaultPath, days);
    if (notes.length === 0) {
      await ctx.reply('近期無筆記，無法產生反向論點。');
      return;
    }

    // 統計各主題的根分類筆記數
    const freq = new Map<string, string[]>();
    for (const n of notes) {
      const root = n.category.split('/')[0] || n.category;
      const titles = freq.get(root) ?? [];
      titles.push(n.title);
      freq.set(root, titles);
    }

    const hotTopics = [...freq.entries()]
      .filter(([, titles]) => titles.length > 4)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3); // 一次最多處理 3 個，避免 LLM 過載

    if (hotTopics.length === 0) {
      await ctx.reply(`近 ${days} 天無任何主題超過 5 篇（共 ${notes.length} 篇），不需要反向論點。`);
      return;
    }

    const saved: string[] = [];
    for (const [topic, titles] of hotTopics) {
      const sample = titles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join('\n');
      const prompt = `你是批判性思考顧問。近 ${days} 天 Vault 中「${topic}」分類累積了 ${titles.length} 篇筆記，代表我對此主題高度關注。

部分筆記標題：
${sample}

請用繁體中文撰寫一篇 400-600 字的反向論點分析：
1. 如果「${topic}」的主流敘事是錯的或被高估的，最可能的原因是什麼？
2. 哪些反向證據或盲點值得關注？
3. 給我一個具體的下一步：應該去找什麼類型的反向資料？

格式：直接輸出分析內容，不要加任何前言。`;

      const result = await runLocalLlmPrompt(prompt, { task: 'summarize' });
      if (!result) continue;

      const today = new Date().toISOString().slice(0, 10);
      const content = `---\ntitle: "${topic}——反向論點分析"\ndate: ${today}\ncategory: inbox\nkeywords: [反向論點, 批判性思考, ${topic}]\nsummary: "近 ${days} 天「${topic}」出現 ${titles.length} 篇筆記，本文提出反向思考"\n---\n\n# ${topic}——如果主流敘事是錯的？\n\n> 反向論點自動生成：當某主題在 ${days} 天內累積 ${titles.length} 篇，自動觸發批判性審視。\n\n${result}\n`;

      const outDir = join(config.vaultPath, 'ObsBot', 'inbox', '反向論點');
      await mkdir(outDir, { recursive: true });
      const filename = `${topic.replace(/[/\\:*?"<>|]/g, '-')}-反向論點-${today}.md`;
      const outPath = join(outDir, filename);
      await writeFile(outPath, content, 'utf-8');
      saved.push(`📌 ${topic}（${titles.length} 篇）→ ${filename}`);
    }

    await ctx.reply(
      saved.length > 0
        ? `😈 已生成 ${saved.length} 篇反向論點筆記：\n\n${saved.join('\n')}`
        : '😈 LLM 未能生成任何反向論點，請確認 oMLX 服務正在運行。',
    );
  } catch (err) {
    await ctx.reply(`反向論點生成失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
