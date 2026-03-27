import { existsSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ override: true });

/** Vault 中存放筆記的子資料夾名稱 */
export const VAULT_SUBFOLDER = 'ObsBot';
/** Vault attachments 子資料夾名稱（保留舊名，避免 282 篇筆記圖片斷連） */
export const ATTACHMENTS_SUBFOLDER = 'getthreads';

function warnNoAuth(): void {
  console.warn(
    '[WARN] ALLOWED_USER_IDS 未設定，任何 Telegram 用戶皆可使用此 Bot。' +
    '如需限制存取，請在 .env 中設定 ALLOWED_USER_IDS=你的用戶ID',
  );
}

export interface AppConfig {
  botToken: string;
  vaultPath: string;
  /** Optional: Telegram user ID whitelist. Undefined = allow all. */
  allowedUserIds?: Set<number>;
  /** Enable automatic translation of non-zh-TW content */
  enableTranslation: boolean;
  /** Max URLs to enrich from post/comments (default: 5) */
  maxLinkedUrls: number;
  /** Save downloaded videos to vault attachments (default: false) */
  saveVideos: boolean;
}

export function loadConfig(): AppConfig {
  const botToken = process.env.BOT_TOKEN;
  const vaultPath = process.env.VAULT_PATH;

  if (!botToken) {
    throw new Error('BOT_TOKEN is required in .env');
  }
  if (!vaultPath) {
    throw new Error('VAULT_PATH is required in .env');
  }

  if (!existsSync(vaultPath)) {
    throw new Error('VAULT_PATH points to a directory that does not exist');
  }

  const allowedRaw = process.env.ALLOWED_USER_IDS;
  const allowedUserIds = allowedRaw
    ? new Set(
        allowedRaw
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n)),
      )
    : undefined;

  if (!allowedUserIds) warnNoAuth();

  return {
    botToken,
    vaultPath,
    allowedUserIds,
    enableTranslation: process.env.ENABLE_TRANSLATION === 'true',
    maxLinkedUrls: parseInt(process.env.MAX_LINKED_URLS ?? '5', 10) || 5,
    saveVideos: process.env.SAVE_VIDEOS === 'true',
  };
}

/** Get the primary (first) owner user ID for sending notifications. */
export function getOwnerUserId(config: AppConfig): number | undefined {
  return config.allowedUserIds?.values().next().value;
}
