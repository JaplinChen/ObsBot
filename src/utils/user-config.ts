/**
 * Unified user configuration loader.
 * Reads `data/user-config.json` with deep-merge defaults.
 * Zero-config: works out of the box without any config file.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import type { TaskType } from './model-router.js';

/* ── Type definitions ───────────────────────────────────────────────── */

export interface FeatureFlags {
  translation: boolean;
  linkEnrichment: boolean;
  imageAnalysis: boolean;
  videoTranscription: boolean;
  comments: boolean;
  proactive: boolean;
  monitor: boolean;
  wall: boolean;
  patrol: boolean;
  consolidation: boolean;
}

export interface LlmTierModels {
  flash: string;
  standard: string;
  deep: string;
}

export type ModelTier = keyof LlmTierModels;

export interface LlmConfig {
  provider: 'auto' | 'omlx' | 'opencode' | 'ddg' | 'none';
  omlx: { baseUrl: string; models: LlmTierModels };
  opencode: { models: LlmTierModels; timeoutMs: number };
  routing: Record<TaskType, ModelTier>;
}

export interface ExtractorConfig {
  enabled: string[];
  disabled: string[];
}

export interface UserConfig {
  features: FeatureFlags;
  llm: LlmConfig;
  extractors: ExtractorConfig;
}

/* ── Defaults ───────────────────────────────────────────────────────── */

const ALL_PLATFORMS = [
  'x', 'threads', 'youtube', 'github', 'reddit', 'bilibili',
  'weibo', 'xiaohongshu', 'douyin', 'tiktok', 'ithome', 'zhihu',
  'direct-video', 'web',
];

const DEFAULTS: UserConfig = {
  features: {
    translation: true,
    linkEnrichment: true,
    imageAnalysis: true,
    videoTranscription: true,
    comments: true,
    proactive: true,
    monitor: true,
    wall: true,
    patrol: false,
    consolidation: true,
  },
  llm: {
    provider: 'auto',
    omlx: {
      baseUrl: 'http://127.0.0.1:8000',
      models: {
        flash: 'MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-4bit',
        standard: 'Qwen3.5-9B-MLX-4bit',
        deep: 'Qwen3.5-27B-4bit',
      },
    },
    opencode: {
      models: {
        flash: 'opencode/mimo-v2-pro-free',
        standard: 'opencode/big-pickle',
        deep: 'opencode/big-pickle',
      },
      timeoutMs: 90_000,
    },
    routing: {
      translate: 'flash',
      classify: 'flash',
      keywords: 'flash',
      vision: 'standard',
      summarize: 'standard',
      general: 'standard',
      analyze: 'deep',
      digest: 'deep',
    },
  },
  extractors: {
    enabled: [...ALL_PLATFORMS],
    disabled: [],
  },
};

/* ── Deep merge utility ─────────────────────────────────────────────── */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T extends Record<string, unknown>>(defaults: T, overrides: Record<string, unknown>): T {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const ov = overrides[key];
    if (ov === undefined) continue;
    const dv = defaults[key];
    if (isPlainObject(dv) && isPlainObject(ov)) {
      (result as Record<string, unknown>)[key] = deepMerge(dv as Record<string, unknown>, ov);
    } else {
      (result as Record<string, unknown>)[key] = ov;
    }
  }
  return result;
}

/* ── Singleton ──────────────────────────────────────────────────────── */

const CONFIG_PATH = join(process.cwd(), 'data', 'user-config.json');
let _cached: UserConfig | null = null;

/** Load user config (cached after first call). */
export function getUserConfig(): UserConfig {
  if (_cached) return _cached;
  _cached = loadFromDisk();
  return _cached;
}

/** Force reload from disk. */
export function reloadUserConfig(): UserConfig {
  _cached = null;
  return getUserConfig();
}

/** Update config with partial patch, save to disk, refresh cache. */
export function updateUserConfig(patch: Record<string, unknown>): UserConfig {
  const current = getUserConfig();
  const merged = deepMerge(current as unknown as Record<string, unknown>, patch) as unknown as UserConfig;
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    logger.info('config', '配置已更新', { path: CONFIG_PATH });
  } catch (e) {
    logger.warn('config', '寫入配置失敗', { message: (e as Error).message });
  }
  _cached = merged;
  return merged;
}

function loadFromDisk(): UserConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, parsed) as unknown as UserConfig;
    logger.info('config', '載入用戶配置', { path: CONFIG_PATH });
    return merged;
  } catch (e) {
    logger.warn('config', '配置檔解析失敗，使用預設值', { message: (e as Error).message });
    return { ...DEFAULTS };
  }
}

/** Get the list of effectively enabled extractor platform keys. */
export function getEnabledPlatforms(): string[] {
  const cfg = getUserConfig().extractors;
  const disabled = new Set(cfg.disabled);
  return cfg.enabled.filter((p) => !disabled.has(p));
}

/** Export defaults for /config reset. */
export function getDefaults(): UserConfig {
  return JSON.parse(JSON.stringify(DEFAULTS)) as UserConfig;
}
