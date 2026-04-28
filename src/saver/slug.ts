import { createHash } from 'node:crypto';
import type { Platform } from '../extractors/types.js';

/** Extract a short, stable ID from a URL for use in filenames */
export function extractPostId(url: string, platform: Platform): string {
  try {
    const u = new URL(url);
    switch (platform) {
      case 'x':
        return u.pathname.match(/\/status\/(\d+)/)?.[1] ?? 'unknown';
      case 'threads':
        return u.pathname.match(/\/post\/([\w-]+)/)?.[1] ?? 'unknown';
      case 'youtube':
        return u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? 'unknown';
      case 'github':
        return u.pathname.split('/').filter(Boolean).slice(0, 3).join('-').slice(0, 40);
      case 'tiktok':
        return u.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? createHash('md5').update(url).digest('hex').slice(0, 8);
      default:
        return createHash('md5').update(url).digest('hex').slice(0, 8);
    }
  } catch {
    return 'unknown';
  }
}

/** Convert a title string into a safe, readable filename slug */
export function slugify(text: string, maxLen = 40): string {
  return text
    .replace(/[：；]/g, '-')
    .replace(/[\\/:*?"<>|，。！？【】「」（）《》\[\](){}]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .trim()
    .slice(0, maxLen)
    .replace(/-$/, '');
}

/** Shorter slug for attachment filenames (spaces → hyphens, tighter limit) */
export function attachmentSlug(text: string): string {
  return text
    .replace(/[\\/:*?"<>|#\[\](){}@]/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, 30)
    .replace(/-$/, '');
}
