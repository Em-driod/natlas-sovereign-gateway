import { createHash } from "node:crypto";
import type { KvStore } from "./store.js";
import type { ChatMessage } from "../pii/redactor.js";

/**
 * Nigerian semantic cache.
 *
 * Everything here operates on *redacted* prompts, so PII never enters the cache.
 * A bonus: two customers asking "explain loan policy for [NIN_1]" with different
 * NINs share one cached answer, and each gets their own NIN back on rehydration.
 */

export interface CachedCompletion {
  content: string;
  finishReason: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  storedAt: number;
}

export interface CacheLookup {
  hit: "exact" | "semantic" | null;
  entry?: CachedCompletion;
  similarity?: number;
}

const STOPWORDS = new Set(
  "a an the is are was were be been to of in on for and or but with at by from as it this that these those me my i you your we our please kindly can could abeg would should will do does did what how why when which who whom".split(" ")
);

// Words that change the answer even when the rest of the prompt is identical.
const CRITICAL = new Set(
  ("yoruba hausa igbo pidgin english french arabic fulfulde kanuri tiv efik ijaw not no never without except don't dont isn't cannot can't " +
    "cac firs cbn nitda ndpc nimc efcc frsc sec ncc nafdac nnpc ndic pencom naicom lirs fct lagos abuja kano rivers").split(" ")
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\[\]_:/' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Vec = Map<string, number>;

// Folds common Nigerian business and Pidgin phrasings onto one form before comparing.
const SYNONYMS: Record<string, string> = {
  client: "customer", clients: "customers", "customer's": "customer", subscriber: "customer",
  abeg: "please", pls: "please", plz: "please", biko: "please", "don't": "not",
  describe: "explain", clarify: "explain", tell: "explain", breakdown: "explain",
  loans: "loan", credit: "loan", borrowing: "loan",
  policies: "policy", rules: "policy", guidelines: "policy", requirements: "policy",
  wetin: "what", wey: "which", dey: "is", na: "is", una: "you", abi: "or",
  firm: "business", company: "business", enterprise: "business", biz: "business",
  register: "registration", registering: "registration", incorporate: "registration",
  naira: "ngn", "₦": "ngn",
};

function vectorize(norm: string): Vec {
  const v: Vec = new Map();
  const words = norm
    .split(" ")
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => w && !STOPWORDS.has(w));
  for (const w of words) v.set(`w:${w}`, (v.get(`w:${w}`) ?? 0) + 1);
  const compact = ` ${words.join(" ")} `;
  for (let i = 0; i < compact.length - 2; i++) {
    const g = `c:${compact.slice(i, i + 3)}`;
    v.set(g, (v.get(g) ?? 0) + 0.5);
  }
  return v;
}

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Signature of answer-changing details: languages, negations, numbers, PII token shapes. */
function guardSignature(norm: string): string {
  const parts = new Set<string>();
  for (const w of norm.split(" ")) {
    if (CRITICAL.has(w) || /\d/.test(w) || /^\[[a-z]+_\d+/.test(w)) parts.add(w);
  }
  return [...parts].sort().join("|");
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 40);

function messageText(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p.text === "string" ? p.text : "")).join(" ");
  return "";
}

export interface CacheKeyParts {
  exactKey: string;
  /** Hash of everything except the final user turn (system prompt, history, params). */
  contextKey: string;
  lastNorm: string;
}

export function cacheKeyParts(model: string, messages: ChatMessage[], params: Record<string, unknown>): CacheKeyParts {
  const norms = messages.map((m) => `${m.role}:${normalize(messageText(m))}`);
  const last = messages.length ? normalize(messageText(messages[messages.length - 1]!)) : "";
  const p = JSON.stringify(params);
  return {
    exactKey: sha(`${model}\n${p}\n${norms.join("\n")}`),
    contextKey: sha(`${model}\n${p}\n${norms.slice(0, -1).join("\n")}`),
    lastNorm: last,
  };
}

interface IndexEntry {
  exactKey: string;
  vec: Vec;
  guard: string;
}

export class SemanticCache {
  // contextKey -> recent prompts under that context.
  private index = new Map<string, IndexEntry[]>();
  private indexSize = 0;

  constructor(
    private readonly store: KvStore,
    private readonly opts: { ttlSeconds: number; semantic: boolean; threshold: number; maxEntries: number }
  ) {}

  async lookup(parts: CacheKeyParts, namespace: string): Promise<CacheLookup> {
    const exact = await this.store.get(`cache:${namespace}:${parts.exactKey}`);
    if (exact) return { hit: "exact", entry: JSON.parse(exact) as CachedCompletion, similarity: 1 };
    if (!this.opts.semantic || parts.lastNorm.length < 8) return { hit: null };

    const bucket = this.index.get(`${namespace}:${parts.contextKey}`);
    if (!bucket?.length) return { hit: null };
    const vec = vectorize(parts.lastNorm);
    const guard = guardSignature(parts.lastNorm);
    let best: IndexEntry | undefined;
    let bestSim = 0;
    for (const e of bucket) {
      if (e.guard !== guard) continue;
      const sim = cosine(vec, e.vec);
      if (sim > bestSim) {
        bestSim = sim;
        best = e;
      }
    }
    if (!best || bestSim < this.opts.threshold) return { hit: null, similarity: bestSim };
    const raw = await this.store.get(`cache:${namespace}:${best.exactKey}`);
    if (!raw) return { hit: null };
    return { hit: "semantic", entry: JSON.parse(raw) as CachedCompletion, similarity: bestSim };
  }

  async put(parts: CacheKeyParts, namespace: string, entry: CachedCompletion): Promise<void> {
    await this.store.set(`cache:${namespace}:${parts.exactKey}`, JSON.stringify(entry), this.opts.ttlSeconds);
    if (!this.opts.semantic || parts.lastNorm.length < 8) return;
    const key = `${namespace}:${parts.contextKey}`;
    const bucket = this.index.get(key) ?? [];
    if (!bucket.some((e) => e.exactKey === parts.exactKey)) {
      bucket.push({ exactKey: parts.exactKey, vec: vectorize(parts.lastNorm), guard: guardSignature(parts.lastNorm) });
      this.indexSize++;
      if (bucket.length > 500) {
        bucket.shift();
        this.indexSize--;
      }
      this.index.set(key, bucket);
    }
    if (this.indexSize > this.opts.maxEntries) {
      const firstKey = this.index.keys().next().value;
      if (firstKey !== undefined) {
        this.indexSize -= this.index.get(firstKey)?.length ?? 0;
        this.index.delete(firstKey);
      }
    }
  }
}
