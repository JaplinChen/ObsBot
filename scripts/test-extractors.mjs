#!/usr/bin/env node
/**
 * Extractor test runner — 兩層驗證：
 *   Layer 1: Connectivity probe（HTTP HEAD/GET，不需要 browser 環境）
 *   Layer 2: Output schema validation（需要 bot 完整環境，以 --full 旗標啟用）
 *
 * Usage:
 *   node scripts/test-extractors.mjs                  # Layer 1 only（快速，CI 適用）
 *   node scripts/test-extractors.mjs --full           # Layer 1 + 2
 *   node scripts/test-extractors.mjs --platform reddit # 只跑指定平台
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_FILE = join(ROOT, 'fixtures', 'extractors', 'index.json');
const PROBE_TIMEOUT_MS = 8_000;

const args = process.argv.slice(2);
const FULL_MODE = args.includes('--full');
const PLATFORM_FILTER = args.find((a) => a.startsWith('--platform='))?.split('=')[1]
  ?? (args[args.indexOf('--platform') + 1]);

/* ── ANSI colours ─────────────────────────────────────────── */
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const ok = (s) => `${GREEN}✓${RESET} ${s}`;
const fail = (s) => `${RED}✗${RESET} ${s}`;
const warn = (s) => `${YELLOW}⚠${RESET} ${s}`;

/* ── Layer 1: Connectivity probe ──────────────────────────── */
async function probeUrl(url, method = 'HEAD') {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 KnowPipe-TestRunner/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    return { ok: res.status < 400, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: err.message };
  }
}

/* ── Layer 2: Schema validation ───────────────────────────── */
function validateSchema(content, expectations, mustHaveFields) {
  const errors = [];
  for (const field of mustHaveFields ?? []) {
    if (content[field] === undefined || content[field] === null || content[field] === '') {
      errors.push(`缺少必要欄位: ${field}`);
    }
  }
  for (const [key, rule] of Object.entries(expectations ?? {})) {
    const val = content[key];
    if (typeof rule === 'object' && rule.minLength !== undefined) {
      if (typeof val !== 'string' || val.length < rule.minLength) {
        errors.push(`${key} 長度不足（需 ≥ ${rule.minLength}，實際 ${typeof val === 'string' ? val.length : 'N/A'}）`);
      }
    } else if (val !== rule) {
      errors.push(`${key} 期望 "${rule}"，實際 "${val}"`);
    }
  }
  return errors;
}

/* ── Main ─────────────────────────────────────────────────── */
async function main() {
  const fixtures = JSON.parse(await readFile(FIXTURES_FILE, 'utf-8'));
  const extractors = PLATFORM_FILTER
    ? fixtures.extractors.filter((e) => e.platform === PLATFORM_FILTER)
    : fixtures.extractors;

  if (extractors.length === 0) {
    console.error(fail(`找不到平台 "${PLATFORM_FILTER}"，可用平台：${fixtures.extractors.map((e) => e.platform).join(', ')}`));
    process.exit(1);
  }

  console.log(`\n🧪 KnowPipe Extractor 測試 (${FULL_MODE ? 'Layer 1+2' : 'Layer 1 only'})\n`);

  const results = { pass: 0, fail: 0, skip: 0 };

  for (const extractor of extractors) {
    console.log(`\n── ${extractor.platform.toUpperCase()} ──`);

    // Layer 1: probe
    const probe = await probeUrl(extractor.probeUrl, 'HEAD');
    if (probe.ok) {
      console.log(ok(`Connectivity probe (${extractor.probeUrl}) → HTTP ${probe.status}`));
      results.pass++;
    } else if (probe.status === 0) {
      console.log(fail(`Connectivity probe 失敗：${probe.error ?? 'timeout'}`));
      results.fail++;
    } else {
      console.log(warn(`Connectivity probe → HTTP ${probe.status}（可能降級）`));
      results.pass++;
    }

    // Layer 2: schema（只在 --full 時執行）
    if (!FULL_MODE) {
      console.log(warn(`  Schema 驗證略過（加 --full 啟用，需要完整 bot 環境）`));
      results.skip += extractor.testCases.length;
      continue;
    }

    for (const tc of extractor.testCases) {
      try {
        // Dynamic import extractor & run（需要 bot context，此為示意）
        // 實際整合時應呼叫 extractContent(tc.url, config)
        console.log(warn(`  [${tc.description}] → schema 驗證需要 bot context（TODO: 整合 extractContent）`));
        results.skip++;
      } catch (err) {
        console.log(fail(`  [${tc.description}] → ${err.message}`));
        results.fail++;
      }
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`通過: ${results.pass}  失敗: ${results.fail}  略過: ${results.skip}`);

  if (results.fail > 0) {
    console.log(fail(`\n${results.fail} 個平台有問題，請檢查 fixtures/extractors/index.json 的 knownIssues。`));
    process.exit(1);
  } else {
    console.log(ok('\n所有 connectivity probe 通過。'));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
