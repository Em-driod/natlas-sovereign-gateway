import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KvStore } from "../cache/store.js";

export interface Tenant {
  id: string;
  name: string;
  /** SHA-256 of the API key; the key itself is never stored. */
  keyHash: string;
  /** Requests per minute for this tenant. */
  rpm: number;
  /** Token ceiling per UTC day, so a startup never wakes up to a surprise bill. */
  dailyTokenBudget: number;
  /** Never cache this tenant's prompts or answers, and keep no content anywhere. */
  zeroRetention: boolean;
  /** Sandbox sign-ups: when the key was created, and optional details the tester chose to share. */
  createdAt?: string;
  org?: string;
  contact?: string;
  /** Tester agreed to be listed on the public beta-evidence page. */
  listPublicly?: boolean;
}

export const KEY_PREFIX = "sk-natlas-";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export class TenantRegistry {
  private byHash = new Map<string, Tenant>();
  private store?: KvStore;
  private static readonly KEY = "tenants:v1";

  constructor(private readonly file: string) {
    this.reload();
  }

  reload(): void {
    this.byHash.clear();
    if (!existsSync(this.file)) return;
    const list = JSON.parse(readFileSync(this.file, "utf8")) as Tenant[];
    for (const t of list) this.byHash.set(t.keyHash, t);
  }

  /** Load tenants (including sandbox keys) kept in a durable store, so keys survive restarts. */
  async attach(store: KvStore): Promise<void> {
    this.store = store;
    const raw = await store.getDurable(TenantRegistry.KEY);
    for (const t of raw ? (JSON.parse(raw) as Tenant[]) : []) this.byHash.set(t.keyHash, t);
  }

  /** Register a tenant. Non-demo tenants go to the durable store; `toFile` also writes the local tenants file (CLI use). */
  add(t: Tenant, opts: { toFile?: boolean; durable?: boolean } = {}): Promise<void> {
    this.byHash.set(t.keyHash, t);
    const persisted = [...this.byHash.values()].filter((x) => !x.id.startsWith("demo"));
    if (opts.toFile) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(persisted.filter((x) => !x.id.startsWith("sandbox-")), null, 2));
    }
    if (opts.durable !== false && this.store && !t.id.startsWith("demo")) {
      return this.store.setDurable(TenantRegistry.KEY, JSON.stringify(persisted));
    }
    return Promise.resolve();
  }

  authenticate(key: string): Tenant | undefined {
    if (!key.startsWith(KEY_PREFIX)) return undefined;
    const h = hashKey(key);
    const t = this.byHash.get(h);
    // Constant-time confirm of the hash match.
    if (t && timingSafeEqual(Buffer.from(t.keyHash), Buffer.from(h))) return t;
    return undefined;
  }

  list(): Tenant[] {
    return [...this.byHash.values()];
  }
}

/** Fixed-window limiter on the shared store (per tenant, per IP). */
export async function rateLimit(store: KvStore, key: string, limit: number, windowSeconds = 60) {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const count = await store.incr(`rl:${key}:${bucket}`, 1, windowSeconds + 1);
  const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter };
}

const today = () => new Date().toISOString().slice(0, 10);

export async function tokensUsedToday(store: KvStore, tenantId: string): Promise<number> {
  return Number((await store.get(`budget:${tenantId}:${today()}`)) ?? 0);
}

export async function chargeTokens(store: KvStore, tenantId: string, tokens: number): Promise<number> {
  return store.incr(`budget:${tenantId}:${today()}`, tokens, 26 * 3600);
}

/** Stable pseudonym for an end-user id: the model can tell users apart, never who they are. */
export function pseudonymise(secret: string, value: string): string {
  return "u_" + createHmac("sha256", secret).update(value).digest("hex").slice(0, 16);
}
