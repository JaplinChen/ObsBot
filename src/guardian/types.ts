export type GuardianStatus = 'healthy' | 'warning' | 'cooldown' | 'restarting' | 'paused' | 'missing';

export type GuardianActionType = 'none' | 'notify' | 'restart';

export type NotificationChannel = 'macos' | 'log';

export interface GuardianServiceConfig {
  id: string;
  name: string;
  processPattern: string;
  restartCommand: string;
  startCommand?: string;
  healthUrl?: string;
  thresholdGb: number;
  consecutiveLimit: number;
  cooldownSeconds: number;
  checkIntervalSeconds: number;
  notifyChannels: NotificationChannel[];
  paused?: boolean;
}

export interface GuardianConfig {
  port: number;
  sampleHistoryLimit: number;
  eventHistoryLimit: number;
  services: GuardianServiceConfig[];
}

export interface GuardianSample {
  ts: number;
  serviceId: string;
  rssGb: number;
  swapUsedGb: number;
  processFound: boolean;
  endpointHealthy: boolean;
}

export interface GuardianAction {
  type: GuardianActionType;
  reason: string;
  notify: boolean;
}

export interface GuardianEvent {
  id: string;
  ts: number;
  serviceId: string;
  level: 'info' | 'warn' | 'error';
  kind: 'sample' | 'notify' | 'restart' | 'state' | 'system';
  message: string;
}

export interface GuardianServiceState {
  status: GuardianStatus;
  consecutiveBreaches: number;
  lastSeenAt: number | null;
  lastRestartAt: number | null;
  lastHealthyAt: number | null;
  lastSample: GuardianSample | null;
  samples: GuardianSample[];
  events: GuardianEvent[];
}

export interface GuardianSnapshot {
  generatedAt: number;
  config: GuardianConfig;
  services: Record<string, GuardianServiceState>;
}
