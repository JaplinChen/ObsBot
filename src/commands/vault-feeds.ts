/** /vault feeds — Generate RSS 2.0 feeds per Vault category */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { VAULT_SUBFOLDER } from '../utils/config.js';
import { getAllMdFiles, parseFrontmatter } from '../vault/frontmatter-utils.js';
import { startTyping, stopTyping } from '../utils/typing-indicator.js';
import { logger } from '../core/logger.js';

const FEEDS_PER_CATEGORY = 20;
const COMBINED_LIMIT = 50;
const SKIP_CATEGORIES = new Set(['inbox', 'MOC']);

function toSlug(category: string): string {
  return category.replace(/[^a-zA-Z0-9一-鿿]/g, '-');
}

interface FeedEntry {
  title: string;
  url: string;
  summary: string;
  pubDate: Date;
}

async function collectEntries(vaultPath: string): Promise<Map<string, FeedEntry[]>> {
  const knowpipePath = join(vaultPath, VAULT_SUBFOLDER);
  const files = await getAllMdFiles(knowpipePath);
  const map = new Map<string, FeedEntry[]>();

  await Promise.all(files.map(async (f) => {
    try {
      const raw = await readFile(f, 'utf-8');
      const fm = parseFrontmatter(raw);
      const title = fm.get('title') ?? '';
      const url = fm.get('url') ?? '';
      const summary = fm.get('summary') ?? '';
      const dateStr = fm.get('date') ?? '';
      if (!title || !url || !dateStr) return;

      // Category = first directory segment under KnowPipe/
      const rel = relative(knowpipePath, dirname(f));
      const category = rel.split('/')[0] ?? '其他';
      if (SKIP_CATEGORIES.has(category)) return;

      const pubDate = new Date(dateStr);
      if (isNaN(pubDate.getTime())) return;

      if (!map.has(category)) map.set(category, []);
      map.get(category)!.push({ title, url, summary, pubDate });
    } catch {
      /* skip unreadable files */
    }
  }));

  // Sort each category by date desc, keep top N
  for (const [cat, entries] of map) {
    map.set(cat, entries
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, FEEDS_PER_CATEGORY));
  }
  return map;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRss(title: string, entries: FeedEntry[]): string {
  const lastBuild = new Date().toUTCString();
  const items = entries.map((e) => `
    <item>
      <title>${escapeXml(e.title)}</title>
      <link>${escapeXml(e.url)}</link>
      <guid>${escapeXml(e.url)}</guid>
      <pubDate>${e.pubDate.toUTCString()}</pubDate>
      <description>${escapeXml(e.summary)}</description>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>KnowPipe — ${escapeXml(title)}</title>
    <link>https://knowpipe.local</link>
    <description>KnowPipe 知識庫 — ${escapeXml(title)}</description>
    <language>zh-TW</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>${items}
  </channel>
</rss>`;
}

export async function generateFeeds(vaultPath: string): Promise<{ feedCount: number; outputDir: string; categories: string[] }> {
  const outputDir = join(process.cwd(), 'public', 'feeds');
  await mkdir(outputDir, { recursive: true });

  const categoryMap = await collectEntries(vaultPath);
  const categories: string[] = [];
  const allEntries: FeedEntry[] = [];

  const writes: Promise<void>[] = [];
  for (const [category, entries] of categoryMap) {
    const slug = toSlug(category);
    writes.push(writeFile(join(outputDir, `${slug}.xml`), buildRss(category, entries), 'utf-8'));
    categories.push(category);
    allEntries.push(...entries);
  }
  await Promise.all(writes);

  // Combined feed (all categories, newest first)
  const combined = allEntries
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, COMBINED_LIMIT);
  await writeFile(join(outputDir, 'all.xml'), buildRss('全部分類', combined), 'utf-8');

  return { feedCount: categoryMap.size, outputDir, categories };
}

export async function handleVaultFeeds(ctx: Context, config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  await ctx.reply('📡 正在產生 RSS Feed…');

  try {
    const { feedCount, outputDir, categories } = await generateFeeds(config.vaultPath);
    stopTyping(typing);
    const lines = [
      `✅ RSS Feed 產生完成`,
      `分類數：${feedCount} 個`,
      `輸出：${outputDir}`,
      ``,
      `部署到 Cloudflare Pages 後訂閱：`,
      `• 全部：feeds/all.xml`,
      ...categories.slice(0, 10).map((c) => {
        const slug = toSlug(c);
        return `• ${c}：feeds/${slug}.xml`;
      }),
    ];
    if (categories.length > 10) lines.push(`… 還有 ${categories.length - 10} 個分類`);
    await ctx.reply(lines.join('\n'));
  } catch (err) {
    stopTyping(typing);
    logger.error('vault-feeds', '產生 Feed 失敗', { err: String(err) });
    await ctx.reply(`Feed 產生失敗：${String(err)}`);
  }
}
