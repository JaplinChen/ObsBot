/**
 * 輕量 RSS/Atom XML 解析器。
 * 使用正則表達式處理，不依賴額外套件。
 * 支援 RSS 2.0 與 Atom 1.0 格式。
 */

export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  author?: string;
  guid?: string;
}

/** 取出 XML 標籤內文（取第一個符合的） */
function extractTag(xml: string, tag: string): string {
  // CDATA
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch?.[1]) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m?.[1]?.trim() ?? '';
}

/** 取出屬性值 */
function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i');
  return xml.match(re)?.[1]?.trim() ?? '';
}

/** 解碼常見 HTML 實體 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** 解析 RSS 2.0 */
function parseRSS(xml: string): RSSItem[] {
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const items: RSSItem[] = [];
  for (const match of xml.matchAll(itemRe)) {
    const block = match[1];
    const title = decodeEntities(extractTag(block, 'title'));
    const link = extractTag(block, 'link') || extractAttr(block, 'link', 'href');
    if (!link) continue;
    items.push({
      title: title || '(無標題)',
      link,
      description: decodeEntities(extractTag(block, 'description')),
      pubDate: extractTag(block, 'pubDate') || extractTag(block, 'dc:date'),
      author: extractTag(block, 'author') || extractTag(block, 'dc:creator'),
      guid: extractTag(block, 'guid'),
    });
  }
  return items;
}

/** 解析 Atom 1.0 */
function parseAtom(xml: string): RSSItem[] {
  const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  const items: RSSItem[] = [];
  for (const match of xml.matchAll(entryRe)) {
    const block = match[1];
    const title = decodeEntities(extractTag(block, 'title'));

    // <link href="..."> 或 <link>url</link>
    const linkHref = extractAttr(block, 'link', 'href');
    const linkText = extractTag(block, 'link');
    const link = linkHref || linkText;
    if (!link) continue;

    const description = decodeEntities(
      extractTag(block, 'summary') || extractTag(block, 'content')
    );

    items.push({
      title: title || '(無標題)',
      link,
      description,
      pubDate: extractTag(block, 'updated') || extractTag(block, 'published'),
      author: extractTag(block, 'name') || extractTag(block, 'author'),
      guid: extractTag(block, 'id'),
    });
  }
  return items;
}

/**
 * 自動判斷 RSS 或 Atom 格式並解析。
 * @returns RSSItem[]，失敗時回傳空陣列
 */
export function parseXmlFeed(xml: string): RSSItem[] {
  if (!xml || xml.length < 50) return [];
  const isAtom = /<feed[^>]*xmlns[^>]*atom/i.test(xml) || /<entry\b/i.test(xml);
  return isAtom ? parseAtom(xml) : parseRSS(xml);
}

/** 將 pubDate 字串轉為 YYYY-MM-DD，解析失敗時回傳今天 */
export function normalizePubDate(pubDate?: string): string {
  if (!pubDate) return new Date().toISOString().split('T')[0];
  try {
    return new Date(pubDate).toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}
