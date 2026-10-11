const r1 = (x: number) => Math.round(x * 10) / 10;

/** In-process aggregates for the dashboard. Counts and timings only, never content. */
class LatencySeries {
  private values: number[] = [];
  constructor(private readonly max = 500) {}
  add(ms: number) {
    this.values.push(ms);
    if (this.values.length > this.max) this.values.shift();
  }
  summary() {
    if (!this.values.length) return { count: 0, avg: 0, p50: 0, p95: 0 };
    const s = [...this.values].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
    return {
      count: s.length,
      avg: r1(s.reduce((a, b) => a + b, 0) / s.length),
      p50: r1(q(0.5)),
      p95: r1(q(0.95)),
    };
  }
}

export class Stats {
  readonly startedAt = Date.now();
  requests = 0;
  cacheExact = 0;
  cacheSemantic = 0;
  cacheMiss = 0;
  blockedInjection = 0;
  rateLimited = 0;
  budgetExceeded = 0;
  upstreamErrors = 0;
  tokensSaved = 0;
  tokensServed = 0;
  bytesSavedByCompression = 0;
  redactions: Record<string, number> = {};
  readonly cachedLatency = new LatencySeries();
  readonly upstreamLatency = new LatencySeries();

  addRedactions(counts: Record<string, number | undefined>) {
    for (const [k, v] of Object.entries(counts)) this.redactions[k] = (this.redactions[k] ?? 0) + (v ?? 0);
  }

  snapshot() {
    const hits = this.cacheExact + this.cacheSemantic;
    const lookups = hits + this.cacheMiss;
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      requests: this.requests,
      cache: {
        exact: this.cacheExact,
        semantic: this.cacheSemantic,
        miss: this.cacheMiss,
        hitRate: lookups ? Math.round((hits / lookups) * 1000) / 10 : 0,
      },
      latency: { cached: this.cachedLatency.summary(), upstream: this.upstreamLatency.summary() },
      security: {
        blockedInjection: this.blockedInjection,
        rateLimited: this.rateLimited,
        budgetExceeded: this.budgetExceeded,
      },
      upstreamErrors: this.upstreamErrors,
      redactions: this.redactions,
      redactionsTotal: Object.values(this.redactions).reduce((a, b) => a + b, 0),
      tokens: { served: this.tokensServed, savedByCache: this.tokensSaved },
    };
  }
}
