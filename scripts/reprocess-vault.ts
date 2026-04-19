/**
 * Reprocess all notes in Obsidian vault: re-extract from URL → re-classify → re-enrich → re-save.
 * Usage:
 *   npx tsx scripts/reprocess-vault.ts              # full reprocess (parallel, concurrency=3)
 *   npx tsx scripts/reprocess-vault.ts --dry-run     # preview only
 *   npx tsx scripts/reprocess-vault.ts --platform=x  # filter by platform
 *   npx tsx scripts/reprocess-vault.ts --resume      # continue from last run
 *   npx tsx scripts/reprocess-vault.ts --skip-backup  # skip backup
 *   npx tsx scripts/reprocess-vault.ts --concurrency=5  # custom concurrency (default: 3)
 *   npx tsx scripts/reprocess-vault.ts --serial       # disable parallel, run one by one
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ override: true });

import { registerAllExtractors } from '../src/extractors/index.js';
import type { Platform, ExtractorWithComments } from '../src/extractors/types.js';
import { findExtractor } from '../src/utils/url-parser.js';
import { canonicalizeUrl } from '../src/utils/url-canonicalizer.js';
import { enrichExtractedContent } from '../src/messages/services/enrich-content-service.js';
import { saveToVault } from '../src/saver.js';
import {
  backupVault, ReprocessProgress, fallbackReclassify,
  cleanEmptyDirs, deleteOldFileIfMoved,
} from '../src/vault/reprocess-helpers.js';

/* ── Types ────────────────────────────────────────────────────────────── */

interface CliOptions {
  platform?: Platform;
  dryRun: boolean;
  resume: boolean;
  skipBackup: boolean;
  concurrency: number;
  serial: boolean;
}

interface Candidate {
  file: string;
  url: string;
  canonicalUrl: string;
  platform: Platform;
}

interface RunStats {
  total: number;
  matched: number;
  success: number;
  fallback: number;
  failed: number;
  skipped: number;
  deduped: number;
  errors: string[];
  changes: Array<{ file: string; from: string; to: string }>;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const SKIP_DIRS = new Set(['MOC', 'attachments']);
const SKIP_FILES = new Set(['知識庫摘要.md', '.reprocess-progress.json', '.enrich-progress.json']);

function getAllMdFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('_backup') || entry.startsWith('KnowPipe-backup')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...getAllMdFiles(full));
    else if (entry.endsWith('.md') && !SKIP_FILES.has(entry)) files.push(full);
  }
  return files;
}

function extractUrlFromFrontmatter(filePath: string): string | null {
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(/^url:\s*["']?(.*?)["']?\s*$/m);
  return match?.[1]?.trim() ?? null;
}

function parseArgs(argv: string[]): CliOptions {
  const get = (prefix: string) => argv.find((a) => a.startsWith(prefix))?.split('=')[1]?.trim();
  return {
    platform: get('--platform') as Platform | undefined,
    dryRun: argv.includes('--dry-run'),
    resume: argv.includes('--resume'),
    skipBackup: argv.includes('--skip-backup'),
    concurrency: parseInt(get('--concurrency') ?? '3', 10) || 3,
    serial: argv.includes('--serial'),
  };
}

/** Simple concurrency limiter (no external deps). */
function createLimiter(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running++;
    try { return await fn(); } finally {
      running--;
      queue.shift()?.();
    }
  };
}

function getConfig(vaultPath: string) {
  return {
    botToken: process.env.BOT_TOKEN ?? 'reprocess',
    vaultPath,
    enableTranslation: process.env.ENABLE_TRANSLATION === 'true',
    maxLinkedUrls: parseInt(process.env.MAX_LINKED_URLS ?? '5', 10) || 5,
  };
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) { console.error('VAULT_PATH is required in .env'); process.exit(1); }

  const obsBotDir = join(vaultPath, 'KnowPipe');
  const startTime = Date.now();

  registerAllExtractors();

  // 1. Scan candidates (exclude MOC, backups, special files)
  const allFiles = getAllMdFiles(obsBotDir);
  const stats: RunStats = {
    total: allFiles.length, matched: 0, success: 0, fallback: 0,
    failed: 0, skipped: 0, deduped: 0, errors: [], changes: [],
  };

  const candidates: Candidate[] = [];
  for (const file of allFiles) {
    const url = extractUrlFromFrontmatter(file);
    if (!url) { stats.skipped++; continue; }
    const extractor = findExtractor(url);
    if (!extractor) { stats.skipped++; continue; }
    if (opts.platform && extractor.platform !== opts.platform) { stats.skipped++; continue; }
    candidates.push({ file, url, canonicalUrl: canonicalizeUrl(url), platform: extractor.platform });
  }

  // Dedup by canonical URL
  const deduped: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.canonicalUrl)) { stats.deduped++; continue; }
    seen.add(c.canonicalUrl);
    deduped.push(c);
  }
  stats.matched = deduped.length;

  console.log(`掃描完成：${stats.total} 個檔案，${deduped.length} 個待處理`);
  if (opts.platform) console.log(`平台篩選：${opts.platform}`);

  // 2. Dry-run mode
  if (opts.dryRun) {
    for (const c of deduped) console.log(`  [${c.platform}] ${c.url.slice(0, 100)}`);
    console.log(`\n共 ${deduped.length} 個檔案（dry-run 模式，未實際執行）`);
    return;
  }

  // 3. Backup vault
  if (!opts.skipBackup) {
    console.log('備份中...');
    const backupDir = await backupVault(vaultPath);
    console.log(`備份完成：${backupDir}`);
  }

  // 4. Load progress (resume support)
  const progress = new ReprocessProgress(vaultPath);
  if (opts.resume) { await progress.load(); console.log('從上次進度繼續...'); }

  const config = getConfig(vaultPath);
  const effectiveConcurrency = opts.serial ? 1 : opts.concurrency;
  const limit = createLimiter(effectiveConcurrency);
  let completed = 0;

  console.log(`並行度：${effectiveConcurrency}${opts.serial ? '（序列模式）' : ''}`);

  // 5. Process candidates in parallel
  async function processOne(item: Candidate, index: number) {
    const label = `[${index + 1}/${deduped.length}]`;

    if (progress.isCompleted(item.canonicalUrl)) {
      console.log(`${label} 跳過（已完成）：${basename(item.file)}`);
      stats.skipped++;
      completed++;
      return;
    }

    console.log(`${label} ${item.platform} ${item.url.slice(0, 100)}`);

    try {
      const extractor = findExtractor(item.url) as ExtractorWithComments | null;
      if (!extractor) throw new Error('extractor not found');

      const content = await extractor.extract(item.url);
      await enrichExtractedContent(content, config);
      const result = await saveToVault(content, vaultPath, { forceOverwrite: true });
      if (content.tempDir) await rm(content.tempDir, { recursive: true, force: true }).catch(() => {});

      await deleteOldFileIfMoved(item.file, result.mdPath);

      stats.success++;
      await progress.mark(item.canonicalUrl, {
        url: item.url, status: 'success', oldPath: item.file, newPath: result.mdPath,
      });
      console.log(`  ✓ ${basename(result.mdPath)} (${++completed}/${deduped.length})`);
    } catch (extractErr) {
      const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
      console.log(`  抓取失敗（${errMsg.slice(0, 80)}），重分類...`);

      try {
        const fbResult = await fallbackReclassify(item.file, obsBotDir);
        stats.fallback++;
        if (fbResult.newPath) {
          stats.changes.push({
            file: basename(item.file), from: fbResult.oldCategory ?? '?', to: fbResult.newCategory ?? '?',
          });
          console.log(`  → ${fbResult.oldCategory} → ${fbResult.newCategory}`);
        } else {
          console.log(`  → 分類未變，保留原檔`);
        }
        await progress.mark(item.canonicalUrl, fbResult);
      } catch {
        stats.failed++;
        stats.errors.push(`${item.url} => ${errMsg.slice(0, 120)}`);
        await progress.mark(item.canonicalUrl, {
          url: item.url, status: 'failed', oldPath: item.file, error: errMsg.slice(0, 120),
        });
        console.log(`  ✗ 完全失敗`);
      }
      completed++;
    }
  }

  await Promise.all(deduped.map((item, i) => limit(() => processOne(item, i))));

  // 6. Cleanup empty directories
  await cleanEmptyDirs(obsBotDir);

  // 7. Report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n===== Vault 重新處理報告 =====');
  console.log(`耗時：${elapsed} 秒`);
  console.log(`掃描：${stats.total} | 處理：${stats.matched} | 成功：${stats.success}`);
  console.log(`重分類：${stats.fallback} | 失敗：${stats.failed} | 跳過：${stats.skipped}`);

  if (stats.changes.length > 0) {
    console.log('\n分類變更：');
    for (const c of stats.changes) console.log(`  ${c.file}: ${c.from} → ${c.to}`);
  }
  if (stats.errors.length > 0) {
    console.log('\n失敗清單：');
    for (const e of stats.errors) console.log(`  - ${e}`);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
