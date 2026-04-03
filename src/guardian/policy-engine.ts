import type { GuardianAction, GuardianServiceConfig, GuardianServiceState } from './types.js';

export function decideGuardianAction(
  config: GuardianServiceConfig,
  state: GuardianServiceState,
  now: number,
): GuardianAction {
  if (config.paused) {
    return { type: 'none', reason: 'service paused', notify: false };
  }

  const sample = state.lastSample;
  if (!sample) {
    return { type: 'none', reason: 'no sample yet', notify: false };
  }

  if (!sample.processFound) {
    return { type: 'restart', reason: 'process missing', notify: true };
  }

  if (!sample.endpointHealthy) {
    return { type: 'notify', reason: 'health check failed', notify: true };
  }

  if (sample.rssGb < config.thresholdGb) {
    return { type: 'none', reason: 'under threshold', notify: false };
  }

  if (state.consecutiveBreaches < config.consecutiveLimit) {
    return { type: 'notify', reason: 'threshold warning', notify: true };
  }

  const lastRestartAt = state.lastRestartAt ?? 0;
  const cooldownMs = config.cooldownSeconds * 1000;
  if (now - lastRestartAt < cooldownMs) {
    return { type: 'notify', reason: 'cooldown active', notify: true };
  }

  return { type: 'restart', reason: 'threshold exceeded', notify: true };
}
