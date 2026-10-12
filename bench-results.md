# Benchmark results

Run 2026-10-12T20:58:44.288Z against `https://located-senator-cap-scanned.trycloudflare.com/v1` (upstream) and `https://natlas-gateway.onrender.com/v1` (gateway), 10 distinct prompts, concurrency 1.

| Path | Requests | Avg | p50 | p95 |
|---|---:|---:|---:|---:|
| N-ATLAS direct (no gateway) | 10 | 6.91 s | 8.34 s | 12.62 s |
| Gateway, cache miss (redact + shield + forward) | 10 | 6.13 s | 4.20 s | 11.20 s |
| Gateway, cache hit | 30 | 258.8 ms | 265.4 ms | 308.1 ms |

- Gateway overhead on a miss: **7.0 ms** at p50, measured inside the gateway (auth, rate limit, injection scan, PII redaction, audit).
- Cache hit vs direct: **31x faster** at p50 (265.4 ms vs 8.34 s).
- PII redaction of a dense KYC sentence (7 identifiers): **164 µs** per call.
