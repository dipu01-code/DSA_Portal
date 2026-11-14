/**
 * Counts failed logins in a sliding window. Two keys are checked: ip+email (one account being
 * guessed) and ip alone (credential stuffing across many accounts).
 * shortcut: in-process memory, so limits are per server instance and reset on restart; move to Redis on Day 7.
 */
export class LoginThrottle {
  private failures = new Map<string, number[]>();

  constructor(
    private perAccount = 5,
    private perIp = 20,
    private windowMs = 15 * 60 * 1000
  ) {}

  private recent(key: string, now: number) {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds until the caller may try again, or 0 if allowed. */
  retryAfter(ip: string, email: string, now = Date.now()) {
    const checks: Array<[string, number]> = [
      [`${ip}|${email}`, this.perAccount],
      [ip, this.perIp],
    ];
    let wait = 0;
    for (const [key, limit] of checks) {
      const list = this.recent(key, now);
      if (list.length >= limit) {
        wait = Math.max(wait, Math.ceil((list[list.length - limit] + this.windowMs - now) / 1000));
      }
    }
    return wait;
  }

  fail(ip: string, email: string, now = Date.now()) {
    for (const key of [`${ip}|${email}`, ip]) {
      this.failures.set(key, [...this.recent(key, now), now]);
    }
  }

  /** A correct password clears the account counter (not the IP one). */
  succeed(ip: string, email: string) {
    this.failures.delete(`${ip}|${email}`);
  }
}
