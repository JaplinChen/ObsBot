import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  GuardianConfig,
  GuardianEvent,
  GuardianSample,
  GuardianServiceConfig,
  GuardianServiceState,
  GuardianSnapshot,
} from './types.js';

const STATE_PATH = join(process.cwd(), 'data', 'guardian-state.json');

function createServiceState(): GuardianServiceState {
  return {
    status: 'healthy',
    consecutiveBreaches: 0,
    lastSeenAt: null,
    lastRestartAt: null,
    lastHealthyAt: null,
    lastSample: null,
    samples: [],
    events: [],
  };
}

export function loadGuardianSnapshot(config: GuardianConfig): GuardianSnapshot {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  const base: GuardianSnapshot = {
    generatedAt: Date.now(),
    config,
    services: Object.fromEntries(config.services.map((service) => [service.id, createServiceState()])),
  };
  if (!existsSync(STATE_PATH)) return base;
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as Partial<GuardianSnapshot>;
    return {
      generatedAt: Date.now(),
      config,
      services: Object.fromEntries(config.services.map((service) => [
        service.id,
        { ...createServiceState(), ...(parsed.services?.[service.id] ?? {}) },
      ])),
    };
  } catch {
    return base;
  }
}

export function persistGuardianSnapshot(snapshot: GuardianSnapshot): void {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

export function appendGuardianSample(
  service: GuardianServiceConfig,
  state: GuardianServiceState,
  sample: GuardianSample,
  sampleLimit: number,
): GuardianServiceState {
  const nextSamples = [...state.samples, sample].slice(-sampleLimit);
  const consecutiveBreaches = sample.rssGb >= service.thresholdGb ? state.consecutiveBreaches + 1 : 0;
  return {
    ...state,
    status: service.paused ? 'paused' : sample.processFound ? 'healthy' : 'missing',
    consecutiveBreaches,
    lastSeenAt: sample.ts,
    lastHealthyAt: sample.processFound && sample.endpointHealthy ? sample.ts : state.lastHealthyAt,
    lastSample: sample,
    samples: nextSamples,
  };
}

export function appendGuardianEvent(
  state: GuardianServiceState,
  event: GuardianEvent,
  eventLimit: number,
): GuardianServiceState {
  return { ...state, events: [...state.events, event].slice(-eventLimit) };
}

export function setGuardianStatus(
  state: GuardianServiceState,
  status: GuardianServiceState['status'],
): GuardianServiceState {
  return { ...state, status };
}

export function markGuardianRestart(state: GuardianServiceState, ts: number): GuardianServiceState {
  return {
    ...state,
    status: 'restarting',
    lastRestartAt: ts,
    consecutiveBreaches: 0,
  };
}
