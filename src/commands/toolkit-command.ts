/**
 * /toolkit — Zero-cost toolkit: scan vault for free/open-source alternatives.
 * Groups results by usage category for quick reference.
 */
import type { Context } from 'telegraf';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../utils/config.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { logger } from '../core/logger.js';

/** Keywords that indicate a free/zero-cost tool or alternative. */
const FREE_KEYWORDS = [
  '免費', 'free', '零成本', 'zero-cost', '開源', 'open-source', 'open source',
  '替代', 'alternative', '自架', 'self-host', 'self-hosted', '自部署',
  '無需付費', '免付費', '0元', '省錢',
];

/** Usage categories for grouping results. */
const USAGE_CATEGORIES: Record<string, string[]> = {
  '📧 信箱/通訊': ['email', 'mail', '信箱', '郵件', 'smtp'],
  '🤖 AI 工具': ['ai', 'llm', 'claude', 'gpt', 'gemini', '模型', 'inference'],
  '🚀 部署/基礎設施': ['deploy', '部署', 'host', 'server', 'aws', 'cloud', 'docker', 'vps'],
  '🔧 開發工具': ['cli', 'editor', 'ide', 'debug', 'dev', '開發', 'coding'],
  '📊 監控/分析': ['monitor', '監控', 'analytics', 'log', '分析', 'dashboard'],
  '📝 筆記/知識管理': ['note', '筆記', 'obsidian', 'notion', 'knowledge', '知識'],
};

interface ToolkitEntry {
  title: string;
  summary: string;
  usageCategory: string;
}

/** Parse frontmatter value from raw note text. */
function fm(head: string, field: string): string {
  const m = head.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function parseList(head: string, field: string): string[] {
  const m = head.match(new RegExp(`^${field}:\\s*\\[(.+?)\\]`, 'm'));
  if (!m) return [];
  return m[1].split(',').map(k => k.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Check if a note matches free/open-source criteria. */
function matchesFreeKeywords(title: string, summary: string, keywords: string[]): boolean {
  const haystack = [title, summary, ...keywords].join(' ').toLowerCase();
  return FREE_KEYWORDS.some(kw => haystack.includes(kw.toLowerCase()));
}

/** Determine which usage category a note belongs to. */
function classifyUsage(title: string, summary: string, keywords: string[]): string {
  const haystack = [title, summary, ...keywords].join(' ').toLowerCase();
  for (const [label, kws] of Object.entries(USAGE_CATEGORIES)) {
    if (kws.some(kw => haystack.includes(kw))) return label;
  }
  return '🔹 其他';
}

/** Scan vault and collect free-tool entries. */
async function scanFreeTools(vaultPath: string): Promise<ToolkitEntry[]> {
  const files = await getAllMdFiles(join(vaultPath, 'KnowPipe'));
  const entries: ToolkitEntry[] = [];

  for (const f of files) {
    try {
      const raw = await readFile(f, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const head = fmMatch[1];

      const title = fm(head, 'title');
      const summary = fm(head, 'summary');
      const keywords = parseList(head, 'keywords');
      if (!title) continue;

      if (matchesFreeKeywords(title, summary, keywords)) {
        entries.push({
          title,
          summary: summary.slice(0, 60),
          usageCategory: classifyUsage(title, summary, keywords),
        });
      }
    } catch { /* skip */ }
  }

  return entries;
}

export async function handleToolkit(ctx: Context, config: AppConfig): Promise<void> {
  const msg = await ctx.reply('🔍 正在掃描 Vault 中的免費工具…');

  try {
    const entries = await scanFreeTools(config.vaultPath);

    if (entries.length === 0) {
      await ctx.telegram.editMessageText(
        msg.chat.id, msg.message_id, undefined,
        '🧰 零成本工具包\n\n目前 Vault 中未找到免費/開源工具筆記。',
      );
      return;
    }

    // Group by usage category
    const grouped = new Map<string, ToolkitEntry[]>();
    for (const e of entries) {
      const list = grouped.get(e.usageCategory) ?? [];
      list.push(e);
      grouped.set(e.usageCategory, list);
    }

    const lines: string[] = [`🧰 零成本工具包（共 ${entries.length} 項）`, ''];

    for (const [category, items] of [...grouped.entries()].sort()) {
      lines.push(category);
      for (const item of items.slice(0, 8)) {
        const desc = item.summary ? ` — ${item.summary}` : '';
        lines.push(`  • ${item.title}${desc}`);
      }
      if (items.length > 8) {
        lines.push(`  … 還有 ${items.length - 8} 項`);
      }
      lines.push('');
    }

    logger.info('toolkit', '掃描完成', { total: entries.length, categories: grouped.size });

    await ctx.telegram.editMessageText(
      msg.chat.id, msg.message_id, undefined,
      lines.join('\n').slice(0, 4000),
    );
  } catch (err) {
    logger.warn('toolkit', '掃描失敗', { error: (err as Error).message });
    await ctx.reply(`❌ 掃描失敗：${(err as Error).message}`);
  }
}
