#!/usr/bin/env node
/**
 * LLM 分類器 A/B 測試工具
 * 用法：npx tsx src/cli-ab-test.ts [N]
 * 從 Vault 隨機取 N 篇筆記（預設 20），比較關鍵詞分類器 vs LLM 分類器的結果。
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles, parseFrontmatter } from './vault/frontmatter-utils.js';
import { compareClassifiers, type ClassifierComparison } from './learning/llm-classifier.js';

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
  console.error('❌ VAULT_PATH 未設定');
  process.exit(1);
}

async function loadSampleNotes(count: number): Promise<Array<{ title: string; text: string; currentCategory: string }>> {
  const rootDir = join(VAULT_PATH!, 'GetThreads');
  const files = await getAllMdFiles(rootDir);

  // 隨機取樣
  const shuffled = files.sort(() => Math.random() - 0.5).slice(0, count * 3);
  const samples: Array<{ title: string; text: string; currentCategory: string }> = [];

  for (const filePath of shuffled) {
    if (samples.length >= count) break;
    try {
      const raw = await readFile(filePath, 'utf-8');
      const fm = parseFrontmatter(raw);
      const title = fm.get('title')?.replace(/^"|"$/g, '') ?? '';
      const category = fm.get('category') ?? '';
      if (!title || !category) continue;

      // 取 frontmatter 後的正文前 500 字
      const bodyStart = raw.indexOf('---', 4);
      const body = bodyStart > 0 ? raw.slice(bodyStart + 3).trim().slice(0, 500) : '';

      samples.push({ title, text: body, currentCategory: category });
    } catch { /* skip */ }
  }

  return samples;
}

async function main(): Promise<void> {
  const count = parseInt(process.argv[2] ?? '20', 10);
  console.log(`📊 LLM 分類器 A/B 測試（取樣 ${count} 篇）\n`);

  const samples = await loadSampleNotes(count);
  console.log(`✅ 載入 ${samples.length} 篇筆記\n`);

  const results: ClassifierComparison[] = [];
  let matchCount = 0;
  let keywordMatchVault = 0;
  let llmMatchVault = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    process.stdout.write(`[${i + 1}/${samples.length}] ${s.title.slice(0, 40)}... `);

    const result = await compareClassifiers(s.title, s.text, VAULT_PATH!);
    results.push(result);

    if (result.match) matchCount++;
    if (result.keywordResult === s.currentCategory) keywordMatchVault++;
    if (result.llmResult === s.currentCategory) llmMatchVault++;

    const icon = result.match ? '✅' : '❌';
    console.log(`${icon} KW: ${result.keywordResult} | LLM: ${result.llmResult}`);
  }

  // 結果摘要
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 結果摘要`);
  console.log(`  測試筆數：${samples.length}`);
  console.log(`  兩者一致：${matchCount}/${samples.length} (${Math.round(matchCount / samples.length * 100)}%)`);
  console.log(`  關鍵詞 = Vault 現有分類：${keywordMatchVault}/${samples.length} (${Math.round(keywordMatchVault / samples.length * 100)}%)`);
  console.log(`  LLM = Vault 現有分類：${llmMatchVault}/${samples.length} (${Math.round(llmMatchVault / samples.length * 100)}%)`);
  console.log(`${'═'.repeat(60)}`);

  // 列出不一致的案例
  const mismatches = results.filter(r => !r.match);
  if (mismatches.length > 0) {
    console.log(`\n❌ 不一致案例（${mismatches.length} 筆）：`);
    for (const m of mismatches) {
      console.log(`  「${m.title}」`);
      console.log(`    關鍵詞: ${m.keywordResult}`);
      console.log(`    LLM:    ${m.llmResult}`);
    }
  }
}

main().catch((err) => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
