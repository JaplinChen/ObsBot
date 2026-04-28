import { writeFile, copyFile, readdir, open } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { logger } from '../core/logger.js';

/** Download a single image (or copy a local file) and return the vault-relative path */
export async function downloadImage(
  imageUrl: string,
  destDir: string,
  filename: string,
  platform: string,
): Promise<string> {
  if (/^[a-zA-Z]:[\\/]/.test(imageUrl) || imageUrl.startsWith('/')) {
    const ext = extname(imageUrl) || '.jpg';
    const fullName = `${filename}${ext}`;
    const fullPath = join(destDir, fullName);
    await copyFile(imageUrl, fullPath);
    return `attachments/knowpipe/${platform}/${fullName}`;
  }

  const res = await fetchWithTimeout(imageUrl, 30_000);
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status} ${imageUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extname(new URL(imageUrl).pathname) || '.jpg';
  const fullName = `${filename}${ext}`;
  const fullPath = join(destDir, fullName);
  await writeFile(fullPath, buffer);
  return `attachments/knowpipe/${platform}/${fullName}`;
}

/** Warn when same source domain floods the same category within a time window. */
export async function warnIfDomainFlood(
  url: string,
  notesDir: string,
  opts = { maxSameSource: 5, dayWindowDays: 7 },
): Promise<void> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - opts.dayWindowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let files: string[];
  try {
    files = await readdir(notesDir);
  } catch {
    return;
  }

  let count = 0;
  for (const fname of files) {
    if (!fname.endsWith('.md')) continue;
    const dateMatch = fname.match(/-(\d{4}-\d{2}-\d{2})-[^-]+\.md$/);
    if (!dateMatch || dateMatch[1] < cutoffStr) continue;

    const fpath = join(notesDir, fname);
    try {
      const buf = Buffer.alloc(300);
      const fd = await open(fpath, 'r');
      await fd.read(buf, 0, 300, 0);
      await fd.close();
      const head = buf.toString('utf-8');
      const urlMatch = head.match(/^url:\s*["']?(https?:\/\/[^\s"'\n]+)/m);
      if (!urlMatch) continue;
      const fHost = new URL(urlMatch[1]).hostname.replace(/^www\./, '');
      if (fHost === hostname) count++;
    } catch {
      continue;
    }
  }

  if (count >= opts.maxSameSource) {
    logger.warn('saver', `同來源 domain 近 ${opts.dayWindowDays} 天已有 ${count} 篇，留意是否重複`, {
      hostname,
      count,
      dir: notesDir.split('/').slice(-2).join('/'),
    });
  }
}
