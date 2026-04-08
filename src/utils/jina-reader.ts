/**
 * Jina Reader — 將任意 URL 轉為 Markdown。
 * 用法：fetchJina(url) → markdown string 或 null（靜默失敗）。
 * 不拋例外，供 web-extractor 作為 fallback tier 使用。
 */

const JINA_BASE = 'https://r.jina.ai/';
const TIMEOUT_MS = 25_000;
const MIN_LENGTH = 200;

export interface JinaResult {
  title: string;
  markdown: string;
  url: string;
}

/**
 * 呼叫 Jina Reader API 取得頁面 Markdown。
 * @returns JinaResult 或 null（失敗時靜默回傳 null）
 */
export async function fetchJina(url: string): Promise<JinaResult | null> {
  const jinaUrl = JINA_BASE + encodeURIComponent(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(jinaUrl, {
      signal: ac.signal,
      headers: {
        Accept: 'application/json',
        'X-No-Cache': 'true',
        'X-Return-Format': 'markdown',
        'X-With-Generated-Alt': 'true',
      },
    });

    if (!res.ok) return null;

    const ct = res.headers.get('content-type') || '';

    if (ct.includes('application/json')) {
      const json = await res.json() as {
        data?: { title?: string; content?: string; url?: string };
        code?: number;
      };
      const data = json?.data;
      if (!data?.content || data.content.length < MIN_LENGTH) return null;
      return {
        title: data.title || '',
        markdown: data.content,
        url: data.url || url,
      };
    }

    // 純文字 / Markdown 回應
    const text = await res.text();
    if (!text || text.length < MIN_LENGTH) return null;

    // 嘗試從 markdown 第一行抽取標題
    const titleMatch = text.match(/^#\s+(.+)/m);
    return {
      title: titleMatch?.[1]?.trim() || '',
      markdown: text,
      url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
