import { join } from 'node:path';
import { runVaultLearner } from './vault-learner.js';
import { refreshFromPatterns } from './dynamic-classifier.js';
import type { AppConfig } from '../utils/config.js';

export const RULES_PATH = join(process.cwd(), 'data', 'learned-patterns.json');

export interface LearnResult {
  notesScanned: number;
  rulesGenerated: number;
  categoryDist: Record<string, number>;
}

/** Run vault learning and refresh in-memory rules. */
export async function executeLearn(config: AppConfig): Promise<LearnResult> {
  const patterns = await runVaultLearner(config.vaultPath, RULES_PATH);
  refreshFromPatterns(patterns);
  return {
    notesScanned: patterns.stats.totalNotes,
    rulesGenerated: patterns.classificationRules.length,
    categoryDist: patterns.stats.categoryDist,
  };
}

/** Format a human-readable learn report for Telegram. */
export function formatLearnReport(result: LearnResult): string {
  const topCats = Object.entries(result.categoryDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, count]) => `  ${cat}: ${count} 篇`)
    .join('\n');
  return [
    '學習完成！',
    `掃描：${result.notesScanned} 篇有效筆記`,
    `規則：${result.rulesGenerated} 條分類規則`,
    '',
    '分類分佈：',
    topCats || '  （無有效筆記）',
  ].join('\n');
}
