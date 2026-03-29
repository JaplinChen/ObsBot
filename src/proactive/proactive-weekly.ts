/**
 * Weekly deep digest cycle — generates and pushes a weekly knowledge synthesis.
 * Extracted from proactive-service.ts to keep files under 300 lines.
 */
import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { getOwnerUserId } from '../utils/config.js';
import type { ProactiveConfig } from './proactive-types.js';
import { saveProactiveConfig } from './proactive-store.js';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { collectRecentNotes, groupByCategory } from '../commands/digest-command.js';
import { saveReportToVault } from '../knowledge/report-saver.js';

/** Check if current time is within the digest hour window (HH:00 to HH:30). */
function isDigestHour(digestHour: number): boolean {
  const now = new Date();
  return now.getHours() === digestHour && now.getMinutes() <= 30;
}

/** Check if today is the configured weekly digest day and within digest hour window. */
function isWeeklyDigestTime(pConfig: ProactiveConfig): boolean {
  const now = new Date();
  return now.getDay() === pConfig.weeklyDigestDay && isDigestHour(pConfig.digestHour);
}

/** Check if weekly digest was already sent this week. */
function alreadySentThisWeek(lastWeeklyAt: string | null): boolean {
  if (!lastWeeklyAt) return false;
  const last = new Date(lastWeeklyAt);
  const now = new Date();
  return now.getTime() - last.getTime() < 6 * 24 * 3_600_000;
}

/** Run weekly deep digest cycle */
export async function runWeeklyCycle(
  bot: Telegraf,
  config: AppConfig,
  pConfig: ProactiveConfig,
): Promise<void> {
  if (!isWeeklyDigestTime(pConfig)) return;
  if (alreadySentThisWeek(pConfig.lastWeeklyAt)) return;

  logger.info('proactive', '開始生成每週深度合成');

  try {
    const days = 7;
    const notes = await collectRecentNotes(config.vaultPath, days);
    if (notes.length < pConfig.minNotesForDigest) {
      logger.info('proactive', '近期筆記不足，跳過週報', { count: notes.length });
      pConfig.lastWeeklyAt = new Date().toISOString();
      await saveProactiveConfig(pConfig);
      return;
    }

    const groups = groupByCategory(notes);
    const catCount = Object.keys(groups).length;

    // Build weekly synthesis prompt
    const catSummaries: string[] = [];
    for (const [cat, catNotes] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
      const items = catNotes.map(n => `- ${n.title}${n.summary ? `：${n.summary.slice(0, 80)}` : ''}`);
      catSummaries.push(`【${cat}】(${catNotes.length} 篇)\n${items.join('\n')}`);
    }

    const prompt = [
      '你是知識策略顧問。以下是用戶本週收集的筆記，請產出一份深度週報。',
      `時間範圍：最近 ${days} 天，共 ${notes.length} 篇，分佈在 ${catCount} 個分類。`,
      '',
      '請用繁體中文產出 400-600 字的「週報深度合成」，結構如下：',
      '## 本週焦點\n2-3 個最重要的主題，每個 50-80 字。',
      '## 跨主題洞察\n不同分類之間的隱藏連結。',
      '## 行動建議\n基於本週知識，建議下一步探索方向（2-3 條）。',
      '## 知識缺口\n哪些主題缺乏深度，建議補充什麼。',
      '',
      '語氣：專業但有觀點。不要重複列舉標題。',
      '',
      ...catSummaries,
    ].join('\n');

    const synthesis = await runLocalLlmPrompt(prompt, {
      timeoutMs: 120_000,
      model: 'deep',
      maxTokens: 2048,
    });

    if (!synthesis) {
      logger.warn('proactive', '週報 LLM 生成失敗');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Save to Vault
    await saveReportToVault(config.vaultPath, {
      title: `週報深度合成 ${today}`,
      date: today,
      content: synthesis,
      tags: ['weekly', 'digest', 'auto-generated'],
      filePrefix: 'weekly',
      subtitle: `${notes.length} 篇筆記 · ${catCount} 個分類 · 近 ${days} 天`,
    });

    // Push to Telegram
    const message = `📰 每週深度合成\n${today} | ${notes.length} 篇筆記 · ${catCount} 個分類\n\n${synthesis}`;
    const userId = getOwnerUserId(config);
    if (userId) {
      await bot.telegram.sendMessage(userId, message.slice(0, 4000));
    }

    pConfig.lastWeeklyAt = new Date().toISOString();
    await saveProactiveConfig(pConfig);
    logger.info('proactive', '每週深度合成完成', { notes: notes.length, categories: catCount });
  } catch (err) {
    logger.warn('proactive', '每週深度合成失敗', { message: (err as Error).message });
  }
}
