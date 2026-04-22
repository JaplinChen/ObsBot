/**
 * Auto skill generator — after a successful multi-step ReAct session (≥3 steps),
 * use LLM to distill the query strategy into a reusable UnifiedSkill and save it.
 */
import { createHash } from 'node:crypto';
import type { ReactResult } from '../utils/react-loop.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { saveSkill } from './skill-store.js';
import type { UnifiedSkill } from './skill-types.js';
import { logger } from '../core/logger.js';

const MIN_STEPS = 3;

interface GeneratedMeta {
  id: string;
  title: string;
  description: string;
  triggers: string[];
  strategy: string;
}

function toKebab(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

function parseMeta(raw: string): GeneratedMeta | null {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      id: String(obj['id'] ?? ''),
      title: String(obj['title'] ?? ''),
      description: String(obj['description'] ?? ''),
      triggers: Array.isArray(obj['triggers']) ? (obj['triggers'] as string[]) : [],
      strategy: String(obj['strategy'] ?? ''),
    };
  } catch { return null; }
}

/**
 * Attempt to generate a skill from a ReAct result.
 * Runs in background (fire-and-forget); errors are logged, never thrown.
 */
export async function maybeGenerateSkill(query: string, result: ReactResult): Promise<void> {
  if (result.steps.length < MIN_STEPS) return;

  const searchSteps = result.steps.filter((s) => s.action === 'search_vault');
  if (searchSteps.length === 0) return;

  const stepsText = searchSteps
    .map((s) => `搜尋「${s.input}」→ ${(s.observation ?? '').slice(0, 120)}`)
    .join('\n');

  const prompt = [
    '根據以下成功的知識庫查詢流程，生成可重用技能描述（JSON 格式，只輸出 JSON）：',
    `原始問題：${query}`,
    `搜尋步驟：\n${stepsText}`,
    `最終回答摘要：${result.answer.slice(0, 150)}`,
    '',
    '輸出格式：',
    '{"id":"kebab-case英文id","title":"技能中文名稱","description":"一句話說明何時使用","triggers":["觸發情境1","觸發情境2"],"strategy":"此類查詢的最佳搜尋策略說明"}',
  ].join('\n');

  try {
    const raw = await runLocalLlmPrompt(prompt, { model: 'flash', timeoutMs: 15_000, maxTokens: 512 });
    if (!raw) return;

    const meta = parseMeta(raw);
    if (!meta?.title || !meta.id) return;

    const instructions = [
      `## 查詢策略\n${meta.strategy}`,
      `## 搜尋關鍵字模式\n${searchSteps.map((s) => `- ${s.input}`).join('\n')}`,
      `## 來源問題\n${query}`,
    ].join('\n\n');

    const skill: UnifiedSkill = {
      id: `generated-${toKebab(meta.id)}-${Date.now()}`,
      title: meta.title,
      description: meta.description,
      triggers: meta.triggers,
      instructions,
      constraints: [],
      examples: [query],
      category: 'generated',
      sourceFormat: 'claude',
      metadata: {
        author: 'KnowPipe',
        version: '1.0',
        tags: ['generated', 'react-loop', 'ask'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: createHash('md5').update(instructions).digest('hex'),
      },
    };

    await saveSkill(skill);
    logger.info('skill-generator', `自動產生技能: ${skill.id}`);
  } catch (err) {
    logger.warn('skill-generator', '技能生成失敗（忽略）', { error: (err as Error).message });
  }
}
