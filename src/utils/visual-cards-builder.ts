/**
 * Visual knowledge card prompt builder — baoyu-xhs-images style.
 * Generates infographic card prompts from note summaries for use with
 * baoyu-skills or any AI image tool.
 *
 * Card format follows baoyu-xhs-images conventions:
 *   Style × Layout 二維系統
 *   Styles: minimal | notion | bold | fresh | chalkboard
 *   Layouts: dense | balanced | sparse | list | comparison | flow
 */
import { runLocalLlmPrompt } from './local-llm.js';

export interface CardNote {
  title: string;
  category: string;
  summary: string;
  date: string;
}

interface CardSpec {
  title: string;
  category: string;
  keyPoints: string[];
  style: string;
  layout: string;
}

/** Pick baoyu-xhs-images style based on category */
function pickStyle(category: string): string {
  if (/研究|論文|LLM|AI/i.test(category)) return 'minimal';
  if (/開發|工具|程式|code/i.test(category)) return 'notion';
  if (/商業|創業|投資/i.test(category)) return 'bold';
  if (/生活|創作|設計/i.test(category)) return 'fresh';
  return 'minimal';
}

/** Pick baoyu-xhs-images layout based on summary length */
function pickLayout(summary: string): string {
  const pts = summary.split(/[。.！!？?\n]/).filter(s => s.trim().length > 10);
  if (pts.length >= 5) return 'dense';
  if (pts.length >= 3) return 'balanced';
  return 'list';
}

/**
 * Generate baoyu-xhs-images card prompts from recent notes.
 * Returns a formatted message ready to send to user.
 */
export function buildCardsMessage(notes: CardNote[]): string {
  if (notes.length === 0) return '';

  const cards: CardSpec[] = notes.map(n => {
    const pts = n.summary
      .split(/[。.！!？?\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, 5);
    return {
      title: n.title.slice(0, 40),
      category: n.category,
      keyPoints: pts.length > 0 ? pts : [n.summary.slice(0, 80)],
      style: pickStyle(n.category),
      layout: pickLayout(n.summary),
    };
  });

  const lines: string[] = ['🎴 知識卡片（baoyu-xhs-images 格式）', ''];

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    lines.push(`**卡片 ${i + 1}：${c.title}**`);
    lines.push(`分類：${c.category} | 風格：${c.style} | 版面：${c.layout}`);
    if (c.keyPoints.length > 0) lines.push(`重點：${c.keyPoints.slice(0, 3).join('；')}`);
    lines.push('');
  }

  lines.push('📋 Claude Code 指令（貼入後執行）：');
  for (const c of cards) {
    lines.push(`/baoyu-xhs-images "${c.title}" --style ${c.style} --layout ${c.layout}`);
  }

  return lines.join('\n');
}

/**
 * Use LLM to generate a visual prompt for a flow-layout timeline.
 * Summarizes what topics a timeline of posts covers.
 * Returns null on failure.
 */
export async function buildTimelineVisualPrompt(
  username: string,
  posts: Array<{ title: string; category: string; date: string }>,
): Promise<string | null> {
  if (posts.length === 0) return null;

  const summary = posts
    .slice(0, 10)
    .map(p => `[${p.date}] ${p.title.slice(0, 50)}`)
    .join('\n');

  const catCounts: Record<string, number> = {};
  for (const p of posts) catCounts[p.category] = (catCounts[p.category] ?? 0) + 1;
  const topCats = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, n]) => `${c}（${n} 篇）`)
    .join('、');

  const prompt = `你是 AI 視覺提示詞生成師。根據以下用戶貼文時間軸，生成一段手繪風 flow-layout 資訊圖提示詞。

用戶：@${username}
主要主題：${topCats}
最近貼文：
${summary}

請用英文輸出一段 AI 繪圖提示詞，格式：
TYPE: flowchart
LAYOUT: chronological flow, left-to-right arrow sequence, 4-6 topic nodes
LABELS: [各節點的主題關鍵詞]
COLORS: hand-drawn warm palette, cream background #F5F0E8, accent #E8655A
STYLE: hand-drawn-edu, slight wobble lines, educational infographic
ASPECT: 16:9

（不超過 80 words）`;

  try {
    const result = await runLocalLlmPrompt(prompt, {
      task: 'keywords',
      timeoutMs: 25_000,
      maxTokens: 200,
    });
    return result?.trim() ?? null;
  } catch {
    return null;
  }
}
