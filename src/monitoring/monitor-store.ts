/** Persistent config for self-healing monitoring. */
import { join } from 'node:path';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import type { MonitorConfig } from './health-types.js';
import { DEFAULT_MONITOR_CONFIG } from './health-types.js';

const CONFIG_PATH = join('data', 'monitor-config.json');

export async function loadMonitorConfig(): Promise<MonitorConfig> {
  const loaded = await safeReadJSON<Partial<MonitorConfig>>(CONFIG_PATH, {});
  return { ...DEFAULT_MONITOR_CONFIG, ...loaded };
}

export async function saveMonitorConfig(config: MonitorConfig): Promise<void> {
  await safeWriteJSON(CONFIG_PATH, config);
}
