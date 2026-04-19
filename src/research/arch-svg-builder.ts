/**
 * 架構圖 SVG 產生器 — 支援 dark / sketch / minimal 三種風格。
 */

export interface ArchNode {
  id: string;
  label: string;
  sublabel?: string;
  type?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ArchSpec {
  title?: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export type ArchStyle = 'dark' | 'sketch' | 'minimal';

// ─── 風格設定 ────────────────────────────────────────────────────────────────

type PaletteEntry = { stroke: string; fill: string; text: string; icon: string };

const DARK_PALETTE: Record<string, { stroke: string; fill: string }> = {
  cyan:   { stroke: '#22d3ee', fill: 'rgba(8,51,68,0.5)' },
  green:  { stroke: '#34d399', fill: 'rgba(6,78,59,0.5)' },
  purple: { stroke: '#a78bfa', fill: 'rgba(76,29,149,0.5)' },
  amber:  { stroke: '#fbbf24', fill: 'rgba(120,53,15,0.4)' },
  rose:   { stroke: '#fb7185', fill: 'rgba(136,19,55,0.5)' },
  orange: { stroke: '#fb923c', fill: 'rgba(251,146,60,0.4)' },
  slate:  { stroke: '#64748b', fill: 'rgba(30,41,59,0.5)' },
};

const SKETCH_PALETTE: Record<string, PaletteEntry> = {
  cyan:   { stroke: '#7dd3fc', fill: '#e0f7ff', text: '#0c4a6e', icon: '🖥' },
  green:  { stroke: '#86efac', fill: '#f0fdf4', text: '#14532d', icon: '⚙️' },
  purple: { stroke: '#c4b5fd', fill: '#faf5ff', text: '#4c1d95', icon: '🗄️' },
  amber:  { stroke: '#fcd34d', fill: '#fffbeb', text: '#78350f', icon: '☁️' },
  rose:   { stroke: '#fda4af', fill: '#fff1f2', text: '#881337', icon: '🛡️' },
  orange: { stroke: '#fdba74', fill: '#fff7ed', text: '#7c2d12', icon: '📨' },
  slate:  { stroke: '#cbd5e1', fill: '#f8fafc', text: '#334155', icon: '📦' },
};

const MINIMAL_PALETTE: Record<string, PaletteEntry> = {
  cyan:   { stroke: '#bae6fd', fill: '#ffffff', text: '#0369a1', icon: '' },
  green:  { stroke: '#bbf7d0', fill: '#ffffff', text: '#15803d', icon: '' },
  purple: { stroke: '#ddd6fe', fill: '#ffffff', text: '#7e22ce', icon: '' },
  amber:  { stroke: '#fde68a', fill: '#ffffff', text: '#b45309', icon: '' },
  rose:   { stroke: '#fecdd3', fill: '#ffffff', text: '#be123c', icon: '' },
  orange: { stroke: '#fed7aa', fill: '#ffffff', text: '#c2410c', icon: '' },
  slate:  { stroke: '#e2e8f0', fill: '#ffffff', text: '#475569', icon: '' },
};

// ─── 常數 ────────────────────────────────────────────────────────────────────

const BOX_W = 175;
const DARK_H = 60;
const RICH_H = 88; // sketch / minimal（留空間給 icon）
const ROW_SPACING_DARK = 110;
const ROW_SPACING_RICH = 128;
const SVG_W = 900;
const FONT_BASE = `font-family="'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif"`;

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** LLM 輸出中提取 ArchSpec JSON。 */
export function parseArchSpec(text: string): ArchSpec | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let jsonStr = fenced ? fenced[1] : '';
  if (!jsonStr) {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s >= 0 && e > s) jsonStr = text.slice(s, e + 1);
  }
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr) as ArchSpec;
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;
    return obj;
  } catch { return null; }
}

// ─── 連線繪製（共用）────────────────────────────────────────────────────────

type Pos = { x: number; y: number; cx: number; cy: number; col: number };

function buildEdges(
  edges: ArchEdge[],
  posMap: Map<string, Pos>,
  boxH: number,
  arrowColor: string,
  labelBg: string,
): string[] {
  const lines: string[] = [];
  const STROKE = `stroke="${arrowColor}" stroke-width="2" fill="none" marker-end="url(#arr)"`;
  const FONT10 = `font-size="10" fill="${arrowColor}" ${FONT_BASE}`;

  for (const edge of edges) {
    const src = posMap.get(edge.from);
    const tgt = posMap.get(edge.to);
    if (!src || !tgt) continue;
    const dx = tgt.cx - src.cx;
    const dy = tgt.cy - src.cy;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    let lineEl: string;
    let lx = 0, ly = 0;

    if (absX >= absY) {
      const x1 = dx >= 0 ? src.x + BOX_W : src.x;
      const y1 = src.cy;
      const x2 = dx >= 0 ? tgt.x : tgt.x + BOX_W;
      const y2 = tgt.cy;
      lineEl = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${STROKE}/>`;
      lx = Math.round((x1 + x2) / 2);
      ly = Math.round((y1 + y2) / 2) - 7;
    } else {
      const x1 = src.cx;
      const y1 = dy >= 0 ? src.y + boxH : src.y;
      const x2 = tgt.cx;
      const y2 = dy >= 0 ? tgt.y : tgt.y + boxH;
      let pathD: string;
      if (src.col === tgt.col) {
        const bow = BOX_W / 2 + 40;
        const cpx = src.cx + bow;
        pathD = `M ${x1} ${y1} C ${cpx} ${y1 + dy * 0.35} ${cpx} ${y2 - dy * 0.35} ${x2} ${y2}`;
        lx = Math.round(src.cx + bow * 0.7);
        ly = Math.round((y1 + y2) / 2);
      } else {
        pathD = `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.45} ${x2} ${y2 - dy * 0.45} ${x2} ${y2}`;
        lx = Math.round((x1 + x2) / 2);
        ly = Math.round((y1 + y2) / 2) - 7;
      }
      lineEl = `<path d="${pathD}" ${STROKE}/>`;
    }

    lines.push(lineEl);
    if (edge.label) {
      lines.push(`<rect x="${lx - 22}" y="${ly - 11}" width="44" height="14" rx="3" fill="${labelBg}"/>`);
      lines.push(`<text x="${lx}" y="${ly}" text-anchor="middle" ${FONT10}>${xmlEsc(edge.label)}</text>`);
    }
  }
  return lines;
}

// ─── 主要產生函式 ─────────────────────────────────────────────────────────────

/** 從 ArchSpec 自動排版並產生 SVG 字串，支援 dark / sketch / minimal 風格。 */
export function buildArchitectureSvg(spec: ArchSpec, style: ArchStyle = 'sketch'): string {
  const nodes = spec.nodes.slice(0, 8);
  if (nodes.length === 0) return '';

  const isDark = style === 'dark';
  const boxH = isDark ? DARK_H : RICH_H;
  const rowSpacing = isDark ? ROW_SPACING_DARK : ROW_SPACING_RICH;
  const topPad = isDark ? 50 : 60;
  const botPad = isDark ? 40 : 50;

  const cols = nodes.length <= 3 ? 1 : nodes.length <= 6 ? 2 : 3;
  const rows = Math.ceil(nodes.length / cols);
  const H = topPad + rows * rowSpacing + botPad;
  const colCx: number[] =
    cols === 1 ? [SVG_W / 2] :
    cols === 2 ? [225, 675] :
                 [175, 450, 725];

  const posMap = new Map<string, Pos>();
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = colCx[col];
    const cy = topPad + row * rowSpacing + boxH / 2;
    posMap.set(node.id, { x: cx - BOX_W / 2, y: cy - boxH / 2, cx, cy, col });
  });

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${H}" width="${SVG_W}" height="${H}">`);

  // ── defs ──
  out.push('<defs>');
  if (style === 'dark') {
    out.push('<marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">');
    out.push('<polygon points="0 0,8 3,0 6" fill="#4b5563"/></marker>');
  } else if (style === 'sketch') {
    out.push('<filter id="shadow" x="-15%" y="-15%" width="130%" height="130%">');
    out.push('<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="rgba(0,0,0,0.09)"/></filter>');
    out.push('<filter id="skw" x="-4%" y="-4%" width="108%" height="108%">');
    out.push('<feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="n"/>');
    out.push('<feDisplacementMap in="SourceGraphic" in2="n" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter>');
    out.push('<marker id="arr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">');
    out.push('<polygon points="0 0,10 3.5,0 7" fill="#94a3b8"/></marker>');
  } else {
    out.push('<filter id="shadow" x="-15%" y="-15%" width="130%" height="130%">');
    out.push('<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.06)"/></filter>');
    out.push('<marker id="arr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">');
    out.push('<polygon points="0 0,10 3.5,0 7" fill="#cbd5e1"/></marker>');
  }
  out.push('</defs>');

  // ── 背景 ──
  if (isDark) {
    out.push(`<rect width="${SVG_W}" height="${H}" fill="#020617"/>`);
    out.push('<g stroke="#1e293b" stroke-width="0.5">');
    for (let gx = 40; gx < SVG_W; gx += 40) out.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${H}"/>`);
    for (let gy = 40; gy < H; gy += 40) out.push(`<line x1="0" y1="${gy}" x2="${SVG_W}" y2="${gy}"/>`);
    out.push('</g>');
  } else {
    const bg = style === 'sketch' ? '#fafaf9' : '#ffffff';
    out.push(`<rect width="${SVG_W}" height="${H}" fill="${bg}"/>`);
  }

  // ── 標題 ──
  if (spec.title) {
    const titleColor = isDark ? '#94a3b8' : '#1e293b';
    const titleY = isDark ? H - 10 : 34;
    const anchor = isDark ? 'middle' : 'middle';
    out.push(`<text x="${SVG_W / 2}" y="${titleY}" text-anchor="${anchor}" font-size="16" font-weight="700" fill="${titleColor}" ${FONT_BASE}>${xmlEsc(spec.title)}</text>`);
  }

  // ── 連線 ──
  const arrowColor = isDark ? '#4b5563' : style === 'sketch' ? '#94a3b8' : '#cbd5e1';
  const labelBg = isDark ? 'rgba(2,6,23,0.8)' : style === 'sketch' ? 'rgba(250,250,249,0.85)' : 'rgba(255,255,255,0.9)';
  out.push(...buildEdges(spec.edges, posMap, boxH, arrowColor, labelBg));

  // ── 節點 ──
  for (const node of nodes) {
    const p = posMap.get(node.id);
    if (!p) continue;

    if (isDark) {
      const c = DARK_PALETTE[node.type ?? ''] ?? DARK_PALETTE.slate;
      out.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${boxH}" rx="8" fill="#0f172a"/>`);
      out.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${boxH}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`);
      const label = xmlEsc(clip(node.label, 10));
      if (node.sublabel) {
        const sub = xmlEsc(clip(node.sublabel, 14));
        out.push(`<text x="${p.cx}" y="${p.y + 22}" text-anchor="middle" font-size="13" font-weight="500" fill="#e2e8f0" ${FONT_BASE}>${label}</text>`);
        out.push(`<text x="${p.cx}" y="${p.y + 42}" text-anchor="middle" font-size="11" fill="#94a3b8" ${FONT_BASE}>${sub}</text>`);
      } else {
        out.push(`<text x="${p.cx}" y="${p.y + 35}" text-anchor="middle" font-size="13" font-weight="500" fill="#e2e8f0" ${FONT_BASE}>${label}</text>`);
      }

    } else if (style === 'sketch') {
      const c = SKETCH_PALETTE[node.type ?? ''] ?? SKETCH_PALETTE.slate;
      out.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${boxH}" rx="14" fill="${c.fill}" filter="url(#shadow)"/>`);
      out.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${boxH}" rx="14" fill="none" stroke="${c.stroke}" stroke-width="2.2" filter="url(#skw)"/>`);
      out.push(`<text x="${p.cx}" y="${p.y + 34}" text-anchor="middle" font-size="22" ${FONT_BASE}>${c.icon}</text>`);
      const label = xmlEsc(clip(node.label, 10));
      if (node.sublabel) {
        const sub = xmlEsc(clip(node.sublabel, 14));
        out.push(`<text x="${p.cx}" y="${p.y + 58}" text-anchor="middle" font-size="13" font-weight="700" fill="${c.text}" ${FONT_BASE}>${label}</text>`);
        out.push(`<text x="${p.cx}" y="${p.y + 74}" text-anchor="middle" font-size="10" fill="${c.stroke}" ${FONT_BASE}>${sub}</text>`);
      } else {
        out.push(`<text x="${p.cx}" y="${p.y + 62}" text-anchor="middle" font-size="13" font-weight="700" fill="${c.text}" ${FONT_BASE}>${label}</text>`);
      }

    } else { // minimal
      const c = MINIMAL_PALETTE[node.type ?? ''] ?? MINIMAL_PALETTE.slate;
      out.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${boxH}" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5" filter="url(#shadow)"/>`);
      // 頂部色條
      out.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="4" rx="10" fill="${c.stroke}"/>`);
      out.push(`<rect x="${p.x}" y="${p.y + 2}" width="${BOX_W}" height="4" fill="${c.stroke}"/>`);
      const label = xmlEsc(clip(node.label, 10));
      if (node.sublabel) {
        const sub = xmlEsc(clip(node.sublabel, 14));
        out.push(`<text x="${p.cx}" y="${p.y + 42}" text-anchor="middle" font-size="13" font-weight="700" fill="${c.text}" ${FONT_BASE}>${label}</text>`);
        out.push(`<text x="${p.cx}" y="${p.y + 60}" text-anchor="middle" font-size="10" fill="#94a3b8" ${FONT_BASE}>${sub}</text>`);
      } else {
        out.push(`<text x="${p.cx}" y="${p.y + 50}" text-anchor="middle" font-size="13" font-weight="700" fill="${c.text}" ${FONT_BASE}>${label}</text>`);
      }
    }
  }

  out.push('</svg>');
  return out.join('\n');
}
