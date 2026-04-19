/**
 * Natural language intent parser for KnowPipe.
 * Two-layer approach:
 * - Layer 1: High-confidence regex patterns → auto-trigger
 * - Layer 2: Low-confidence patterns → suggest with InlineKeyboard
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { logger } from '../core/logger.js';

export interface ParsedIntent {
  /** Intent type */
  intent: 'weekly-digest' | 'compare' | 'trends' | 'ask' | 'explore';
  /** Extracted topic (if any) */
  topic?: string;
  /** Second topic for compare */
  topicB?: string;
  /** Whether to auto-execute or suggest */
  mode: 'auto' | 'suggest';
}

interface PatternRule {
  pattern: RegExp;
  intent: ParsedIntent['intent'];
  mode: 'auto' | 'suggest';
  extractTopics?: boolean;
}

/* ── High-confidence patterns (auto-trigger) ──────────────────── */

const AUTO_PATTERNS: PatternRule[] = [
  {
    pattern: /^(幫我|產生|做|生成|跑).{0,4}(週報|周報|本週摘要|weekly)/i,
    intent: 'weekly-digest',
    mode: 'auto',
  },
  {
    pattern: /^比較\s*(.+?)\s*(和|與|跟|vs)\s*(.+)/i,
    intent: 'compare',
    mode: 'auto',
    extractTopics: true,
  },
  {
    pattern: /^(這週|本週|近期).{0,6}(趨勢|熱門|關注|焦點)/i,
    intent: 'trends',
    mode: 'auto',
  },
];

/* ── Low-confidence patterns (suggest with buttons) ───────────── */

const SUGGEST_PATTERNS: PatternRule[] = [
  {
    pattern: /週報|摘要|digest/i,
    intent: 'weekly-digest',
    mode: 'suggest',
  },
  {
    pattern: /比較|對比|差異/i,
    intent: 'compare',
    mode: 'suggest',
  },
  {
    pattern: /趨勢|熱門|trending/i,
    intent: 'trends',
    mode: 'suggest',
  },
  {
    pattern: /(.+)(是什麼|怎麼用|有什麼|相關)/i,
    intent: 'explore',
    mode: 'suggest',
  },
];

/**
 * Parse user text for intent. Returns null if no intent detected.
 */
export function parseIntent(text: string): ParsedIntent | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 200) return null;

  // Layer 1: High-confidence auto-trigger
  for (const rule of AUTO_PATTERNS) {
    const match = trimmed.match(rule.pattern);
    if (!match) continue;

    const result: ParsedIntent = { intent: rule.intent, mode: 'auto' };

    if (rule.extractTopics && rule.intent === 'compare') {
      result.topic = match[1]?.trim();
      result.topicB = match[3]?.trim();
    }

    logger.info('intent', '高信心意圖匹配', { intent: rule.intent, text: trimmed.slice(0, 40) });
    return result;
  }

  // Layer 2: Low-confidence suggest
  for (const rule of SUGGEST_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      logger.info('intent', '低信心意圖匹配', { intent: rule.intent, text: trimmed.slice(0, 40) });
      return { intent: rule.intent, mode: 'suggest' };
    }
  }

  return null;
}

/** Build suggestion keyboard for ambiguous intents */
export async function replySuggestion(ctx: Context, intent: ParsedIntent): Promise<void> {
  const options: Record<string, { label: string; callback: string }[]> = {
    'weekly-digest': [
      { label: '📰 產生週報', callback: 'dg:weekly' },
      { label: '📋 精華摘要', callback: 'dg:digest' },
    ],
    'compare': [
      { label: '⚖️ 開始比較', callback: 'intent:compare' },
      { label: '🔍 搜尋', callback: 'intent:search' },
    ],
    'trends': [
      { label: '📰 週報（含趨勢）', callback: 'dg:weekly' },
      { label: '📋 精華摘要', callback: 'dg:digest' },
    ],
    'explore': [
      { label: '🔬 深度探索', callback: 'intent:explore' },
      { label: '📚 搜尋筆記', callback: 'intent:search' },
    ],
    'ask': [
      { label: '💬 知識問答', callback: 'intent:ask' },
    ],
  };

  const buttons = options[intent.intent] ?? [];
  if (buttons.length === 0) return;

  await ctx.reply(
    '你想要做什麼？',
    Markup.inlineKeyboard(
      buttons.map(b => [Markup.button.callback(b.label, b.callback)]),
    ),
  );
}
