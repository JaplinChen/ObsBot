import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseFm(content: string): Record<string, string> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["'](.*)["']$/, '$1');
    if (k) fm[k] = v;
  }
  return fm;
}

function stripFm(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
      `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) =>
      `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(t)}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`);
}

function convertBody(md: string): string {
  const out: string[] = [];
  let pBuf: string[] = [];
  let bqBuf: string[] = [];
  let ulBuf: string[] = [];
  let olBuf: string[] = [];
  let tableRows: string[][] = [];
  let preBuf: string[] = [];
  let preLang = '';
  let inPre = false;

  const flush = (except?: string) => {
    if (except !== 'p' && pBuf.length) {
      out.push(`<p>${pBuf.join('<br>')}</p>`); pBuf = [];
    }
    if (except !== 'bq' && bqBuf.length) {
      out.push(`<blockquote><p>${bqBuf.join('<br>')}</p></blockquote>`); bqBuf = [];
    }
    if (except !== 'ul' && ulBuf.length) {
      out.push(`<ul>${ulBuf.join('')}</ul>`); ulBuf = [];
    }
    if (except !== 'ol' && olBuf.length) {
      out.push(`<ol>${olBuf.join('')}</ol>`); olBuf = [];
    }
    if (except !== 'table' && tableRows.length) {
      const rows = tableRows.map((cells, i) => {
        const tag = i === 0 ? 'th' : 'td';
        return `<tr>${cells.map(c => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
      });
      out.push(`<table>${rows.join('')}</table>`);
      tableRows = [];
    }
  };

  for (const line of md.split('\n')) {
    // Code fence
    if (line.startsWith('```')) {
      if (!inPre) {
        flush();
        preLang = esc(line.slice(3).trim());
        inPre = true;
      } else {
        const attr = preLang ? ` class="language-${preLang}"` : '';
        out.push(`<pre><code${attr}>${preBuf.join('\n')}</code></pre>`);
        preBuf = []; preLang = ''; inPre = false;
      }
      continue;
    }
    if (inPre) { preBuf.push(esc(line)); continue; }

    // Table
    if (line.startsWith('|')) {
      flush('table');
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!cells.every(c => /^:?-+:?$/.test(c))) tableRows.push(cells);
      continue;
    }
    // HR
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flush(); out.push('<hr>'); continue;
    }
    // Heading
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      flush();
      const lvl = hm[1].length === 1 ? 2 : Math.min(hm[1].length, 4);
      out.push(`<h${lvl}>${inline(hm[2])}</h${lvl}>`); continue;
    }
    // Blockquote
    if (line.startsWith('> ')) {
      flush('bq');
      bqBuf.push(inline(line.slice(2))); continue;
    }
    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      flush('ul');
      ulBuf.push(`<li>${inline(line.replace(/^[-*+]\s/, ''))}</li>`); continue;
    }
    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      flush('ol');
      olBuf.push(`<li>${inline(line.replace(/^\d+\.\s/, ''))}</li>`); continue;
    }
    // Empty line
    if (!line.trim()) { flush(); continue; }
    // Paragraph
    flush('p');
    pBuf.push(inline(line));
  }
  flush();
  if (inPre) out.push(`<pre><code>${preBuf.join('\n')}</code></pre>`);
  return out.join('\n');
}

function buildHtml(fm: Record<string, string>, bodyHtml: string): string {
  const title = fm.title ?? '筆記';
  const url = fm.url ?? '';
  const source = fm.source ?? '';
  const author = fm.author ?? '';
  const date = fm.date ?? '';
  const category = fm.category ?? '';
  const summary = fm.summary ?? '';
  const tags = (fm.tags ?? '').replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean);

  const metaRows = [
    url
      ? `<div class="meta-row"><span class="label">來源</span><a href="${esc(url)}" target="_blank" rel="noopener">${esc(source || url)}</a></div>`
      : '',
    author ? `<div class="meta-row"><span class="label">作者</span>${esc(author)}</div>` : '',
    date ? `<div class="meta-row"><span class="label">日期</span>${esc(date)}</div>` : '',
    category ? `<div class="meta-row"><span class="label">分類</span>${esc(category)}</div>` : '',
    tags.length
      ? `<div class="meta-row">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      : '',
  ].filter(Boolean).join('\n');

  const summaryHtml = summary
    ? `<p class="summary-text">${esc(summary)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'PingFang TC','Noto Sans TC','Microsoft JhengHei',Helvetica,sans-serif;background:#f5f5f7;color:#1d1d1f;line-height:1.75;padding:2rem 1rem;min-height:100vh}
.wrap{max-width:720px;margin:0 auto}
.card{background:#fff;border-radius:14px;padding:1.5rem;margin-bottom:1.25rem;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.card h1{font-size:1.35rem;font-weight:700;line-height:1.4;margin-bottom:.9rem;color:#1d1d1f}
.meta-row{display:flex;align-items:baseline;gap:.5rem;margin:.3rem 0;font-size:.875rem;color:#555;flex-wrap:wrap}
.label{font-weight:600;color:#1d1d1f;flex-shrink:0}
.tag{background:#f0f0f2;border-radius:5px;padding:2px 8px;font-size:.78rem;color:#555}
.summary-text{font-size:.875rem;color:#666;border-top:1px solid #f0f0f0;margin-top:.8rem;padding-top:.8rem;font-style:italic}
a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
.body{background:#fff;border-radius:14px;padding:1.5rem;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.body h2{font-size:1.05rem;font-weight:600;margin:1.5rem 0 .5rem;padding-bottom:.3rem;border-bottom:1px solid #f0f0f0;color:#1d1d1f}
.body h3{font-size:.95rem;font-weight:600;margin:1rem 0 .35rem;color:#1d1d1f}
.body h4{font-size:.9rem;font-weight:600;margin:.8rem 0 .3rem;color:#444}
.body p{margin:.6rem 0;font-size:.925rem}
.body ul,.body ol{padding-left:1.5rem;margin:.5rem 0}
.body li{margin:.2rem 0;font-size:.925rem}
.body blockquote{border-left:3px solid #e0e0e0;padding:.5rem 1rem;background:#fafafa;margin:.75rem 0;color:#555;font-style:italic;border-radius:0 6px 6px 0}
.body blockquote p{margin:.2rem 0}
.body code{background:#f5f5f7;padding:1px 5px;border-radius:4px;font-family:'SF Mono','Fira Code',monospace;font-size:.87em;color:#c0392b}
.body pre{background:#1c1c1e;border-radius:10px;padding:1rem;overflow-x:auto;margin:.75rem 0}
.body pre code{background:none;color:#e0e0e0;font-size:.85rem;padding:0}
.body hr{border:none;border-top:1px solid #f0f0f0;margin:1.25rem 0}
.body table{width:100%;border-collapse:collapse;margin:.75rem 0;font-size:.875rem}
.body th,.body td{border:1px solid #e8e8e8;padding:.45rem .7rem;text-align:left}
.body th{background:#f5f5f7;font-weight:600}
.body img{max-width:100%;border-radius:8px;margin:.5rem 0;display:block}
.footer{text-align:center;font-size:.75rem;color:#bbb;margin-top:1.25rem;padding:.5rem}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
<h1>${esc(title)}</h1>
${metaRows}
${summaryHtml}
</div>
<div class="body">
${bodyHtml}
</div>
<p class="footer">由 KnowPipe 自動產生</p>
</div>
</body>
</html>`;
}

/** Convert a saved Vault .md note to a clean HTML string. */
export async function renderNoteAsHtml(mdPath: string): Promise<string> {
  const content = await readFile(mdPath, 'utf-8');
  const fm = parseFm(content);
  const body = stripFm(content);
  return buildHtml(fm, convertBody(body));
}

/** Write rendered HTML to a temp file and return its path. Caller must delete after use. */
export async function writeHtmlTemp(mdPath: string): Promise<string> {
  const html = await renderNoteAsHtml(mdPath);
  const base = (mdPath.split('/').pop() ?? 'note').replace(/\.md$/, '');
  const tmpPath = join(tmpdir(), `${base}-${randomUUID().slice(0, 8)}.html`);
  await writeFile(tmpPath, html, 'utf-8');
  return tmpPath;
}
