/**
 * Known failure signature detector — scans log file for recurring error patterns.
 * Integrates with incident-log.ts to record detected failures.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logIncident, rotateIfNeeded, type IncidentSeverity, type RemediationStatus } from './incident-log.js';
import { logger } from '../core/logger.js';

const LOG_FILE = '/tmp/knowpipe-launch.log';
const CURSOR_FILE = join('.claude', 'incident-cursor.txt');

export interface FailureSignature {
  id: string;
  pattern: RegExp;
  severity: IncidentSeverity;
  remediation: string;
  status: RemediationStatus;
}

/** 已知錯誤簽名庫——從 insights 報告中的高頻 bug 整理 */
export const KNOWN_SIGNATURES: FailureSignature[] = [
  {
    id: 'omlx_507',
    pattern: /HTTP 507|status.*507|507.*memory|OOM/i,
    severity: 'warning',
    remediation: '自動降級已啟動（deep→standard→flash）；若持續發生，重啟 oMLX 服務釋放 GPU 記憶體',
    status: 'auto_applied',
  },
  {
    id: 'translation_parse_failure',
    pattern: /parseTranslationResponse|CJK fallback|translation.*failed|翻譯.*失敗/i,
    severity: 'warning',
    remediation: '執行 /reprocess --filter untranslated 重新翻譯受影響筆記',
    status: 'needs_review',
  },
  {
    id: 'cookie_bytestring',
    pattern: /ByteString|non-ASCII.*cookie|cookie.*encoding/i,
    severity: 'critical',
    remediation: '重新執行 /setup-browser-cookies 更新 cookie；確認 encodeURIComponent 已套用',
    status: 'needs_review',
  },
  {
    id: 'bot_409_conflict',
    pattern: /409.*Conflict|getUpdates.*terminated|conflict.*bot/i,
    severity: 'critical',
    remediation: '多個 bot 實例同時運行；執行 /restart-bot 正確停止 loop.mjs 後重啟',
    status: 'needs_review',
  },
  {
    id: 'json_in_notes',
    pattern: /json.*in.*note|embedded.*json|note.*body.*\{.*\}/i,
    severity: 'warning',
    remediation: '執行 /vault heal 自動清除筆記中的嵌入 JSON',
    status: 'needs_review',
  },
  {
    id: 'camoufox_crash',
    pattern: /camoufox.*crash|browser.*exit.*1|playwright.*timeout/i,
    severity: 'warning',
    remediation: 'Browser pool 已自動回收；若頻繁發生，考慮降低 MAX_POOL_SIZE',
    status: 'logged_only',
  },
  {
    id: 'omlx_connection',
    pattern: /ECONNREFUSED.*1143[45]|oMLX.*unavailable|omlx.*down/i,
    severity: 'critical',
    remediation: '執行 brew services restart omlx 或確認 oMLX port 設定（預設 11435）',
    status: 'needs_review',
  },
];

/** 讀取 log 中自上次游標後的新行 */
async function getNewLogLines(): Promise<{ lines: string[]; newByteOffset: number }> {
  if (!existsSync(LOG_FILE)) return { lines: [], newByteOffset: 0 };

  let offset = 0;
  if (existsSync(CURSOR_FILE)) {
    const cursorRaw = await readFile(CURSOR_FILE, 'utf-8').catch(() => '0');
    offset = parseInt(cursorRaw, 10) || 0;
  }

  const raw = await readFile(LOG_FILE, 'utf-8');
  const newContent = raw.slice(offset);
  const newByteOffset = Buffer.byteLength(raw, 'utf-8');

  return {
    lines: newContent.split('\n').filter(Boolean),
    newByteOffset,
  };
}

/** 掃描新 log 行，偵測已知錯誤簽名，記錄事件 */
export async function runIncidentScan(): Promise<number> {
  const { lines, newByteOffset } = await getNewLogLines();
  if (lines.length === 0) return 0;

  let detected = 0;
  const seenInThisScan = new Set<string>();

  for (const line of lines) {
    for (const sig of KNOWN_SIGNATURES) {
      if (!sig.pattern.test(line)) continue;

      // 同一次掃描同一簽名只記錄一次（避免 log 爆量時重複記錄）
      if (seenInThisScan.has(sig.id)) continue;
      seenInThisScan.add(sig.id);

      const snippet = line.slice(0, 200);
      await logIncident({
        signature: sig.id,
        severity: sig.severity,
        message: snippet,
        remediation: sig.remediation,
        status: sig.status,
        autoFixed: sig.status === 'auto_applied',
      });

      logger.info('incident-detector', `偵測到 ${sig.id}`, { snippet });
      detected++;
    }
  }

  // 更新游標（只在成功處理後移動）
  await writeFile(CURSOR_FILE, String(newByteOffset), 'utf-8');
  await rotateIfNeeded();

  return detected;
}

/** 格式化事件摘要供 Telegram 推播 */
export function formatIncidentAlert(signatureId: string, count: number): string {
  const sig = KNOWN_SIGNATURES.find((s) => s.id === signatureId);
  if (!sig) return `⚠️ 偵測到未知錯誤（${signatureId}）× ${count}`;

  const icon = sig.severity === 'critical' ? '🔴' : sig.severity === 'warning' ? '🟡' : 'ℹ️';
  return [
    `${icon} [自癒系統] ${signatureId} × ${count}`,
    `修復建議：${sig.remediation}`,
  ].join('\n');
}
