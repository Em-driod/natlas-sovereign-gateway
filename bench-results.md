# Benchmark results

Run 2026-10-11T08:19:48.615Z against `http://127.0.0.1:9090/v1` (upstream) and `http://127.0.0.1:8080/v1` (gateway), 10 distinct prompts, concurrency 5.

| Path | Requests | Avg | p50 | p95 |
|---|---:|---:|---:|---:|
| N-ATLAS direct (no gateway) | 10 | 1.44 s | 1.51 s | 1.67 s |
| Gateway, cache miss (redact + shield + forward) | 10 | 1.48 s | 1.57 s | 1.67 s |
| Gateway, cache hit | 30 | 13.9 ms | 10.9 ms | 33.8 ms |

- Gateway overhead on a miss: **1.0 ms** at p50, measured inside the gateway (auth, rate limit, injection scan, PII redaction, audit).
- Cache hit vs direct: **138x faster** at p50 (10.9 ms vs 1.51 s).
- PII redaction of a dense KYC sentence (7 identifiers): **22 µs** per call.
