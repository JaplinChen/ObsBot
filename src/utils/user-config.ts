/**
 * Unified user configuration loader.
 * Reads `data/user-config.json` with deep-merge defaults.
 * Zero-config: works out of the box without any config file.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
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
  qualityReview: boolean;
  speakerIdentification: boolean;
}

export interface LlmTierModels {
  flash: string;
  standard: string;
  deep: string;
}

export type ModelTier = keyof LlmTierModels;

/** OpenAI-compatible provider config (oMLX, Ollama, OpenAI all share this shape). */
export interface OpenAIProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: LlmTierModels;
}

export type LlmProviderKey = 'omlx' | 'ollama' | 'openai' | 'gemini' | 'opencode' | 'ddg';

export interface LlmConfig {
  /** Provider priority order (first enabled provider wins). */
  order: LlmProviderKey[];
  /** Per-provider enabled state. */
  enabled: Record<LlmProviderKey, boolean>;
  omlx: OpenAIProviderConfig;
  ollama: OpenAIProviderConfig;
  openai: OpenAIProviderConfig;
  gemini: { apiKey: string; model: string };
  opencode: { models: LlmTierModels; timeoutMs: number };
  routing: Record<TaskType, ModelTier>;
}

export interface ExtractorConfig {
  enabled: string[];
  disabled: string[];
}

export interface MonitorTuningConfig {
  memoryCleanupEnabled: boolean;
  intervalMinutes: number;
  cooldownMinutes: number;
  freeThresholdPercent: number;
  claudeThresholdPercent: number;
}

export interface UserConfig {
  features: FeatureFlags;
  llm: LlmConfig;
  extractors: ExtractorConfig;
  monitor: MonitorTuningConfig;
}

/* ── Defaults ───────────────────────────────────────────────────────── */

const IS_DOCKER = process.env.NODE_ENV === 'production';
/** Docker 容器內用 host.docker.internal 連到主機服務 */
const LOCAL_HOST = IS_DOCKER ? 'host.docker.internal' : '127.0.0.1';

/** 平台偵測：macOS 用 oMLX，Windows 用 Ollama */
const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';

const ALL_PLATFORMS = [
  'x', 'threads', 'youtube', 'github', 'bilibili',
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
    qualityReview: true,
    speakerIdentification: false,
  },
  llm: {
    order: IS_WINDOWS
      ? ['ollama', 'openai', 'gemini', 'opencode', 'ddg']
      : ['omlx', 'ollama', 'openai', 'gemini', 'opencode', 'ddg'],
    enabled: {
      omlx: IS_MACOS, ollama: IS_WINDOWS, openai: false,
      gemini: false, opencode: true, ddg: true,
    },
    omlx: {
      baseUrl: `http://${LOCAL_HOST}:11435`,
      apiKey: '',
      model: '',
      models: {
        flash: 'MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-4bit',
        standard: 'Qwen3.5-9B-MLX-4bit',
        deep: 'Qwen3.5-9B-MLX-4bit',
      },
    },
    ollama: {
      baseUrl: `http://${LOCAL_HOST}:11434`,
      apiKey: '',
      model: IS_WINDOWS ? 'qwen3:8b' : '',
      models: IS_WINDOWS
        ? { flash: 'qwen3:4b', standard: 'qwen3:8b', deep: 'gemma4:e4b' }
        : { flash: '', standard: '', deep: '' },
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: '',
      models: { flash: 'gpt-4.1-mini', standard: 'gpt-4.1-mini', deep: 'gpt-4.1' },
    },
    gemini: {
      apiKey: '',
      model: 'gemini-2.5-flash',
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
  monitor: {
    memoryCleanupEnabled: true,
    intervalMinutes: 15,
    cooldownMinutes: 30,
    freeThresholdPercent: 15,
    claudeThresholdPercent: 10,
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
    const content = JSON.stringify(merged, null, 2) + '\n';
    const tmp = `${CONFIG_PATH}.tmp`;
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, CONFIG_PATH);
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
