import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KvStore } from "../cache/store.js";

/**
 * Tamper-evident audit trail for regulators (NDPC, NITDA, CBN).
 * Records *what happened* to each request (redaction counts, cache result,
 * injection verdict, latency), never prompt or response content.
 * Each record carries the hash of the previous one, so any edit or deletion breaks the chain.
 */
export interface AuditEvent {
  requestId: string;
  tenantId: string;
  route: string;
  model: string;
  status: number;
  outcome: "served" | "cache_hit" | "blocked_injection" | "rate_limited" | "budget_exceeded" | "unauthorized" | "upstream_error" | "bad_request";
  cache: "exact" | "semantic" | "miss" | "bypass";
  redactions: Record<string, number>;
  injectionScore: number;
  injectionRules: string[];
  latencyMs: number;
  upstreamMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  zeroRetention: boolean;
  stream: boolean;
  /** Detected prompt language (yo, ha, ig, pcm, en). */
  language?: string;
  /** Raw PII caught in the model's output (egress DLP), by type. */
  egressRedactions?: Record<string, number>;
}

export interface AuditRecord extends AuditEvent {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);
const KEY = "audit:v1";
/** Records kept in Redis (about 10 MB). Older ones roll off, and verification then starts from the oldest kept record. */
const MAX_RECORDS = 20_000;
const digest = (r: Omit<AuditRecord, "hash">) => createHash("sha256").update(JSON.stringify(r)).digest("hex");

export class AuditLog {
  private lastHash = GENESIS;
  private seq = 0;
  private recent: AuditRecord[] = [];
  private pending: Promise<unknown> = Promise.resolve();

  /** With a Redis store the trail lives in Redis and survives restarts and redeploys; otherwise it is a JSONL file. */
  constructor(private readonly file: string, private readonly store?: KvStore) {
    mkdirSync(dirname(file), { recursive: true });
  }

  private get durable(): boolean {
    return this.store?.kind === "redis";
  }

  private async lines(): Promise<string[]> {
    await this.pending;
    if (this.durable) return this.store!.range(KEY, 0, -1);
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
  }

  /** Resume the chain from the last stored record. */
  async init(): Promise<this> {
    const lines = this.durable ? await this.store!.range(KEY, -200, -1) : (await this.lines()).slice(-200);
    for (const l of lines) this.recent.push(JSON.parse(l) as AuditRecord);
    const last = this.recent[this.recent.length - 1];
    if (last) {
      this.lastHash = last.hash;
      this.seq = last.seq;
    }
    return this;
  }

  write(e: AuditEvent): AuditRecord {
    const base = { seq: ++this.seq, ts: new Date().toISOString(), ...e, prevHash: this.lastHash };
    const rec: AuditRecord = { ...base, hash: digest(base) };
    this.lastHash = rec.hash;
    const line = JSON.stringify(rec);
    if (this.durable) {
      // Chained so records land in order even under concurrent requests.
      this.pending = this.pending
        .then(() => this.store!.push(KEY, line, MAX_RECORDS))
        .catch((err) => console.warn("[audit] write failed:", (err as Error).message));
    } else {
      appendFileSync(this.file, line + "\n");
    }
    this.recent.push(rec);
    if (this.recent.length > 200) this.recent.shift();
    return rec;
  }

  /** Resolves once every queued write has reached the store. */
  flush(): Promise<unknown> {
    return this.pending;
  }

  tail(n = 50): AuditRecord[] {
    return this.recent.slice(-n).reverse();
  }

  /** Aggregate the whole trail for the compliance report (counts only, like the log itself). */
  async summarize() {
    const lines = await this.lines();
    const s = {
      records: lines.length,
      from: "",
      to: "",
      outcomes: {} as Record<string, number>,
      redactions: {} as Record<string, number>,
      egressRedactions: {} as Record<string, number>,
      injectionRules: {} as Record<string, number>,
      languages: {} as Record<string, number>,
      tenants: new Set<string>(),
      requestsByTenant: {} as Record<string, number>,
      zeroRetentionRequests: 0,
      requestsWithPii: 0,
      cacheHits: 0,
      cacheLookups: 0,
      upstreamCalls: 0,
      lastHash: "",
    };
    for (const l of lines) {
      const r = JSON.parse(l) as AuditRecord;
      s.from ||= r.ts;
      s.to = r.ts;
      s.lastHash = r.hash;
      s.outcomes[r.outcome] = (s.outcomes[r.outcome] ?? 0) + 1;
      let pii = 0;
      for (const [k, v] of Object.entries(r.redactions ?? {})) {
        s.redactions[k] = (s.redactions[k] ?? 0) + v;
        pii += v;
      }
      for (const [k, v] of Object.entries(r.egressRedactions ?? {})) s.egressRedactions[k] = (s.egressRedactions[k] ?? 0) + v;
      if (pii) s.requestsWithPii++;
      if (r.language) s.languages[r.language] = (s.languages[r.language] ?? 0) + 1;
      for (const rule of r.injectionRules ?? []) if (r.outcome === "blocked_injection") s.injectionRules[rule] = (s.injectionRules[rule] ?? 0) + 1;
      if (r.tenantId && r.tenantId !== "unknown") {
        s.tenants.add(r.tenantId);
        s.requestsByTenant[r.tenantId] = (s.requestsByTenant[r.tenantId] ?? 0) + 1;
      }
      if (r.zeroRetention) s.zeroRetentionRequests++;
      if (r.cache === "exact" || r.cache === "semantic") s.cacheHits++;
      if (r.cache !== "bypass" && (r.outcome === "served" || r.outcome === "cache_hit")) s.cacheLookups++;
      if (r.upstreamMs !== undefined) s.upstreamCalls++;
    }
    return { ...s, tenants: [...s.tenants] };
  }

  /** Re-walk the trail and confirm no record was edited, removed or reordered. */
  async verify(): Promise<{ ok: boolean; records: number; brokenAt?: number; fromSeq?: number }> {
    const lines = await this.lines();
    if (!lines.length) return { ok: true, records: 0 };
    const first = JSON.parse(lines[0]!) as AuditRecord;
    // A trimmed Redis trail starts mid-chain: anchor on its first record's link.
    let prev = first.seq === 1 ? GENESIS : first.prevHash;
    for (const line of lines) {
      const rec = JSON.parse(line) as AuditRecord;
      const { hash, ...rest } = rec;
      if (rec.prevHash !== prev || digest(rest) !== hash) return { ok: false, records: lines.length, brokenAt: rec.seq, fromSeq: first.seq };
      prev = hash;
    }
    return { ok: true, records: lines.length, fromSeq: first.seq };
  }
}
