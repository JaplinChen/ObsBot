/**
 * 架構圖 SVG 產生器 — 從 JSON 規格自動計算版面，消除 LLM 座標錯誤。
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

const COLORS: Record<string, { stroke: string; fill: string }> = {
  cyan:   { stroke: '#22d3ee', fill: 'rgba(8,51,68,0.5)' },
  green:  { stroke: '#34d399', fill: 'rgba(6,78,59,0.5)' },
  purple: { stroke: '#a78bfa', fill: 'rgba(76,29,149,0.5)' },
  amber:  { stroke: '#fbbf24', fill: 'rgba(120,53,15,0.4)' },
  rose:   { stroke: '#fb7185', fill: 'rgba(136,19,55,0.5)' },
  orange: { stroke: '#fb923c', fill: 'rgba(251,146,60,0.4)' },
  slate:  { stroke: '#64748b', fill: 'rgba(30,41,59,0.5)' },
};

const BOX_W = 200;
const BOX_H = 60;
const ROW_SPACING = 110;
const SVG_W = 900;

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
  } catch {
    return null;
  }
}

/** 從 ArchSpec 自動排版並產生 SVG 字串。 */
export function buildArchitectureSvg(spec: ArchSpec): string {
  const nodes = spec.nodes.slice(0, 8);
  if (nodes.length === 0) return '';

  const cols = nodes.length <= 3 ? 1 : nodes.length <= 6 ? 2 : 3;
  const rows = Math.ceil(nodes.length / cols);
  const H = 50 + rows * ROW_SPACING + 40;

  // 每欄中心 x
  const colCx: number[] =
    cols === 1 ? [SVG_W / 2] :
    cols === 2 ? [225, 675] :
                 [175, 450, 725];

  // 計算每個節點位置（box 左上角 x/y + 中心 cx/cy + 欄索引）
  type Pos = { x: number; y: number; cx: number; cy: number; col: number };
  const posMap = new Map<string, Pos>();
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = colCx[col];
    const cy = 50 + row * ROW_SPACING + BOX_H / 2;
    posMap.set(node.id, { x: cx - BOX_W / 2, y: cy - BOX_H / 2, cx, cy, col });
  });

  const lines: string[] = [];

  // SVG 開頭
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${H}" width="${SVG_W}" height="${H}">`);

  // Defs：箭頭 marker
  lines.push('<defs><marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">');
  lines.push('<polygon points="0 0,8 3,0 6" fill="#4b5563"/></marker></defs>');

  // 背景
  lines.push(`<rect width="${SVG_W}" height="${H}" fill="#020617"/>`);

  // 網格
  lines.push('<g stroke="#1e293b" stroke-width="0.5">');
  for (let gx = 40; gx < SVG_W; gx += 40) lines.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${H}"/>`);
  for (let gy = 40; gy < H; gy += 40) lines.push(`<line x1="0" y1="${gy}" x2="${SVG_W}" y2="${gy}"/>`);
  lines.push('</g>');

  // 箭頭連線（先畫，在節點底層）
  for (const edge of spec.edges) {
    const src = posMap.get(edge.from);
    const tgt = posMap.get(edge.to);
    if (!src || !tgt) continue;

    const dx = tgt.cx - src.cx;
    const dy = tgt.cy - src.cy;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    const STROKE = 'stroke="#4b5563" stroke-width="1.5" marker-end="url(#arr)"';
    const FONT10 = `font-size="10" fill="#64748b" font-family="'PingFang TC','Microsoft JhengHei',sans-serif"`;
    let lineEl: string;
    let lx: number, ly: number; // label position

    if (absX >= absY) {
      // 水平主導：直線從左右邊緣出發
      const x1 = dx >= 0 ? src.x + BOX_W : src.x;
      const y1 = src.cy;
      const x2 = dx >= 0 ? tgt.x : tgt.x + BOX_W;
      const y2 = tgt.cy;
      lineEl = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${STROKE}/>`;
      lx = Math.round((x1 + x2) / 2);
      ly = Math.round((y1 + y2) / 2) - 6;
    } else {
      // 垂直主導：貝茲曲線從上下邊緣出發，避免穿越中間節點
      const x1 = src.cx;
      const y1 = dy >= 0 ? src.y + BOX_H : src.y;
      const x2 = tgt.cx;
      const y2 = dy >= 0 ? tgt.y : tgt.y + BOX_H;
      const dist = absY;
      let pathD: string;
      if (src.col === tgt.col) {
        // 同欄：向右彎避免線條穿過中間節點
        const bow = BOX_W / 2 + 40;
        const cpx = src.cx + bow;
        pathD = `M ${x1} ${y1} C ${cpx} ${y1 + dist * 0.35} ${cpx} ${y2 - dist * 0.35} ${x2} ${y2}`;
        lx = Math.round(src.cx + bow * 0.7);
        ly = Math.round((y1 + y2) / 2);
      } else {
        // 不同欄垂直主導：S 型曲線
        pathD = `M ${x1} ${y1} C ${x1} ${y1 + dist * 0.45} ${x2} ${y2 - dist * 0.45} ${x2} ${y2}`;
        lx = Math.round((x1 + x2) / 2);
        ly = Math.round((y1 + y2) / 2) - 6;
      }
      lineEl = `<path d="${pathD}" fill="none" ${STROKE}/>`;
    }

    lines.push(lineEl);
    if (edge.label) {
      lines.push(`<text x="${lx}" y="${ly}" text-anchor="middle" ${FONT10}>${xmlEsc(edge.label)}</text>`);
    }
  }

  // 節點（遮罩 → 框 → 文字）
  const FONT = `font-family="'PingFang TC','Microsoft JhengHei',sans-serif"`;
  for (const node of nodes) {
    const p = posMap.get(node.id);
    if (!p) continue;
    const color = COLORS[node.type ?? ''] ?? COLORS.slate;

    // 遮罩（確保連線不透出邊框）
    lines.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="#0f172a"/>`);
    // 元件框
    lines.push(`<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.5"/>`);

    // 文字
    const label = xmlEsc(clip(node.label, 10));
    if (node.sublabel) {
      const sub = xmlEsc(clip(node.sublabel, 14));
      lines.push(`<text x="${p.cx}" y="${p.y + 22}" text-anchor="middle" font-size="13" font-weight="500" fill="#e2e8f0" ${FONT}>${label}</text>`);
      lines.push(`<text x="${p.cx}" y="${p.y + 42}" text-anchor="middle" font-size="11" fill="#94a3b8" ${FONT}>${sub}</text>`);
    } else {
      lines.push(`<text x="${p.cx}" y="${p.y + 35}" text-anchor="middle" font-size="13" font-weight="500" fill="#e2e8f0" ${FONT}>${label}</text>`);
    }
  }

  // 標題（底部置中）
  if (spec.title) {
    lines.push(`<text x="${SVG_W / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#475569" ${FONT}>${xmlEsc(spec.title)}</text>`);
  }

  lines.push('</svg>');
  return lines.join('\n');
}
