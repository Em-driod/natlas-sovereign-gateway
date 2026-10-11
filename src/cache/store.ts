import { Redis } from "ioredis";

/**
 * Minimal store: in-memory by default, Redis when REDIS_URL is set.
 * TTL keys hold the cache, rate limits and budgets; durable keys and lists hold
 * tenants, the audit trail, stats and beta feedback so they survive restarts.
 */
export interface KvStore {
  readonly kind: "memory" | "redis";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  incr(key: string, by: number, ttlSeconds: number): Promise<number>;
  /** Durable value with no expiry. */
  getDurable(key: string): Promise<string | null>;
  setDurable(key: string, value: string): Promise<void>;
  /** Append to a durable list, keeping at most `max` newest items. */
  push(key: string, value: string, max: number): Promise<void>;
  /** Items in insertion order; negative indexes count from the end. */
  range(key: string, start: number, stop: number): Promise<string[]>;
  close(): Promise<void>;
}

export class MemoryStore implements KvStore {
  readonly kind = "memory" as const;
  private map = new Map<string, { v: string; exp: number }>();
  private durable = new Map<string, string>();
  private lists = new Map<string, string[]>();
  constructor(private readonly maxEntries = 10_000) {}

  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    // Refresh LRU position.
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.map.delete(key);
    this.map.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  async incr(key: string, by: number, ttlSeconds: number): Promise<number> {
    const cur = Number((await this.get(key)) ?? 0) + by;
    const e = this.map.get(key);
    const exp = e && e.exp > Date.now() ? e.exp : Date.now() + ttlSeconds * 1000;
    this.map.set(key, { v: String(cur), exp });
    return cur;
  }

  async getDurable(key: string) {
    return this.durable.get(key) ?? null;
  }
  async setDurable(key: string, value: string) {
    this.durable.set(key, value);
  }
  async push(key: string, value: string, max: number) {
    const l = this.lists.get(key) ?? [];
    l.push(value);
    if (l.length > max) l.splice(0, l.length - max);
    this.lists.set(key, l);
  }
  async range(key: string, start: number, stop: number) {
    const l = this.lists.get(key) ?? [];
    const norm = (i: number) => (i < 0 ? Math.max(0, l.length + i) : i);
    return l.slice(norm(start), norm(stop) + 1);
  }

  async close(): Promise<void> {}
}

export class RedisStore implements KvStore {
  readonly kind = "redis" as const;
  constructor(private readonly redis: Redis) {}

  get(key: string) {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }
  async incr(key: string, by: number, ttlSeconds: number) {
    const n = await this.redis.incrby(key, by);
    if (n === by) await this.redis.expire(key, ttlSeconds);
    return n;
  }
  getDurable(key: string) {
    return this.redis.get(key);
  }
  async setDurable(key: string, value: string) {
    await this.redis.set(key, value);
  }
  async push(key: string, value: string, max: number) {
    await this.redis.multi().rpush(key, value).ltrim(key, -max, -1).exec();
  }
  range(key: string, start: number, stop: number) {
    return this.redis.lrange(key, start, stop);
  }
  async close() {
    await this.redis.quit();
  }
}

export async function createStore(redisUrl: string, maxEntries: number): Promise<KvStore> {
  if (!redisUrl) return new MemoryStore(maxEntries);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  try {
    await redis.connect();
    await redis.ping();
    return new RedisStore(redis);
  } catch (err) {
    redis.disconnect();
    console.warn(`[store] Redis unreachable; falling back to in-memory store.`, (err as Error).message);
    return new MemoryStore(maxEntries);
  }
}
