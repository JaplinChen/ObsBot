/**
 * Classifier Tuner — Karpathy autoresearch-inspired evaluation loop.
 *
 * 流程：
 * 1. 從 classification-feedback.json 載入歷史錯誤案例（二元測試集）
 * 2. 對每個案例跑 classifyContent() → 計算通過率（基準線）
 * 3. LLM 分析失敗案例，提出新關鍵字建議
 * 4. 模擬套用建議 → 重算通過率
 * 5. 輸出 diff + 改善幅度，供用戶確認後寫入 learned-patterns.json
 */
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import { classifyContent } from '../classifier.js';
import { loadFeedbackStore } from './feedback-tracker.js';
import type { LearnedPatterns, ClassificationRule } from './vault-learner.js';

/* ── Types ────────────────────────────────────────────────── */

export interface TuneCase {
  title: string;
  correctCategory: string;
  currentResult: string;
  pass: boolean;
}

export interface KeywordSuggestion {
  keyword: string;
  category: string;
  action: 'add' | 'remove';
  reason: string;
}

export interface TuneResult {
  totalCases: number;
  baselinePass: number;
  baselineRate: number;
  projectedPass: number;
  projectedRate: number;
  improvement: number;
  suggestions: KeywordSuggestion[];
  cases: TuneCase[];
  applied: boolean;
}

const LEARNED_PATTERNS_PATH = join('data', 'learned-patterns.json');
const MIN_CASES = 5;

/* ── Evaluation ──────────────────────────────────────────── */

async function evaluateCases(
  feedbacks: Array<{ title: string; to: string; keywords: string[] }>,
): Promise<TuneCase[]> {
  const cases: TuneCase[] = [];
  for (const fb of feedbacks) {
    const current = await classifyContent(fb.title, fb.keywords.join(' '));
    cases.push({
      title: fb.title,
      correctCategory: fb.to,
      currentResult: current,
      pass: current === fb.to,
    });
  }
  return cases;
}

/* ── LLM suggestion prompt ───────────────────────────────── */

function buildSuggestionPrompt(failedCases: TuneCase[]): string {
  const caseList = failedCases
    .slice(0, 20) // limit to 20 cases for prompt length
    .map(c =>
      `標題：「${c.title}」| 正確分類：${c.correctCategory} | 實際分類：${c.currentResult}`,
    )
    .join('\n');

  return [
    '你是分類器調優專家。以下是分類錯誤的案例，請分析規律並提出關鍵字建議。',
    '',
    '分類錯誤案例：',
    caseList,
    '',
    '任務：為每個常見失敗模式提出 1-3 個關鍵字建議。',
    '輸出純 JSON，格式：',
    '[',
    '  {',
    '    "keyword": "關鍵詞",',
    '    "category": "目標分類名稱",',
    '    "action": "add",',
    '    "reason": "為何此關鍵詞能改善分類準確率"',
    '  }',
    ']',
    '',
    '規則：',
    '- keyword 長度 >= 3 字',
    '- 不建議過於廣泛的詞（如「的」「是」）',
    '- 最多建議 10 個',
    '- action 只能是 "add" 或 "remove"',
  ].join('\n');
}

async function getLlmSuggestions(failedCases: TuneCase[]): Promise<KeywordSuggestion[]> {
  if (failedCases.length === 0) return [];

  const prompt = buildSuggestionPrompt(failedCases);
  const result = await runLocalLlmPrompt(prompt, {
    timeoutMs: 60_000,
    task: 'classify',
    maxTokens: 1024,
  });

  if (!result) return [];

  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('no JSON array');
    return JSON.parse(jsonMatch[0]) as KeywordSuggestion[];
  } catch {
    logger.warn('classifier-tuner', 'LLM 建議 JSON 解析失敗');
    return [];
  }
}

/* ── Simulate applying suggestions ──────────────────────────*/

function simulateWithSuggestions(
  cases: TuneCase[],
  suggestions: KeywordSuggestion[],
  patterns: LearnedPatterns,
): number {
  // Build augmented rules
  const augmented = [...patterns.classificationRules];

  for (const s of suggestions) {
    if (s.action === 'add') {
      const exists = augmented.some(r => r.keyword === s.keyword && r.category === s.category);
      if (!exists) {
        augmented.push({ keyword: s.keyword, category: s.category, score: 0.8, count: 1 });
      }
    } else if (s.action === 'remove') {
      const idx = augmented.findIndex(r => r.keyword === s.keyword && r.category === s.category);
      if (idx >= 0) augmented.splice(idx, 1);
    }
  }

  // Rerun with naive re-scoring (simulate learned rules applied)
  let passCount = 0;
  for (const c of cases) {
    if (c.pass) { passCount++; continue; } // already passing

    // Check if any new 'add' suggestion would fix this case
    const relevant = suggestions.filter(
      s => s.action === 'add' && s.category === c.correctCategory,
    );
    const titleLower = c.title.toLowerCase();
    const wouldFix = relevant.some(s => titleLower.includes(s.keyword.toLowerCase()));
    if (wouldFix) passCount++;
  }

  return passCount;
}

/* ── Apply suggestions ───────────────────────────────────── */

async function applyToLearnedPatterns(suggestions: KeywordSuggestion[]): Promise<boolean> {
  const patterns = await safeReadJSON<Partial<LearnedPatterns>>(LEARNED_PATTERNS_PATH, {});
  if (!patterns.classificationRules) return false;

  const rules: ClassificationRule[] = patterns.classificationRules;

  for (const s of suggestions) {
    if (s.action === 'add') {
      const exists = rules.some(r => r.keyword === s.keyword && r.category === s.category);
      if (!exists) {
        rules.push({ keyword: s.keyword, category: s.category, score: 0.8, count: 1 });
        logger.info('classifier-tuner', '新增規則', { keyword: s.keyword, category: s.category });
      }
    } else if (s.action === 'remove') {
      const idx = rules.findIndex(r => r.keyword === s.keyword && r.category === s.category);
      if (idx >= 0) {
        rules.splice(idx, 1);
        logger.info('classifier-tuner', '移除規則', { keyword: s.keyword, category: s.category });
      }
    }
  }

  patterns.classificationRules = rules;
  patterns.generatedAt = new Date().toISOString();
  await safeWriteJSON(LEARNED_PATTERNS_PATH, patterns);
  return true;
}

/* ── Format report ───────────────────────────────────────── */

export function formatTuneReport(result: TuneResult): string {
  const lines: string[] = [
    `📊 分類器調優報告`,
    '',
    `測試案例：${result.totalCases} 個`,
    `基準準確率：${result.baselinePass}/${result.totalCases}（${(result.baselineRate * 100).toFixed(1)}%）`,
  ];

  if (result.suggestions.length > 0) {
    lines.push(`預估改善後：${result.projectedPass}/${result.totalCases}（${(result.projectedRate * 100).toFixed(1)}%）`);
    lines.push(`改善幅度：+${(result.improvement * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('💡 建議修改：');
    for (const s of result.suggestions) {
      const icon = s.action === 'add' ? '➕' : '➖';
      lines.push(`${icon} [${s.category}] "${s.keyword}" — ${s.reason}`);
    }
  } else {
    lines.push('✅ 無失敗案例或無明確改善建議');
  }

  if (result.applied) {
    lines.push('');
    lines.push('✅ 已套用至 learned-patterns.json');
  }

  return lines.join('\n');
}

/* ── Main export ─────────────────────────────────────────── */

export async function runClassifierTuning(autoApply = false): Promise<TuneResult> {
  const store = await loadFeedbackStore();
  const feedbacks = store.feedbacks;

  if (feedbacks.length < MIN_CASES) {
    logger.info('classifier-tuner', '案例不足，跳過調優', { count: feedbacks.length, min: MIN_CASES });
    return {
      totalCases: feedbacks.length,
      baselinePass: feedbacks.length,
      baselineRate: 1,
      projectedPass: feedbacks.length,
      projectedRate: 1,
      improvement: 0,
      suggestions: [],
      cases: [],
      applied: false,
    };
  }

  // Step 1: Evaluate baseline
  const cases = await evaluateCases(feedbacks);
  const baselinePass = cases.filter(c => c.pass).length;
  const baselineRate = baselinePass / cases.length;

  logger.info('classifier-tuner', '基準評估完成', { pass: baselinePass, total: cases.length });

  // Step 2: LLM suggestions for failed cases
  const failed = cases.filter(c => !c.pass);
  const suggestions = await getLlmSuggestions(failed);

  // Step 3: Simulate improvement
  const patterns = await safeReadJSON<Partial<LearnedPatterns>>(LEARNED_PATTERNS_PATH, {});
  const safePatterns: LearnedPatterns = {
    version: patterns.version ?? 1,
    generatedAt: patterns.generatedAt ?? new Date().toISOString(),
    stats: patterns.stats ?? { totalNotes: 0, categoryDist: {} },
    classificationRules: patterns.classificationRules ?? [],
    formatting: patterns.formatting ?? { commonTags: [], topKeywordsByCategory: {} },
  };

  const projectedPass = simulateWithSuggestions(cases, suggestions, safePatterns);
  const projectedRate = projectedPass / cases.length;
  const improvement = projectedRate - baselineRate;

  // Step 4: Auto-apply if requested and improvement exists
  let applied = false;
  if (autoApply && improvement > 0 && suggestions.length > 0) {
    applied = await applyToLearnedPatterns(suggestions);
  }

  return {
    totalCases: cases.length,
    baselinePass,
    baselineRate,
    projectedPass,
    projectedRate,
    improvement,
    suggestions,
    cases,
    applied,
  };
}
