/**
 * Quality review service — Harness Engineering "Evaluator" role.
 * Sits between enricher and saver. Uses Generator-Evaluator separation:
 *   Layer 1: Rule-based checks (zero cost)
 *   Layer 2: Evaluator — scores each field + provides fix instructions
 *   Layer 3: Generator — regenerates only the fields flagged by Evaluator
 * Never blocks saving.
 */
import type { ExtractedContent } from '../../extractors/types.js';
import type { AppConfig } from '../../utils/config.js';
import { logger } from '../../core/logger.js';
import { getUserConfig } from '../../utils/user-config.js';
import { runLocalLlmPrompt } from '../../utils/local-llm.js';
import { regenerateFields } from '../../learning/ai-enricher.js';
import { getSignalTag } from '../../utils/signal-scorer.js';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ReviewIssue {
  field: 'summary' | 'category' | 'keywords';
  problem: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ReviewResult {
  passed: boolean;
  issues: ReviewIssue[];
  autoFixed: boolean;
  fixedFields: string[];
  durationMs: number;
  scores?: Record<string, number>;
}

interface FixInstruction {
  field: string;
  instruction: string;
}

const PASS_RESULT: ReviewResult = {
  passed: true, issues: [], autoFixed: false, fixedFields: [], durationMs: 0,
};

const REVIEW_TIMEOUT_MS = 20_000;
const SCORE_THRESHOLD = 6;

/* ── Layer 1: Rule-based checks (zero LLM cost) ─────────────────── */

function runRuleBasedChecks(content: ExtractedContent): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const summary = content.enrichedSummary;
  const keywords = content.enrichedKeywords;

  if (!summary || summary.length <= 10) {
    issues.push({ field: 'summary', problem: '摘要為空或過短', severity: 'high' });
  } else if (summary === content.title || summary.trim() === content.title.trim()) {
    issues.push({ field: 'summary', problem: '摘要與標題相同，無額外資訊', severity: 'medium' });
  }

  if (!keywords || keywords.length === 0) {
    issues.push({ field: 'keywords', problem: '關鍵字為空', severity: 'medium' });
  }

  if (content.category === '其他' && (content.text?.length ?? 0) > 200) {
    issues.push({ field: 'category', problem: '內容充足但分類為「其他」', severity: 'low' });
  }

  // AI 偽裝偵測：關鍵字與原文重疊率低 → 可能是 AI 捏造的關鍵字
  if (keywords && keywords.length > 0 && content.text) {
    const textLower = content.text.toLowerCase().slice(0, 1000);
    const overlapping = keywords.filter((kw) => textLower.includes(kw.toLowerCase()));
    if (overlapping.length < 2) {
      issues.push({ field: 'summary', problem: 'AI 摘要術語與原文重疊率低，可能偽裝', severity: 'medium' });
    }
  }

  return issues;
}

/* ── Layer 2: Evaluator (standard tier — semantic scoring) ───────── */

function buildEvaluatorPrompt(content: ExtractedContent): string {
  const textSnippet = (content.text ?? '').slice(0, 600);
  return `你是品質評估器（Evaluator）。請對以下內容豐富化結果做語義品質評分。

原始標題：${content.title}
原始內容片段：
${textSnippet}

---
當前豐富化結果：
分類：${content.category ?? '無'}
摘要：${content.enrichedSummary ?? '無'}
關鍵字：${(content.enrichedKeywords ?? []).join(', ') || '無'}
分析：${(content.enrichedAnalysis ?? '').slice(0, 200) || '無'}

---
請評分（0-10）並判斷是否需要修復。以 JSON 格式回覆，不要其他文字：
{
  "scores": { "summary": 0-10, "keywords": 0-10, "title": 0-10, "analysis": 0-10 },
  "verdict": "pass" 或 "needs_fix",
  "fixInstructions": [
    { "field": "欄位名", "instruction": "具體改善指令，說明缺什麼或哪裡不對" }
  ]
}

評分標準：
- summary: ≤120字、客觀、含核心主題和實用價值 → 8-10分；空泛或重複標題 → 3-5分
- keywords: 3-5個精準關鍵字、覆蓋核心概念 → 8-10分；泛化或遺漏 → 3-5分
- title: 格式清楚、含工具/概念名 → 8-10分；過長或含無用前綴 → 3-5分
- analysis: 有具體細節、可驗證 → 8-10分；空泛模板語 → 3-5分

verdict 規則：任一欄位 < ${SCORE_THRESHOLD} 分就是 "needs_fix"。
fixInstructions 只列出 < ${SCORE_THRESHOLD} 分的欄位，instruction 要具體（「缺少 XX 技術名稱」而非「需要改善」）。`;
}

interface EvaluatorResult {
  scores: Record<string, number>;
  verdict: 'pass' | 'needs_fix';
  fixInstructions: FixInstruction[];
}

function parseEvaluatorResponse(raw: string): EvaluatorResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as EvaluatorResult;
    if (!parsed.scores || !parsed.verdict) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── Layer 3: Generator fix (via ai-enricher) ────────────────────── */

async function runGeneratorFix(
  content: ExtractedContent,
  instructions: FixInstruction[],
): Promise<string[]> {
  const textSnippet = (content.text ?? '').slice(0, 1500);
  const currentOutput = {
    summary: content.enrichedSummary ?? null,
    keywords: content.enrichedKeywords ?? null,
    analysis: content.enrichedAnalysis ?? null,
    keyPoints: content.enrichedKeyPoints ?? null,
  };

  const fix = await regenerateFields(
    content.title,
    textSnippet,
    currentOutput,
    instructions,
  );

  const fixedFields: string[] = [];
  if (fix.summary && fix.summary.length > 10) {
    content.enrichedSummary = fix.summary;
    fixedFields.push('summary');
  }
  if (fix.keywords && fix.keywords.length > 0) {
    content.enrichedKeywords = fix.keywords;
    fixedFields.push('keywords');
  }
  if (fix.analysis && fix.analysis.length > 10) {
    content.enrichedAnalysis = fix.analysis;
    fixedFields.push('analysis');
  }
  if (fix.keyPoints && fix.keyPoints.length > 0) {
    content.enrichedKeyPoints = fix.keyPoints;
    fixedFields.push('keyPoints');
  }
  // Category auto-fix is intentionally NOT applied — classifier rules are authoritative
  return fixedFields;
}

/* ── Main exported function ───────────────────────────────────────── */

function applySignalTag(content: ExtractedContent): void {
  const tag = getSignalTag(content);
  if (!tag) return;
  content.suggestedTags = [...(content.suggestedTags ?? []).filter(t => t !== 'high-signal' && t !== 'low-signal'), tag];
  logger.info('review', `信號標籤：${tag}`, { platform: content.platform });
}

export async function reviewEnrichedContent(
  content: ExtractedContent,
  _config: AppConfig,
): Promise<ReviewResult> {
  // Signal scoring runs unconditionally — zero cost, no LLM
  applySignalTag(content);

  if (!getUserConfig().features.qualityReview) return PASS_RESULT;

  // 短文（<500 字）內容簡單，規則檢查足夠，跳過 LLM 審查
  if (content.text.length < 500) return PASS_RESULT;

  const start = Date.now();

  try {
    return await Promise.race([
      doReview(content),
      new Promise<ReviewResult>(resolve =>
        setTimeout(() => {
          logger.warn('review', '品質審查超時，跳過');
          resolve({ ...PASS_RESULT, durationMs: Date.now() - start });
        }, REVIEW_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    logger.warn('review', '品質審查異常', { err: (err as Error).message });
    return { ...PASS_RESULT, durationMs: Date.now() - start };
  }
}

async function doReview(content: ExtractedContent): Promise<ReviewResult> {
  const start = Date.now();

  // Layer 1: Rule-based checks
  const ruleIssues = runRuleBasedChecks(content);
  if (ruleIssues.some(i => i.severity === 'high')) {
    // Critical rule failure — go straight to Generator fix (routing handles provider selection)
    const instructions = ruleIssues.map(i => ({
      field: i.field,
      instruction: i.problem,
    }));
    const fixedFields = await runGeneratorFix(content, instructions);
    if (fixedFields.length > 0) {
      const remaining = runRuleBasedChecks(content);
      logger.info('review', 'L1 修復完成', { fixedFields, remaining: remaining.length });
      return {
        passed: remaining.length === 0,
        issues: remaining,
        autoFixed: true,
        fixedFields,
        durationMs: Date.now() - start,
      };
    }
    return {
      passed: false, issues: ruleIssues,
      autoFixed: false, fixedFields: [], durationMs: Date.now() - start,
    };
  }

  // Layer 2: Evaluator — routes via model-router (task: 'review' → standard tier)
  const evalPrompt = buildEvaluatorPrompt(content);
  const evalRaw = await runLocalLlmPrompt(evalPrompt, { task: 'review', timeoutMs: 10_000 });
  if (!evalRaw) {
    return { passed: ruleIssues.length === 0, issues: ruleIssues,
      autoFixed: false, fixedFields: [], durationMs: Date.now() - start };
  }

  const evalResult = parseEvaluatorResponse(evalRaw);
  if (!evalResult) {
    return { passed: ruleIssues.length === 0, issues: ruleIssues,
      autoFixed: false, fixedFields: [], durationMs: Date.now() - start };
  }

  logger.info('review', 'Evaluator 評分', {
    scores: evalResult.scores, verdict: evalResult.verdict,
  });

  // Layer 2 pass — no fix needed
  if (evalResult.verdict === 'pass') {
    return {
      passed: true, issues: [], autoFixed: false, fixedFields: [],
      durationMs: Date.now() - start, scores: evalResult.scores,
    };
  }

  // Layer 3: Generator fix based on Evaluator instructions
  const instructions = evalResult.fixInstructions ?? [];
  if (instructions.length === 0) {
    return {
      passed: false,
      issues: instructions.map(i => ({
        field: i.field as ReviewIssue['field'],
        problem: i.instruction,
        severity: 'medium' as const,
      })),
      autoFixed: false, fixedFields: [],
      durationMs: Date.now() - start, scores: evalResult.scores,
    };
  }

  const fixedFields = await runGeneratorFix(content, instructions);
  if (fixedFields.length > 0) {
    const remaining = runRuleBasedChecks(content);
    logger.info('review', 'Generator 修復完成', { fixedFields, remaining: remaining.length });
    return {
      passed: remaining.length === 0,
      issues: remaining,
      autoFixed: true,
      fixedFields,
      durationMs: Date.now() - start,
      scores: evalResult.scores,
    };
  }

  return {
    passed: false,
    issues: instructions.map(i => ({
      field: i.field as ReviewIssue['field'],
      problem: i.instruction,
      severity: 'medium' as const,
    })),
    autoFixed: false, fixedFields: [],
    durationMs: Date.now() - start, scores: evalResult.scores,
  };
}
