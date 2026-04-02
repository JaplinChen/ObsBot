import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

/** In-memory ring buffer for recent log entries */
const LOG_BUFFER_SIZE = 200;

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: string;
}

const logBuffer: LogEntry[] = [];

/* ── Persistent file logging ──────────────────────────────────────── */
const LOG_DIR = join('data', 'logs');
const LOG_FILE = join(LOG_DIR, 'app.jsonl');
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB per file
const MAX_ROTATED = 7; // Keep 7 rotated files (7 days roughly)
let logDirReady = false;

async function ensureLogDir(): Promise<void> {
  if (logDirReady) return;
  await mkdir(LOG_DIR, { recursive: true });
  logDirReady = true;
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const s = await stat(LOG_FILE);
    if (s.size <= MAX_LOG_SIZE) return;
    // Rotate: app.jsonl → app.jsonl.1, old .7 is dropped
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      try { await rename(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`); } catch { /* ok */ }
    }
    await rename(LOG_FILE, `${LOG_FILE}.1`);
  } catch { /* file doesn't exist yet */ }
}

async function writeToFile(entry: LogEntry): Promise<void> {
  try {
    await ensureLogDir();
    await rotateIfNeeded();
    const json = JSON.stringify({ ts: entry.ts, l: entry.level, s: entry.scope, m: entry.message, d: entry.meta });
    await appendFile(LOG_FILE, json + '\n', 'utf-8');
  } catch { /* best-effort, never crash the app */ }
}

/* ── Core write function ──────────────────────────────────────────── */

function serializeMeta(meta?: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) return ` | ${meta.name}: ${meta.message}`;
  try {
    return ` | ${JSON.stringify(meta)}`;
  } catch {
    return ' | [unserializable-meta]';
  }
}

function write(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  const metaStr = serializeMeta(meta);
  const line = `[${scope}] ${message}${metaStr}`;

  const entry: LogEntry = { ts: Date.now(), level, scope, message, meta: metaStr || undefined };

  // Push to ring buffer
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

  // Persist to file (fire-and-forget)
  writeToFile(entry).catch(() => {});

  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(scope: string, message: string, meta?: unknown): void {
    write('info', scope, message, meta);
  },
  warn(scope: string, message: string, meta?: unknown): void {
    write('warn', scope, message, meta);
  },
  error(scope: string, message: string, meta?: unknown): void {
    write('error', scope, message, meta);
  },

  /** Get recent log entries, optionally filtered by level */
  getRecent(count = 20, level?: LogLevel): LogEntry[] {
    const filtered = level ? logBuffer.filter((e) => e.level === level) : logBuffer;
    return filtered.slice(-count);
  },
};
