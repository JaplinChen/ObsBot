import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../core/logger.js';
import { checkHealth, findProcess, readSwapUsedGb } from './system-metrics.js';
import type { GuardianSample, GuardianServiceConfig } from './types.js';

const execFileAsync = promisify(execFile);

export async function collectGuardianSample(service: GuardianServiceConfig): Promise<GuardianSample> {
  const process = await findProcess(service.processPattern);
  const [swapUsedGb, healthy] = await Promise.all([
    readSwapUsedGb(),
    checkHealth(service.healthUrl),
  ]);
  return {
    ts: Date.now(),
    serviceId: service.id,
    rssGb: process.rssGb,
    swapUsedGb,
    processFound: process.pid !== null,
    endpointHealthy: healthy,
  };
}

export async function restartGuardianService(service: GuardianServiceConfig): Promise<void> {
  await runShellCommand(service.restartCommand);
}

export async function ensureGuardianServiceRunning(service: GuardianServiceConfig): Promise<void> {
  if (!service.startCommand) return;
  await runShellCommand(service.startCommand);
}

async function runShellCommand(command: string): Promise<void> {
  try {
    await execFileAsync('/bin/zsh', ['-lc', command]);
  } catch (error) {
    logger.error('guardian', '執行服務命令失敗', { command, error: (error as Error).message });
    throw error;
  }
}
