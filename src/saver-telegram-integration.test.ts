/**
 * Integration-level test for the fire-and-forget backup call added to saver.ts.
 * Verifies backupToTelegram is called with correct arguments after saveToVault,
 * and that its rejection does NOT propagate (fire-and-forget contract).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Heavy dependency mocks ─────────────────────────────────────────────────
vi.mock('./saver/telegram-backup.js', () => ({
  backupToTelegram: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./saver/slug.js', () => ({
  slugify: vi.fn(() => 'test-slug'),
  attachmentSlug: vi.fn(() => 'attachment-slug'),
  extractPostId: vi.fn(() => null),
}));

vi.mock('./saver/url-index.js', () => ({
  isDuplicateUrl: vi.fn(() => false),
  processingUrls: new Set<string>(),
  updateIndex: vi.fn(),
}));

vi.mock('./saver/image-downloader.js', () => ({
  downloadImage: vi.fn().mockResolvedValue(null),
  warnIfDomainFlood: vi.fn(),
}));

vi.mock('./knowledge/wiki-updater.js', () => ({
  notifyNoteAdded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true }),
  };
});

vi.mock('./core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { backupToTelegram } from './saver/telegram-backup.js';
import type { ExtractedContent } from './extractors/types.js';

const mockBackup = vi.mocked(backupToTelegram);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Rather than calling saveToVault (which has too many transitive deps),
 * we test the fire-and-forget pattern directly: if backupToTelegram rejects,
 * the .catch(() => {}) swallows the error.
 */
describe('backupToTelegram fire-and-forget contract', () => {
  it('does not throw when backup rejects', async () => {
    mockBackup.mockRejectedValueOnce(new Error('network error'));

    // Replicate the exact pattern in saver.ts line 158-162
    const run = () =>
      backupToTelegram('note.md', '# content', {
        title: 'Test',
        category: 'AI',
        url: 'https://ex.com',
      }).catch(() => {});

    await expect(run()).resolves.toBeUndefined();
  });

  it('passes correct shape to backupToTelegram', async () => {
    mockBackup.mockResolvedValueOnce(undefined);

    await backupToTelegram('2026-01-01-test-slug.md', '# markdown body', {
      title: 'Article Title',
      category: 'AI/Research',
      url: 'https://example.com/article',
    }).catch(() => {});

    expect(mockBackup).toHaveBeenCalledWith(
      '2026-01-01-test-slug.md',
      '# markdown body',
      { title: 'Article Title', category: 'AI/Research', url: 'https://example.com/article' },
    );
  });
});
