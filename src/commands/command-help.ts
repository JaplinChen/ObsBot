import type { Context } from 'telegraf';
import { Markup } from 'telegraf';

export const HELP_TEXT = [
  'KnowPipe — 傳送連結即可自動儲存',
  'X / Threads / Reddit / YouTube / GitHub',
  '微博 / B站 / 小紅書 / 抖音 / 任何網頁',
  '',
  '核心指令：',
  '/search — 搜尋（主題/作者/關鍵字/Vault）',
  '/ask — 用知識庫回答問題',
  '/radar — 內容雷達（自動發現+存入）',
  '/discover — GitHub 專案探索',
  '',
  '點擊下方查看更多，或 /help all 完整列表',
].join('\n');

export const HELP_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('📥 搜尋與收集', 'help:content'), Markup.button.callback('🧠 知識系統', 'help:knowledge')],
  [Markup.button.callback('🔧 Vault 維護', 'help:vault'), Markup.button.callback('⚙️ 系統管理', 'help:system')],
]);

export const HELP_CATEGORIES: Record<string, string> = {
  content: [
    '📥 搜尋與收集',
    '',
    '/search — 統一搜尋入口',
    '  /search topic <主題> — 主題搜尋（跨平台）',
    '  /search author <作者> — 作者文章搜尋',
    '  /search keyword <關鍵字> — 關鍵字跨平台搜尋',
    '  /search vault <關鍵字> — Vault 筆記搜尋',
    '',
    '/discover <關鍵字> — GitHub 專案探索',
    '/radar — 內容雷達（自動搜尋+存入）',
    '  /radar add topic <主題> — 新增主題追蹤',
    '  /radar add author <作者> — 新增作者追蹤',
    '  /radar add keyword <關鍵字> — 新增關鍵字監控',
    '',
    '/track — 追蹤與訂閱',
    '  /track timeline @用戶 — 抓取最近貼文',
    '  /track subscribe — 訂閱管理',
    '  /track patrol — 多平台巡邏',
  ].join('\n'),
  knowledge: [
    '🧠 知識系統',
    '',
    '/ask <問題> — 用知識庫回答問題',
    '/knowledge — 知識庫總覽（gaps/skills/analyze）',
    '/digest — 知識報告（精華/週報/蒸餾/整合）',
  ].join('\n'),
  vault: [
    '🔧 Vault 維護',
    '',
    '/vault — 統一維護入口',
    '  /vault quality — 品質報告',
    '  /vault dedup — 掃描重複筆記',
    '  /vault reprocess <路徑> — 重新 AI 豐富',
    '  /vault reformat — 修復排版',
    '  /vault benchmark — 品質基準報告',
    '  /vault retry — 重試失敗連結',
    '  /vault suggest — 推薦相關筆記連結',
  ].join('\n'),
  system: [
    '⚙️ 系統管理',
    '',
    '/admin — 統一管理入口',
    '  /admin status — Bot 狀態',
    '  /admin health — 健康檢查',
    '  /admin doctor — 全面診斷',
    '  /admin logs [n] — 查看日誌',
    '  /admin restart — 重啟 Bot',
    '  /admin code <action> — 遠端指令',
    '  /admin clear — 清除統計',
    '  /admin learn — Vault 學習',
  ].join('\n'),
};

export async function handleHelpCategory(ctx: Context & { match: RegExpExecArray }): Promise<void> {
  const cat = ctx.match[1];
  await ctx.answerCbQuery().catch(() => {});
  const text = HELP_CATEGORIES[cat];
  if (text) await ctx.reply(text);
}

export const HELP_ALL_TEXT = [
  'KnowPipe 完整指令列表',
  '',
  '📥 搜尋與收集',
  '/search [vault|web|monitor|video] <查詢> — 統一搜尋',
  '/discover <關鍵字> — GitHub 專案探索',
  '/radar — 內容雷達',
  '/track [timeline|subscribe|patrol] — 追蹤與訂閱',
  '',
  '🧠 知識系統',
  '/ask <問題> — 知識庫問答',
  '/knowledge [gaps|skills|analyze] — 知識庫總覽',
  '/digest [weekly|distill] — 知識報告',
  '',
  '🔧 Vault 維護',
  '/vault [quality|dedup|reprocess|reformat|benchmark|retry|suggest]',
  '',
  '⚙️ 系統管理',
  '/admin [status|health|doctor|logs|restart|code|clear|learn]',
  '',
  '所有舊指令（/find /monitor /status 等）仍可直接使用',
].join('\n');

/** Telegram menu — only 10 core commands */
export const BOT_COMMANDS_MENU = [
  { command: 'search', description: '搜尋（主題/作者/關鍵字/Vault）' },
  { command: 'ask', description: '用知識庫回答問題' },
  { command: 'radar', description: '內容雷達（自動發現+存入）' },
  { command: 'digest', description: '知識報告（精華/週報/蒸餾）' },
  { command: 'discover', description: 'GitHub 專案探索' },
  { command: 'track', description: '追蹤（時間軸/訂閱/巡邏）' },
  { command: 'vault', description: 'Vault 維護（品質/重複/重處理）' },
  { command: 'admin', description: '系統管理（狀態/診斷/重啟）' },
  { command: 'help', description: '顯示說明' },
];
