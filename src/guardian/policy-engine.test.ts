import { describe, expect, it } from 'vitest';
import { decideGuardianAction } from './policy-engine.js';
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

function makeState(partial: Partial<GuardianServiceState>): GuardianServiceState {
  return {
    status: 'healthy',
    consecutiveBreaches: 0,
    lastSeenAt: null,
    lastRestartAt: null,
    lastHealthyAt: null,
    lastSample: null,
    samples: [],
    events: [],
    ...partial,
  };
}

describe('decideGuardianAction', () => {
  it('warns before restart threshold', () => {
    const action = decideGuardianAction(service, makeState({
      consecutiveBreaches: 1,
      lastSample: {
        ts: Date.now(), serviceId: 'omlx', rssGb: 21, swapUsedGb: 2, processFound: true, endpointHealthy: true,
      },
    }), Date.now());
    expect(action.type).toBe('notify');
  });

  it('restarts after consecutive breaches', () => {
    const action = decideGuardianAction(service, makeState({
      consecutiveBreaches: 2,
      lastSample: {
        ts: Date.now(), serviceId: 'omlx', rssGb: 22, swapUsedGb: 2, processFound: true, endpointHealthy: true,
      },
    }), Date.now());
    expect(action.type).toBe('restart');
  });

  it('respects cooldown', () => {
    const action = decideGuardianAction(service, makeState({
      consecutiveBreaches: 2,
      lastRestartAt: Date.now() - 1_000,
      lastSample: {
        ts: Date.now(), serviceId: 'omlx', rssGb: 22, swapUsedGb: 2, processFound: true, endpointHealthy: true,
      },
    }), Date.now());
    expect(action.reason).toBe('cooldown active');
  });
});
