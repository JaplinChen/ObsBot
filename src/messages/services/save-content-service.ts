import { rm } from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import type { ExtractedContent } from '../../extractors/types.js';
import { saveToVault, type SaveResult } from '../../saver.js';

export async function saveExtractedContent(content: ExtractedContent, vaultPath: string): Promise<SaveResult> {
  const result = await saveToVault(content, vaultPath);
  if (content.tempDir) {
    rm(content.tempDir, { recursive: true, force: true }).catch(() => {});
  }
  logger.info('msg', 'saved', { mdPath: result.mdPath });
  return result;
}
