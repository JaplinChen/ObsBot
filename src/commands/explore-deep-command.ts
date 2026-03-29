/**
 * Deep synthesis and save-to-vault handlers for /explore.
 * Extracted to keep knowledge-query-command.ts under 300 lines.
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { aggregateKnowledge, getInsightsByTopic } from '../knowledge/knowledge-aggregator.js';
import type { VaultKnowledge } from '../knowledge/types.js';
import { findNotesByTopic } from './knowledge-query-helpers.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { saveReportToVault } from '../knowledge/report-saver.js';
import { logger } from '../core/logger.js';
import { replyEmptyKnowledge } from './reply-buttons.js';

/* re-use the callback cache from the parent module */
import { buildCallbackData, resolveCallbackToken } from './knowledge-query-command.js';

async function loadAndAggregate(): Promise<VaultKnowledge | null> {
  const k = await loadKnowledge();
  if (Object.keys(k.notes).length === 0) return null;
  aggregateKnowledge(k);
  return k;
}

/** xdeep callback — deep topic synthesis with LLM */
export async function handleDeepSynthesis(
  ctx: Context, topic: string, config: AppConfig,
): Promise<void> {
  const status = await ctx.reply(`正在深度合成「${topic}」…`);

  try {
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

    const noteContext = matchedNotes.slice(0, 8).map(n => {
      const insights = n.insights.slice(0, 2).map(i => i.content).join('；');
      return `- ${n.title}（${n.category}）${insights ? `：${insights}` : ''}`;
    }).join('\n');

    const prompt = [
      `你是知識策略顧問。以下是用戶收集的「${topic}」相關筆記。`,
      `共 ${matchedNotes.length} 篇相關筆記。`,
      '',
      '請用繁體中文產出 200-400 字的深度合成報告，結構如下：',
      '1. 核心發現：這個主題的 2-3 個最重要觀點',
      '2. 趨勢觀察：從這些筆記中看到的發展方向',
      '3. 實踐建議：具體可以怎麼應用這些知識',
      '',
      '語氣：專業但有觀點。不要重複列舉標題，要提煉出深層洞察。',
      '',
      noteContext,
    ].join('\n');

    const synthesis = await runLocalLlmPrompt(prompt, {
      timeoutMs: 90_000, model: 'deep', maxTokens: 1536,
    });

    if (!synthesis) {
      await ctx.reply('深度合成生成失敗，請稍後再試。');
      return;
    }

    const header = `🔬 「${topic}」深度合成\n來源：${matchedNotes.length} 篇相關筆記\n`;
    await ctx.reply(`${header}\n${synthesis}`);

    // Offer save-to-vault button
    const saveToken = buildCallbackData('xsave', JSON.stringify({
      topic, synthesis, noteCount: matchedNotes.length,
    }));
    await ctx.reply(
      '要存入 Vault 嗎？',
      Markup.inlineKeyboard([[Markup.button.callback('💾 存入 Vault', saveToken)]]),
    );

    logger.info('explore', '深度合成完成', { topic, notes: matchedNotes.length });
  } catch (err) {
    await ctx.reply(`深度合成失敗：${(err as Error).message}`);
  } finally {
    await ctx.deleteMessage(status.message_id).catch(() => {});
  }
}

/** xsave callback — save synthesis report to vault */
export async function handleSaveToVault(
  ctx: Context, payload: string, config: AppConfig,
): Promise<void> {
  try {
    const data = JSON.parse(payload) as { topic: string; synthesis: string; noteCount: number };
    const today = new Date().toISOString().slice(0, 10);

    const slug = data.topic.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-').slice(0, 20);
    const savedPath = await saveReportToVault(config.vaultPath, {
      title: `${data.topic} 深度合成`,
      date: today,
      content: data.synthesis,
      tags: ['synthesis', 'explore', 'auto-generated'],
      filePrefix: `synthesis-${slug}`,
      subtitle: `${data.noteCount} 篇相關筆記`,
    });

    await ctx.reply(`💾 已存入：${savedPath.split('/ObsBot/')[1] ?? savedPath}`);
  } catch (err) {
    await ctx.reply(`儲存失敗：${(err as Error).message}`);
  }
}
