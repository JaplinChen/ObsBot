/**
 * Extractor Health Check — tests all extractors against known URLs.
 * Usage: npx tsx scripts/extractor-health-check.ts
 * Used by /extractor-status skill and weekly scheduled task.
 */
import { registerAllExtractors } from '../src/extractors/index.js';
import { findExtractor } from '../src/utils/url-parser.js';

const TEST_URLS: Record<string, { url: string; skip?: string }> = {
  threads: { url: 'https://www.threads.net/@zuck/post/DTa3-B1EbTp' },
  youtube: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  github: { url: 'https://github.com/anthropics/claude-code' },
  reddit: { url: 'https://www.reddit.com/r/ObsidianMD/comments/1j0hly2/how_do_you_use_obsidian_for_daily_journaling/' },
  bilibili: { url: 'https://www.bilibili.com/video/BV1GJ411x7h7' },
  tiktok: { url: 'https://www.tiktok.com/@khaby.lame/video/7394365710498294049' },
  ithome: { url: 'https://ithelp.ithome.com.tw/articles/10359398' },
  web: { url: 'https://example.com' },
  weibo: { url: 'https://weibo.com/test', skip: '需登入' },
  xhs: { url: 'https://www.xiaohongshu.com/explore/test', skip: '需登入' },
  douyin: { url: 'https://www.douyin.com/video/test', skip: '需登入' },
};

interface TestResult {
  platform: string;
  match: boolean;
  parseId: boolean;
  extract: boolean;
  title: string;
  textLen: number;
  timeMs: number;
  status: string;
  error?: string;
}

async function testExtractor(platform: string, url: string): Promise<TestResult> {
  const result: TestResult = {
    platform, match: false, parseId: false, extract: false,
    title: '', textLen: 0, timeMs: 0, status: '❌',
  };

  const ext = findExtractor(url);
  if (!ext) return result;
  result.match = true;

  try {
    const id = ext.parseId(url);
    if (id) result.parseId = true;
  } catch { /* skip */ }

  const start = Date.now();
  try {
    const content = await Promise.race([
      ext.extract(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout 30s')), 30_000),
      ),
    ]);
    result.timeMs = Date.now() - start;
    result.extract = true;
    result.title = (content.title || '').slice(0, 30);
    result.textLen = (content.text || '').length;
    result.status = '✅';
  } catch (err) {
    result.timeMs = Date.now() - start;
    result.error = (err as Error).message.slice(0, 50);
    result.status = '❌';
  }

  return result;
}

async function main(): Promise<void> {
  registerAllExtractors();

  console.log('## Extractor 健康報告\n');
  console.log('| 平台 | match | parseId | extract | title | text | 耗時 | 狀態 |');
  console.log('|------|-------|---------|---------|-------|------|------|------|');

  const results: TestResult[] = [];
  for (const [platform, config] of Object.entries(TEST_URLS)) {
    if (config.skip) {
      console.log(`| ${platform} | ⏭ ${config.skip} | — | — | — | — | — | ⏭ |`);
      continue;
    }

    const r = await testExtractor(platform, config.url);
    results.push(r);
    const m = r.match ? '✅' : '❌';
    const p = r.parseId ? '✅' : '❌';
    const e = r.extract ? '✅' : '❌';
    const t = r.title || '—';
    const len = r.textLen > 0 ? `${r.textLen} 字` : '—';
    const ms = r.timeMs > 0 ? `${(r.timeMs / 1000).toFixed(1)}s` : '—';
    console.log(`| ${platform} | ${m} | ${p} | ${e} | ${t} | ${len} | ${ms} | ${r.status} |`);

    if (r.error) {
      console.log(`|  | ↳ ${r.error} ||||||| `);
    }
  }

  if (results.some(r => !r.extract)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Health check failed:', err);
  process.exitCode = 1;
});
