/**
 * Tests for telegram-backup.ts
 * Covers: env-guard (missing token/channelId), happy-path POST, caption truncation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { backupToTelegram } from './telegram-backup.js';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('backupToTelegram', () => {
  it('returns immediately when BOT_TOKEN is absent', async () => {
    delete process.env.BOT_TOKEN;
    delete process.env.BACKUP_CHANNEL_ID;

    await backupToTelegram('note.md', '# content', { title: 'T', category: 'AI', url: 'https://ex.com' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns immediately when BACKUP_CHANNEL_ID is absent', async () => {
    process.env.BOT_TOKEN = 'tok';
    delete process.env.BACKUP_CHANNEL_ID;

    await backupToTelegram('note.md', '# content', { title: 'T', category: 'AI', url: 'https://ex.com' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('POSTs to sendDocument with correct URL when both env vars are set', async () => {
    process.env.BOT_TOKEN = 'mytoken';
    process.env.BACKUP_CHANNEL_ID = '-100123';

    await backupToTelegram('note.md', '# markdown', { title: 'My Article', category: 'AI', url: 'https://ex.com/a' });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botmytoken/sendDocument');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('caption is at most 1024 characters', async () => {
    process.env.BOT_TOKEN = 'tok';
    process.env.BACKUP_CHANNEL_ID = '-100';

    const longTitle = 'T'.repeat(2000);
    await backupToTelegram('note.md', '# content', { title: longTitle, category: 'AI', url: 'https://ex.com' });

    const formData: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const caption = formData.get('caption') as string;
    expect(caption.length).toBeLessThanOrEqual(1024);
  });

  it('sends the markdown blob as a document attachment', async () => {
    process.env.BOT_TOKEN = 'tok';
    process.env.BACKUP_CHANNEL_ID = '-100';

    const markdown = '# Hello World\nsome content';
    await backupToTelegram('backup.md', markdown, { title: 'T', category: 'Dev', url: 'https://ex.com' });

    const formData: FormData = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(formData.get('chat_id')).toBe('-100');
    // document field should be a Blob/File
    const doc = formData.get('document');
    expect(doc).toBeInstanceOf(Blob);
  });
});
