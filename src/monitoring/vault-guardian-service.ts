import { readFile, writeFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import type { Telegram } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { getOwnerUserId } from '../utils/config.js';
import { logger } from '../core/logger.js';
import { scoreArticle, type GuardianScore } from './vault-guardian-scorer.js';

const LAST_RUN_STAMP = '/tmp/vault-guardian-last-run';
const REPROCESS_QUEUE = '/tmp/vault-guardian-queue.txt';
const MOC_PATTERN = /(_index|MOC|地圖|索引|目錄)/i;

export interface GuardianResult {
  scanned: number;
  excellent: number;
  normal: number;
  lowQuality: number;
  mocSkipped: number;
  queued: number;
  notified: number;
}

interface ArticleResult {
  filePath: string;
  score: GuardianScore;
  title: string;
  category: string;
}

async function getLastRunTime(sinceArg: string): Promise<Date> {
  if (existsSync(LAST_RUN_STAMP)) {
    const s = await stat(LAST_RUN_STAMP);
    return s.mtime;
  }
  // Parse --since: 24h / 7d / 30d
  const match = sinceArg.match(/^(\d+)(h|d)$/);
  const ms = match
    ? parseInt(match[1]) * (match[2] === 'h' ? 3_600_000 : 86_400_000)
    : 86_400_000;
  return new Date(Date.now() - ms);
}

async function detectNewArticles(vaultPath: string, since: Date): Promise<string[]> {
  const pattern = join(vaultPath, 'KnowPipe', '**', '*.md');
  const files = await glob(pattern, { absolute: true });
  const sinceTs = since.getTime();
  const results: string[] = [];
  for (const f of files) {
    if (MOC_PATTERN.test(f)) continue;
    try {
      const s = await stat(f);
      if (s.mtimeMs >= sinceTs) results.push(f);
    } catch { /* skip */ }
  }
  return results;
}

function readFrontmatterTitle(content: string): { title: string; category: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: '', category: '' };
  const titleMatch = match[1].match(/^title:\s*(.+)$/m);
  const catMatch = match[1].match(/^category:\s*(.+)$/m);
  return {
    title: titleMatch?.[1]?.replace(/^["']|["']$/g, '') ?? '',
    category: catMatch?.[1]?.replace(/^["']|["']$/g, '') ?? '',
  };
}

async function sendTelegramAlert(
  telegram: Telegram,
  userId: number,
  result: ArticleResult,
  vaultPath: string,
): Promise<void> {
  const rel = relative(vaultPath, result.filePath);
  const emoji = result.score.total < 4 ? '🔴' : '🟡';
  const issueLines = result.score.issues.map(i => `• ${i}`).join('\n');
  const msg = [
    `${emoji} Vault 品質警報`,
    '',
    `📄 《${result.title || rel}》`,
    `📁 分類：${result.category || '未知'}`,
    `⭐ 品質分數：${result.score.total}/10`,
    '',
    issueLines ? `問題：\n${issueLines}` : '',
    '',
    `👉 修復：/vault reprocess --low-quality`,
  ].filter(l => l !== undefined).join('\n').trim();

  await telegram.sendMessage(userId, msg.slice(0, 4000)).catch(() => {});
}

async function appendQueueEntry(sourceUrl: string): Promise<void> {
  await appendFile(REPROCESS_QUEUE, `${sourceUrl}\n`, 'utf-8').catch(() => {});
}

async function appendDailyReport(vaultPath: string, date: string, results: GuardianResult, lowArticles: ArticleResult[]): Promise<void> {
  const logDir = join(vaultPath, '_meta');
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, 'quality-log.md');

  const lines = [
    `\n## ${date}`,
    '',
    `| 指標 | 數值 |`,
    `|------|------|`,
    `| 掃描文章 | ${results.scanned} 篇 |`,
    `| 優質（≥ 7.5）| ${results.excellent} 篇 |`,
    `| 普通（5–7.4）| ${results.normal} 篇 |`,
    `| 低品質（< 5）| ${results.lowQuality} 篇 |`,
    `| MOC 豁免 | ${results.mocSkipped} 篇 |`,
    `| 推送 Telegram | ${results.notified} 篇 |`,
  ];

  if (lowArticles.length > 0) {
    lines.push('', '### 本日低品質文章');
    for (const a of lowArticles.slice(0, 20)) {
      lines.push(`- \`${relative(vaultPath, a.filePath)}\`（${a.score.total} 分）— ${a.score.issues.slice(0, 2).join('、')}`);
    }
  }

  const content = lines.join('\n') + '\n';
  if (!existsSync(logPath)) {
    await writeFile(logPath, `# Vault 品質守護日誌\n${content}`, 'utf-8');
  } else {
    await appendFile(logPath, content, 'utf-8');
  }
}

export async function runGuardianCycle(
  telegram: Telegram,
  config: AppConfig,
  sinceArg = '24h',
  dryRun = false,
): Promise<GuardianResult> {
  const userId = getOwnerUserId(config);
  const since = await getLastRunTime(sinceArg);
  logger.info('guardian', `掃描 ${since.toISOString()} 之後的新文章`);

  const files = await detectNewArticles(config.vaultPath, since);
  const result: GuardianResult = { scanned: files.length, excellent: 0, normal: 0, lowQuality: 0, mocSkipped: 0, queued: 0, notified: 0 };
  const lowArticles: ArticleResult[] = [];

  for (const filePath of files) {
    try {
      const score = await scoreArticle(filePath);
      if (score.isMoc) { result.mocSkipped++; continue; }

      const content = await readFile(filePath, 'utf-8');
      const { title, category } = readFrontmatterTitle(content);
      const articleResult: ArticleResult = { filePath, score, title, category };

      if (score.total >= 7.5) {
        result.excellent++;
      } else if (score.total >= 5.0) {
        result.normal++;
      } else {
        result.lowQuality++;
        lowArticles.push(articleResult);
        if (!dryRun) {
          const urlMatch = content.match(/^url:\s*(.+)$/m);
          if (urlMatch?.[1]) await appendQueueEntry(urlMatch[1].trim());
          result.queued++;
          if (userId) {
            await sendTelegramAlert(telegram, userId, articleResult, config.vaultPath);
            result.notified++;
          }
        }
      }
    } catch (err) {
      logger.warn('guardian', `評分失敗：${filePath} — ${String(err)}`);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  if (!dryRun) {
    await appendDailyReport(config.vaultPath, date, result, lowArticles);
    await writeFile(LAST_RUN_STAMP, date, 'utf-8');
  }

  logger.info('guardian', `完成：${result.scanned} 篇掃描，${result.lowQuality} 篇低品質`);
  return result;
}
