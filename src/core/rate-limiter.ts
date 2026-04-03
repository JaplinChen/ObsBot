/**
 * Per-user rate limiter — prevents abuse and controls LLM costs.
 * Uses a sliding window counter in memory.
 */

interface UserWindow {
  /** Timestamps of recent requests within the window. */
  timestamps: number[];
}

const windows = new Map<number, UserWindow>();

/** Default limits: 30 requests per hour per user. */
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_REQUESTS = 30;

/**
 * Check if a user is within their rate limit.
 * Returns { allowed: true } or { allowed: false, retryAfterMs }.
 */
export function checkRateLimit(
  userId: number,
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
): { allowed: boolean; retryAfterMs?: number; remaining: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let window = windows.get(userId);
  if (!window) {
    window = { timestamps: [] };
    windows.set(userId, window);
  }

  // Prune expired entries
  window.timestamps = window.timestamps.filter(ts => ts > cutoff);

  if (window.timestamps.length >= maxRequests) {
    const oldest = window.timestamps[0];
    const retryAfterMs = oldest + windowMs - now;
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  window.timestamps.push(now);
  return { allowed: true, remaining: maxRequests - window.timestamps.length };
}

/** Get rate limit status for all users (for admin dashboard). */
export function getRateLimitStatus(): Array<{ userId: number; requestsInWindow: number }> {
  const now = Date.now();
  const cutoff = now - DEFAULT_WINDOW_MS;
  const result: Array<{ userId: number; requestsInWindow: number }> = [];

  for (const [userId, window] of windows) {
    const active = window.timestamps.filter(ts => ts > cutoff).length;
    if (active > 0) result.push({ userId, requestsInWindow: active });
  }

  return result.sort((a, b) => b.requestsInWindow - a.requestsInWindow);
}

/** Reset rate limit for a specific user (admin override). */
export function resetRateLimit(userId: number): void {
  windows.delete(userId);
}
