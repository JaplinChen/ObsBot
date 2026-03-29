/**
 * Generic TTL cache with automatic expiry and size limits.
 * Replaces hand-rolled FIFO caches across the codebase.
 */

export class TtlCache<V = string> {
  private readonly data = new Map<string, V>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(opts: { maxSize: number; ttlMs: number }) {
    this.maxSize = opts.maxSize;
    this.ttlMs = opts.ttlMs;
  }

  set(key: string, value: V): void {
    // Clear existing timer if key already exists
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    this.data.set(key, value);
    this.timers.set(key, setTimeout(() => this.delete(key), this.ttlMs));

    // Evict oldest if over capacity
    if (this.data.size > this.maxSize) {
      const oldest = this.data.keys().next().value;
      if (oldest) this.delete(oldest);
    }
  }

  get(key: string): V | undefined {
    return this.data.get(key);
  }

  delete(key: string): void {
    this.data.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  get size(): number {
    return this.data.size;
  }
}
