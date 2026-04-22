/**
 * /patrol — multi-platform content patrol.
 * /patrol             → run multi-platform patrol cycle
 * /patrol auto        → toggle automatic patrol
 * /patrol sources     → show/toggle enabled sources
 * /patrol topics      → show/set interest topics
 * /patrol github      → run GitHub Trending only (legacy)
 * /patrol devil [N]   → 反指標注射器：找出近 N 天熱門主題，生成反向論點筆記
 * /patrol predictions → 掃描 Vault 中到期或即將到期的可驗證預測
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { runPatrolCycle, runMultiPatrolCycle } from '../patrol/patrol-service.js';
import { loadPatrolConfig, savePatrolConfig } from '../patrol/patrol-store.js';
import { formatPatrolNotification, buildPatrolButtons } from '../patrol/patrol-notifier.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectRecentNotes } from './digest-command.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

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
  if (sub === 'predictions') {
    return handlePredictions(ctx, config);
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

請用繁體中文撰寫一篇 400-600 字的反向論點分析，**必須使用 Markdown 格式**：

## 主張「${topic}」被高估的最可能原因

- **論點一**：說明
- **論點二**：說明
（列出 3-5 點）

## 值得關注的反向證據與盲點

- **盲點一**：說明
（列出 3-5 點）

## 具體下一步（要找的反向資料）

- **資料類型一**：說明去哪找、找什麼
（列出 2-3 點）

> [!tip] 優先建議
> 一句話總結：最值得優先蒐集哪類反向資料，原因為何。

規則：直接輸出 Markdown 內容，從 ## 開始，不要加任何前言或說明。`;

      const rawResult = await runLocalLlmPrompt(prompt, { task: 'summarize' });
      if (!rawResult) continue;

      // 清理 LLM 可能夾帶的 UI metadata 垃圾字串
      const result = rawResult
        .replace(/^[\s·\-]+$/gm, '')                         // 孤立的符號行
        .replace(/^(Private|Fast|public)\s*$/gim, '')         // ChatGPT/Claude UI 標籤
        .replace(/^All chats are private\..*$/gim, '')        // Claude UI 底部說明
        .replace(/^AI can make mistakes\..*$/gim, '')         // 錯誤免責聲明
        .replace(/\n{3,}/g, '\n\n')                           // 多餘空行壓縮
        .trim();

      const today = new Date().toISOString().slice(0, 10);
      const content = `---\ntitle: "${topic}——反向論點分析"\ndate: ${today}\ncategory: inbox\nkeywords: [反向論點, 批判性思考, ${topic}]\nsummary: "近 ${days} 天「${topic}」出現 ${titles.length} 篇筆記，本文提出反向思考"\n---\n\n# ${topic}——如果主流敘事是錯的？\n\n> [!warning] 反向論點自動生成\n> 當某主題在 ${days} 天內累積 **${titles.length} 篇**，自動觸發批判性審視。\n\n${result}\n`;

      const outDir = join(config.vaultPath, 'KnowPipe', 'inbox', '反向論點');
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

/** 掃描 Vault 中到期或即將到期（30 天內）的可驗證預測 */
async function handlePredictions(ctx: Context, config: AppConfig): Promise<void> {
  const status = await ctx.reply('🔮 掃描可驗證預測中…');
  try {
    const rootDir = join(config.vaultPath, 'KnowPipe');
    const files = await getAllMdFiles(rootDir);
    const today = new Date();
    const cutoff = new Date(today.getTime() + 30 * 86400_000);
    const PRED_RE = /predictions:\s*\[(.+)\]/;
    const ENTRY_RE = /"([^"]+)\[(\d+)%\/(\d{4}-\d{2}-\d{2})\]"/g;

    const due: string[] = [];
    const overdue: string[] = [];

    for (const f of files) {
      const raw = await readFile(f, 'utf-8').catch(() => '');
      const fmEnd = raw.indexOf('\n---', 4);
      const fm = fmEnd > 0 ? raw.slice(0, fmEnd) : raw.slice(0, 500);
      const m = PRED_RE.exec(fm);
      if (!m) continue;
      const relPath = f.replace(/.*KnowPipe[\\/]/, '');
      for (const em of m[1].matchAll(ENTRY_RE)) {
        const [, text, conf, dl] = em;
        const deadline = new Date(dl);
        if (deadline < today) {
          overdue.push(`⏰ *${text}* [${conf}%] 截止 ${dl}\n   └ ${relPath}`);
        } else if (deadline <= cutoff) {
          due.push(`🔔 *${text}* [${conf}%] 截止 ${dl}\n   └ ${relPath}`);
        }
      }
    }

    const total = overdue.length + due.length;
    if (total === 0) {
      await ctx.reply('📭 沒有即將到期或已過期的預測。');
    } else {
      const parts: string[] = [`🔮 找到 ${total} 個需驗證的預測：\n`];
      if (overdue.length) parts.push(`**已到期（請回填結果）**\n${overdue.join('\n\n')}`);
      if (due.length) parts.push(`**30 天內到期**\n${due.join('\n\n')}`);
      parts.push('\n回填方式：打開筆記，將 `預測文字[信心%/日期]` 改為 `[✅正確]` 或 `[❌錯誤]`');
      await ctx.reply(parts.join('\n\n'), { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await ctx.reply(`預測掃描失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}
