/**
 * Tool Usage Dashboard — tracks tool mention frequency,
 * generates "active vs dormant" usage stats for /knowledge.
 * Reuses wall-index buildToolIndex + computeToolActivity (zero duplication).
 */
import type { VaultKnowledge } from './types.js';
import type { ToolEntry, ToolActivity } from '../radar/wall-types.js';
import { buildToolIndex, computeToolActivity } from '../radar/wall-index.js';

/* ── Types ────────────────────────────────────────────────── */

export interface ToolDashboard {
  generatedAt: string;
  totalTools: number;
  byStatus: { active: number; dormant: number; rising: number; new: number };
  topMentioned: Array<{ name: string; mentions: number; status: string }>;
  risingTools: Array<{ name: string; recentMentions: number }>;
  forgotten: Array<{ name: string; daysSince: number; totalMentions: number }>;
  categoryBreakdown: Array<{ category: string; count: number }>;
  monthlyTimeline: Array<{ month: string; toolCount: number }>;
}

/* ── Dashboard builder ────────────────────────────────────── */

const FORGOTTEN_DAYS = 90; // 3+ months

export function buildToolDashboard(knowledge: VaultKnowledge): ToolDashboard {
  const tools = buildToolIndex(knowledge);
  const activities = computeToolActivity(tools, 30);

  // Status counts
  const byStatus = { active: 0, dormant: 0, rising: 0, new: 0 };
  for (const a of activities) byStatus[a.status]++;

  // Top mentioned (sort by total, take 10)
  const topMentioned = [...activities]
    .sort((a, b) => b.totalMentions - a.totalMentions)
    .slice(0, 10)
    .map(a => ({ name: a.name, mentions: a.totalMentions, status: a.status }));

  // Rising tools
  const risingTools = activities
    .filter(a => a.status === 'rising')
    .sort((a, b) => b.recentMentions - a.recentMentions)
    .slice(0, 5)
    .map(a => ({ name: a.name, recentMentions: a.recentMentions }));

  // Forgotten: saved 90+ days ago, never revisited (totalMentions === 1)
  const forgotten = activities
    .filter(a => a.daysSinceLastMention >= FORGOTTEN_DAYS && a.totalMentions <= 1)
    .sort((a, b) => b.daysSinceLastMention - a.daysSinceLastMention)
    .slice(0, 15)
    .map(a => ({ name: a.name, daysSince: a.daysSinceLastMention, totalMentions: a.totalMentions }));

  // Category breakdown
  const catMap = new Map<string, number>();
  for (const t of tools) {
    const cat = t.category.split('/')[0] || '其他';
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
  }
  const categoryBreakdown = [...catMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Monthly timeline (aggregate first-seen across months)
  const monthlyTimeline = buildMonthlyTimeline(tools);

  return {
    generatedAt: new Date().toISOString(),
    totalTools: tools.length,
    byStatus,
    topMentioned,
    risingTools,
    forgotten,
    categoryBreakdown,
    monthlyTimeline,
  };
}

/** Build monthly tool mention counts from all tool timelines */
function buildMonthlyTimeline(tools: ToolEntry[]): Array<{ month: string; toolCount: number }> {
  const monthMap = new Map<string, number>();
  for (const t of tools) {
    for (const pt of t.mentionTimeline) {
      monthMap.set(pt.month, (monthMap.get(pt.month) ?? 0) + pt.count);
    }
  }
  return [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6) // last 6 months
    .map(([month, toolCount]) => ({ month, toolCount }));
}

/* ── Formatters ───────────────────────────────────────────── */

const STATUS_EMOJI: Record<string, string> = {
  active: '✅', dormant: '💤', rising: '🚀', new: '🆕',
};

/** Format dashboard for Telegram message */
export function formatToolDashboard(d: ToolDashboard): string {
  if (d.totalTools === 0) {
    return '📭 知識庫中尚未偵測到工具/框架。';
  }

  const lines: string[] = ['🛠 工具使用率儀表板', ''];

  // Overview
  lines.push(`共追蹤 ${d.totalTools} 個工具/框架`);
  lines.push(
    `  ✅ 活躍 ${d.byStatus.active}` +
    `  🚀 上升 ${d.byStatus.rising}` +
    `  🆕 新發現 ${d.byStatus.new}` +
    `  💤 沉睡 ${d.byStatus.dormant}`,
  );
  lines.push('');

  // Top mentioned
  if (d.topMentioned.length > 0) {
    lines.push('📊 最常提及的工具');
    for (const t of d.topMentioned.slice(0, 7)) {
      const emoji = STATUS_EMOJI[t.status] ?? '•';
      const bar = '█'.repeat(Math.min(t.mentions, 15));
      lines.push(`  ${emoji} ${t.name}: ${bar} ${t.mentions} 次`);
    }
    lines.push('');
  }

  // Rising
  if (d.risingTools.length > 0) {
    lines.push('🚀 近期關注上升');
    for (const t of d.risingTools) {
      lines.push(`  • ${t.name}：近期 ${t.recentMentions} 次提及`);
    }
    lines.push('');
  }

  // Category breakdown
  if (d.categoryBreakdown.length > 0) {
    lines.push('📁 工具分類');
    for (const c of d.categoryBreakdown.slice(0, 6)) {
      lines.push(`  • ${c.category}：${c.count} 個`);
    }
    lines.push('');
  }

  // Monthly timeline
  if (d.monthlyTimeline.length > 0) {
    lines.push('📈 月度提及趨勢');
    for (const m of d.monthlyTimeline) {
      const bar = '▓'.repeat(Math.min(Math.ceil(m.toolCount / 2), 20));
      lines.push(`  ${m.month}: ${bar} ${m.toolCount}`);
    }
    lines.push('');
  }

  // Forgotten tools
  if (d.forgotten.length > 0) {
    lines.push(`⚠️ 被遺忘的工具（${FORGOTTEN_DAYS}+ 天未再提及）`);
    for (const f of d.forgotten.slice(0, 8)) {
      lines.push(`  • ${f.name}：已 ${f.daysSince} 天未提及`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
