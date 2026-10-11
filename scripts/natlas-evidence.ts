/**
 * Produces N-ATLAS integration evidence: runs multilingual and PII-heavy prompts
 * through the gateway against whichever upstream it is configured with, and writes
 * natlas-evidence.md (questions, answers, model id, latency, redactions, language).
 *
 *   GATEWAY_URL=https://natlas-sovereign-gateway.onrender.com/v1 npm run evidence
 */
import { writeFileSync } from "node:fs";

const GATEWAY = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const ROOT = GATEWAY.replace(/\/v1$/, "");
const KEY = process.env.GATEWAY_KEY ?? "sk-natlas-demo-key";

const PROBES = [
  { lang: "Yoruba", prompt: "Translate 'Good morning, how can I help you today?' to Yoruba." },
  { lang: "Hausa", prompt: "Translate 'Good morning, how can I help you today?' to Hausa." },
  { lang: "Igbo", prompt: "Translate 'Good morning, how can I help you today?' to Igbo." },
  { lang: "Pidgin", prompt: "Abeg explain wetin BVN be and why bank dey ask for am. Make e short." },
  { lang: "English + PII", prompt: "Customer Adaeze Okafor, BVN 22345678901, phone 0803 123 4567, lives at No. 12, Adeola Odeku Street, Victoria Island, Lagos. Is she eligible for a POS terminal?" },
];

const health = (await (await fetch(`${ROOT}/healthz`)).json()) as { upstream: { mode: string; model: string; provider: string } };
console.log(`Upstream: ${health.upstream.mode} · ${health.upstream.provider} · model ${health.upstream.model}\n`);

const rows: string[] = [];
for (const p of PROBES) {
  const t0 = performance.now();
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-natlas-debug": "1", "x-natlas-cache": "bypass" },
    body: JSON.stringify({ model: "n-atlas-8b", temperature: 0.2, max_tokens: 200, messages: [{ role: "user", content: p.prompt }] }),
  });
  const ms = Math.round(performance.now() - t0);
  const body = (await res.json()) as any;
  const answer = body.choices?.[0]?.message?.content ?? JSON.stringify(body.error ?? body);
  const saw = body.natlas?.model_saw?.[0]?.content ?? "";
  console.log(`[${p.lang}] ${ms} ms\n  Q: ${p.prompt}\n  A: ${answer.slice(0, 300)}\n`);
  rows.push(`### ${p.lang}

| | |
|---|---|
| **Prompt (from the user)** | ${p.prompt.replace(/\|/g, "\\|")} |
| **What N-ATLAS received** | ${saw.replace(/\|/g, "\\|")} |
| **Answer returned to the user** | ${answer.replace(/\n+/g, " ").replace(/\|/g, "\\|")} |
| Upstream model id | \`${body.natlas?.upstream_model ?? "–"}\` |
| Detected language | \`${res.headers.get("x-natlas-language") ?? "–"}\` |
| Redactions | \`${res.headers.get("x-natlas-redactions") ?? "–"}\` |
| Gateway trace | \`${res.headers.get("x-natlas-trace") ?? "–"}\` |
| Round trip | ${ms} ms |
`);
}

const doc = `# N-ATLAS integration evidence

Generated ${new Date().toISOString()} by \`npm run evidence\` against \`${GATEWAY}\`.

**Upstream:** ${health.upstream.mode === "mock" ? "⚠️ built-in mock (not the real model)" : `${health.upstream.provider}`} · served model name \`${health.upstream.model}\`

Each prompt below went through the full gateway pipeline (auth, rate limit, injection scan, PII redaction, cache bypassed, N-ATLAS, restoration). "What N-ATLAS received" is the exact redacted prompt the model saw.

${rows.join("\n")}
`;
writeFileSync("natlas-evidence.md", doc);
console.log("Saved natlas-evidence.md");
