/**
 * Classifier Evolver — AlphaEvolve 啟發的自動分類器進化循環。
 * 1. buildEvalDataset  — 從 Vault 取代表性筆記（每 category 最多 5 篇）
 * 2. generateRuleVariants — 生成 5 個候選規則變體
 * 3. evaluateVariants   — 評估各變體在 eval dataset 的準確率
 * 4. applyBestVariant  — 若最佳 > 現有 + 1%，寫入 learned-patterns.json
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import { safeReadJSON, safeWriteJSON } from '../core/safe-write.js';
import { classifyWithLearnedRules } from './dynamic-classifier.js';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import type { LearnedPatterns, ClassificationRule } from './vault-learner.js';

const LEARNED_PATTERNS_PATH = join('data', 'learned-patterns.json');
const MAX_NOTES_PER_CAT = 5;
const VARIANT_COUNT = 5;
const IMPROVEMENT_THRESHOLD = 0.01;

export interface EvalNote {
  title: string;
  text: string;
  expectedCategory: string;
}

export interface VariantSet {
  label: string;
  rules: ClassificationRule[];
}

export interface EvalResult {
  variant: VariantSet;
  accuracy: number;
  correct: number;
  total: number;
}

/** Scan Vault for representative labeled notes (min summary length 50 chars) */
export async function buildEvalDataset(vaultPath: string): Promise<EvalNote[]> {
  const notesDir = join(vaultPath, 'KnowPipe');
  const files = await getAllMdFiles(notesDir);
  const byCategory = new Map<string, EvalNote[]>();

  for (const fp of files) {
    try {
      const raw = await readFile(fp, 'utf-8');
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;
      const fmText = fmMatch[1];

      const getField = (f: string) => fmText.match(new RegExp(`^${f}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? '';
      const title = getField('title');
      const category = getField('category');
      const summary = getField('summary');

      if (!title || !category || category === '其他' || category === '知識整合') continue;
      if (summary.length < 50) continue;

      const root = category.split('/')[0] ?? category;
      const body = raw.replace(/^---[\s\S]*?---\r?\n/, '').slice(0, 500);
      const arr = byCategory.get(root) ?? [];
      if (arr.length < MAX_NOTES_PER_CAT) {
        arr.push({ title, text: `${summary} ${body}`, expectedCategory: root });
        byCategory.set(root, arr);
      }
    } catch { /* skip */ }
  }

  return [...byCategory.values()].flat();
}

/** Generate 5 candidate rule variants from the current learned rules */
export function generateRuleVariants(currentRules: ClassificationRule[]): VariantSet[] {
  if (currentRules.length === 0) return [];
  const sorted = [...currentRules].sort((a, b) => b.score - a.score);

  // Variant 1: raise threshold — only keep rules with score >= 0.85
  const v1: VariantSet = {
    label: '提高精確度閾值 (score ≥ 0.85)',
    rules: sorted.filter((r) => r.score >= 0.85),
  };

  // Variant 2: lower threshold — include rules with score >= 0.65
  const v2: VariantSet = {
    label: '降低閾值 (score ≥ 0.65)',
    rules: sorted.filter((r) => r.score >= 0.65),
  };

  // Variant 3: top-N per category (keep best 5 per cat)
  const catBest = new Map<string, ClassificationRule[]>();
  for (const r of sorted) {
    const arr = catBest.get(r.category) ?? [];
    if (arr.length < 5) arr.push(r);
    catBest.set(r.category, arr);
  }
  const v3: VariantSet = { label: '每分類取 Top-5 規則', rules: [...catBest.values()].flat() };

  // Variant 4: drop low-count rules (count < 3)
  const v4: VariantSet = {
    label: '移除低頻規則 (count < 3)',
    rules: sorted.filter((r) => r.count >= 3),
  };

  // Variant 5: keep only CJK keywords (≥2 CJK chars) + high-quality ASCII (≥6 chars)
  const v5: VariantSet = {
    label: '強化 CJK 優先規則',
    rules: sorted.filter((r) => {
      const hasCJK = /[一-鿿]/.test(r.keyword);
      return hasCJK ? r.keyword.length >= 2 : r.keyword.length >= 6 && r.score >= 0.75;
    }),
  };

  return [v1, v2, v3, v4, v5].filter((v) => v.rules.length > 0).slice(0, VARIANT_COUNT);
}

/** Evaluate a single variant: returns fraction of correctly classified notes */
function evaluateSingleVariant(variant: VariantSet, evalSet: EvalNote[]): EvalResult {
  if (evalSet.length === 0) return { variant, accuracy: 0, correct: 0, total: 0 };

  // Temporarily swap cached rules by building a mini classifier
  const rules = variant.rules;
  let correct = 0;
  for (const note of evalSet) {
    const titleLower = note.title.toLowerCase();
    const textLower = note.text.toLowerCase();
    let predicted: string | null = null;

    for (const rule of rules) {
      if (rule.score >= 0.8 && titleLower.includes(rule.keyword)) { predicted = rule.category; break; }
    }
    if (!predicted) {
      for (const rule of rules) {
        if (rule.score >= 0.65 && textLower.includes(rule.keyword)) { predicted = rule.category; break; }
      }
    }

    if (predicted === note.expectedCategory) correct++;
  }

  return { variant, accuracy: correct / evalSet.length, correct, total: evalSet.length };
}

export function evaluateVariants(variants: VariantSet[], evalSet: EvalNote[]): EvalResult[] {
  return variants.map((v) => evaluateSingleVariant(v, evalSet));
}

/** Apply best variant to learned-patterns.json if improvement > threshold */
export async function applyBestVariant(
  results: EvalResult[],
  baselineAccuracy: number,
): Promise<{ applied: boolean; best: EvalResult | null }> {
  if (results.length === 0) return { applied: false, best: null };
  const best = results.reduce((a, b) => b.accuracy > a.accuracy ? b : a);
  if (best.accuracy - baselineAccuracy <= IMPROVEMENT_THRESHOLD) return { applied: false, best };

  try {
    const patterns = await safeReadJSON<Partial<LearnedPatterns>>(LEARNED_PATTERNS_PATH, {});
    patterns.classificationRules = best.variant.rules;
    patterns.generatedAt = new Date().toISOString();
    await safeWriteJSON(LEARNED_PATTERNS_PATH, patterns);
    logger.info('classifier-evolver', '套用最佳變體', { accuracy: best.accuracy, baseline: baselineAccuracy });
    return { applied: true, best };
  } catch (err) {
    logger.warn('classifier-evolver', '套用失敗', { err });
    return { applied: false, best };
  }
}

/** Main orchestration — returns formatted Telegram message */
export async function runClassifierEvolution(vaultPath: string): Promise<string> {
  const patterns = await safeReadJSON<Partial<LearnedPatterns>>(LEARNED_PATTERNS_PATH, {});
  const currentRules: ClassificationRule[] = patterns.classificationRules ?? [];

  if (currentRules.length === 0) {
    return '⚠️ 尚無 learned-patterns.json，請先執行 /learn scan 建立基礎規則。';
  }

  // Step 1: build eval dataset
  const evalSet = await buildEvalDataset(vaultPath);
  if (evalSet.length < 10) {
    return `⚠️ Eval dataset 不足（${evalSet.length} 篇），需要至少 10 篇有效筆記。`;
  }

  const catCount = new Set(evalSet.map((n) => n.expectedCategory)).size;

  // Step 2: baseline accuracy (current rules)
  const baselineResult = evaluateSingleVariant({ label: '現有規則', rules: currentRules }, evalSet);
  const baseline = baselineResult.accuracy;

  // Step 3: generate & evaluate variants
  const variants = generateRuleVariants(currentRules);
  const results = evaluateVariants(variants, evalSet);

  // Step 4: apply best if improvement > threshold
  const { applied, best } = await applyBestVariant(results, baseline);

  // Format output
  const lines = [
    '🧬 分類器進化報告',
    `📊 Eval dataset：${evalSet.length} 篇（${catCount} 個 category）`,
    `📏 基準準確率：${(baseline * 100).toFixed(1)}%（${baselineResult.correct}/${evalSet.length}）`,
    '',
    `🔬 測試 ${variants.length} 個候選變體：`,
  ];

  for (const r of results) {
    const delta = r.accuracy - baseline;
    const icon = delta > IMPROVEMENT_THRESHOLD ? '✅' : delta > 0 ? '➕' : '❌';
    lines.push(`  ${icon} ${r.variant.label}：${(r.accuracy * 100).toFixed(1)}%（${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%）`);
  }

  lines.push('');
  if (applied && best) {
    lines.push(`✨ 已套用最佳變體「${best.variant.label}」`);
    lines.push(`   準確率 ${(baseline * 100).toFixed(1)}% → ${(best.accuracy * 100).toFixed(1)}%（+${((best.accuracy - baseline) * 100).toFixed(1)}%）`);
  } else if (best) {
    lines.push(`ℹ️ 最佳變體「${best.variant.label}」改善 ${((best.accuracy - baseline) * 100).toFixed(1)}%，未達 1% 閾值，不套用。`);
  }

  void classifyWithLearnedRules; // ensure import is used for type-check
  return lines.join('\n');
}
