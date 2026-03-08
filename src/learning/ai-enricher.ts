/** Optional Claude API enrichment for keywords and summary generation. */

const VALID_CATEGORIES = new Set([
  'AI/Claude Code', 'AI/OpenClaw', 'AI/工具', 'AI/學習', 'AI/提示詞', 'AI/模型', 'AI/應用', 'AI',
  '科技', '程式設計', '投資理財', '創業商業', '設計', '行銷', '生產力', '新聞時事', '生活', '其他',
]);

interface EnrichResult {
  keywords: string[] | null;
  summary: string | null;
  title?: string;
  category?: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

/**
 * Enrich content with AI-generated keywords and summary.
 * Falls back silently to { keywords: null, summary: null } on any error.
 *
 * @param title         Content title
 * @param text          Content body
 * @param categoryHints Top keywords from vault for the target category (few-shot context)
 * @param apiKey        Anthropic API key
 */
export async function enrichContent(
  title: string,
  text: string,
  categoryHints: string[],
  apiKey: string,
): Promise<EnrichResult> {
  const textPreview = text.slice(0, 800).replace(/\n/g, ' ');
  const hintLine = categoryHints.length > 0
    ? `此分類常見關鍵詞參考：${categoryHints.slice(0, 5).join('、')}`
    : '';

  const userMsg = [hintLine, `標題: "${title}"`, `內容: "${textPreview}"`]
    .filter(Boolean)
    .join('\n');

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 10_000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `請從內容提取5個繁體中文關鍵詞、1句摘要（50字內）、1個精準標題（50字內）以及1個分類。
只輸出 JSON，格式如下：
{"keywords":["k1","k2"],"summary":"...","title":"標題","category":"分類"}

title 規則：
- 描述內容核心主題，≤50字
- 社群媒體貼文請從內容提取關鍵洞察，不要用「Author on X」格式

category 規則（必須完全匹配以下清單其中一個）：
AI/Claude Code, AI/OpenClaw, AI/工具, AI/學習, AI/提示詞, AI/模型, AI/應用, AI, 科技, 程式設計, 投資理財, 創業商業, 設計, 行銷, 生產力, 新聞時事, 生活, 其他`,
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: ac.signal,
    });

    if (!res.ok) return { keywords: null, summary: null };

    const data = await res.json() as AnthropicResponse;
    const responseText = data.content?.[0]?.text ?? '';
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) return { keywords: null, summary: null };

    const parsed = JSON.parse(match[0]) as {
      keywords?: unknown;
      summary?: unknown;
      title?: unknown;
      category?: unknown;
    };

    const rawCategory = typeof parsed.category === 'string' ? parsed.category : undefined;

    return {
      keywords: Array.isArray(parsed.keywords)
        ? (parsed.keywords as string[]).slice(0, 5)
        : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      category: rawCategory !== undefined && VALID_CATEGORIES.has(rawCategory)
        ? rawCategory
        : undefined,
    };
  } catch {
    return { keywords: null, summary: null };
  } finally {
    clearTimeout(timeout);
  }
}
