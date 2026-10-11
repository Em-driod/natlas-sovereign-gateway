/**
 * Lightweight detector for the languages N-ATLAS serves: Yoruba, Hausa, Igbo,
 * Nigerian Pidgin and English. It uses distinctive letters and common function
 * words, so it runs in microseconds with no model; good enough to label traffic
 * and to tell clients which language a prompt arrived in.
 */
export type LangCode = "yo" | "ha" | "ig" | "pcm" | "en";

export const LANGUAGE_NAMES: Record<LangCode, string> = { yo: "Yoruba", ha: "Hausa", ig: "Igbo", pcm: "Nigerian Pidgin", en: "English" };

const WORDS: Record<Exclude<LangCode, "en">, string[]> = {
  yo: ["ni", "ti", "àti", "ati", "ṣe", "se", "kí", "mo", "wa", "jẹ", "bawo", "báwo", "ẹ", "kaabo", "ẹ̀kọ́", "owó", "ọmọ", "ilé", "sí", "fún", "pẹ̀lú", "naa", "náà", "kò", "gbogbo", "àwọn", "awon", "mi", "rẹ", "jọwọ", "jowo", "ẹ jọ̀wọ́"],
  ha: ["da", "ba", "na", "ta", "yaya", "sannu", "ina", "kuma", "wannan", "zan", "barka", "don", "allah", "ne", "ce", "shi", "ita", "mun", "kudi", "kuɗi", "gida", "yau", "gobe", "nawa", "lafiya", "aiki", "tare", "amma", "mutane", "akwai"],
  ig: ["na", "ka", "nke", "ndewo", "kedu", "biko", "maka", "gị", "gi", "m", "ọ", "anyị", "ha", "ego", "ụlọ", "ulo", "nwa", "ihe", "ebe", "ndị", "ndi", "unu", "dị", "di", "mma", "daalụ", "daalu", "ọ bụ", "bụ", "bu"],
  pcm: ["dey", "wetin", "abeg", "una", "wahala", "sabi", "wey", "don", "dem", "oga", "pikin", "comot", "chop", "make", "dis", "dat", "e be", "na im", "no be", "abi", "sef", "shey", "jare", "wan", "fit", "commot", "waka", "dis one", "how far"],
};

// Letters specific to one orthography.
const LETTERS: Array<[RegExp, LangCode, number]> = [
  [/[ẹọṣẸỌṢ]/g, "yo", 2.5],
  [/[ƙɗɓƘƊƁ]/g, "ha", 3],
  [/[ịụṅỊỤṄ]/g, "ig", 3],
];

export interface LanguageGuess {
  code: LangCode;
  name: string;
  confidence: number;
}

export function detectLanguage(text: string): LanguageGuess {
  const t = text.toLowerCase().normalize("NFC");
  const tokens = t.split(/[^\p{L}\p{M}']+/u).filter(Boolean);
  if (!tokens.length) return { code: "en", name: LANGUAGE_NAMES.en, confidence: 0 };
  const score: Record<LangCode, number> = { yo: 0, ha: 0, ig: 0, pcm: 0, en: 0 };
  const sets = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v)])) as Record<Exclude<LangCode, "en">, Set<string>>;
  for (const tok of tokens) for (const code of ["yo", "ha", "ig", "pcm"] as const) if (sets[code].has(tok)) score[code] += 1;
  // Two-word Pidgin phrases.
  for (const phrase of WORDS.pcm.filter((w) => w.includes(" "))) if (t.includes(phrase)) score.pcm += 1.5;
  for (const [re, code, w] of LETTERS) score[code] += (t.match(re)?.length ?? 0) * w;
  // Very common English words count against the local languages.
  const en = ["the", "is", "are", "and", "what", "how", "please", "my", "your", "explain", "for", "with", "this", "that", "to", "of"];
  for (const tok of tokens) if (en.includes(tok)) score.en += 0.8;
  const ranked = (Object.entries(score) as Array<[LangCode, number]>).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0]!;
  const second = ranked[1]![1];
  const enough = bestScore >= 2 && bestScore > second * 1.2;
  const code: LangCode = best !== "en" && enough ? best : "en";
  const confidence = Math.min(1, code === "en" ? 0.5 + score.en / (tokens.length + 1) : (bestScore - second) / (bestScore + 1));
  return { code, name: LANGUAGE_NAMES[code], confidence: Math.round(confidence * 100) / 100 };
}
