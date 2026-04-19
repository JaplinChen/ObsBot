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
import { handleDevil, handlePredictions } from './patrol-extra-commands.js';

const AVAILABLE_SOURCES = ['github-trending', 'hn', 'reddit', 'devto'];

export async function handlePatrol(ctx: Context, config: AppConfig): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const args = text.replace(/^\/patrol\s*/i, '').trim().toLowerCase().split(/\s+/);
  const sub = args[0] || '';

  if (sub === 'auto') return handleToggleAuto(ctx);
  if (sub === 'sources') return handleSources(ctx, args.slice(1));
  if (sub === 'topics') return handleTopics(ctx, args.slice(1));
  if (sub === 'github') return handleGitHubOnly(ctx, config);
  if (sub === 'devil') {
    const days = parseInt(args[1] ?? '7', 10) || 7;
    return handleDevil(ctx, config, days);
  }
  if (sub === 'predictions') return handlePredictions(ctx, config);

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
      const notifText = formatPatrolNotification(notifyItems);
      const buttons = buildPatrolButtons(notifyItems);
      await ctx.reply(notifText, {
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
