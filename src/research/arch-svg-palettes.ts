/**
 * 架構圖風格調色盤定義 — dark / sketch / minimal / retro / blueprint / pastel
 */

export type ArchStyle = 'dark' | 'sketch' | 'minimal' | 'retro' | 'blueprint' | 'pastel';

export type CompactPalette = { stroke: string; fill: string };
export type RichPalette    = { stroke: string; fill: string; text: string; icon: string };

// ─── 暗黑科技 ─────────────────────────────────────────────────────────────────
export const DARK_P: Record<string, CompactPalette> = {
  cyan:   { stroke: '#22d3ee', fill: 'rgba(8,51,68,0.5)' },
  green:  { stroke: '#34d399', fill: 'rgba(6,78,59,0.5)' },
  purple: { stroke: '#a78bfa', fill: 'rgba(76,29,149,0.5)' },
  amber:  { stroke: '#fbbf24', fill: 'rgba(120,53,15,0.4)' },
  rose:   { stroke: '#fb7185', fill: 'rgba(136,19,55,0.5)' },
  orange: { stroke: '#fb923c', fill: 'rgba(251,146,60,0.4)' },
  slate:  { stroke: '#64748b', fill: 'rgba(30,41,59,0.5)' },
};

// ─── 復古終端機 ───────────────────────────────────────────────────────────────
export const RETRO_P: Record<string, CompactPalette> = {
  cyan:   { stroke: '#00ff41', fill: 'rgba(0,30,10,0.6)' },
  green:  { stroke: '#33ff57', fill: 'rgba(0,25,8,0.6)' },
  purple: { stroke: '#39ff14', fill: 'rgba(5,40,5,0.6)' },
  amber:  { stroke: '#66ff77', fill: 'rgba(5,38,10,0.5)' },
  rose:   { stroke: '#00e639', fill: 'rgba(0,30,8,0.5)' },
  orange: { stroke: '#00d438', fill: 'rgba(0,28,8,0.6)' },
  slate:  { stroke: '#009926', fill: 'rgba(0,15,5,0.6)' },
};

// ─── 工程藍圖 ─────────────────────────────────────────────────────────────────
export const BLUEPRINT_P: Record<string, CompactPalette> = {
  cyan:   { stroke: '#93c5fd', fill: 'rgba(255,255,255,0.07)' },
  green:  { stroke: '#6ee7b7', fill: 'rgba(255,255,255,0.07)' },
  purple: { stroke: '#c4b5fd', fill: 'rgba(255,255,255,0.07)' },
  amber:  { stroke: '#fcd34d', fill: 'rgba(255,255,255,0.07)' },
  rose:   { stroke: '#fca5a5', fill: 'rgba(255,255,255,0.07)' },
  orange: { stroke: '#fdba74', fill: 'rgba(255,255,255,0.07)' },
  slate:  { stroke: '#94a3b8', fill: 'rgba(255,255,255,0.05)' },
};

// ─── 手繪插畫 ─────────────────────────────────────────────────────────────────
export const SKETCH_P: Record<string, RichPalette> = {
  cyan:   { stroke: '#7dd3fc', fill: '#e0f7ff', text: '#0c4a6e', icon: '🖥' },
  green:  { stroke: '#86efac', fill: '#f0fdf4', text: '#14532d', icon: '⚙️' },
  purple: { stroke: '#c4b5fd', fill: '#faf5ff', text: '#4c1d95', icon: '🗄️' },
  amber:  { stroke: '#fcd34d', fill: '#fffbeb', text: '#78350f', icon: '☁️' },
  rose:   { stroke: '#fda4af', fill: '#fff1f2', text: '#881337', icon: '🛡️' },
  orange: { stroke: '#fdba74', fill: '#fff7ed', text: '#7c2d12', icon: '📨' },
  slate:  { stroke: '#cbd5e1', fill: '#f8fafc', text: '#334155', icon: '📦' },
};

// ─── 簡約白 ───────────────────────────────────────────────────────────────────
export const MINIMAL_P: Record<string, RichPalette> = {
  cyan:   { stroke: '#bae6fd', fill: '#ffffff', text: '#0369a1', icon: '' },
  green:  { stroke: '#bbf7d0', fill: '#ffffff', text: '#15803d', icon: '' },
  purple: { stroke: '#ddd6fe', fill: '#ffffff', text: '#7e22ce', icon: '' },
  amber:  { stroke: '#fde68a', fill: '#ffffff', text: '#b45309', icon: '' },
  rose:   { stroke: '#fecdd3', fill: '#ffffff', text: '#be123c', icon: '' },
  orange: { stroke: '#fed7aa', fill: '#ffffff', text: '#c2410c', icon: '' },
  slate:  { stroke: '#e2e8f0', fill: '#ffffff', text: '#475569', icon: '' },
};

// ─── 粉彩 ─────────────────────────────────────────────────────────────────────
export const PASTEL_P: Record<string, RichPalette> = {
  cyan:   { stroke: '#67e8f9', fill: '#f0fdff', text: '#155e75', icon: '🌊' },
  green:  { stroke: '#86efac', fill: '#f0fdf4', text: '#166534', icon: '🌿' },
  purple: { stroke: '#d8b4fe', fill: '#fdf4ff', text: '#6b21a8', icon: '🌸' },
  amber:  { stroke: '#fde68a', fill: '#fffbeb', text: '#92400e', icon: '🌻' },
  rose:   { stroke: '#fda4af', fill: '#fff1f2', text: '#9f1239', icon: '🌹' },
  orange: { stroke: '#fdba74', fill: '#fff7ed', text: '#9a3412', icon: '🍊' },
  slate:  { stroke: '#cbd5e1', fill: '#f8fafc', text: '#475569', icon: '🪨' },
};
