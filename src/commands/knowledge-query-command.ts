/**
 * /explore <topic> — unified knowledge exploration.
 * Replaces /recommend, /brief, /compare.
 * Shows mode picker (InlineKeyboard) when topic is provided.
 * Shows entity picker when no topic is given.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import { createHash } from 'node:crypto';
import type { AppConfig } from '../utils/config.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { aggregateKnowledge, getTopEntities, getInsightsByTopic } from '../knowledge/knowledge-aggregator.js';
import type { VaultKnowledge } from '../knowledge/types.js';
import { tagForceReply, forceReplyMarkup } from '../utils/force-reply.js';
import { findEntity, findNotesByTopic, formatEntitySection, findDirectRelations } from './knowledge-query-helpers.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { replyEmptyKnowledge } from './reply-buttons.js';

const CALLBACK_CACHE_LIMIT = 500;
const callbackPayloadCache = new Map<string, string>();

function rememberCallbackPayload(command: string, payload: string): string {
  const token = createHash('sha1').update(command + ':' + payload).digest('hex').slice(0, 12);
  const key = command + ':' + token;
  callbackPayloadCache.set(key, payload);

  if (callbackPayloadCache.size > CALLBACK_CACHE_LIMIT) {
    const oldest = callbackPayloadCache.keys().next().value;
    if (oldest) callbackPayloadCache.delete(oldest);
  }

  return token;
}

export function buildCallbackData(command: string, payload: string): string {
  return `${command}:${rememberCallbackPayload(command, payload)}`;
}

export function resolveCallbackPayload(command: string, tokenOrPayload: string): string {
  const key = command + ':' + tokenOrPayload;
  return callbackPayloadCache.get(key) ?? tokenOrPayload;
}

export function resolveCallbackToken(command: string, token: string): string | null {
  const key = command + ':' + token;
  return callbackPayloadCache.get(key) ?? null;
}

/** /explore <topic> — main entry point */
export async function handleExplore(ctx: Context, _config: AppConfig): Promise<void> {
  const arg = extractArg(ctx);

  // /explore <A> vs <B> → run compare directly
  if (arg && arg.includes('vs')) {
    await runCompare(ctx, arg);
    return;
  }

  // /explore <topic> → show mode picker
  if (arg) {
    const recToken = rememberCallbackPayload('xrec', arg);
    const brfToken = rememberCallbackPayload('xbrf', arg);
    const deepToken = rememberCallbackPayload('xdeep', arg);
    await ctx.reply(
      `探索「${arg}」：`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('📚 推薦筆記', `xrec:${recToken}`),
          Markup.button.callback('🧠 知識簡報', `xbrf:${brfToken}`),
        ],
        [
          Markup.button.callback('🔬 深度合成', `xdeep:${deepToken}`),
        ],
      ]),
    );
    return;
  }

  // /explore (no args) → entity picker
  await replyWithTopicPicker(ctx, 'explore', '請選擇主題或輸入關鍵字：');
}

/** Callback handlers used by register-commands.ts */
export async function handleRecommendByTopic(ctx: Context, topic: string): Promise<void> {
  await runRecommend(ctx, topic);
}

export async function handleBriefByTopic(ctx: Context, topic: string): Promise<void> {
  await runBrief(ctx, topic);
}

export async function handleCompareByArg(ctx: Context, arg: string): Promise<void> {
  await runCompare(ctx, arg);
}

/** xpick callback — show mode picker for a topic selected from entity buttons */
export async function handleModePicker(ctx: Context, topic: string): Promise<void> {
  const recToken = rememberCallbackPayload('xrec', topic);
  const brfToken = rememberCallbackPayload('xbrf', topic);
  const deepToken = rememberCallbackPayload('xdeep', topic);
  await ctx.reply(
    `探索「${topic}」：`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('📚 推薦筆記', `xrec:${recToken}`),
        Markup.button.callback('🧠 知識簡報', `xbrf:${brfToken}`),
      ],
      [
        Markup.button.callback('🔬 深度合成', `xdeep:${deepToken}`),
      ],
    ]),
  );
}

// --- Core logic ---

async function runRecommend(ctx: Context, topic: string): Promise<void> {
  const knowledge = await loadAndAggregate();
  if (!knowledge) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  const matchedNotes = findNotesByTopic(knowledge, topic);
  if (matchedNotes.length === 0) {
    await ctx.reply(`找不到與「${topic}」相關的筆記。`);
    return;
  }

  const entity = findEntity(knowledge, topic);
  const header = entity
    ? `📚 ${entity.name} 相關筆記（${entity.mentions} 篇提及）`
    : `📚 「${topic}」相關筆記`;

  const lines = [header, ''];
  for (const n of matchedNotes.slice(0, 10)) {
    const stars = '⭐'.repeat(Math.min(n.qualityScore, 5));
    lines.push(`${stars} ${n.title.slice(0, 50)}`);
  }

  const insights = getInsightsByTopic(knowledge, topic).slice(0, 3);
  if (insights.length > 0) {
    lines.push('', '💡 相關洞察：');
    for (const ins of insights) {
      lines.push(`• ${ins.content.slice(0, 80)}`);
    }
  }

  await ctx.reply(lines.join('\n'));
}

async function runBrief(ctx: Context, topic: string): Promise<void> {
  const knowledge = await loadAndAggregate();
  if (!knowledge) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  const insights = getInsightsByTopic(knowledge, topic);
  const matchedNotes = findNotesByTopic(knowledge, topic);

  if (insights.length === 0 && matchedNotes.length === 0) {
    await ctx.reply(`找不到與「${topic}」相關的知識。`);
    return;
  }

  const lines = [`🧠 ${topic} 知識簡報`, '', `來源：${matchedNotes.length} 篇相關筆記`];

  if (insights.length > 0) {
    lines.push('', '核心洞察：');
    for (const ins of insights.slice(0, 6)) {
      lines.push(`• ${ins.content}`);
    }
  }

  const entitySet = new Set<string>();
  for (const n of matchedNotes) {
    for (const e of n.entities) {
      if (e.name.toLowerCase() !== topic.toLowerCase()) entitySet.add(e.name);
    }
  }
  if (entitySet.size > 0) {
    const entityList = [...entitySet].slice(0, 8).join(', ');
    lines.push('', `🏷 相關實體：${entityList}`);
  }

  await ctx.reply(lines.join('\n'));
}

async function runCompare(ctx: Context, arg: string): Promise<void> {
  const [rawA, rawB] = arg.split(/\s+vs\s+/i).map((s) => s.trim());
  if (!rawA || !rawB) {
    await ctx.reply('格式錯誤，用法：/explore <A> vs <B>');
    return;
  }

  const knowledge = await loadAndAggregate();
  if (!knowledge) {
    await replyEmptyKnowledge(ctx);
    return;
  }

  const entityA = findEntity(knowledge, rawA);
  const entityB = findEntity(knowledge, rawB);

  const lines = [`⚖️ ${rawA} vs ${rawB}`, ''];
  lines.push(...formatEntitySection(knowledge, rawA, entityA));
  lines.push('');
  lines.push(...formatEntitySection(knowledge, rawB, entityB));

  const directRels = findDirectRelations(knowledge, rawA, rawB);
  if (directRels.length > 0) {
    lines.push('', '🔗 直接關係：');
    for (const r of directRels) {
      lines.push(`• ${r.from} → ${r.to}：${r.description}`);
    }
  }

  // LLM-powered comparison when both have enough notes
  const notesA = findNotesByTopic(knowledge, rawA);
  const notesB = findNotesByTopic(knowledge, rawB);
  if (notesA.length >= 2 && notesB.length >= 2) {
    try {
      const summariesA = notesA.slice(0, 5).map(n => n.title).join('、');
      const summariesB = notesB.slice(0, 5).map(n => n.title).join('、');
      const prompt = [
        `比較「${rawA}」和「${rawB}」兩個主題。`,
        `${rawA} 相關筆記：${summariesA}`,
        `${rawB} 相關筆記：${summariesB}`,
        '用繁體中文寫 100-150 字的比較分析，涵蓋：',
        '1. 兩者的核心差異 2. 各自優勢 3. 適用場景',
        '語氣中性專業，不要列點。',
      ].join('\n');
      const analysis = await runLocalLlmPrompt(prompt, {
        timeoutMs: 30_000, model: 'standard', maxTokens: 512,
      });
      if (analysis) {
        lines.push('', '🤖 AI 比較分析：', analysis);
      }
    } catch { /* best-effort */ }
  }

  await ctx.reply(lines.join('\n'));
}

// --- Helpers ---

function extractArg(ctx: Context): string | null {
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
  const parts = text.split(/\s+/);
  parts.shift();
  const arg = parts.join(' ').trim();
  return arg || null;
}

async function loadAndAggregate(): Promise<VaultKnowledge | null> {
  const k = await loadKnowledge();
  if (Object.keys(k.notes).length === 0) return null;
  aggregateKnowledge(k);
  return k;
}

/** Show top entities as InlineKeyboard + ForceReply fallback */
async function replyWithTopicPicker(ctx: Context, command: string, prompt: string): Promise<void> {
  const knowledge = await loadAndAggregate();
  if (!knowledge) {
    await ctx.reply(
      tagForceReply(command, prompt),
      forceReplyMarkup('輸入主題…'),
    );
    return;
  }

  const topEntities = getTopEntities(knowledge, 6);
  if (topEntities.length === 0) {
    await ctx.reply(
      tagForceReply(command, prompt),
      forceReplyMarkup('輸入主題…'),
    );
    return;
  }

  const buttons: Array<{ text: string; callback_data: string }[]> = [];
  for (let i = 0; i < topEntities.length; i += 2) {
    const row = [Markup.button.callback(topEntities[i].name, buildCallbackData('xpick', topEntities[i].name))];
    if (i + 1 < topEntities.length) {
      row.push(Markup.button.callback(topEntities[i + 1].name, buildCallbackData('xpick', topEntities[i + 1].name)));
    }
    buttons.push(row);
  }

  await ctx.reply(
    tagForceReply(command, prompt),
    Markup.inlineKeyboard(buttons),
  );
}
