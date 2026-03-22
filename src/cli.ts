#!/usr/bin/env node
/**
 * GetThreads CLI — 獨立於 Telegram Bot 的命令列入口
 * 用法：
 *   npx tsx src/cli.ts fetch <url>       擷取 URL → 存入 Obsidian
 *   npx tsx src/cli.ts classify <url>    僅分類，不存檔
 *   npx tsx src/cli.ts extract <url>     僅擷取，輸出 JSON
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import { existsSync } from 'node:fs';
import { registerAllExtractors } from './extractors/index.js';
import { findExtractor } from './utils/url-parser.js';
import { classifyContent, extractKeywords } from './classifier.js';
import { enrichExtractedContent } from './messages/services/enrich-content-service.js';
import { saveExtractedContent } from './messages/services/save-content-service.js';
import { extractContentWithComments } from './messages/services/extract-content-service.js';
import type { ExtractorWithComments } from './extractors/types.js';
import type { AppConfig } from './utils/config.js';
import { buildKnowledgeGraph, saveGraph, findRelated } from './knowledge/graph-builder.js';

// ── Helpers ──

function printUsage(): void {
  console.log(`
GetThreads CLI

用法：
  npx tsx src/cli.ts fetch <url>       擷取 → 豐富化 → 存入 Obsidian
  npx tsx src/cli.ts classify <url>    僅分類（不存檔）
  npx tsx src/cli.ts extract <url>     僅擷取（輸出 JSON）
  npx tsx src/cli.ts graph             建構知識圖譜 (graph.json)
  npx tsx src/cli.ts graph:find <q>    查詢知識圖譜中的關聯實體

範例：
  npx tsx src/cli.ts fetch https://x.com/user/status/123
  npx tsx src/cli.ts classify https://github.com/org/repo
  npx tsx src/cli.ts graph:find claude
`.trim());
}

function loadCliConfig(): AppConfig {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error('❌ VAULT_PATH 未設定，請在 .env 中設定');
    process.exit(1);
  }
  if (!existsSync(vaultPath)) {
    console.error(`❌ VAULT_PATH 不存在: ${vaultPath}`);
    process.exit(1);
  }
  return {
    botToken: '',
    vaultPath,
    enableTranslation: process.env.ENABLE_TRANSLATION === 'true',
    maxLinkedUrls: parseInt(process.env.MAX_LINKED_URLS ?? '5', 10) || 5,
    saveVideos: process.env.SAVE_VIDEOS === 'true',
  };
}

// ── Commands ──

async function cmdClassify(url: string): Promise<void> {
  registerAllExtractors();
  const extractor = findExtractor(url);
  if (!extractor) {
    console.error(`❌ 不支援的 URL: ${url}`);
    process.exit(1);
  }

  console.log(`⏳ 擷取中 (${extractor.platform})...`);
  const content = await extractContentWithComments(url, extractor as ExtractorWithComments);
  const category = classifyContent(content.title, content.text);
  const keywords = extractKeywords(content.title, content.text);

  console.log(`\n📋 分類結果`);
  console.log(`  標題：${content.title}`);
  console.log(`  平台：${extractor.platform}`);
  console.log(`  分類：${category}`);
  console.log(`  關鍵詞：${keywords.join(', ') || '(無)'}`);
}

async function cmdExtract(url: string): Promise<void> {
  registerAllExtractors();
  const extractor = findExtractor(url);
  if (!extractor) {
    console.error(`❌ 不支援的 URL: ${url}`);
    process.exit(1);
  }

  console.log(`⏳ 擷取中 (${extractor.platform})...`);
  const content = await extractContentWithComments(url, extractor as ExtractorWithComments);

  const output = {
    title: content.title,
    platform: content.platform,
    author: content.authorHandle,
    date: content.date,
    url: content.url,
    text: content.text.slice(0, 500) + (content.text.length > 500 ? '...' : ''),
    images: content.images.length,
    videos: content.videos.length,
    comments: content.comments?.length ?? 0,
  };
  console.log(JSON.stringify(output, null, 2));
}

async function cmdFetch(url: string): Promise<void> {
  registerAllExtractors();
  const config = loadCliConfig();

  const extractor = findExtractor(url);
  if (!extractor) {
    console.error(`❌ 不支援的 URL: ${url}`);
    process.exit(1);
  }

  const t0 = Date.now();
  console.log(`⏳ 擷取中 (${extractor.platform})...`);
  const content = await extractContentWithComments(url, extractor as ExtractorWithComments);
  console.log(`✅ 擷取完成 (${Date.now() - t0}ms)`);

  const wasFallback = extractor.platform !== 'web' && content.platform === 'web';

  console.log(`⏳ 豐富化中...`);
  const t1 = Date.now();
  await enrichExtractedContent(content, config);
  console.log(`✅ 豐富化完成 (${Date.now() - t1}ms)`);

  // 寫入 Pipeline 處理日誌
  content.processingLog = {
    extractorUsed: wasFallback ? `web (fallback from ${extractor.platform})` : extractor.platform,
    wasFallback: wasFallback || undefined,
    processingTimeMs: Date.now() - t0,
  };

  console.log(`⏳ 存檔中...`);
  const t2 = Date.now();
  const result = await saveExtractedContent(content, config.vaultPath, {
    saveVideos: config.saveVideos,
  });
  console.log(`✅ 存檔完成 (${Date.now() - t2}ms)`);

  if (result.duplicate) {
    console.log(`\n⚠️ 重複 URL，已存在：${result.mdPath}`);
  } else {
    console.log(`\n📁 已儲存`);
    console.log(`  路徑：${result.mdPath}`);
    console.log(`  分類：${content.category}`);
    console.log(`  圖片：${result.imageCount}`);
    console.log(`  影片：${result.videoCount}`);
    console.log(`  總耗時：${Date.now() - t0}ms`);
  }
}

// ── Main ──

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const url = args[1];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  // graph 和 graph:find 不需要 URL 參數
  if (command === 'graph') {
    try {
      const config = loadCliConfig();
      console.log('⏳ 建構知識圖譜...');
      const graph = await buildKnowledgeGraph(config.vaultPath);
      const outputPath = await saveGraph(graph, config.vaultPath);
      console.log(`\n✅ 知識圖譜已建構`);
      console.log(`  筆記數：${graph.metadata.noteCount}`);
      console.log(`  實體數：${graph.metadata.entityCount}`);
      console.log(`  關係數：${graph.metadata.edgeCount}`);
      console.log(`  輸出：${outputPath}`);
      // 顯示 top 10 實體
      const top = Object.values(graph.entities).sort((a, b) => b.count - a.count).slice(0, 10);
      console.log(`\n📊 出現最多的實體：`);
      for (const e of top) console.log(`  [${e.type}] ${e.name} (${e.count})`);
    } catch (err) {
      console.error('❌ 失敗:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
    return;
  }

  if (command === 'graph:find') {
    const query = url; // reuse url as query
    if (!query) { console.error('❌ 請提供查詢詞'); process.exit(1); }
    try {
      const config = loadCliConfig();
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const raw = await readFile(join(config.vaultPath, 'GetThreads', 'graph.json'), 'utf-8');
      const graph = JSON.parse(raw);
      const related = findRelated(graph, query);
      if (related.length === 0) { console.log('未找到相關實體'); return; }
      console.log(`🔗 「${query}」的關聯實體：`);
      for (const e of related) console.log(`  [${e.type}] ${e.name} (出現 ${e.count} 次)`);
    } catch (err) {
      console.error('❌ 失敗:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
    return;
  }

  if (!url) {
    console.error('❌ 請提供 URL');
    printUsage();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'fetch':
        await cmdFetch(url);
        break;
      case 'classify':
        await cmdClassify(url);
        break;
      case 'extract':
        await cmdExtract(url);
        break;
      default:
        console.error(`❌ 未知命令: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`❌ 失敗:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
