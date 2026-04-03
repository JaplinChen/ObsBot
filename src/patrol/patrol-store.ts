/**
 * Persistent storage for patrol configuration.
 */
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import type { PatrolConfig } from './patrol-types.js';
import { DEFAULT_PATROL_CONFIG } from './patrol-types.js';

const STORE_PATH = join(process.cwd(), 'data', 'patrol-config.json');

export async function loadPatrolConfig(): Promise<PatrolConfig> {
  const loaded = await safeReadJSON<Partial<PatrolConfig>>(STORE_PATH, {});
  return { ...DEFAULT_PATROL_CONFIG, ...loaded };
}

export async function savePatrolConfig(config: PatrolConfig): Promise<void> {
  await safeWriteJSON(STORE_PATH, config);
  logger.info('patrol', '已儲存設定');
}
