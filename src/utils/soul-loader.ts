/**
 * SOUL.md loader — lazy loads and caches the KnowPipe personality definition.
 * Injected into LLM system prompts for user-facing interactions.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let _soul: string | null = null;

/** Load SOUL.md from project root (lazy, cached). Returns empty string if missing. */
export async function loadSoul(): Promise<string> {
  if (_soul !== null) return _soul;
  try {
    _soul = await readFile(join(process.cwd(), 'SOUL.md'), 'utf-8');
  } catch {
    _soul = '';
  }
  return _soul;
}

/** Force reload on next access (e.g. after SOUL.md is edited). */
export function invalidateSoulCache(): void {
  _soul = null;
}
