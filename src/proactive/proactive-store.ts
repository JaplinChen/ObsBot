/** Persistent config for proactive intelligence service. */
import { join } from 'node:path';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import type { ProactiveConfig } from './proactive-types.js';
import { DEFAULT_PROACTIVE_CONFIG } from './proactive-types.js';

const CONFIG_PATH = join('data', 'proactive-config.json');

export async function loadProactiveConfig(): Promise<ProactiveConfig> {
  const loaded = await safeReadJSON<Partial<ProactiveConfig>>(CONFIG_PATH, {});
  return { ...DEFAULT_PROACTIVE_CONFIG, ...loaded };
}

export async function saveProactiveConfig(config: ProactiveConfig): Promise<void> {
  await safeWriteJSON(CONFIG_PATH, config);
}
