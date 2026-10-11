import { regionForAddress, regionForPoint } from "./regions.js";

export type PiiType = "BVN" | "NIN" | "PHONE" | "EMAIL" | "CARD" | "ACCOUNT" | "GPS" | "ADDRESS" | "ID" | "NAME";

export const PII_TYPES: PiiType[] = ["BVN", "NIN", "PHONE", "EMAIL", "CARD", "ACCOUNT", "GPS", "ADDRESS", "ID", "NAME"];

/**
 * Per-request token vault. Lives only in memory for the duration of one request,
 * so the original values are never cached, logged or sent upstream.
 * The same value always maps to the same token within a request.
 */
export class Vault {
  private byValue = new Map<string, string>();
  private byToken = new Map<string, string>();
  private counters = new Map<PiiType, number>();
  readonly counts: Partial<Record<PiiType, number>> = {};

  tokenFor(type: PiiType, value: string, hint?: string): string {
    const key = `${type}\u0000${value}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    const id = `${type}_${n}`;
    const token = hint ? `[${id}:${hint}]` : `[${id}]`;
    this.byValue.set(key, token);
    this.byToken.set(id, value);
    return token;
  }

  lookup(id: string): string | undefined {
    return this.byToken.get(id);
  }

  get size(): number {
    return this.byToken.size;
  }

  total(): number {
    return Object.values(this.counts).reduce((a, b) => a + (b ?? 0), 0);
  }
}

interface Span {
  start: number;
  end: number;
  type: PiiType;
  value: string;
  hint?: string;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const before = (text: string, at: number, n = 48) => text.slice(Math.max(0, at - n), at).toLowerCase();

const STREET = "(?:Street|street|St|Road|road|Rd|Avenue|avenue|Ave|Close|close|Crescent|crescent|Cres|Way|way|Lane|lane|Drive|drive|Boulevard|Expressway|Estate|estate)";
const CAP_WORD = "[A-Z][A-Za-z'-]*";

type Detector = (text: string) => Span[];

// "[Cc]ustomer" style: the cue is case-insensitive on its first letter, the name itself must be capitalised.
const ci = (w: string) => `[${w[0]!.toUpperCase()}${w[0]!.toLowerCase()}]${w.slice(1)}`;
const NAME_WORD = "[A-Z][a-z'-]+";
const HONORIFICS = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Chief", "Alhaji", "Alhaja", "Hajia", "Mallam", "Malam", "Engr", "Barr", "Prof", "Pastor", "Rev", "Otunba", "Madam", "Sir", "Lady"];
const NAME_AFTER_HONORIFIC = new RegExp(`\\b(?:${HONORIFICS.join("|")})\\.?\\s+(${NAME_WORD}(?:\\s+${NAME_WORD}){0,2})`, "g");
const CUES = ["customer", "client", "patient", "beneficiary", "borrower", "applicant", "subscriber", "account name", "full name", "my name is", "name is", "named", "name:"];
// Cue words need two or more name words ("customer Adaeze Okafor"), which avoids "customer Service".
const NAME_AFTER_CUE = new RegExp(`\\b(?:${CUES.map(ci).join("|")})\\s*[:\\-]?\\s+(${NAME_WORD}(?:\\s+${NAME_WORD}){1,2})`, "g");
const NOT_NAMES = new Set(
  "lagos abuja kano ibadan nigeria nigerian bank state island street road avenue limited ltd plc service services care support team account loan policy please kindly explain the and who".split(" ")
);

function all(re: RegExp, text: string, fn: (m: RegExpExecArray) => Span | null): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    const s = fn(m as RegExpExecArray);
    if (s) out.push(s);
  }
  return out;
}

// Ordered by priority: an earlier detector wins when spans overlap.
const DETECTORS: Detector[] = [
  // Email addresses.
  (t) =>
    all(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, t, (m) => ({
      start: m.index, end: m.index + m[0].length, type: "EMAIL", value: m[0],
    })),

  // GPS: "lat: 6.45, lng: 3.39".
  (t) =>
    all(/\blat(?:itude)?\s*[:=]?\s*(-?\d{1,2}\.\d{2,})\s*[,;/ ]\s*(?:lng|lon|long|longitude)\s*[:=]?\s*(-?\d{1,3}\.\d{2,})/gi, t, (m) => ({
      start: m.index, end: m.index + m[0].length, type: "GPS", value: m[0],
      hint: regionForPoint(Number(m[1]), Number(m[2])),
    })),

  // GPS: "6.4281° N, 3.4219° E".
  (t) =>
    all(/(\d{1,2}\.\d{2,})\s*°?\s*([NS])\s*,?\s*(\d{1,3}\.\d{2,})\s*°?\s*([EW])\b/g, t, (m) => {
      const lat = Number(m[1]) * (m[2] === "S" ? -1 : 1);
      const lon = Number(m[3]) * (m[4] === "W" ? -1 : 1);
      return { start: m.index, end: m.index + m[0].length, type: "GPS", value: m[0], hint: regionForPoint(lat, lon) };
    }),

  // GPS: bare decimal pair "6.4541, 3.3947" (needs 3+ decimals to avoid prices).
  (t) =>
    all(/(?<![\d.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?!\.?\d)/g, t, (m) => {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return { start: m.index, end: m.index + m[0].length, type: "GPS", value: m[0], hint: regionForPoint(lat, lon) };
    }),

  // Nigerian mobile numbers: +234 803 123 4567, 2348031234567, 08031234567, 0803-123-4567.
  (t) =>
    all(/(?<![\d+])(?:\+?234[\s-]?\(?0?\)?|0)[789][01]\d[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g, t, (m) => ({
      start: m.index, end: m.index + m[0].length, type: "PHONE", value: m[0],
    })),

  // Payment cards: 13 to 19 digits, Luhn-valid.
  (t) =>
    all(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, t, (m) => {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return null;
      return { start: m.index, end: m.index + m[0].length, type: "CARD", value: m[0] };
    }),

  // 11-digit identifiers: BVN or NIN from context, else a generic ID.
  (t) =>
    all(/(?<!\d)\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)|(?<!\d)\d{11}(?!\d)/g, t, (m) => {
      if (m[0].replace(/\D/g, "").length !== 11) return null;
      // Only the words since the previous number count, so "BVN 1..., ref 2..." labels ref as ID.
      const ctx = before(t, m.index).replace(/^[\s\S]*\d/, "");
      const type: PiiType = /\bbvn\b|bank verification/.test(ctx)
        ? "BVN"
        : /\bnin\b|\bnimc\b|national id|identification number|\bnin slip/.test(ctx)
          ? "NIN"
          : "ID";
      return { start: m.index, end: m.index + m[0].length, type, value: m[0] };
    }),

  // NUBAN bank account numbers (10 digits), only with banking context nearby.
  (t) =>
    all(/(?<!\d)\d{10}(?!\d)/g, t, (m) => {
      const ctx = before(t, m.index, 40);
      if (!/account|acct|a\/c|nuban|acc no|bank/.test(ctx)) return null;
      return { start: m.index, end: m.index + m[0].length, type: "ACCOUNT", value: m[0] };
    }),

  // Person names, only after an honorific or a cue word, so ordinary capitalised words are left alone.
  (t) => {
    const out: Span[] = [];
    for (const re of [NAME_AFTER_HONORIFIC, NAME_AFTER_CUE]) {
      for (const m of t.matchAll(re)) {
        const name = m[1]!;
        const words = name.split(/\s+/);
        if (words.some((w) => NOT_NAMES.has(w.toLowerCase()))) continue;
        const start = m.index! + m[0].length - name.length;
        out.push({ start, end: start + name.length, type: "NAME", value: name });
      }
    }
    return out;
  },

  // Street addresses: "No. 12, Adeola Odeku Street, Victoria Island, Lagos".
  (t) =>
    all(
      new RegExp(
        `(?:\\b[Nn]o\\.?\\s*)?\\b\\d{1,4}[A-Za-z]?,?\\s+(?:${CAP_WORD}\\s+){1,4}${STREET}\\b\\.?(?:,\\s*${CAP_WORD}(?:\\s+${CAP_WORD}){0,2}){0,3}`,
        "g"
      ),
      t,
      (m) => ({
        start: m.index, end: m.index + m[0].length, type: "ADDRESS", value: m[0],
        hint: regionForAddress(m[0]),
      })
    ),
];

/** Replace Nigerian PII in `text` with vault tokens. */
export function redactText(text: string, vault: Vault): string {
  if (!text) return text;
  const accepted: Span[] = [];
  for (const detect of DETECTORS) {
    for (const s of detect(text)) {
      if (!accepted.some((a) => s.start < a.end && a.start < s.end)) accepted.push(s);
    }
  }
  if (accepted.length === 0) return text;
  accepted.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of accepted) {
    out += text.slice(cursor, s.start) + vault.tokenFor(s.type, s.value, s.hint);
    cursor = s.end;
  }
  return out + text.slice(cursor);
}

const TYPES_RE = PII_TYPES.join("|");
// "[NIN_1]" or "[GPS_1:Lagos/Ikeja]"; models sometimes drop the brackets, so match "NIN_1" too.
const TOKEN_RE = new RegExp(`\\[(${TYPES_RE})_(\\d+)(?::[^\\]\\n]{0,60})?\\]|\\b(${TYPES_RE})_(\\d+)\\b`, "g");

/** Swap tokens in a model response back to the caller's original values. */
export function rehydrateText(text: string, vault: Vault): string {
  if (!text || vault.size === 0) return text;
  return text.replace(TOKEN_RE, (whole, t1, n1, t2, n2) => {
    const id = `${t1 ?? t2}_${n1 ?? n2}`;
    return vault.lookup(id) ?? whole;
  });
}

/**
 * Rehydrates a streamed response. A token may be split across chunks ("[NI" + "N_1]"),
 * so text after an unclosed "[" is held back until it closes or clearly isn't a token.
 */
export class StreamRehydrator {
  private pending = "";
  constructor(private readonly vault: Vault) {}

  push(chunk: string): string {
    const text = this.pending + chunk;
    const open = text.lastIndexOf("[");
    if (open !== -1 && text.indexOf("]", open) === -1 && text.length - open < 72) {
      this.pending = text.slice(open);
      return rehydrateText(text.slice(0, open), this.vault);
    }
    // Hold a trailing bare "NIN_" style fragment too.
    const tail = text.match(new RegExp(`\\b(?:${TYPES_RE})_?\\d*$`));
    if (tail && tail.index !== undefined) {
      this.pending = text.slice(tail.index);
      return rehydrateText(text.slice(0, tail.index), this.vault);
    }
    this.pending = "";
    return rehydrateText(text, this.vault);
  }

  flush(): string {
    const rest = rehydrateText(this.pending, this.vault);
    this.pending = "";
    return rest;
  }
}

// ---- Chat message helpers (OpenAI format) ----

export interface ChatMessage {
  role: string;
  content?: string | Array<{ type: string; text?: string; [k: string]: unknown }> | null;
  [k: string]: unknown;
}

export function redactMessages(messages: ChatMessage[], vault: Vault): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { ...m, content: redactText(m.content, vault) };
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((p) => (p.type === "text" && typeof p.text === "string" ? { ...p, text: redactText(p.text, vault) } : p)),
      };
    }
    return m;
  });
}
