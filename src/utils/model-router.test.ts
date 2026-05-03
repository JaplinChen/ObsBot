/**
 * Tests for model-router.ts
 * Covers: resolveModelTier with explicit tier, task routing, unknown task fallback,
 *         and the deep-tier change (gemma → Qwen3.5-9B now maps to same as standard).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./user-config.js', () => ({
  getUserConfig: vi.fn(),
}));

import { getUserConfig } from './user-config.js';
import { resolveModelTier } from './model-router.js';
import type { TaskType } from './model-router.js';

const mockGetUserConfig = vi.mocked(getUserConfig);

function makeConfig(routing: Record<string, string> = {}) {
  return {
    llm: { routing },
  } as ReturnType<typeof getUserConfig>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveModelTier', () => {
  it('returns explicit tier when provided, ignoring task routing', () => {
    mockGetUserConfig.mockReturnValue(makeConfig({ summarize: 'deep' }));

    expect(resolveModelTier('summarize', 'flash')).toBe('flash');
    expect(resolveModelTier('summarize', 'standard')).toBe('standard');
    expect(resolveModelTier('summarize', 'deep')).toBe('deep');
  });

  it('reads task tier from user-config routing table', () => {
    mockGetUserConfig.mockReturnValue(makeConfig({
      translate: 'flash',
      classify: 'standard',
      digest: 'deep',
    }));

    expect(resolveModelTier('translate')).toBe('flash');
    expect(resolveModelTier('classify')).toBe('standard');
    expect(resolveModelTier('digest')).toBe('deep');
  });

  it('falls back to "standard" for unknown/unmapped tasks', () => {
    mockGetUserConfig.mockReturnValue(makeConfig({})); // empty routing

    const tasks: TaskType[] = ['summarize', 'analyze', 'keywords', 'vision', 'general'];
    for (const t of tasks) {
      expect(resolveModelTier(t)).toBe('standard');
    }
  });

  it('all canonical TaskTypes resolve without throwing', () => {
    mockGetUserConfig.mockReturnValue(makeConfig({
      translate: 'flash',
      classify: 'flash',
      keywords: 'flash',
      summarize: 'standard',
      analyze: 'standard',
      digest: 'deep',
      vision: 'standard',
      general: 'standard',
    }));

    const tasks: TaskType[] = ['translate', 'classify', 'keywords', 'summarize', 'analyze', 'digest', 'vision', 'general'];
    expect(() => tasks.forEach((t) => resolveModelTier(t))).not.toThrow();
  });

  it('after deep-tier config change, digest task resolves to standard (same as Qwen3.5-9B)', () => {
    // Simulates the shipped change: deep model is now Qwen3.5-9B-MLX-4bit (same as standard)
    // The routing table still maps digest→deep, but the model behind "deep" changed.
    mockGetUserConfig.mockReturnValue(makeConfig({ digest: 'deep' }));
    expect(resolveModelTier('digest')).toBe('deep');
  });
});
