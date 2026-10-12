/**
 * Point the live gateway at a real N-ATLaS endpoint (e.g. the Colab notebook's output),
 * then produce integration evidence and a benchmark against the real model.
 *
 *   npm run connect -- --url https://xxxx.trycloudflare.com/v1 --key natlas-xxxx [--label "NCAIR1/N-ATLaS on vLLM (Colab GPU)"]
 *
 * Reads ADMIN_TOKEN from .env (or the environment). GATEWAY_URL defaults to the live deployment.
 */
import { execSync } from "node:child_process";
import "../src/config.js"; // loads .env

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = arg("url")?.replace(/\/$/, "");
const key = arg("key") ?? "";
const label = arg("label") ?? "NCAIR1/N-ATLaS on vLLM (Colab GPU)";
const gateway = (process.env.GATEWAY_URL ?? "https://natlas-gateway.onrender.com/v1").replace(/\/$/, "");
const root = gateway.replace(/\/v1$/, "");
const admin = process.env.ADMIN_TOKEN;

if (!url) {
  console.error("Usage: npm run connect -- --url <upstream /v1 url> --key <upstream key> [--label <name>]");
  process.exit(1);
}
if (!admin) {
  console.error("ADMIN_TOKEN is not set (put it in .env).");
  process.exit(1);
}

console.log(`1/3  Switching ${root} to ${url} …`);
const res = await fetch(`${root}/admin/upstream`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${admin}` },
  body: JSON.stringify({ url, apiKey: key, model: "n-atlas-8b", label }),
});
const body = (await res.json()) as { ok: boolean; error?: string; sample?: string; model?: string; upstream?: unknown };
if (!body.ok) {
  console.error(`     Switch refused (the gateway validates first, so nothing changed): ${body.error}`);
  process.exit(1);
}
console.log(`     Live. Upstream model id: ${body.model}. Sample reply: ${(body.sample ?? "").trim().slice(0, 120)}`);

const run = (cmd: string, env: Record<string, string>) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

console.log("\n2/3  Generating natlas-evidence.md …");
run("npx tsx scripts/natlas-evidence.ts", { GATEWAY_URL: gateway });

console.log("\n3/3  Benchmarking N-ATLaS direct vs gateway vs cache …");
run("npx tsx scripts/benchmark.ts", { GATEWAY_URL: gateway, UPSTREAM_DIRECT_URL: url, UPSTREAM_API_KEY: key, UPSTREAM_MODEL: "n-atlas-8b", BENCH_CONCURRENCY: "1" });

console.log("\nDone. Commit natlas-evidence.md and bench-results.md as integration evidence.");
