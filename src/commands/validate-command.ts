/**
 * /validate <想法> — 雙層創業驗證框架
 *
 * 第一層（AI 自動）：從 Vault 找相關競品與趨勢，生成市場分析摘要。
 * 第二層（人工判斷）：輸出 3 個 AI 無法代勞的核心判斷問題。
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadKnowledge } from '../knowledge/knowledge-store.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { splitMessage } from '../utils/telegram.js';
import { withTypingIndicator } from './command-runner.js';

const USAGE = '💡 使用方式：/validate <你的想法>\n\n範例：/validate 幫 Obsidian 用戶做 AI 智慧摘要的 SaaS';

/** 從 knowledge store 找與想法相關的競品 / 趨勢筆記 */
function findRelatedNotes(idea: string, knowledge: ReturnType<typeof loadKnowledge> extends Promise<infer T> ? T : never) {
  const ideaTokens = idea.toLowerCase().split(/[\s,，、]+/).filter(t => t.length > 1);
  const scored: Array<{ title: string; category: string; score: number; insights: string[] }> = [];

  for (const note of Object.values(knowledge.notes)) {
    const haystack = [note.title, note.category, ...note.entities.map(e => e.name)].join(' ').toLowerCase();
    const score = ideaTokens.filter(t => haystack.includes(t)).length;
    if (score === 0) continue;

    const topInsights = note.insights
      .filter(i => i.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2)
      .map(i => i.content);

    scored.push({ title: note.title, category: note.category, score, insights: topInsights });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 8);
}

/** LLM 生成市場分析摘要 + 3 個判斷問題 */
async function generateValidationReport(idea: string, relatedNotes: ReturnType<typeof findRelatedNotes>): Promise<string> {
  const noteContext = relatedNotes.length > 0
    ? relatedNotes.map(n =>
        `- [${n.category}] ${n.title}${n.insights.length ? '\n  洞察：' + n.insights.join('；') : ''}`
      ).join('\n')
    : '（Vault 中無直接相關筆記）';

  const prompt = `你是一位資深創業顧問，專門幫獨立開發者快速驗證想法。

想法描述：${idea}

Vault 中找到的相關筆記（競品 / 趨勢參考）：
${noteContext}

請產出以下驗證報告（繁體中文，簡潔有力）：

## 市場快照（3 點）
- 用 1-2 句描述每個競品或相關趨勢，點出對這個想法的影響

## 差異化機會
- 這個想法最有可能建立差異化的切入點是什麼？（1-2 句）

## AI 無法判斷的 3 個核心問題
列出 3 個只有創業者自己能回答的問題，格式：
1. ❓ [問題]（為何重要：[一句話說明]）
2. ❓ [問題]（為何重要：[一句話說明]）
3. ❓ [問題]（為何重要：[一句話說明]）

## 建議的第一步（7 天內可執行）
一個具體行動，驗證最關鍵的未知數。

注意：報告要直接、不廢話、不加免責聲明。`;

  const result = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    timeoutMs: 60_000,
    maxTokens: 800,
    soul: false,
  });

  return result?.trim() ?? '⚠️ LLM 無回應，請稍後再試。';
}

export async function handleValidate(ctx: Context, config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const idea = text.replace(/^\/validate\s*/i, '').trim();

  if (!idea) {
    await ctx.reply(USAGE);
    return;
  }

  await withTypingIndicator(
    ctx,
    `🔍 第一層驗證中：掃描 Vault 競品與趨勢…`,
    async () => {
      const knowledge = await loadKnowledge();
      const noteCount = Object.keys(knowledge.notes).length;

      const relatedNotes = noteCount > 0 ? findRelatedNotes(idea, knowledge) : [];

      const header = [
        `🧪 雙層驗證報告`,
        `想法：「${idea}」`,
        `Vault 參考筆記：${relatedNotes.length} 篇`,
        '',
      ].join('\n');

      await ctx.reply(header);

      // 第一層：AI 生成報告
      const report = await generateValidationReport(idea, relatedNotes);

      for (const chunk of splitMessage(report)) {
        await ctx.reply(chunk);
      }

      // 第二層提示
      await ctx.reply(
        '━━━━━━━━━━━━━━━━\n' +
        '⬆️ 第一層（AI 自動）完成。\n\n' +
        '📋 第二層（你的判斷）：\n' +
        '用自己的話回答上方 3 個問題。如果任何一題「我不確定」，' +
        '那就是你接下來 7 天要解決的問題，不是繼續建產品。',
      );
    },
    '驗證失敗，請稍後再試',
  );
}
