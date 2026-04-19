import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./utils/fetch-with-timeout.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { downloadImage } from './saver-image-downloader.js';
import { writeFile, copyFile } from 'node:fs/promises';
import { fetchWithTimeout } from './utils/fetch-with-timeout.js';

describe('downloadImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('本地路徑走 copyFile', async () => {
    const result = await downloadImage('/tmp/photo.jpg', '/vault/attachments', 'img-001', 'x');
    expect(copyFile).toHaveBeenCalledWith('/tmp/photo.jpg', expect.stringContaining('img-001'));
    expect(result).toMatch(/attachments\/knowpipe\/x\//);
  });

  it('Windows 本地路徑也走 copyFile', async () => {
    const result = await downloadImage('C:\\Users\\test\\photo.png', '/vault', 'img-002', 'reddit');
    expect(copyFile).toHaveBeenCalled();
    expect(result).toContain('img-002');
  });

  it('遠端 URL 走 fetchWithTimeout', async () => {
    const mockRes = {
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: new Map(),
    };
    vi.mocked(fetchWithTimeout).mockResolvedValue(mockRes as never);

    const result = await downloadImage('https://example.com/image.jpg', '/vault', 'img-003', 'web');
    expect(fetchWithTimeout).toHaveBeenCalledWith('https://example.com/image.jpg', 30_000);
    expect(writeFile).toHaveBeenCalled();
    expect(result).toContain('img-003');
  });

  it('HTTP 錯誤拋出例外', async () => {
    const mockRes = { ok: false, status: 403, arrayBuffer: vi.fn() };
    vi.mocked(fetchWithTimeout).mockResolvedValue(mockRes as never);

    await expect(
      downloadImage('https://example.com/forbidden.jpg', '/vault', 'img-004', 'web')
    ).rejects.toThrow('403');
  });
});

describe('semaphore 並發限制', () => {
  it('semaphore 允許至多 3 個並發，第 4 個等待', async () => {
    let activeCount = 0;
    let maxObservedActive = 0;
    const resolvers: Array<() => void> = [];

    vi.mocked(fetchWithTimeout).mockImplementation(() =>
      new Promise<Response>(resolve => {
        activeCount++;
        if (activeCount > maxObservedActive) maxObservedActive = activeCount;
        resolvers.push(() => {
          activeCount--;
          resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as never);
        });
      })
    );

    const promises = [1, 2, 3, 4].map(i =>
      downloadImage(`https://example.com/img${i}.jpg`, '/vault', `img-${i}`, 'web').catch(() => {})
    );

    await new Promise(r => setTimeout(r, 20));
    // 3 個進行中（第 4 個被 semaphore 阻擋）
    expect(activeCount).toBe(3);
    expect(maxObservedActive).toBe(3);

    // 釋放一個，讓第 4 個進來
    resolvers[0]?.();
    await new Promise(r => setTimeout(r, 20));
    resolvers[1]?.();
    resolvers[2]?.();
    resolvers[3]?.();
    await Promise.allSettled(promises);
  });
});
