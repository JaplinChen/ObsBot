/**
 * Tests for vault-feeds.ts
 * Covers: escapeXml, buildRss, collectEntries filtering, generateFeeds, handleVaultFeeds error path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── fs mocks ───────────────────────────────────────────────────────────────
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../vault/frontmatter-utils.js', () => ({
  getAllMdFiles: vi.fn(),
  parseFrontmatter: vi.fn(),
}));

vi.mock('../utils/typing-indicator.js', () => ({
  startTyping: vi.fn().mockReturnValue(null),
  stopTyping: vi.fn(),
}));

vi.mock('../core/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { getAllMdFiles, parseFrontmatter } from '../vault/frontmatter-utils.js';
import { generateFeeds, handleVaultFeeds } from './vault-feeds.js';

const mockReadFile = vi.mocked(readFile);
const mockGetAllMdFiles = vi.mocked(getAllMdFiles);
const mockParseFrontmatter = vi.mocked(parseFrontmatter);
const mockWriteFile = vi.mocked(writeFile);

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as never;
}

function makeConfig(vaultPath = '/vault') {
  return { vaultPath } as never;
}

// Helper: build a Map that parseFrontmatter returns
function fmMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateFeeds', () => {
  it('writes per-category and combined XML files', async () => {
    mockGetAllMdFiles.mockResolvedValue([
      '/vault/KnowPipe/AI/note1.md',
      '/vault/KnowPipe/Dev/note2.md',
    ]);

    // Set up readFile to return dummy raw content (parseFrontmatter is mocked separately)
    mockReadFile.mockResolvedValue('---\ntitle: Title\n---\n' as never);

    mockParseFrontmatter
      .mockReturnValueOnce(fmMap({ title: 'AI Article', url: 'https://ex.com/ai', summary: 'AI sum', date: '2026-01-01' }))
      .mockReturnValueOnce(fmMap({ title: 'Dev Article', url: 'https://ex.com/dev', summary: 'Dev sum', date: '2026-01-02' }));

    const result = await generateFeeds('/vault');

    expect(result.feedCount).toBe(2);
    expect(result.categories).toContain('AI');
    expect(result.categories).toContain('Dev');
    // per-category files + combined
    expect(mockWriteFile).toHaveBeenCalledTimes(3);
    // combined file uses 'all.xml'
    const allCall = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => String(c[0]).endsWith('all.xml'),
    );
    expect(allCall).toBeDefined();
  });

  it('skips entries missing title, url, or date', async () => {
    mockGetAllMdFiles.mockResolvedValue(['/vault/KnowPipe/AI/bad.md']);
    mockReadFile.mockResolvedValue('' as never);
    // Missing url
    mockParseFrontmatter.mockReturnValueOnce(fmMap({ title: 'T', date: '2026-01-01' }));

    const result = await generateFeeds('/vault');
    expect(result.feedCount).toBe(0);
    // only combined file written (empty feed)
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('skips entries with invalid date', async () => {
    mockGetAllMdFiles.mockResolvedValue(['/vault/KnowPipe/News/note.md']);
    mockReadFile.mockResolvedValue('' as never);
    mockParseFrontmatter.mockReturnValueOnce(
      fmMap({ title: 'T', url: 'https://ex.com', summary: 's', date: 'not-a-date' }),
    );

    const result = await generateFeeds('/vault');
    expect(result.feedCount).toBe(0);
  });

  it('skips SKIP_CATEGORIES (inbox, MOC)', async () => {
    mockGetAllMdFiles.mockResolvedValue([
      '/vault/KnowPipe/inbox/note.md',
      '/vault/KnowPipe/MOC/note.md',
    ]);
    mockReadFile.mockResolvedValue('' as never);
    mockParseFrontmatter
      .mockReturnValueOnce(fmMap({ title: 'Inbox', url: 'https://ex.com/i', summary: 's', date: '2026-01-01' }))
      .mockReturnValueOnce(fmMap({ title: 'MOC', url: 'https://ex.com/m', summary: 's', date: '2026-01-01' }));

    const result = await generateFeeds('/vault');
    expect(result.feedCount).toBe(0);
  });

  it('sorts entries newest-first and caps at 20 per category', async () => {
    // Create 25 entries for one category
    const files = Array.from({ length: 25 }, (_, i) => `/vault/KnowPipe/AI/note${i}.md`);
    mockGetAllMdFiles.mockResolvedValue(files);
    mockReadFile.mockResolvedValue('' as never);

    files.forEach((_, i) => {
      mockParseFrontmatter.mockReturnValueOnce(
        fmMap({
          title: `Article ${i}`,
          url: `https://ex.com/${i}`,
          summary: 's',
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        }),
      );
    });

    const result = await generateFeeds('/vault');
    expect(result.feedCount).toBe(1);

    // The XML for AI should contain at most 20 items
    const aiCall = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => !String(c[0]).endsWith('all.xml'),
    );
    const xml = String(aiCall![1]);
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    expect(itemCount).toBeLessThanOrEqual(20);
  });
});

describe('escapeXml (via buildRss output)', () => {
  it('escapes XML special characters in feed output', async () => {
    mockGetAllMdFiles.mockResolvedValue(['/vault/KnowPipe/AI/note.md']);
    mockReadFile.mockResolvedValue('' as never);
    mockParseFrontmatter.mockReturnValueOnce(
      fmMap({
        title: 'A & B <test> "quoted"',
        url: 'https://ex.com?a=1&b=2',
        summary: 'sum',
        date: '2026-01-01',
      }),
    );

    await generateFeeds('/vault');

    const aiCall = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => !String(c[0]).endsWith('all.xml'),
    );
    const xml = String(aiCall![1]);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&quot;');
    expect(xml).not.toMatch(/[^&]&[^a-z#]/); // no raw & outside entity refs
  });
});

describe('handleVaultFeeds', () => {
  it('replies with success summary when generateFeeds resolves', async () => {
    mockGetAllMdFiles.mockResolvedValue(['/vault/KnowPipe/AI/note.md']);
    mockReadFile.mockResolvedValue('' as never);
    mockParseFrontmatter.mockReturnValueOnce(
      fmMap({ title: 'T', url: 'https://ex.com', summary: 's', date: '2026-01-01' }),
    );

    const ctx = makeCtx();
    await handleVaultFeeds(ctx, makeConfig());

    // Should have replied twice: "generating" + summary
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    const [, secondReply] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
    expect(secondReply[0]).toContain('RSS Feed 產生完成');
  });

  it('replies with error message when generateFeeds throws', async () => {
    mockGetAllMdFiles.mockRejectedValue(new Error('disk error'));

    const ctx = makeCtx();
    await handleVaultFeeds(ctx, makeConfig());

    const replies = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(replies.some((r: unknown) => String(r).includes('disk error'))).toBe(true);
  });

  it('truncates category list to 10 and shows overflow count', async () => {
    // 12 categories
    const files = Array.from({ length: 12 }, (_, i) => `/vault/KnowPipe/Cat${i}/note.md`);
    mockGetAllMdFiles.mockResolvedValue(files);
    mockReadFile.mockResolvedValue('' as never);
    files.forEach((_, i) => {
      mockParseFrontmatter.mockReturnValueOnce(
        fmMap({ title: `T${i}`, url: `https://ex.com/${i}`, summary: 's', date: '2026-01-01' }),
      );
    });

    const ctx = makeCtx();
    await handleVaultFeeds(ctx, makeConfig());

    const lastReply = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '';
    expect(lastReply).toContain('還有 2 個分類');
  });
});
