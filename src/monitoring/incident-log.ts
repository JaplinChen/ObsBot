/**
 * Structured incident log — appends to .claude/incidents.jsonl.
 * Each entry records a detected failure with severity and remediation hint.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const INCIDENTS_FILE = join('.claude', 'incidents.jsonl');
const MAX_INCIDENTS_PER_FILE = 500;

export type IncidentSeverity = 'critical' | 'warning' | 'info';
export type RemediationStatus = 'auto_applied' | 'needs_review' | 'logged_only';

export interface Incident {
  id: string;
  timestamp: string;
  signature: string;         // 錯誤簽名 ID（對應 KNOWN_SIGNATURES）
  severity: IncidentSeverity;
  message: string;           // 偵測到的原始 log 片段
  remediation: string;       // 建議修復行動
  status: RemediationStatus;
  autoFixed?: boolean;
}

export interface DailyDigest {
  date: string;
  total: number;
  bySignature: Record<string, number>;
  bySeverity: Record<IncidentSeverity, number>;
  autoFixed: number;
  needsReview: number;
  recent: Incident[];
}

/** 追加一筆事件到 .claude/incidents.jsonl */
export async function logIncident(incident: Omit<Incident, 'id' | 'timestamp'>): Promise<Incident> {
  const entry: Incident = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...incident,
  };
  await appendFile(INCIDENTS_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

/** 讀取最近 N 小時的事件（預設 24 小時） */
export async function getRecentIncidents(hours = 24): Promise<Incident[]> {
  if (!existsSync(INCIDENTS_FILE)) return [];
  const raw = await readFile(INCIDENTS_FILE, 'utf-8');
  const cutoff = Date.now() - hours * 3_600_000;
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as Incident; } catch { return null; }
    })
    .filter((e): e is Incident => e !== null && new Date(e.timestamp).getTime() >= cutoff);
}

/** 產出今日事件摘要 */
export async function getDailyDigest(): Promise<DailyDigest> {
  const incidents = await getRecentIncidents(24);
  const bySignature: Record<string, number> = {};
  const bySeverity: Record<IncidentSeverity, number> = { critical: 0, warning: 0, info: 0 };

  for (const i of incidents) {
    bySignature[i.signature] = (bySignature[i.signature] ?? 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    total: incidents.length,
    bySignature,
    bySeverity,
    autoFixed: incidents.filter((i) => i.autoFixed).length,
    needsReview: incidents.filter((i) => i.status === 'needs_review').length,
    recent: incidents.slice(-10),
  };
}

/** 輪替：超過 MAX_INCIDENTS_PER_FILE 行時保留最新一半 */
export async function rotateIfNeeded(): Promise<void> {
  if (!existsSync(INCIDENTS_FILE)) return;
  const raw = await readFile(INCIDENTS_FILE, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length > MAX_INCIDENTS_PER_FILE) {
    const kept = lines.slice(-Math.floor(MAX_INCIDENTS_PER_FILE / 2));
    await writeFile(INCIDENTS_FILE, kept.join('\n') + '\n', 'utf-8');
  }
}
