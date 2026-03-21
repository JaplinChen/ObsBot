import { describe, it, expect } from 'vitest';
import { detectTrends, detectCategoryGaps } from './trend-detector.js';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('detectTrends', () => {
  it('detects new keywords with 2+ recent mentions', () => {
    const notes = [
      { date: daysAgo(1), category: 'AI', keywords: ['mcp', 'agent'] },
      { date: daysAgo(2), category: 'AI', keywords: ['mcp', 'tool'] },
    ];
    const trends = detectTrends(notes, 3, 14);
    const mcpTrend = trends.find(t => t.keyword === 'mcp');
    expect(mcpTrend).toBeDefined();
    expect(mcpTrend!.recentCount).toBe(2);
    expect(mcpTrend!.previousCount).toBe(0);
    expect(mcpTrend!.growthRate).toBe(Infinity);
  });

  it('ignores single-mention new keywords', () => {
    const notes = [
      { date: daysAgo(1), category: 'AI', keywords: ['rare-keyword'] },
    ];
    const trends = detectTrends(notes, 3, 14);
    expect(trends.find(t => t.keyword === 'rare-keyword')).toBeUndefined();
  });

  it('detects growth spikes vs previous period', () => {
    const notes = [
      // Previous period: 1 mention
      { date: daysAgo(7), category: 'AI', keywords: ['react'] },
      // Recent period: 5 mentions (3 days) → normalized = 5 * (14/3) ≈ 23 >> 1 * 2
      { date: daysAgo(0), category: 'AI', keywords: ['react'] },
      { date: daysAgo(1), category: 'AI', keywords: ['react'] },
      { date: daysAgo(1), category: 'AI', keywords: ['react'] },
      { date: daysAgo(2), category: 'AI', keywords: ['react'] },
      { date: daysAgo(2), category: 'AI', keywords: ['react'] },
    ];
    const trends = detectTrends(notes, 3, 14);
    const reactTrend = trends.find(t => t.keyword === 'react');
    expect(reactTrend).toBeDefined();
    expect(reactTrend!.recentCount).toBe(5);
    expect(reactTrend!.previousCount).toBe(1);
    expect(reactTrend!.growthRate).toBeGreaterThan(0);
  });

  it('returns empty for stable keywords', () => {
    // Recent: 1, Previous: 10 → normalized = 1 * (14/3) ≈ 4.67 < 10 * 2 = 20
    const notes = [
      { date: daysAgo(1), category: 'AI', keywords: ['stable'] },
      ...Array.from({ length: 10 }, (_, i) => ({
        date: daysAgo(5 + i),
        category: 'AI',
        keywords: ['stable'],
      })),
    ];
    const trends = detectTrends(notes, 3, 14);
    expect(trends.find(t => t.keyword === 'stable')).toBeUndefined();
  });

  it('limits results to 10', () => {
    const notes = Array.from({ length: 20 }, (_, i) => ({
      date: daysAgo(1),
      category: 'AI',
      keywords: [`kw-${i}`],
    }));
    // Duplicate each to hit the 2-mention threshold
    notes.push(...notes.map(n => ({ ...n, date: daysAgo(2) })));
    const trends = detectTrends(notes, 3, 14);
    expect(trends.length).toBeLessThanOrEqual(10);
  });

  it('is case insensitive', () => {
    const notes = [
      { date: daysAgo(1), category: 'AI', keywords: ['MCP'] },
      { date: daysAgo(2), category: 'AI', keywords: ['mcp'] },
    ];
    const trends = detectTrends(notes, 3, 14);
    expect(trends.find(t => t.keyword === 'mcp')?.recentCount).toBe(2);
  });

  it('skips notes with invalid dates', () => {
    const notes = [
      { date: 'not-a-date', category: 'AI', keywords: ['bad'] },
      { date: 'not-a-date', category: 'AI', keywords: ['bad'] },
    ];
    const trends = detectTrends(notes, 3, 14);
    expect(trends).toHaveLength(0);
  });
});

describe('detectCategoryGaps', () => {
  it('detects inactive categories', () => {
    const notes = [
      { date: daysAgo(30), category: 'DevOps', keywords: [] },
      { date: daysAgo(1), category: 'AI', keywords: [] },
    ];
    const gaps = detectCategoryGaps(notes, 14);
    expect(gaps.find(g => g.category === 'DevOps')).toBeDefined();
    expect(gaps.find(g => g.category === 'AI')).toBeUndefined();
  });

  it('uses top-level category (splits on /)', () => {
    const notes = [
      { date: daysAgo(20), category: 'AI/NLP', keywords: [] },
      { date: daysAgo(5), category: 'AI/Vision', keywords: [] },
    ];
    const gaps = detectCategoryGaps(notes, 14);
    // AI last active 5 days ago → not a gap
    expect(gaps.find(g => g.category === 'AI')).toBeUndefined();
  });

  it('returns empty when all categories are active', () => {
    const notes = [
      { date: daysAgo(1), category: 'AI', keywords: [] },
      { date: daysAgo(2), category: 'DevOps', keywords: [] },
    ];
    const gaps = detectCategoryGaps(notes, 14);
    expect(gaps).toHaveLength(0);
  });

  it('sorts by most inactive first', () => {
    const notes = [
      { date: daysAgo(30), category: 'Old', keywords: [] },
      { date: daysAgo(60), category: 'Ancient', keywords: [] },
      { date: daysAgo(1), category: 'Active', keywords: [] },
    ];
    const gaps = detectCategoryGaps(notes, 14);
    expect(gaps[0].category).toBe('Ancient');
    expect(gaps[1].category).toBe('Old');
  });
});
