/**
 * Data schema migration system.
 * Tracks schema version in data/schema-version.json and runs migrations on startup.
 * Each migration is a function that upgrades from version N to N+1.
 */
import { join } from 'node:path';
import { logger } from './logger.js';
import { safeWriteJSON, safeReadJSON } from './safe-write.js';

const SCHEMA_PATH = join(process.cwd(), 'data', 'schema-version.json');

/** Current schema version — bump this when adding migrations. */
export const CURRENT_SCHEMA_VERSION = 2;

interface SchemaState {
  version: number;
  lastMigratedAt: string;
  history: Array<{ from: number; to: number; at: string }>;
}

type MigrationFn = () => Promise<void>;

/**
 * Migration registry: key is the target version.
 * Migration N upgrades from version N-1 to N.
 */
const migrations: Map<number, MigrationFn> = new Map();

/** Register a migration function. */
function registerMigration(targetVersion: number, fn: MigrationFn): void {
  migrations.set(targetVersion, fn);
}

// ─── Migration v1 → v2: Add schema-version tracking itself ───────────
registerMigration(2, async () => {
  // v2: Initial schema tracking — no data changes needed.
  // This migration exists to establish the baseline version.
  logger.info('migrator', '初始化 schema 版本追蹤 (v2)');
});

// ─── Add future migrations above this line ───────────────────────────

/**
 * Run all pending migrations sequentially.
 * Returns the number of migrations applied.
 */
export async function runMigrations(): Promise<number> {
  const state = await safeReadJSON<SchemaState>(SCHEMA_PATH, {
    version: 1,
    lastMigratedAt: new Date().toISOString(),
    history: [],
  });

  if (state.version >= CURRENT_SCHEMA_VERSION) {
    logger.info('migrator', `Schema 版本 v${state.version}，無需遷移`);
    return 0;
  }

  let applied = 0;
  for (let v = state.version + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const migrationFn = migrations.get(v);
    if (!migrationFn) {
      logger.warn('migrator', `找不到 v${v} 遷移腳本，跳過`);
      continue;
    }

    logger.info('migrator', `執行遷移 v${v - 1} → v${v}`);
    try {
      await migrationFn();
      state.version = v;
      state.lastMigratedAt = new Date().toISOString();
      state.history.push({ from: v - 1, to: v, at: state.lastMigratedAt });
      await safeWriteJSON(SCHEMA_PATH, state);
      applied++;
      logger.info('migrator', `遷移 v${v} 完成`);
    } catch (err) {
      logger.error('migrator', `遷移 v${v} 失敗`, err);
      // Stop on first failure — don't run subsequent migrations
      break;
    }
  }

  if (applied > 0) {
    logger.info('migrator', `共完成 ${applied} 個遷移，目前版本 v${state.version}`);
  }

  return applied;
}

/** Get current schema state for diagnostics. */
export async function getSchemaState(): Promise<SchemaState> {
  return safeReadJSON<SchemaState>(SCHEMA_PATH, {
    version: 1,
    lastMigratedAt: '',
    history: [],
  });
}
