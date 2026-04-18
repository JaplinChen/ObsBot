/** Types for self-healing monitoring system. */

export type IssueSeverity = 'auto_fixed' | 'needs_review' | 'info';

export interface VaultIssue {
  file: string;
  issue: string;
  autoFixable: boolean;
  fixed?: boolean;
  severity?: IssueSeverity;
}

export interface ExtractorHealth {
  platform: string;
  status: 'ok' | 'degraded' | 'down';
  lastCheckAt: string;
  lastError?: string;
  consecutiveFailures: number;
}

export interface HealthReport {
  timestamp: string;
  vault: {
    totalNotes: number;
    issuesFound: number;
    autoFixed: number;
    translated: number;
  };
  extractors: ExtractorHealth[];
  enrichment: {
    llmAvailable: boolean;
    fallbackUsed: boolean;
  };
}

export interface MonitorConfig {
  /** Vault health check interval in hours (default: 12) */
  vaultCheckHours: number;
  /** Extractor probe interval in hours (default: 24) */
  extractorCheckHours: number;
  lastVaultCheckAt: string | null;
  lastExtractorCheckAt: string | null;
  extractorHealth: Record<string, ExtractorHealth>;
}

/** An auto-fix event logged by vault-healer (ALTK-style correction trajectory) */
export interface CorrectionEvent {
  file: string;       // ObsBot 相對路徑
  field: string;      // 'translation' | 'summary' | 'keywords' | 'html' | 'images'
  timestamp: string;  // ISO datetime
  reason?: string;    // 失敗原因分類，供 failure-analyzer 使用
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  vaultCheckHours: 12,
  extractorCheckHours: 24,
  lastVaultCheckAt: null,
  lastExtractorCheckAt: null,
  extractorHealth: {},
};
