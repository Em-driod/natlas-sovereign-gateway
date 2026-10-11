/**
 * Benchmark: N-ATLAS direct vs. through the gateway (cold) vs. gateway cache (warm).
 *   npm run bench                         # against the local mock
 *   GATEWAY_URL=https://... UPSTREAM_DIRECT_URL=... npm run bench
 * Writes a markdown table to bench-results.md.
 */
import { writeFileSync } from "node:fs";
import { Vault, redactText } from "../src/pii/redactor.js";

const GATEWAY = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const DIRECT = (process.env.UPSTREAM_DIRECT_URL ?? "http://127.0.0.1:9090/v1").replace(/\/$/, "");
const KEY = process.env.GATEWAY_KEY ?? "sk-natlas-demo-key";
const DIRECT_KEY = process.env.UPSTREAM_API_KEY ?? "";
const MODEL = process.env.UPSTREAM_MODEL ?? "n-atlas-8b";
const runId = Date.now().toString(36);

const PROMPTS = [
  "My customer NIN is 12345678901. Explain the loan policy in Pidgin.",
  "Translate 'Good morning, how can I help you today?' to Yoruba.",
  "Translate 'Good morning, how can I help you today?' to Hausa.",
  "Translate 'Good morning, how can I help you today?' to Igbo.",
  "What are the steps to register a business with CAC?",
  "Customer BVN 22345678901, phone 08031234567. Explain the loan policy.",
  "Explain how a POS agent can open a bank account for a customer.",
  "What documents do I need to apply for a small business loan in Nigeria?",
  "How do I report a failed transfer to my bank?",
  "Summarise the rights of a data subject under the NDPA 2023.",
].map((p, i) => `${p} (run ${runId}-${i})`);

// Gateway-side processing time on a miss (its total minus time spent waiting on N-ATLAS).
const overheads: number[] = [];

async function timed(url: string, key: string, prompt: string, extraHeaders: Record<string, string> = {}) {
  const t0 = performance.now();
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...extraHeaders },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
  });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const total = Number(res.headers.get("x-natlas-latency-ms") ?? NaN);
  const up = Number(res.headers.get("x-natlas-upstream-ms") ?? NaN);
  if (!Number.isNaN(total - up)) overheads.push(total - up);
  return { ms: performance.now() - t0, cache: res.headers.get("x-natlas-cache") ?? "-" };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { avg: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95) };
};

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<number>) {
  const out: number[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) out.push(await fn(items[i++]!));
    })
  );
  return out;
}

console.log(`Benchmarking ${PROMPTS.length} prompts\n  gateway: ${GATEWAY}\n  direct:  ${DIRECT}\n`);

const direct = await pool(PROMPTS, 5, async (p) => (await timed(DIRECT, DIRECT_KEY, p)).ms);
console.log("  direct N-ATLAS ............ done");
const cold = await pool(PROMPTS, 5, async (p) => (await timed(GATEWAY, KEY, p)).ms);
console.log("  gateway, cold (miss) ...... done");
const warm: number[] = [];
for (let r = 0; r < 3; r++) warm.push(...(await pool(PROMPTS, 5, async (p) => (await timed(GATEWAY, KEY, p)).ms)));
console.log("  gateway, warm (cache hit) . done");

// Redaction cost on its own.
const sample = "Customer Adaeze, BVN 22345678901, NIN 12345678901, phone 0803 123 4567, email a@b.ng, lives at No. 12, Adeola Odeku Street, Victoria Island, Lagos, GPS 6.6018, 3.3515.";
const N = 5000;
const tR = performance.now();
for (let i = 0; i < N; i++) redactText(sample, new Vault());
const redactUs = ((performance.now() - tR) / N) * 1000;

const d = stats(direct), c = stats(cold), w = stats(warm);
const fmt = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${x.toFixed(1)} ms`);
const table = `| Path | Requests | Avg | p50 | p95 |
|---|---:|---:|---:|---:|
| N-ATLAS direct (no gateway) | ${direct.length} | ${fmt(d.avg)} | ${fmt(d.p50)} | ${fmt(d.p95)} |
| Gateway, cache miss (redact + shield + forward) | ${cold.length} | ${fmt(c.avg)} | ${fmt(c.p50)} | ${fmt(c.p95)} |
| Gateway, cache hit | ${warm.length} | ${fmt(w.avg)} | ${fmt(w.p50)} | ${fmt(w.p95)} |

- Gateway overhead on a miss: **${fmt(stats(overheads).p50)}** at p50, measured inside the gateway (auth, rate limit, injection scan, PII redaction, audit).
- Cache hit vs direct: **${(d.p50 / w.p50).toFixed(0)}x faster** at p50 (${fmt(w.p50)} vs ${fmt(d.p50)}).
- PII redaction of a dense KYC sentence (7 identifiers): **${redactUs.toFixed(0)} µs** per call.
`;

console.log("\n" + table);
writeFileSync(
  "bench-results.md",
  `# Benchmark results\n\nRun ${new Date().toISOString()} against \`${DIRECT}\` (upstream) and \`${GATEWAY}\` (gateway), ${PROMPTS.length} distinct prompts, concurrency 5.\n\n${table}`
);
console.log("Saved bench-results.md");
