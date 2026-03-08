/**
 * Deep knowledge extraction using Claude Sonnet.
 * Independent from ai-enricher.ts (which uses Haiku for lightweight enrichment).
 */
import type { AIAnalysisResponse } from './types.js';

const SONNET_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1500;
const TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 3000;

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

const SYSTEM_PROMPT = `你是知識萃取專家。分析給定的文章，從中萃取結構化知識。

回傳格式（嚴格 JSON，不要有其他文字）：
{
  "qualityScore": <1-5 整數>,
  "entities": [
    {
      "name": "<正規化名稱>",
      "type": "<tool|concept|person|framework|company|technology|platform|language>",
      "aliases": ["<別名>"]
    }
  ],
  "insights": [
    {
      "type": "<principle|framework|pattern|warning|best_practice|mental_model|tip|anti_pattern>",
      "content": "<洞察內容，100字以內，使用繁體中文>",
      "relatedEntities": ["<相關實體名稱>"],
      "confidence": <0.0-1.0>
    }
  ],
  "relations": [
    {
      "from": "<實體名稱>",
      "to": "<實體名稱>",
      "type": "<uses|compares|builds_on|contradicts|alternative_to|part_of|created_by|integrates>",
      "description": "<關係描述，50字以內>"
    }
  ]
}

品質分數標準：
1 = 純新聞/公告，無實質洞察
2 = 有基本資訊但缺乏深度
3 = 有具體技巧或工具介紹
4 = 有深入分析、框架或原則
5 = 有原創洞察、系統性思考或範式轉移

規則：
- 實體名稱要正規化（如 "Claude Code" 不要寫成 "claude code 工具"）
- 洞察要具體可操作，不要泛泛而談
- 關係必須基於文章明確提到的關聯
- 每篇最多 10 個實體、8 個洞察、6 個關係
- 信心分數低於 0.5 的洞察不要包含`;

/**
 * Deeply analyze a single note using Claude Sonnet.
 * Returns null on any failure (graceful fallback).
 */
export async function analyzeNote(
  title: string,
  text: string,
  category: string,
  apiKey: string,
): Promise<AIAnalysisResponse | null> {
  const truncatedText = text.slice(0, MAX_INPUT_CHARS).replace(/\n/g, ' ');
  const userMsg = `分類：${category}\n標題：${title}\n\n內容：${truncatedText}`;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[analyzer] API error: ${res.status} ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as AnthropicResponse;
    const responseText = data.content?.[0]?.text ?? '';
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as AIAnalysisResponse;
    return validateResponse(parsed);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.warn('[analyzer] 分析失敗:', (err as Error).message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Validate and sanitize AI response to ensure type safety */
function validateResponse(raw: AIAnalysisResponse): AIAnalysisResponse | null {
  if (typeof raw.qualityScore !== 'number') return null;

  return {
    qualityScore: Math.min(5, Math.max(1, Math.round(raw.qualityScore))),
    entities: (Array.isArray(raw.entities) ? raw.entities : [])
      .filter(e => typeof e.name === 'string' && typeof e.type === 'string')
      .slice(0, 10),
    insights: (Array.isArray(raw.insights) ? raw.insights : [])
      .filter(i => typeof i.content === 'string' && i.confidence >= 0.5)
      .slice(0, 8),
    relations: (Array.isArray(raw.relations) ? raw.relations : [])
      .filter(r => typeof r.from === 'string' && typeof r.to === 'string')
      .slice(0, 6),
  };
}
