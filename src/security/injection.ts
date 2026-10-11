import type { ChatMessage } from "../pii/redactor.js";

/**
 * Heuristic prompt-injection and jailbreak filter, tuned for the attacks we see
 * against Llama-3 models, including Nigerian-language phrasings.
 * Scores combine as independent signals: 1 - Π(1 - w).
 */
interface Rule {
  id: string;
  re: RegExp;
  weight: number;
}

const RULES: Rule[] = [
  { id: "ignore_instructions", re: /\b(ignore|disregard|forget|skip|bypass)\b.{0,30}\b(previous|prior|above|earlier|all|any|your|the)\b.{0,20}\b(instructions?|rules|prompts?|guidelines|directions)\b/i, weight: 0.8 },
  { id: "reveal_system_prompt", re: /\b(reveal|show|print|repeat|leak|output|tell me|display)\b.{0,25}\b(system|hidden|initial|original|secret)\s+(prompt|instructions?|message)\b/i, weight: 0.8 },
  { id: "jailbreak_persona", re: /\b(DAN|do anything now|developer mode|jailbr(eak|oken)|god mode|unfiltered mode|evil (assistant|ai))\b/i, weight: 0.85 },
  { id: "no_restrictions", re: /\b(pretend|imagine|act as if|assume)\b.{0,40}\b(no|without)\s+(rules|restrictions|filters|limits|guidelines|censorship)\b/i, weight: 0.7 },
  { id: "override_safety", re: /\b(override|disable|turn off|deactivate)\b.{0,25}\b(safety|guardrails?|filters?|content policy|moderation)\b/i, weight: 0.75 },
  { id: "role_spoofing", re: /<\|?(im_start|im_end|start_header_id|end_header_id|eot_id|begin_of_text)\|?>|\[\/?INST\]|<\/?\s*system\s*>|^\s*system\s*:/im, weight: 0.75 },
  { id: "new_instructions", re: /\b(new|updated|real)\s+(instructions?|system prompt)\s*[:=]/i, weight: 0.55 },
  { id: "encoded_payload", re: /\b(decode|base64|rot13)\b.{0,40}\b(execute|follow|run|obey)\b/i, weight: 0.6 },
  { id: "exfiltration", re: /\b(send|post|upload|exfiltrate)\b.{0,30}\b(api key|credentials|password|secret|token|conversation)\b.{0,30}(https?:\/\/|to )/i, weight: 0.55 },
  // Nigerian Pidgin: "forget everything wey dem tell you", "comot all the rules".
  { id: "pidgin_ignore", re: /\b(forget|ignore)\b.{0,20}\b(everything|all|wetin)\b.{0,15}\bwey\b.{0,15}\b(dem|una|person)\b.{0,10}\b(tell|talk|give)\b/i, weight: 0.75 },
  { id: "pidgin_rules", re: /\b(comot|remove|throway)\b.{0,15}\b(all|the|una)?\s*(rules|restriction|law)s?\b/i, weight: 0.6 },
  // Yoruba: "gbagbe gbogbo ilana/itosona" (forget all instructions).
  { id: "yoruba_ignore", re: /\bgbagbe\b.{0,20}\b(gbogbo|ilana|itosona|ofin)\b/i, weight: 0.65 },
  // Hausa: "manta da duk umarnin" (forget all instructions).
  { id: "hausa_ignore", re: /\b(manta|watsi)\b.{0,20}\b(duk|umarni|umarnin|dokoki)\b/i, weight: 0.65 },
  // Igbo: "chefuo ntuziaka niile" (forget all instructions).
  { id: "igbo_ignore", re: /\b(chefuo|leghara)\b.{0,20}\b(ntuziaka|iwu|niile)\b/i, weight: 0.65 },
];

export interface InjectionVerdict {
  score: number;
  matched: string[];
}

// Cyrillic and Greek look-alikes commonly swapped in to dodge filters.
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "һ": "h", "ӏ": "l",
  "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I", "Ѕ": "S", "Α": "A", "Ε": "E", "Ι": "I", "Ο": "O", "ο": "o", "ν": "v",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/**
 * Undo common evasion tricks before matching: invisible characters, full-width
 * and look-alike letters, leetspeak ("1gn0re"), spaced or dotted letters
 * ("i g n o r e", "i.g.n.o.r.e"), and base64-encoded payloads.
 */
export function normalizeForScan(text: string): string {
  // Decode plausible base64 chunks first (later steps would mangle them) and scan their contents too.
  const decoded: string[] = [];
  for (const m of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
    try {
      const d = Buffer.from(m, "base64").toString("utf8");
      if (/^[\x20-\x7E\s]{8,}$/.test(d)) decoded.push(d);
    } catch {}
  }
  let t = text.normalize("NFKC").replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, "");
  t = t.replace(/[\u0370-\u03FF\u0400-\u04FF\u0250-\u02AF]/g, (c) => HOMOGLYPHS[c] ?? c);
  // Leetspeak only inside words that also contain letters, so prices and IDs stay intact.
  t = t.replace(/\S*[A-Za-z]\S*/g, (w) => w.replace(/[013457@$!]/g, (c, i) => (i === w.length - 1 && c === "!" ? c : LEET[c] ?? c)));
  // Collapse letters split by single spaces, dots, dashes or underscores: "i g n o r e" -> "ignore".
  t = t.replace(/\b(?:[A-Za-z][ .\-_*]){3,}[A-Za-z]\b/g, (m) => m.replace(/[ .\-_*]/g, ""));
  return decoded.length ? `${t}\n${decoded.join("\n")}` : t;
}

function scoreRaw(text: string): InjectionVerdict {
  let keep = 1;
  const matched: string[] = [];
  for (const r of RULES) {
    if (r.re.test(text)) {
      keep *= 1 - r.weight;
      matched.push(r.id);
    }
  }
  return { score: Math.round((1 - keep) * 100) / 100, matched };
}

export function scoreText(text: string): InjectionVerdict {
  const plain = scoreRaw(text);
  const normalized = normalizeForScan(text);
  if (normalized === text) return plain;
  const deob = scoreRaw(normalized);
  if (deob.score <= plain.score) return plain;
  // Matching only after de-obfuscation is itself a strong signal of intent.
  const score = Math.min(1, Math.round((1 - (1 - deob.score) * 0.8) * 100) / 100);
  return { score, matched: [...new Set([...deob.matched, "obfuscation"])] };
}

/** Only end-user and tool content is untrusted; the developer's system prompt is not scanned. */
export function scoreMessages(messages: ChatMessage[]): InjectionVerdict {
  const text = messages
    .filter((m) => m.role === "user" || m.role === "tool" || m.role === "function")
    .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => p.text ?? "").join(" ") : ""))
    .join("\n");
  return scoreText(text);
}
