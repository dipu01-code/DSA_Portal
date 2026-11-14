/**
 * Fixed-window request counter per key (an IP or a user id).
 * shortcut: kept in this API instance's memory, so N instances allow N × limit; move it to Redis or
 * PostgreSQL when the API runs behind a load balancer. Submission quotas are already shared (counted in PostgreSQL).
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs = 60_000
  ) {}

  /** Counts one hit. Returns 0 if allowed, otherwise the seconds until the window resets (for Retry-After). */
  hit(key: string, now = Date.now()): number {
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      // Drop finished windows now and then, so a flood of distinct IPs cannot grow the map forever.
      if (this.windows.size >= 10_000) {
        for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
      }
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count > this.limit ? Math.max(1, Math.ceil((w.resetAt - now) / 1000)) : 0;
  }
}
