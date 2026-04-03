import { describe, it, expect, beforeEach } from 'vitest';
import { isCircuitAllowed, recordSuccess, recordFailure, getBreakerStatus } from './circuit-breaker.js';

describe('circuit-breaker', () => {
  beforeEach(() => {
    // Reset by recording success
    recordSuccess('test-platform');
  });

  it('新平台預設允許通過', () => {
    expect(isCircuitAllowed('new-platform')).toBe(true);
  });

  it('連續失敗後熔斷', () => {
    recordFailure('fail-plat');
    recordFailure('fail-plat');
    expect(isCircuitAllowed('fail-plat')).toBe(true); // 2 failures, still ok
    recordFailure('fail-plat');
    expect(isCircuitAllowed('fail-plat')).toBe(false); // 3 failures, blocked
  });

  it('成功後重置熔斷器', () => {
    recordFailure('reset-plat');
    recordFailure('reset-plat');
    recordFailure('reset-plat');
    expect(isCircuitAllowed('reset-plat')).toBe(false);
    recordSuccess('reset-plat');
    expect(isCircuitAllowed('reset-plat')).toBe(true);
  });

  it('getBreakerStatus 回報失敗平台', () => {
    recordFailure('status-plat');
    recordFailure('status-plat');
    const statuses = getBreakerStatus();
    const entry = statuses.find(s => s.platform === 'status-plat');
    expect(entry).toBeDefined();
    expect(entry!.failures).toBe(2);
  });
});
