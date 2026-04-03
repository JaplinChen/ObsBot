import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardianConfig } from './types.js';

const CONFIG_PATH = join(process.cwd(), 'data', 'guardian-config.json');

const DEFAULT_CONFIG: GuardianConfig = {
  port: 3199,
  sampleHistoryLimit: 120,
  eventHistoryLimit: 80,
  services: [{
    id: 'omlx',
    name: 'oMLX',
    processPattern: '/opt/homebrew/opt/omlx/bin/omlx serve',
    restartCommand: 'brew services restart omlx',
    startCommand: 'brew services start omlx',
    healthUrl: 'http://127.0.0.1:11435/v1/models',
    thresholdGb: 20,
    consecutiveLimit: 2,
    cooldownSeconds: 300,
    checkIntervalSeconds: 60,
    notifyChannels: ['macos', 'log'],
    paused: false,
  }],
};

function ensureDataDir(): void {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
}

function parseConfig(raw: string): GuardianConfig {
  const parsed = JSON.parse(raw) as Partial<GuardianConfig>;
  return {
    port: parsed.port ?? DEFAULT_CONFIG.port,
    sampleHistoryLimit: parsed.sampleHistoryLimit ?? DEFAULT_CONFIG.sampleHistoryLimit,
    eventHistoryLimit: parsed.eventHistoryLimit ?? DEFAULT_CONFIG.eventHistoryLimit,
    services: parsed.services?.length ? parsed.services.map((service) => ({
      ...DEFAULT_CONFIG.services[0],
      ...service,
    })) : DEFAULT_CONFIG.services,
  };
}

export function getDefaultGuardianConfig(): GuardianConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as GuardianConfig;
}

export function loadGuardianConfig(): GuardianConfig {
  ensureDataDir();
  if (!existsSync(CONFIG_PATH)) {
    writeGuardianConfig(DEFAULT_CONFIG);
    return getDefaultGuardianConfig();
  }
  return parseConfig(readFileSync(CONFIG_PATH, 'utf-8'));
}

export function writeGuardianConfig(config: GuardianConfig): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function patchGuardianConfig(
  updater: (config: GuardianConfig) => GuardianConfig,
): GuardianConfig {
  const next = updater(loadGuardianConfig());
  writeGuardianConfig(next);
  return next;
}

export function getGuardianConfigPath(): string {
  return CONFIG_PATH;
}
