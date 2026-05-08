/**
 * /config — runtime configuration management via Telegram.
 * Sub-commands: features, llm, extractors, reset
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import {
  getUserConfig, updateUserConfig, getDefaults, reloadUserConfig,
  getEnabledPlatforms, ALL_PLATFORMS,
} from '../utils/user-config.js';
import type { FeatureFlags } from '../utils/user-config.js';

const FEATURE_LABELS: Record<keyof FeatureFlags, string> = {
  translation: '簡轉繁翻譯',
  linkEnrichment: '連結深度抓取',
  imageAnalysis: '圖片 AI 辨識',
  videoTranscription: '影片逐字稿',
  comments: '評論擷取',
  proactive: '主動推理推送',
  monitor: '自我修復監控',
  wall: '情報牆',
  patrol: '自動巡邏',
  consolidation: '記憶整合',
  qualityReview: '品質審查',
  speakerIdentification: 'YouTube 說話人識別',
};

function buildFeatureKeyboard(cfg: ReturnType<typeof getUserConfig>) {
  return Object.entries(FEATURE_LABELS).map(([key, label]) => {
    const on = cfg.features[key as keyof FeatureFlags];
    return [Markup.button.callback(`${on ? '✅' : '⬜'} ${label}`, `cfg:feat:${key}`)];
  });
}

function buildExtractorKeyboard(enabledSet: Set<string>) {
  const rows = [];
  for (let i = 0; i < ALL_PLATFORMS.length; i += 2) {
    const pair = [ALL_PLATFORMS[i], ALL_PLATFORMS[i + 1]].filter(Boolean) as string[];
    rows.push(pair.map((p) => Markup.button.callback(
      `${enabledSet.has(p) ? '✅' : '⬜'} ${p}`,
      `cfg:ext:${p}`,
    )));
  }
  return rows;
}

/** Main /config handler */
export async function handleConfig(ctx: Context): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const sub = text.replace(/^\/config\s*/i, '').trim().split(/\s+/);
  const action = sub[0]?.toLowerCase() || '';

  if (action === 'features') return showFeatures(ctx);
  if (action === 'llm') return showLlm(ctx);
  if (action === 'extractors') return showExtractors(ctx);
  if (action === 'reset') return resetConfig(ctx);

  // Default: show overview
  const cfg = getUserConfig();
  const onCount = Object.values(cfg.features).filter(Boolean).length;
  const totalCount = Object.keys(cfg.features).length;
  const platforms = getEnabledPlatforms();

  const lines = [
    '⚙️ **KnowPipe 配置**',
    '',
    `🔘 功能開關：${onCount}/${totalCount} 啟用`,
    `🤖 LLM：${cfg.llm.order.filter(k => cfg.llm.enabled[k]).join(' → ')}`,
    `🌐 平台：${platforms.length} 個啟用`,
    '',
    '子指令：',
    '`/config features` — 功能開關',
    '`/config llm` — LLM 設定',
    '`/config extractors` — 平台管理',
    '`/config reset` — 恢復預設',
  ];

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

async function showFeatures(ctx: Context): Promise<void> {
  const cfg = getUserConfig();
  await ctx.reply('🔘 **功能開關**（點擊切換）', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buildFeatureKeyboard(cfg)),
  });
}

async function showLlm(ctx: Context): Promise<void> {
  const cfg = getUserConfig();
  const lines = [
    '🤖 **LLM 配置**',
    '',
    `Provider: \`${cfg.llm.order.filter(k => cfg.llm.enabled[k]).join(' → ')}\``,
    '',
    '**oMLX**',
    `  Base URL: \`${cfg.llm.omlx.baseUrl}\``,
    `  Flash: \`${cfg.llm.omlx.models.flash}\``,
    `  Standard: \`${cfg.llm.omlx.models.standard}\``,
    `  Deep: \`${cfg.llm.omlx.models.deep}\``,
    '',
    '**OpenCode**',
    `  Flash: \`${cfg.llm.opencode.models.flash}\``,
    `  Standard: \`${cfg.llm.opencode.models.standard}\``,
    `  Deep: \`${cfg.llm.opencode.models.deep}\``,
    `  Timeout: \`${cfg.llm.opencode.timeoutMs}ms\``,
    '',
    '修改方式：管理介面 `http://localhost:3001/` 或編輯 `data/user-config.json`',
  ];

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

async function showExtractors(ctx: Context): Promise<void> {
  const enabled = new Set(getEnabledPlatforms());
  await ctx.reply('🌐 **平台 Extractors**（點擊切換）', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buildExtractorKeyboard(enabled)),
  });
}

async function resetConfig(ctx: Context): Promise<void> {
  await ctx.reply('確定要恢復所有配置為預設值嗎？', {
    ...Markup.inlineKeyboard([
      Markup.button.callback('✅ 確認重置', 'cfg:reset:confirm'),
      Markup.button.callback('❌ 取消', 'cfg:reset:cancel'),
    ]),
  });
}

/* ── Callback handlers ──────────────────────────────────────────────── */

/** Toggle a feature flag via inline keyboard callback. */
export async function handleConfigFeatureToggle(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const key = ctx.callbackQuery.data.replace('cfg:feat:', '') as keyof FeatureFlags;
  if (!(key in FEATURE_LABELS)) return;

  const cfg = getUserConfig();
  const newVal = !cfg.features[key];
  updateUserConfig({ features: { [key]: newVal } });

  await ctx.answerCbQuery(`${FEATURE_LABELS[key]}：${newVal ? '已啟用' : '已停用'}`);
  await ctx.editMessageReplyMarkup(
    Markup.inlineKeyboard(buildFeatureKeyboard(getUserConfig())).reply_markup,
  );
}

/** Toggle an extractor platform via inline keyboard callback. */
export async function handleConfigExtractorToggle(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const platform = ctx.callbackQuery.data.replace('cfg:ext:', '');
  if (!ALL_PLATFORMS.includes(platform)) return;

  const cfg = getUserConfig();
  const disabled = new Set(cfg.extractors.disabled);
  const wasEnabled = !disabled.has(platform);
  if (wasEnabled) {
    disabled.add(platform);
  } else {
    disabled.delete(platform);
  }
  updateUserConfig({ extractors: { disabled: [...disabled] } });

  await ctx.answerCbQuery(`${platform}：${wasEnabled ? '已停用' : '已啟用'}`);
  const newEnabled = new Set(getEnabledPlatforms());
  await ctx.editMessageReplyMarkup(
    Markup.inlineKeyboard(buildExtractorKeyboard(newEnabled)).reply_markup,
  );
}

/** Reset config to defaults. */
export async function handleConfigResetConfirm(ctx: Context): Promise<void> {
  const defaults = getDefaults();
  updateUserConfig(defaults as unknown as Record<string, unknown>);
  reloadUserConfig();
  await ctx.answerCbQuery('已恢復預設配置');
  await ctx.editMessageText('✅ 所有配置已恢復為預設值。部分變更需要 `/restart` 才會生效。', { parse_mode: 'Markdown' });
}

/** Cancel reset. */
export async function handleConfigResetCancel(ctx: Context): Promise<void> {
  await ctx.answerCbQuery('已取消');
  await ctx.editMessageText('❌ 已取消重置。');
}
