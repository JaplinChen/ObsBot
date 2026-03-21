/**
 * Simple service registry — collects background timers so they can be
 * cleaned up on SIGINT / SIGTERM to prevent leaks during hot-reload.
 */

const timers: NodeJS.Timeout[] = [];

/** Register one or more interval timers for cleanup on shutdown. */
export function registerTimers(...ts: NodeJS.Timeout[]): void {
  timers.push(...ts);
}

/** Clear all registered timers. Called once during graceful shutdown. */
export function clearAllTimers(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
