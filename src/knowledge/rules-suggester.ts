/**
 * Rules Suggester — compares recent Vault decision notes against CLAUDE.md,
 * outputs a suggest-only list of potential improvements.
 * Never auto-modifies CLAUDE.md; all suggestions require human review.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadKnowledge } from './knowledge-store.js';
import { saveReportToVault } from './report-saver.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

export interface RulesSuggestResult {
  savedPath: string;
  suggestionsCount: number;
  relevantNotes: number;
}

const DECISION_CATS = new Set(['claude.md', 'claude', 'karpathy', 'ai/研究對話']);
const DECISION_KW = ['決策', '架構', '設計', '方案', '遷移', '整合', '踩坑', '教訓'];

function isDecisionNote(title: string, category: string, entityNames: string[]): boolean {
  if (DECISION_CATS.has(category.toLowerCase())) return true;
  const haystack = (title + ' ' + entityNames.join(' ')).toLowerCase();
  return DECISION_KW.some(kw => haystack.includes(kw));
}

export async function runRulesSuggester(
  vaultPath: string,
  projectRoot = process.cwd(),
): Promise<RulesSuggestResult> {
  const today = new Date().toISOString().split('T')[0];

  const [knowledge, claudeMd] = await Promise.all([
    loadKnowledge(),
    readFile(join(projectRoot, 'CLAUDE.md'), 'utf-8').catch(() => ''),
  ]);

  if (!claudeMd) {
    const savedPath = await saveReportToVault(vaultPath, {
      title: `Rules Suggest — ${today}`,
      date: today,
      content: '找不到 CLAUDE.md，請確認專案根目錄。',
      tags: ['rules-suggest', 'auto-generated'],
      filePrefix: 'rules-suggest',
      tool: 'rules-suggest',
    });
    return { savedPath, suggestionsCount: 0, relevantNotes: 0 };
  }

  const decisionNotes = Object.values(knowledge.notes)
    .filter(n => isDecisionNote(n.title, n.category, n.entities.map(e => e.name)))
    .sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt))
    .slice(0, 25);

  const noteSummaries = decisionNotes.map(n => {
    const insights = n.insights.slice(0, 2).map(i => i.content).join('；') || '（無洞察）';
    return `- 「${n.title}」[${n.category}]\n  ${insights}`;
  }).join('\n');

  const prompt = [
    `你是 KnowPipe 的知識管理助手。`,
    `\n以下是 CLAUDE.md 的關鍵章節（節錄 3000 字）：\n---\n${claudeMd.slice(0, 3000)}\n---`,
    `\n以下是 Vault 中最近的決策相關筆記（${decisionNotes.length} 篇）：\n${noteSummaries}`,
    `\n請比對以上兩份資料，找出 CLAUDE.md 中**可能遺漏或需補充**的決策規則、路由項目或踩坑教訓。`,
    `每條建議格式：\n[建議] <具體建議內容>\n[來源] <對應的 Vault 筆記標題>\n[位置] 建議新增至 CLAUDE.md 的哪個章節`,
    `\n輸出 3-6 條最有價值的建議，不要重複 CLAUDE.md 已有的內容。用繁體中文。`,
  ].join('\n');

  const suggestions = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    timeoutMs: 60_000,
    maxTokens: 1000,
  });

  const suggCount = suggestions ? (suggestions.match(/\[建議\]/g)?.length ?? 0) : 0;

  const content = suggestions
    ? `## 建議清單（Suggest-Only）\n\n` +
      `> ⚠️ 以下為建議，不會自動修改 CLAUDE.md，需人工確認後手動套用。\n\n${suggestions}`
    : '## 無建議\n\nLLM 分析後未找到需補充的規則，或 Vault 決策類筆記不足（需先執行 /vault analyze）。';

  const savedPath = await saveReportToVault(vaultPath, {
    title: `CLAUDE.md Rules Suggest — ${today}`,
    date: today,
    content,
    tags: ['rules-suggest', 'claude-md', 'auto-generated'],
    filePrefix: 'rules-suggest',
    subtitle: `分析 ${decisionNotes.length} 篇決策筆記，發現 ${suggCount} 條建議`,
    tool: 'rules-suggest',
  });

  logger.info('rules-suggest', '規則建議生成完成', { suggestions: suggCount, notes: decisionNotes.length });
  return { savedPath, suggestionsCount: suggCount, relevantNotes: decisionNotes.length };
}
