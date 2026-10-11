import { config } from "./config.js";
import { createStore, type KvStore } from "./cache/store.js";
import { SemanticCache } from "./cache/semantic-cache.js";
import { TenantRegistry, hashKey } from "./security/tenants.js";
import { AuditLog } from "./audit/audit-log.js";
import { Stats } from "./lib/stats.js";

export interface GatewayContext {
  store: KvStore;
  cache: SemanticCache;
  tenants: TenantRegistry;
  audit: AuditLog;
  stats: Stats;
}

export async function createContext(): Promise<GatewayContext> {
  const store = await createStore(config.redisUrl, config.cache.maxEntries);
  const cache = new SemanticCache(store, {
    ttlSeconds: config.cache.ttlSeconds,
    semantic: config.cache.semantic,
    threshold: config.cache.semanticThreshold,
    maxEntries: config.cache.maxEntries,
  });
  const tenants = new TenantRegistry(config.tenantsFile);

  // Demo tenants for local runs and judging; disable with DEMO_API_KEY="" in production.
  const demoKey = process.env.DEMO_API_KEY ?? "sk-natlas-demo-key";
  if (demoKey) {
    tenants.add({ id: "demo", name: "Demo Fintech Ltd", keyHash: hashKey(demoKey), rpm: 120, dailyTokenBudget: 2_000_000, zeroRetention: false }, false);
    tenants.add({ id: "demo-zero-retention", name: "Demo Hospital (zero-retention)", keyHash: hashKey(`${demoKey}-zr`), rpm: 60, dailyTokenBudget: 500_000, zeroRetention: true }, false);
  }

  return { store, cache, tenants, audit: new AuditLog(config.auditFile), stats: new Stats() };
}
