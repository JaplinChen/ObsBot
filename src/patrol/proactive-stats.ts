/**
 * 主動採集比例統計 — 掃描 Vault 筆記的 frontmatter，
 * 比較 bot-discovered 標籤與總筆記數，計算 Bot 自主值班效率。
 *
 * 計算起點：2026-05-10（bot-discovered tag 制度上線日）
 * 早於此日期的筆記無 tag，不計入主動率，避免基線失真。
 */
import { readFile } from 'node:fs/promises';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';

/** 追蹤系統上線日 — 早於此日期的筆記沒有 bot-discovered tag */
const TRACKING_START = '2026-05-10';

export interface ProactiveStats {
  totalNotes: number;
  botDiscovered: number;
  userSubmitted: number;
  proactiveRatio: number;
  /** 僅計算追蹤上線後的筆記 */
  sinceTracking: { total: number; botDiscovered: number; ratio: number; startDate: string };
  last30Days: { total: number; botDiscovered: number; ratio: number };
}

const BOT_TAG_RE = /\bbot-discovered\b/;
const DATE_RE = /^date:\s*(\d{4}-\d{2}-\d{2})/m;

function isRecent(dateStr: string, days: number): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() >= Date.now() - days * 86_400_000;
}

function isAfterTracking(dateStr: string): boolean {
  if (!dateStr) return false;
  return dateStr >= TRACKING_START;
}

export async function computeProactiveStats(vaultPath: string): Promise<ProactiveStats> {
  const files = await getAllMdFiles(vaultPath);

  let total = 0, bot = 0;
  let trackingTotal = 0, trackingBot = 0;
  let recent30Total = 0, recent30Bot = 0;

  for (const f of files) {
    let raw: string;
    try { raw = await readFile(f, 'utf-8'); } catch { continue; }

    const front = raw.slice(0, 600);
    if (!front.startsWith('---')) continue;
    total++;

    const isBot = BOT_TAG_RE.test(front);
    if (isBot) bot++;

    const dm = DATE_RE.exec(front);
    const dateStr = dm?.[1] ?? '';

    if (isAfterTracking(dateStr)) {
      trackingTotal++;
      if (isBot) trackingBot++;
    }
    if (isRecent(dateStr, 30)) {
      recent30Total++;
      if (isBot) recent30Bot++;
    }
  }

  return {
    totalNotes: total,
    botDiscovered: bot,
    userSubmitted: total - bot,
    proactiveRatio: total > 0 ? bot / total : 0,
    sinceTracking: {
      total: trackingTotal,
      botDiscovered: trackingBot,
      ratio: trackingTotal > 0 ? trackingBot / trackingTotal : 0,
      startDate: TRACKING_START,
    },
    last30Days: {
      total: recent30Total,
      botDiscovered: recent30Bot,
      ratio: recent30Total > 0 ? recent30Bot / recent30Total : 0,
    },
  };
}

export function formatProactiveStats(s: ProactiveStats): string {
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const bar = (r: number, len = 20) => '█'.repeat(Math.round(r * len)) + '░'.repeat(len - Math.round(r * len));

  const st = s.sinceTracking;
  const lines = [
    '🤖 Bot 主動值班效率報告',
    '',
    `▸ 追蹤制度上線後（${st.startDate} 起）`,
    `  新增筆記：${st.total} 篇`,
    `  Bot 主動發現：${st.botDiscovered} 篇 (${pct(st.ratio)})`,
    `  ${bar(st.ratio)} ${pct(st.ratio)}`,
    '',
    '▸ 最近 30 天（含追蹤前筆記）',
    `  總計：${s.last30Days.total} 篇`,
    `  Bot 主動發現：${s.last30Days.botDiscovered} 篇 (${pct(s.last30Days.ratio)})`,
    `  ${bar(s.last30Days.ratio)} ${pct(s.last30Days.ratio)}`,
    '',
    `▸ 全庫（${s.totalNotes} 篇，含 ${st.startDate} 前舊筆記）`,
    `  歷史主動率：${pct(s.proactiveRatio)}（追蹤前筆記均計入手動）`,
    '',
  ];

  if (st.ratio < 0.2) {
    if (st.total === 0) {
      lines.push('⏳ 追蹤剛上線——等 /patrol 或 /radar 存入筆記後比例才會累積。');
    } else {
      lines.push('📉 主動率偏低——Bot 大多在等你送 URL，試試 /patrol 或調整 /radar 關鍵字。');
    }
  } else if (st.ratio < 0.5) {
    lines.push('🔄 主動率中等——Bot 已在值班，但仍有提升空間。');
  } else {
    lines.push('✅ 主動率良好——Bot 正在替你值班！繼續保持。');
  }

  lines.push('', '來源追蹤：patrol → /patrol stats | radar → /radar 關鍵字 | 訂閱 → /subscribe');
  return lines.join('\n');
}
