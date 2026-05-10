/**
 * /filter — manage the content blocklist (categories and keywords).
 *
 * /filter              → show current blocklist
 * /filter add <cat>    → block a category
 * /filter add kw:<kw>  → block a keyword
 * /filter remove <cat> → unblock a category
 * /filter remove kw:<kw> → unblock a keyword
 */
import type { Context } from 'telegraf';
import {
  loadContentFilter,
  addBlockedCategory,
  removeBlockedCategory,
  addBlockedKeyword,
  removeBlockedKeyword,
} from '../utils/content-filter.js';

export async function handleFilter(ctx: Context): Promise<void> {
  const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text : '';
  const args = text.replace(/^\/filter\s*/, '').trim();

  if (!args) {
    await showFilterList(ctx);
    return;
  }

  const [subcmd, ...rest] = args.split(/\s+/);
  const value = rest.join(' ').trim();

  if (subcmd === 'add') {
    if (!value) { await ctx.reply('用法：/filter add <分類> 或 /filter add kw:<關鍵字>'); return; }
    if (value.startsWith('kw:')) {
      const kw = value.slice(3).trim();
      await addBlockedKeyword(kw);
      await ctx.reply(`✅ 已封鎖關鍵字「${kw}」`);
    } else {
      await addBlockedCategory(value);
      await ctx.reply(`✅ 已封鎖分類「${value}」`);
    }
    return;
  }

  if (subcmd === 'remove') {
    if (!value) { await ctx.reply('用法：/filter remove <分類> 或 /filter remove kw:<關鍵字>'); return; }
    if (value.startsWith('kw:')) {
      const kw = value.slice(3).trim();
      await removeBlockedKeyword(kw);
      await ctx.reply(`✅ 已解除關鍵字「${kw}」封鎖`);
    } else {
      await removeBlockedCategory(value);
      await ctx.reply(`✅ 已解除分類「${value}」封鎖`);
    }
    return;
  }

  await ctx.reply(
    '用法：\n' +
    '/filter — 查看封鎖清單\n' +
    '/filter add <分類> — 封鎖分類\n' +
    '/filter add kw:<關鍵字> — 封鎖關鍵字\n' +
    '/filter remove <分類> — 解除分類封鎖\n' +
    '/filter remove kw:<關鍵字> — 解除關鍵字封鎖',
  );
}

async function showFilterList(ctx: Context): Promise<void> {
  const filter = await loadContentFilter();
  const lines: string[] = ['🚫 內容過濾清單', ''];

  lines.push(`【封鎖分類】（${filter.blockedCategories.length} 個）`);
  if (filter.blockedCategories.length > 0) {
    filter.blockedCategories.forEach(c => lines.push(`  • ${c}`));
  } else {
    lines.push('  （無）');
  }

  lines.push('');
  lines.push(`【封鎖關鍵字】（${filter.blockedKeywords.length} 個）`);
  if (filter.blockedKeywords.length > 0) {
    filter.blockedKeywords.forEach(k => lines.push(`  • ${k}`));
  } else {
    lines.push('  （無）');
  }

  if (filter.stats) {
    lines.push('');
    lines.push(`【今日過濾統計】共 ${filter.stats.total} 篇`);
    const topCats = Object.entries(filter.stats.byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    topCats.forEach(([cat, n]) => lines.push(`  • ${cat}：${n} 篇`));
  }

  lines.push('');
  lines.push('/filter add <分類> 新增封鎖 | /filter remove <分類> 解除封鎖');

  await ctx.reply(lines.join('\n'));
}
