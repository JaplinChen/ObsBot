import { logger } from '../core/logger.js';
import { sendGuardianNotification } from './notifier.js';
import { decideGuardianAction } from './policy-engine.js';
import { collectGuardianSample, ensureGuardianServiceRunning, restartGuardianService } from './runtime-adapter.js';
import {
  appendGuardianEvent,
  appendGuardianSample,
  loadGuardianSnapshot,
  markGuardianRestart,
  persistGuardianSnapshot,
  setGuardianStatus,
} from './state-store.js';
import type { GuardianConfig, GuardianEvent, GuardianServiceConfig, GuardianSnapshot } from './types.js';

export class GuardianServiceManager {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private snapshot: GuardianSnapshot;

  constructor(private config: GuardianConfig) {
    this.snapshot = loadGuardianSnapshot(config);
  }

  start(): void {
    for (const service of this.config.services) {
      this.runCheck(service).catch((error) => logger.error('guardian', 'initial check failed', error));
      const timer = setInterval(() => {
        this.runCheck(service).catch((error) => logger.error('guardian', 'scheduled check failed', error));
      }, service.checkIntervalSeconds * 1000);
      this.timers.set(service.id, timer);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  getSnapshot(): GuardianSnapshot {
    return { ...this.snapshot, generatedAt: Date.now() };
  }

  async restartNow(serviceId: string): Promise<boolean> {
    const service = this.config.services.find((item) => item.id === serviceId);
    if (!service) return false;
    await this.performRestart(service, 'manual restart');
    return true;
  }

  async updatePause(serviceId: string, paused: boolean): Promise<boolean> {
    const service = this.config.services.find((item) => item.id === serviceId);
    if (!service) return false;
    service.paused = paused;
    const state = this.snapshot.services[serviceId];
    this.snapshot.services[serviceId] = setGuardianStatus(state, paused ? 'paused' : 'healthy');
    persistGuardianSnapshot(this.snapshot);
    return true;
  }

  private async runCheck(service: GuardianServiceConfig): Promise<void> {
    const sample = await collectGuardianSample(service);
    let state = appendGuardianSample(
      service,
      this.snapshot.services[service.id],
      sample,
      this.config.sampleHistoryLimit,
    );

    if (!sample.processFound) {
      state = setGuardianStatus(state, 'missing');
      await ensureGuardianServiceRunning(service);
      state = this.pushEvent(service.id, state, 'warn', 'system', `${service.name} process missing, attempted start`);
      await sendGuardianNotification(service.notifyChannels, 'Guardian', `${service.name} process missing, attempting start`);
    }

    const action = decideGuardianAction(service, state, Date.now());
    if (action.type === 'notify') {
      state = this.applyStatusForReason(service, state, action.reason);
      state = this.pushEvent(service.id, state, 'warn', 'state', this.describeAction(service, state, action.reason));
      await sendGuardianNotification(service.notifyChannels, 'Guardian Warning', this.describeAction(service, state, action.reason));
    }

    if (action.type === 'restart') {
      state = await this.performRestart(service, action.reason, state);
    }

    this.snapshot.services[service.id] = state;
    this.snapshot.generatedAt = Date.now();
    persistGuardianSnapshot(this.snapshot);
  }

  private async performRestart(
    service: GuardianServiceConfig,
    reason: string,
    existingState = this.snapshot.services[service.id],
  ) {
    let state = markGuardianRestart(existingState, Date.now());
    state = this.pushEvent(service.id, state, 'warn', 'restart', `${service.name} restarting: ${reason}`);
    this.snapshot.services[service.id] = state;
    persistGuardianSnapshot(this.snapshot);
    await sendGuardianNotification(service.notifyChannels, 'Guardian Restart', `${service.name} restarting: ${reason}`);

    try {
      await restartGuardianService(service);
      state = this.pushEvent(service.id, state, 'info', 'restart', `${service.name} restart complete`);
      state = setGuardianStatus(state, 'cooldown');
      await sendGuardianNotification(service.notifyChannels, 'Guardian Restarted', `${service.name} restart complete`);
    } catch (error) {
      state = this.pushEvent(service.id, state, 'error', 'restart', `${service.name} restart failed`);
      state = setGuardianStatus(state, 'missing');
      await sendGuardianNotification(service.notifyChannels, 'Guardian Error', `${service.name} restart failed`);
      logger.error('guardian', 'restart failed', error);
    }
    return state;
  }

  private pushEvent(
    serviceId: string,
    state: GuardianSnapshot['services'][string],
    level: GuardianEvent['level'],
    kind: GuardianEvent['kind'],
    message: string,
  ) {
    return appendGuardianEvent(state, {
      id: `${serviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      serviceId,
      level,
      kind,
      message,
    }, this.config.eventHistoryLimit);
  }

  private applyStatusForReason(
    service: GuardianServiceConfig,
    state: GuardianSnapshot['services'][string],
    reason: string,
  ) {
    if (reason === 'cooldown active') return setGuardianStatus(state, 'cooldown');
    if (reason === 'threshold warning') return setGuardianStatus(state, 'warning');
    if (reason === 'health check failed') return setGuardianStatus(state, 'warning');
    return setGuardianStatus(state, service.paused ? 'paused' : 'healthy');
  }

  private describeAction(
    service: GuardianServiceConfig,
    state: GuardianSnapshot['services'][string],
    reason: string,
  ): string {
    const rss = state.lastSample?.rssGb.toFixed(2) ?? '0.00';
    if (reason === 'threshold warning') {
      return `${service.name} at ${rss}GB, breach ${state.consecutiveBreaches}/${service.consecutiveLimit}`;
    }
    if (reason === 'cooldown active') {
      return `${service.name} still above threshold at ${rss}GB, cooldown active`;
    }
    return `${service.name} requires attention: ${reason}`;
  }
}
