# NAIC 2026 submission: N-ATLAS Sovereign Gateway

Track: **Developer Infrastructure** (Problem Statement 01)

## Links

| | |
|---|---|
| Live gateway and dashboard | https://natlas-gateway.onrender.com |
| API base URL (OpenAI-compatible) | https://natlas-gateway.onrender.com/v1 (demo key `sk-natlas-demo-key`) |
| Source code | https://github.com/Em-driod/natlas-sovereign-gateway |
| N-ATLAS integration evidence | [N-ATLAS-INTEGRATION.md](N-ATLAS-INTEGRATION.md), `natlas-evidence.md` |
| Real-world validation | https://natlas-gateway.onrender.com/beta |
| NDPA compliance report (live) | https://natlas-gateway.onrender.com/admin/report |
| Video | _add link_ |

## One-line summary

A drop-in, OpenAI-compatible gateway that lets Nigerian banks, fintechs, hospitals and agencies use N-ATLAS without exposing a single BVN: it strips Nigerian personal data before the model sees it, caches repeated answers, blocks jailbreaks in Nigerian languages, and keeps a tamper-evident audit trail for regulators.

## Problem

Organisations that hold Nigerian personal data are the ones most likely to benefit from N-ATLAS, and the least able to adopt it. Under the NDPA 2023 they cannot send customer BVNs, NINs, phone numbers or home addresses to a model endpoint, expose internal networks to it, or explain to an auditor what happened to the data. Inference is also expensive and slow on Nigerian mobile networks, and the same questions are asked thousands of times a day.

## Solution

Developers change one line, the SDK's base URL. Every request then passes through:

1. **Authentication and limits:** hashed tenant keys, per-tenant rate limits and daily token budgets, and per-IP limits that cannot be spoofed.
2. **Prompt-injection defence** in English, Pidgin, Yoruba, Hausa, Igbo, French and Spanish, with de-obfuscation (spaced letters, leetspeak, look-alike characters, invisible characters, base64).
3. **Nigerian PII redaction:** BVN, NIN, phone, NUBAN account, card, email, names, passport, TIN, voter VIN, driver's licence and plate numbers. GPS and street addresses are coarsened to a district such as `[GPS_1:Lagos/Ikeja]`.
4. **Semantic cache** on redacted prompts, so answers are shared without sharing personal data, with guards so an answer is never reused across languages, agencies or negations.
5. **N-ATLAS** receives only the redacted prompt, with no client IP, cookies or identity.
6. **Restoration:** the caller's real values are put back into the answer (streaming included), and personal data the model leaks on its own is withheld (egress DLP).
7. **Audit:** a hash-chained, content-free audit record per request, and a one-click NDPA compliance report.

## N-ATLAS integration

- Built for N-ATLaS (`NCAIR1/N-ATLaS`, Llama-3 8B): OpenAI-compatible Chat Completions as served by vLLM, with streaming.
- Language-aware for the languages N-ATLAS serves: every prompt is labelled Yoruba, Hausa, Igbo, Pidgin or English; the label appears in headers, stats and the audit trail, and governs caching.
- Defends the Llama-3 chat template against role-token spoofing.
- The N-ATLAS endpoint can be switched at runtime (validated by a live call, persisted across restarts). A Colab notebook serves the official weights on vLLM.
- Evidence: `natlas-evidence.md` shows Yoruba, Hausa, Igbo, Pidgin and PII-heavy prompts, exactly what N-ATLAS received, its answers and the upstream model id. `bench-results.md` compares N-ATLAS direct, through the gateway, and from cache.

## Working artefact and technical rigour

- Live deployment on Render (Frankfurt) with Redis persistence: keys, audit chain, stats and feedback survive restarts.
- 43 automated tests, including end-to-end HTTP tests that run the real server: PII never reaches the model, the cache restores each caller's own values, spoofed IPs are ignored, obfuscated jailbreaks are blocked, egress DLP, streaming, zero retention, sandbox keys, feedback, upstream hot-swap, and audit and report integrity.
- GitHub Actions CI (typecheck, tests, dependency audit, live smoke test with Redis) and a scheduled uptime check every 10 minutes.
- `npm audit`: 0 vulnerabilities.
- Measured results: about 1 ms of gateway overhead per request; cache hits answered in about 11 ms versus about 1.5 s for inference in the benchmark; injection filter evaluated on three rounds of attacks and 30 normal questions, with honest before-tuning scores reported (`npm run eval:injection`).

## Real-world validation

External developers get a sandbox key from the dashboard's Developers tab, build against the gateway, and leave a rating and comments. `/beta` shows each opted-in tester, **their request count from the audit trail** (not self-reported), and their feedback. _Add tester count and highlights at submission time._

## Impact

- Unlocks N-ATLAS for regulated sectors (banking, fintech, health, government) that hold the most sensitive data and serve the most Nigerians.
- Keeps data in Nigeria: the gateway and N-ATLAS can both run on Nigerian infrastructure.
- Cuts inference cost and latency for repeated questions, which matters on mobile data.
- Gives NDPC, NITDA and CBN reviewers a verifiable record without exposing any conversation content.

## Scalability and sustainability

- Stateless Node.js process plus Redis; scales horizontally behind any load balancer.
- Model: free sandbox, a per-request tier for startups, and an enterprise tier (self-hosted in a Nigerian data centre, custom redaction rules, monthly NDPA reports, SLA).
- Every cache hit is an inference that never runs, so the gateway pays for itself as repeated traffic grows.

## Honest limits

- PII detection is pattern- and context-based: fast and predictable, but it can miss free-form names without a cue word.
- The injection filter catches known shapes and obfuscation reliably, but freely reworded attacks can still pass (about 2 in 10 on unseen rounds before tuning). A model-based second check is the next step.
- On the free hosting tier, the real N-ATLAS runs on a temporary GPU; production would use a dedicated GPU or NCAIR's API.

## Team

_Add names, roles and relevant experience._
