/**
 * Circuit breaker for extractors — prevents repeated timeouts on failing platforms.
 *
 * States: CLOSED (normal) → OPEN (blocked after N failures) → HALF_OPEN (test one request)
 * Transitions: 3 consecutive failures → OPEN, 5 min cooldown → HALF_OPEN, success → CLOSED
 */
import { logger } from '../core/logger.js';

/** Callback invoked when a breaker opens. Set externally to send Telegram alerts. */
let onBreakerOpen: ((platform: string, failures: number) => void) | null = null;

/** Register a callback for breaker-open events (e.g., Telegram notification). */
export function setOnBreakerOpen(cb: (platform: string, failures: number) => void): void {
  onBreakerOpen = cb;
}

interface BreakerState {
  status: 'closed' | 'open' | 'half_open';
  failures: number;
  lastFailureAt: number;
  openedAt: number;
}

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const breakers = new Map<string, BreakerState>();

function getState(platform: string): BreakerState {
  let state = breakers.get(platform);
  if (!state) {
    state = { status: 'closed', failures: 0, lastFailureAt: 0, openedAt: 0 };
    breakers.set(platform, state);
  }
  return state;
}

/** Check if a platform should be allowed through. Returns true if allowed. */
export function isCircuitAllowed(platform: string): boolean {
  const state = getState(platform);

  if (state.status === 'closed') return true;

  if (state.status === 'open') {
    // Check if cooldown has elapsed → transition to half_open
    if (Date.now() - state.openedAt >= COOLDOWN_MS) {
      state.status = 'half_open';
      logger.info('breaker', `${platform} 熔斷器半開放，允許測試請求`);
      return true;
    }
    return false;
  }

  // half_open: allow one test request
  return true;
}

/** Record a successful extraction — resets the breaker. */
export function recordSuccess(platform: string): void {
  const state = getState(platform);
  if (state.status !== 'closed') {
    logger.info('breaker', `${platform} 熔斷器恢復正常`);
  }
  state.status = 'closed';
  state.failures = 0;
}

/** Record a failed extraction — may trip the breaker. */
export function recordFailure(platform: string): void {
  const state = getState(platform);
  state.failures++;
  state.lastFailureAt = Date.now();

  if (state.status === 'half_open') {
    // Test request failed → re-open
    state.status = 'open';
    state.openedAt = Date.now();
    logger.warn('breaker', `${platform} 半開放測試失敗，重新熔斷`);
    return;
  }

  if (state.failures >= FAILURE_THRESHOLD && state.status === 'closed') {
    state.status = 'open';
    state.openedAt = Date.now();
    logger.warn('breaker', `${platform} 連續 ${state.failures} 次失敗，熔斷器開啟`);
    onBreakerOpen?.(platform, state.failures);
  }
}

/** Get breaker status summary for admin/diagnostics. */
export function getBreakerStatus(): Array<{ platform: string; status: string; failures: number }> {
  return [...breakers.entries()]
    .filter(([, s]) => s.failures > 0)
    .map(([platform, s]) => ({ platform, status: s.status, failures: s.failures }));
}
