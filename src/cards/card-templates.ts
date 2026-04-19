/**
 * HTML template for info card generation.
 * Produces a 800x420px card with magazine-style layout.
 */
import type { CardData } from './card-types.js';

/** Escape HTML entities. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Truncate text to max length with ellipsis. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Generate HTML string for the info card. */
export function renderCardHtml(data: CardData, fontFaceCSS = ''): string {
  const title = escHtml(truncate(data.title, 60));
  const summary = escHtml(truncate(data.summary, 120));
  const category = escHtml(data.category);
  const platform = escHtml(data.platform);
  const date = escHtml(data.date);
  const keywords = data.keywords.slice(0, 4).map(k => escHtml(k));
  const accent = data.accentColor;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${fontFaceCSS}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 420px;
    font-family: "Noto Sans TC", "PingFang TC", "Hiragino Sans GB", "STHeiti", "Microsoft JhengHei", system-ui, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    overflow: hidden;
  }
  .card {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    padding: 40px 48px 32px;
    position: relative;
  }
  .accent-bar {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 5px;
    background: ${accent};
  }
  .meta {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 20px;
    font-size: 14px; color: #94a3b8;
  }
  .meta .badge {
    background: ${accent}22;
    color: ${accent};
    padding: 3px 10px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 13px;
  }
  .title {
    font-size: 28px; font-weight: 700;
    line-height: 1.3;
    margin-bottom: 16px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .summary {
    font-size: 16px; line-height: 1.6;
    color: #cbd5e1;
    flex: 1;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .footer {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: auto; padding-top: 20px;
    border-top: 1px solid #1e293b;
  }
  .keywords {
    display: flex; gap: 8px;
  }
  .kw {
    background: #1e293b;
    color: #94a3b8;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  .brand {
    font-size: 12px; color: #475569;
    font-weight: 600;
  }
</style>
</head>
<body>
<div class="card">
  <div class="accent-bar"></div>
  <div class="meta">
    <span class="badge">${category}</span>
    <span>${platform}</span>
    <span>•</span>
    <span>${date}</span>
  </div>
  <div class="title">${title}</div>
  <div class="summary">${summary}</div>
  <div class="footer">
    <div class="keywords">
      ${keywords.map(k => `<span class="kw">${k}</span>`).join('')}
    </div>
    <span class="brand">KnowPipe</span>
  </div>
</div>
</body>
</html>`;
}
