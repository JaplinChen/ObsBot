import { describe, expect, it } from 'vitest';
import { appendGuardianSample } from './state-store.js';
import type { GuardianServiceConfig, GuardianServiceState } from './types.js';

const service: GuardianServiceConfig = {
  id: 'omlx',
  name: 'oMLX',
  processPattern: 'omlx',
  restartCommand: 'restart',
  thresholdGb: 20,
  consecutiveLimit: 2,
  cooldownSeconds: 300,
  checkIntervalSeconds: 60,
  notifyChannels: ['log'],
};

const baseState: GuardianServiceState = {
  status: 'healthy',
  consecutiveBreaches: 0,
  lastSeenAt: null,
  lastRestartAt: null,
  lastHealthyAt: null,
  lastSample: null,
  samples: [],
  events: [],
};

describe('appendGuardianSample', () => {
  it('increments breaches above threshold', () => {
    const next = appendGuardianSample(service, baseState, {
      ts: Date.now(),
      serviceId: 'omlx',
      rssGb: 21,
      swapUsedGb: 2,
      processFound: true,
      endpointHealthy: true,
    }, 10);
    expect(next.consecutiveBreaches).toBe(1);
    expect(next.samples).toHaveLength(1);
  });

  it('resets breaches when memory recovers', () => {
    const next = appendGuardianSample(service, { ...baseState, consecutiveBreaches: 2 }, {
      ts: Date.now(),
      serviceId: 'omlx',
      rssGb: 12,
      swapUsedGb: 0,
      processFound: true,
      endpointHealthy: true,
    }, 10);
    expect(next.consecutiveBreaches).toBe(0);
  });
});
