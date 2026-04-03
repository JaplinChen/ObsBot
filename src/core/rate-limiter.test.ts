import { describe, it, expect } from 'vitest';
import { checkRateLimit, resetRateLimit, getRateLimitStatus } from './rate-limiter.js';

describe('rate-limiter', () => {
  it('允許在限額內的請求', () => {
    resetRateLimit(99901);
    const result = checkRateLimit(99901, 60_000, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('超過限額時拒絕', () => {
    resetRateLimit(99902);
    for (let i = 0; i < 3; i++) {
      checkRateLimit(99902, 60_000, 3);
    }
    const result = checkRateLimit(99902, 60_000, 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('不同用戶互不影響', () => {
    resetRateLimit(99903);
    resetRateLimit(99904);
    for (let i = 0; i < 3; i++) {
      checkRateLimit(99903, 60_000, 3);
    }
    const result = checkRateLimit(99904, 60_000, 3);
    expect(result.allowed).toBe(true);
  });

  it('重置後恢復', () => {
    resetRateLimit(99905);
    for (let i = 0; i < 3; i++) {
      checkRateLimit(99905, 60_000, 3);
    }
    resetRateLimit(99905);
    const result = checkRateLimit(99905, 60_000, 3);
    expect(result.allowed).toBe(true);
  });

  it('getRateLimitStatus 回報活躍用戶', () => {
    resetRateLimit(99906);
    checkRateLimit(99906, 60_000, 10);
    const status = getRateLimitStatus();
    const entry = status.find(s => s.userId === 99906);
    expect(entry).toBeDefined();
    expect(entry!.requestsInWindow).toBe(1);
  });
});
