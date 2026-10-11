/**
 * Create a tenant API key offline (the gateway stores only its SHA-256).
 *   npm run key -- "Kuda Bank" --rpm 300 --budget 5000000 [--zero-retention]
 * Restart the gateway (or POST /admin/tenants while it runs) to pick it up.
 */
import { config } from "../src/config.js";
import { TenantRegistry, generateKey, hashKey } from "../src/security/tenants.js";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? "New Tenant";
const flag = (f: string, d: number) => {
  const i = args.indexOf(f);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const key = generateKey();
const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
new TenantRegistry(config.tenantsFile).add({
  id, name, keyHash: hashKey(key),
  rpm: flag("--rpm", 60),
  dailyTokenBudget: flag("--budget", 500_000),
  zeroRetention: args.includes("--zero-retention"),
});
console.log(`Tenant: ${name} (${id})\nAPI key (shown once): ${key}\nSaved hash to ${config.tenantsFile}`);
