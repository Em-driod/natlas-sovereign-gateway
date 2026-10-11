import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Tamper-evident audit trail for regulators (NDPC, NITDA, CBN).
 * Records *what happened* to each request (redaction counts, cache result,
 * injection verdict, latency), never prompt or response content.
 * Each line carries the hash of the previous one, so any edit or deletion breaks the chain.
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
}

export interface AuditRecord extends AuditEvent {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);
const digest = (r: Omit<AuditRecord, "hash">) => createHash("sha256").update(JSON.stringify(r)).digest("hex");

export class AuditLog {
  private lastHash = GENESIS;
  private seq = 0;
  private recent: AuditRecord[] = [];

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
      for (const l of lines.slice(-200)) this.recent.push(JSON.parse(l) as AuditRecord);
      const last = this.recent[this.recent.length - 1];
      if (last) {
        this.lastHash = last.hash;
        this.seq = last.seq;
      }
    }
  }

  write(e: AuditEvent): AuditRecord {
    const base = { seq: ++this.seq, ts: new Date().toISOString(), ...e, prevHash: this.lastHash };
    const rec: AuditRecord = { ...base, hash: digest(base) };
    this.lastHash = rec.hash;
    appendFileSync(this.file, JSON.stringify(rec) + "\n");
    this.recent.push(rec);
    if (this.recent.length > 200) this.recent.shift();
    return rec;
  }

  tail(n = 50): AuditRecord[] {
    return this.recent.slice(-n).reverse();
  }

  /** Re-walk the whole file and confirm no line was edited, removed or reordered. */
  verify(): { ok: boolean; records: number; brokenAt?: number } {
    if (!existsSync(this.file)) return { ok: true, records: 0 };
    let prev = GENESIS;
    const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const rec = JSON.parse(lines[i]!) as AuditRecord;
      const { hash, ...rest } = rec;
      if (rec.prevHash !== prev || digest(rest) !== hash) return { ok: false, records: lines.length, brokenAt: rec.seq };
      prev = hash;
    }
    return { ok: true, records: lines.length };
  }
}
