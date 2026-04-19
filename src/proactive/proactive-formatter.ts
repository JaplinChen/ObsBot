/**
 * Proactive digest formatting — extracted from proactive-service.ts
 * to keep the main service file within 300 lines.
 */
import type { ProactiveDigest } from './proactive-types.js';
import type { RadarCycleSummary } from '../radar/radar-types.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';

/** Format radar cycle summary for digest. */
export function formatRadarSection(summary: RadarCycleSummary | undefined): string[] {
  if (!summary || summary.totalSaved === 0) return [];

  const lines: string[] = ['📡 【雷達自動發現】'];
  const parts: string[] = [];
  const bt = summary.byType;
  if (bt.search) parts.push(`搜尋 ${bt.search} 篇`);
  if (bt.github) parts.push(`GitHub ${bt.github} 篇`);
  if (bt.rss) parts.push(`RSS ${bt.rss} 篇`);
  if (bt.hn) parts.push(`HN ${bt.hn} 篇`);
  if (bt.devto) parts.push(`Dev.to ${bt.devto} 篇`);
  lines.push(`  共 ${summary.totalSaved} 篇：${parts.join('、')}`);
  lines.push('');
  return lines;
}

/** Build formatted digest message for Telegram */
export function formatDigestMessage(
  digest: ProactiveDigest, radarSummary?: RadarCycleSummary, wallLines?: string[],
): string {
  const lines: string[] = ['📊 每日知識摘要', ''];
  lines.push(`📅 ${digest.period} | 共 ${digest.totalNotes} 篇新筆記`);
  lines.push('');

  lines.push(...formatRadarSection(radarSummary));
  if (wallLines && wallLines.length > 0) lines.push(...wallLines);

  if (digest.categoryBreakdown.length > 0) {
    lines.push('【分類概覽】');
    for (const { category, count } of digest.categoryBreakdown.slice(0, 8)) {
      lines.push(`  • ${category}：${count} 篇`);
    }
    lines.push('');
  }

  if (digest.trends.length > 0) {
    lines.push('🔥 【趨勢關鍵字】');
    for (const t of digest.trends.slice(0, 5)) {
      const growth = t.previousCount === 0
        ? '（新出現）'
        : `（+${t.growthRate}%）`;
      lines.push(`  • ${t.keyword}：近期 ${t.recentCount} 次 ${growth}`);
    }
    lines.push('');
  }

  if (digest.gaps.length > 0) {
    lines.push('⚠️ 【久未更新分類】');
    for (const g of digest.gaps.slice(0, 5)) {
      lines.push(`  • ${g.category}：已 ${g.daysSinceLastNote} 天未有新內容`);
    }
    lines.push('');
  }

  if (digest.summary) {
    lines.push('🧠 【AI 總結】');
    lines.push(digest.summary);
    lines.push('');
  }

  if (digest.insights && digest.insights.length > 0) {
    lines.push(...digest.insights);
  }

  return lines.join('\n');
}

/** Strip plain-text thinking process sections and XML think tags from LLM output. */
function stripThinkingText(text: string): string {
  let cleaned = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/\n*(?:Thinking Process|思考過程|Reasoning|Analysis):[\s\S]*/i, '');
  return cleaned.trim();
}

/** Generate AI insight summary for digest (optional, best-effort) */
export async function generateDigestInsight(digest: ProactiveDigest): Promise<string | undefined> {
  if (digest.totalNotes < 5) return undefined;

  const catList = digest.categoryBreakdown
    .slice(0, 5)
    .map(c => `${c.category}(${c.count}篇)`)
    .join('、');

  const trendList = digest.trends
    .slice(0, 5)
    .map(t => t.keyword)
    .join('、');

  const prompt = [
    '你是知識管理助手。根據以下用戶近期收集的筆記統計，寫一段 100 字以內的洞察。',
    '語氣中性專業，使用繁體中文。直接輸出洞察內容，不要輸出思考過程、分析步驟或任何前置說明。',
    `分類分佈：${catList}`,
    trendList ? `趨勢關鍵字：${trendList}` : '',
    '重點：1. 用戶近期關注焦點 2. 可能的知識探索方向建議',
  ].filter(Boolean).join('\n');

  try {
    const raw = await runLocalLlmPrompt(prompt, { timeoutMs: 20_000, model: 'flash', maxTokens: 256 });
    if (!raw) return undefined;
    const result = stripThinkingText(raw);
    return result || undefined;
  } catch {
    return undefined;
  }
}
