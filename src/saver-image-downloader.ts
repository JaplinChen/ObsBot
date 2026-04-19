import { writeFile, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fetchWithTimeout } from './utils/fetch-with-timeout.js';

const IMAGE_CONCURRENCY = 3;

function createSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>(resolve => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const imageLimit = createSemaphore(IMAGE_CONCURRENCY);

/** Download a single image (or copy a local file) and return the vault-relative path. Max 3 concurrent. */
export async function downloadImage(
  imageUrl: string,
  destDir: string,
  filename: string,
  platform: string,
): Promise<string> {
  return imageLimit(async () => {
    if (/^[a-zA-Z]:[\\/]/.test(imageUrl) || imageUrl.startsWith('/')) {
      const ext = extname(imageUrl) || '.jpg';
      const fullName = `${filename}${ext}`;
      await copyFile(imageUrl, join(destDir, fullName));
      return `attachments/knowpipe/${platform}/${fullName}`;
    }

    const res = await fetchWithTimeout(imageUrl, 30_000);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${imageUrl}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = extname(new URL(imageUrl).pathname) || '.jpg';
    const fullName = `${filename}${ext}`;
    await writeFile(join(destDir, fullName), buffer);
    return `attachments/knowpipe/${platform}/${fullName}`;
  });
}
