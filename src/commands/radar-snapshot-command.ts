/**
 * /radar snapshot — competitor page monitoring without external API.
 * /radar snapshot <url>         → take or compare snapshot
 * /radar snapshot list          → list tracked URLs
 * /radar snapshot remove <url> → stop tracking a URL
 *
 * On first call: fetches URL, summarises with AI, stores snapshot.
 * On repeat call: re-fetches, AI-diffs against stored summary → highlights changes.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchJina } from '../utils/jina-reader.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';
import { withTypingIndicator } from './command-runner.js';

const SNAPSHOT_FILE = join('data', 'snapshots.json');

interface Snapshot {
  url: string;
  title: string;
  summary: string;   // AI-generated 3-sentence summary
  takenAt: string;   // ISO datetime
}

async function loadSnapshots(): Promise<Record<string, Snapshot>> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_FILE, 'utf-8')) as Record<string, Snapshot>;
  } catch { return {}; }
}

async function saveSnapshots(data: Record<string, Snapshot>): Promise<void> {
  await mkdir('data', { recursive: true });
  await writeFile(SNAPSHOT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function urlKey(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12);
}

async function summarisePage(title: string, text: string): Promise<string> {
  const prompt = [
    'CAVEMAN RULE: Output ONLY 3 sentences in Traditional Chinese. No JSON. No lists.',
    '用 3 句話（繁體中文）概括以下頁面的核心功能/主要內容/最新資訊。',
    '禁止複述網頁標題。專注於：版本/功能/定價/核心賣點的具體細節。',
    `標題：${title}`,
    `內容：${text.slice(0, 2000)}`,
  ].join('\n');
  const result = await runLocalLlmPrompt(prompt, { timeoutMs: 30_000, model: 'flash' });
  return result?.trim() ?? '（摘要失敗）';
}

export async function handleSnapshot(ctx: Context, _config: AppConfig, arg: string): Promise<void> {
  // /radar snapshot list
  if (arg === 'list') {
    const snaps = await loadSnapshots();
    const entries = Object.values(snaps);
    if (entries.length === 0) {
      await ctx.reply('📭 尚無追蹤中的快照。\n用法：/radar snapshot <URL>');
      return;
    }
    const lines = entries.map(s => {
      const date = new Date(s.takenAt).toLocaleDateString('zh-TW');
      return `• ${s.title.slice(0, 30)} (${date})\n  ${s.url.slice(0, 60)}`;
    });
    await ctx.reply(`📸 追蹤中的快照（${entries.length} 個）：\n\n${lines.join('\n\n')}`);
    return;
  }

  // /radar snapshot remove <url>
  if (arg.startsWith('remove ')) {
    const url = arg.slice(7).trim();
    const snaps = await loadSnapshots();
    const key = urlKey(url);
    if (!snaps[key]) { await ctx.reply('❌ 找不到此 URL 的快照'); return; }
    delete snaps[key];
    await saveSnapshots(snaps);
    await ctx.reply('🗑 已移除快照');
    return;
  }

  // /radar snapshot <url>
  const url = arg.trim();
  if (!url.startsWith('http')) {
    await ctx.reply('用法：\n/radar snapshot <URL>\n/radar snapshot list\n/radar snapshot remove <URL>');
    return;
  }

  await withTypingIndicator(ctx, '📸 抓取頁面快照中…', async () => {
    const page = await fetchJina(url);
    if (!page) throw new Error('無法取得頁面內容');

    const snaps = await loadSnapshots();
    const key = urlKey(url);
    const prev = snaps[key];
    const newSummary = await summarisePage(page.title, page.markdown);
    const now = new Date().toISOString();

    if (!prev) {
      snaps[key] = { url, title: page.title, summary: newSummary, takenAt: now };
      await saveSnapshots(snaps);
      await ctx.reply(
        `✅ 快照已建立：${page.title.slice(0, 50)}\n\n${newSummary}\n\n_再次執行同 URL 可比較變化_`,
        { parse_mode: 'Markdown' },
      );
    } else {
      const diffPrompt = [
        'CAVEMAN RULE: Output ONLY Traditional Chinese text. No JSON.',
        '比較以下兩份網頁摘要，列出具體變化（新功能/定價調整/重大更新）。',
        '若無明顯差異，回覆「本次無明顯變化」。每條變化一行，前綴「•」。最多 5 條。',
        `舊摘要（${prev.takenAt.slice(0, 10)}）：${prev.summary}`,
        `新摘要（${now.slice(0, 10)}）：${newSummary}`,
      ].join('\n');
      const diff = await runLocalLlmPrompt(diffPrompt, { timeoutMs: 30_000, model: 'flash' });
      snaps[key] = { url, title: page.title, summary: newSummary, takenAt: now };
      await saveSnapshots(snaps);
      const prevDate = prev.takenAt.slice(0, 10);
      await ctx.reply(
        `🔍 *${page.title.slice(0, 50)}*\n_對比 ${prevDate} 快照_\n\n${diff?.trim() ?? '（比較失敗）'}`,
        { parse_mode: 'Markdown' },
      );
    }
    logger.info('radar-snapshot', '快照完成', { url, hasChanges: !!prev });
  }, '快照失敗');
}
