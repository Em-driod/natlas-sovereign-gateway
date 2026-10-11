import { Redis } from "ioredis";

/** Minimal key/value store with TTL: in-memory LRU by default, Redis when REDIS_URL is set. */
export interface KvStore {
  readonly kind: "memory" | "redis";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  incr(key: string, by: number, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
}

export class MemoryStore implements KvStore {
  readonly kind = "memory" as const;
  private map = new Map<string, { v: string; exp: number }>();
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
  async close() {
    await this.redis.quit();
  }
}

export async function createStore(redisUrl: string, maxEntries: number): Promise<KvStore> {
  if (!redisUrl) return new MemoryStore(maxEntries);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
  try {
    await redis.connect();
    await redis.ping();
    return new RedisStore(redis);
  } catch (err) {
    redis.disconnect();
    console.warn(`[store] Redis unreachable at ${redisUrl}; falling back to in-memory store.`, (err as Error).message);
    return new MemoryStore(maxEntries);
  }
}
