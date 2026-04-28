/**
 * /benchmark — Show enrichment quality benchmark report.
 * Displays scoring trends, platform success rates, and quality distribution.
 */
import type { Context } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { loadBenchmarkData, generateBenchmarkReport, formatBenchmarkReport } from '../monitoring/benchmark-store.js';
import { logger } from '../core/logger.js';
import { withTypingIndicator } from './command-runner.js';

export async function handleBenchmark(ctx: Context, _config: AppConfig): Promise<void> {
  await withTypingIndicator(ctx, '正在生成品質基準報告...', async () => {
    const data = await loadBenchmarkData();
    const scoreCount = Object.keys(data.scores).length;

    if (scoreCount === 0) {
      await ctx.reply('尚無評分資料。處理更多 URL 後再試。');
      return;
    }

    const report = generateBenchmarkReport(data);
    const formatted = formatBenchmarkReport(report);
    await ctx.reply(formatted);
    logger.info('benchmark', '報告完成', { total: report.totalEnriched });
  }, '基準報告失敗');
}
