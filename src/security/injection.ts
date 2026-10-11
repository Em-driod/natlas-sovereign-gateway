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

export function scoreText(text: string): InjectionVerdict {
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

/** Only end-user and tool content is untrusted; the developer's system prompt is not scanned. */
export function scoreMessages(messages: ChatMessage[]): InjectionVerdict {
  const text = messages
    .filter((m) => m.role === "user" || m.role === "tool" || m.role === "function")
    .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => p.text ?? "").join(" ") : ""))
    .join("\n");
  return scoreText(text);
}
