import { readFileSync, existsSync } from "node:fs";

// Minimal .env loader: real environment variables win over the file.
function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key!] === undefined) {
      process.env[key!] = raw!.replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

const env = (k: string, d: string) => process.env[k] ?? d;
const num = (k: string, d: number) => Number(process.env[k] ?? d);
const bool = (k: string, d: boolean) => {
  const v = process.env[k];
  return v === undefined ? d : /^(1|true|yes|on)$/i.test(v);
};

export const config = {
  port: num("PORT", 8080),
  // Not HOST: some platforms (Render) set HOST to the machine hostname, which breaks public binding.
  host: env("BIND_HOST", "0.0.0.0"),

  /** Any OpenAI-compatible N-ATLAS server: vLLM, Ollama, Featherless, HF TGI, or the bundled mock. */
  upstreamUrl: env("UPSTREAM_URL", "http://127.0.0.1:9090/v1").replace(/\/$/, ""),
  upstreamApiKey: env("UPSTREAM_API_KEY", ""),
  /** Model name the upstream expects. Clients send "n-atlas-8b"; we map it. */
  upstreamModel: env("UPSTREAM_MODEL", "n-atlas-8b"),
  upstreamTimeoutMs: num("UPSTREAM_TIMEOUT_MS", 60_000),

  redisUrl: env("REDIS_URL", ""),

  cache: {
    enabled: bool("CACHE_ENABLED", true),
    ttlSeconds: num("CACHE_TTL_SECONDS", 86_400),
    semantic: bool("SEMANTIC_CACHE", true),
    /** Cosine similarity needed for a semantic hit (0..1). */
    semanticThreshold: num("SEMANTIC_THRESHOLD", 0.86),
    /** Requests above this temperature are creative; never served from cache. */
    maxCacheableTemperature: num("MAX_CACHEABLE_TEMPERATURE", 0.8),
    maxEntries: num("CACHE_MAX_ENTRIES", 5_000),
  },

  security: {
    /** "block" rejects suspected prompt injection; "flag" only audits it. */
    injectionMode: env("INJECTION_MODE", "block") as "block" | "flag",
    injectionThreshold: num("INJECTION_THRESHOLD", 0.7),
    ipRateLimitPerMinute: num("IP_RATE_LIMIT_PER_MINUTE", 120),
    maxBodyBytes: num("MAX_BODY_BYTES", 256 * 1024),
  },

  /** Open the gateway without keys (local demos only). */
  allowAnonymous: bool("ALLOW_ANONYMOUS", false),
  adminToken: env("ADMIN_TOKEN", ""),
  tenantsFile: env("TENANTS_FILE", "data/tenants.json"),
  auditFile: env("AUDIT_FILE", "data/audit.jsonl"),
  /** Secret used to pseudonymise end-user ids before they reach the model. */
  pseudonymSecret: env("PSEUDONYM_SECRET", "dev-only-change-me"),
  logLevel: env("LOG_LEVEL", "info"),
};

export type Config = typeof config;
