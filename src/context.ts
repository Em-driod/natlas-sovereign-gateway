import { config } from "./config.js";
import { createStore, type KvStore } from "./cache/store.js";
import { SemanticCache } from "./cache/semantic-cache.js";
import { TenantRegistry, hashKey } from "./security/tenants.js";
import { AuditLog } from "./audit/audit-log.js";
import { Stats } from "./lib/stats.js";
import { loadUpstream } from "./upstream/registry.js";

export interface GatewayContext {
  store: KvStore;
  cache: SemanticCache;
  tenants: TenantRegistry;
  audit: AuditLog;
  stats: Stats;
  /** Persist stats now (also runs on an interval and at shutdown). */
  saveStats(): Promise<void>;
  stop(): void;
}

const STATS_KEY = "stats:v1";

export async function createContext(): Promise<GatewayContext> {
  const store = await createStore(config.redisUrl, config.cache.maxEntries);
  const cache = new SemanticCache(store, {
    ttlSeconds: config.cache.ttlSeconds,
    semantic: config.cache.semantic,
    threshold: config.cache.semanticThreshold,
    maxEntries: config.cache.maxEntries,
  });

  // An upstream chosen at runtime (POST /admin/upstream) overrides the environment.
  await loadUpstream(store);

  const tenants = new TenantRegistry(config.tenantsFile);
  await tenants.attach(store);
  // Demo tenants for local runs and judging; disable with DEMO_API_KEY="" in production.
  const demoKey = process.env.DEMO_API_KEY ?? "sk-natlas-demo-key";
  if (demoKey) {
    await tenants.add({ id: "demo", name: "Demo Fintech Ltd", keyHash: hashKey(demoKey), rpm: 120, dailyTokenBudget: 2_000_000, zeroRetention: false }, { durable: false });
    await tenants.add({ id: "demo-zero-retention", name: "Demo Hospital (zero-retention)", keyHash: hashKey(`${demoKey}-zr`), rpm: 60, dailyTokenBudget: 500_000, zeroRetention: true }, { durable: false });
  }

  const audit = await new AuditLog(config.auditFile, store).init();

  // Dashboard counters survive restarts and redeploys when a durable store is configured.
  const stats = new Stats();
  const saved = await store.getDurable(STATS_KEY).catch(() => null);
  if (saved) stats.restore(JSON.parse(saved));
  const saveStats = () => store.setDurable(STATS_KEY, JSON.stringify(stats.toJSON())).catch(() => undefined);
  const timer = setInterval(saveStats, 10_000);
  timer.unref();

  return { store, cache, tenants, audit, stats, saveStats, stop: () => clearInterval(timer) };
}
