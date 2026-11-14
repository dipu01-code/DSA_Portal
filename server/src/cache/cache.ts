import Redis from 'ioredis';

/** The few Redis commands the cache needs; RedisBackend in production, MemoryBackend in tests. */
export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** SET key value NX PX ttl: true if this caller took the key. */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  incr(key: string): Promise<number>;
}

export class RedisBackend implements CacheBackend {
  constructor(private redis: Redis) {}
  static fromUrl(url: string) {
    // Fail fast instead of queueing commands while Redis is down: the cache then just misses.
    return new RedisBackend(
      new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 500,
        lazyConnect: false,
      })
    );
  }
  get = (k: string) => this.redis.get(k);
  set = async (k: string, v: string, ttlMs: number) =>
    void (await this.redis.set(k, v, 'PX', ttlMs));
  setNx = async (k: string, v: string, ttlMs: number) =>
    (await this.redis.set(k, v, 'PX', ttlMs, 'NX')) === 'OK';
  del = async (...keys: string[]) => void (keys.length && (await this.redis.del(...keys)));
  incr = (k: string) => this.redis.incr(k);
  quit = () => this.redis.quit();
}

/** In-process backend with expiry, for tests. */
export class MemoryBackend implements CacheBackend {
  private m = new Map<string, { v: string; exp: number }>();
  calls = { get: 0, set: 0 };
  private live(k: string) {
    const e = this.m.get(k);
    if (e && e.exp <= Date.now()) this.m.delete(k);
    return this.m.get(k);
  }
  async get(k: string) {
    this.calls.get++;
    return this.live(k)?.v ?? null;
  }
  async set(k: string, v: string, ttlMs: number) {
    this.calls.set++;
    this.m.set(k, { v, exp: Date.now() + ttlMs });
  }
  async setNx(k: string, v: string, ttlMs: number) {
    if (this.live(k)) return false;
    this.m.set(k, { v, exp: Date.now() + ttlMs });
    return true;
  }
  async del(...keys: string[]) {
    keys.forEach((k) => this.m.delete(k));
  }
  async incr(k: string) {
    const n = Number(this.live(k)?.v ?? 0) + 1;
    this.m.set(k, { v: String(n), exp: Number.MAX_SAFE_INTEGER });
    return n;
  }
  ttlOf(k: string) {
    const e = this.live(k);
    return e ? e.exp - Date.now() : null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cache-aside over shared, non-personal data (problems, leaderboard, daily challenge).
 * Keys: `dsa:v1:<namespace>:...`. Lists use a generation number (`dsa:v1:gen:<ns>`) so one INCR
 * invalidates every variant at once; old generations simply expire.
 * Stampede protection: concurrent misses in this process share one load (single flight), and across
 * processes only the holder of a short Redis lock loads while the others wait briefly for its value.
 * TTLs get up to +10 % random jitter so keys written together don't expire together.
 * Redis down or not configured: every call loads from the database (the cache is an optimisation, never a dependency).
 */
export class Cache {
  readonly metrics = { hits: 0, misses: 0, errors: 0 };
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    private backend: CacheBackend | null,
    private opts: {
      prefix?: string;
      lockMs?: number;
      waitMs?: number;
      pollMs?: number;
      jitter?: () => number;
    } = {}
  ) {}

  private get prefix() {
    return this.opts.prefix ?? 'dsa:v1';
  }

  /** Runs a backend call; on failure counts an error and returns `fallback`. */
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch {
      this.metrics.errors++;
      return fallback;
    }
  }

  key(...parts: string[]) {
    return [this.prefix, ...parts].join(':');
  }

  /** Key inside the current generation of a namespace, e.g. problems list variants. */
  async genKey(ns: string, ...parts: string[]) {
    const gen = this.backend
      ? await this.safe(() => this.backend!.get(this.key('gen', ns)), null)
      : null;
    return this.key(ns, `g${gen ?? 0}`, ...parts);
  }

  async getOrLoad<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
    const b = this.backend;
    if (!b) return load();
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = this.fetch(b, key, ttlS, load).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fetch<T>(
    b: CacheBackend,
    key: string,
    ttlS: number,
    load: () => Promise<T>
  ): Promise<T> {
    const raw = await this.safe(() => b.get(key), null);
    if (raw !== null) {
      this.metrics.hits++;
      return JSON.parse(raw) as T;
    }
    this.metrics.misses++;
    const lock = `${key}:lock`;
    const leader = await this.safe(() => b.setNx(lock, '1', this.opts.lockMs ?? 5000), true);
    if (!leader) {
      // Someone else is loading this key: wait a little for their value instead of hitting the DB too.
      const deadline = Date.now() + (this.opts.waitMs ?? 2000);
      while (Date.now() < deadline) {
        await sleep(this.opts.pollMs ?? 50);
        const v = await this.safe(() => b.get(key), null);
        if (v !== null) return JSON.parse(v) as T;
      }
      return load(); // the leader is slow or died: serve this request uncached
    }
    try {
      const value = await load();
      const jitter = this.opts.jitter?.() ?? Math.random();
      await this.safe(
        () =>
          b.set(key, JSON.stringify(value ?? null), Math.round(ttlS * 1000 * (1 + 0.1 * jitter))),
        undefined
      );
      return value;
    } finally {
      await this.safe(() => b.del(lock), undefined);
    }
  }

  async invalidate(...keys: string[]) {
    if (this.backend) await this.safe(() => this.backend!.del(...keys), undefined);
  }

  async bumpGeneration(ns: string) {
    if (this.backend) await this.safe(() => this.backend!.incr(this.key('gen', ns)), 0);
  }

  async close() {
    if (this.backend instanceof RedisBackend) await this.backend.quit();
  }

  /** Prometheus text format, scraped from GET /metrics. */
  renderMetrics() {
    const { hits, misses, errors } = this.metrics;
    return [
      '# HELP dsa_cache_requests_total Cache lookups by result.',
      '# TYPE dsa_cache_requests_total counter',
      `dsa_cache_requests_total{result="hit"} ${hits}`,
      `dsa_cache_requests_total{result="miss"} ${misses}`,
      '# HELP dsa_cache_errors_total Redis calls that failed (served from the database instead).',
      '# TYPE dsa_cache_errors_total counter',
      `dsa_cache_errors_total ${errors}`,
      '',
    ].join('\n');
  }
}

/** One cache per process; null backend when REDIS_URL is unset (cache off). */
export function cacheFromEnv(url = process.env.REDIS_URL) {
  return new Cache(url ? RedisBackend.fromUrl(url) : null);
}
