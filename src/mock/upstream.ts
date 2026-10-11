/**
 * Mock N-ATLAS inference server (OpenAI-compatible), for demos and benchmarks
 * when the real model isn't reachable. It simulates realistic 8B-model latency
 * and records exactly what it received at GET /_inspect/last, so you can prove
 * that no PII and no client network details ever reached the model.
 */
import type { FastifyInstance } from "fastify";

const BASE_LATENCY = Number(process.env.MOCK_LATENCY_MS ?? 1400);
const JITTER = Number(process.env.MOCK_JITTER_MS ?? 300);

const RAW_PII = [
  { type: "11-digit id (BVN/NIN)", re: /(?<!\d)\d{11}(?!\d)/ },
  { type: "phone", re: /(?:\+?234|\b0)[789][01]\d{8}\b/ },
  { type: "email", re: /[\w.+-]+@[\w-]+\.[\w.]+/ },
];

let last: unknown = null;
let served = 0;

function textOf(messages: Array<{ role: string; content: unknown }>): string {
  const u = [...messages].reverse().find((m) => m.role === "user");
  if (!u) return "";
  return typeof u.content === "string" ? u.content : JSON.stringify(u.content);
}

function compose(prompt: string): string {
  const p = prompt.toLowerCase();
  const tokens = [...new Set(prompt.match(/\[[A-Z]+_\d+(?::[^\]]+)?\]/g) ?? [])];
  // Refer back to at most two identifiers, the way a real assistant would.
  const who = tokens.find((t) => t.startsWith("[NAME_")) ?? tokens[0];
  const idTok = tokens.find((t) => /^\[(BVN|NIN)_/.test(t));
  const refs = [...new Set([who, idTok].filter(Boolean))];
  const ref = refs.length ? ` (Reference: ${refs.join(", ")}.)` : "";

  if (p.includes("pidgin")) {
    return `Okay, make I explain am for Pidgin. For loan, the bank go first check your BVN and NIN to confirm say na you, then dem go look your account history and how you dey pay back. If everything correct, dem fit approve am within few days. Interest dey depend on the bank and the type of loan.${ref}`;
  }
  if (p.includes("yoruba")) return `Ní èdè Yorùbá: "Ẹ kú àárọ̀, báwo ni mo ṣe lè ràn yín lọ́wọ́ lónìí?" (Good morning, how can I help you today?)${ref}`;
  if (p.includes("hausa")) return `A Hausa: "Barka da safiya, ta yaya zan taimake ka yau?" (Good morning, how can I help you today?)${ref}`;
  if (p.includes("igbo")) return `N'asụsụ Igbo: "Ụtụtụ ọma, kedu ka m ga-esi nyere gị aka taa?" (Good morning, how can I help you today?)${ref}`;
  if (p.includes("cac") || p.includes("register") && p.includes("business")) {
    return `To register a business in Nigeria: (1) search and reserve a name on the CAC portal, (2) complete pre-incorporation forms, (3) pay the filing fee, (4) upload ID and signatures, and (5) download your certificate. A Business Name usually takes 1 to 3 working days.${ref}`;
  }
  if (p.includes("pos") || p.includes("eligible")) {
    const place = prompt.match(/\[(?:GPS|ADDRESS)_\d+:([^\]]+)\]/)?.[1];
    return `Yes, likely eligible. To issue a POS terminal, the bank confirms identity with the BVN, checks that the phone and email are reachable, and verifies that the shop location${place ? ` (${place})` : ""} matches the registered business address. Under CBN agent banking rules, the terminal must then stay within its registered location.${ref}`;
  }
  if (p.includes("loan")) {
    return `Most Nigerian lenders follow CBN guidelines: identity is confirmed with BVN and NIN, affordability is assessed from account statements, and the offer letter must state the full cost of credit. Customers can repay early, and complaints go first to the lender, then to the CBN Consumer Protection Department.${ref}`;
  }
  return `Thank you for your question. I am N-ATLAS, Nigeria's multilingual model. Here is a short answer based on current Nigerian guidance, and I can also reply in Yoruba, Hausa, Igbo or Pidgin if you prefer.${ref}`;
}

/** Mock routes; mounted under /mock on the gateway in demo mode, or served alone by mock/server.ts. */
export async function mockRoutes(app: FastifyInstance) {

app.get("/v1/models", async () => ({
  object: "list",
  data: [{ id: "n-atlas-8b", object: "model", owned_by: "ncair-mock" }],
}));

app.get("/_inspect/last", async () => last ?? { note: "no requests yet" });
app.get("/health", async () => ({ ok: true, served }));

app.post("/v1/chat/completions", async (req, reply) => {
  const body = req.body as { model?: string; messages: Array<{ role: string; content: unknown }>; stream?: boolean };
  const allText = JSON.stringify(body.messages);
  last = {
    receivedAt: new Date().toISOString(),
    headers: req.headers,
    remoteAddress: req.ip,
    body,
    rawPiiDetected: RAW_PII.filter((x) => x.re.test(allText)).map((x) => x.type),
  };
  served++;

  const content = compose(textOf(body.messages));
  const promptTokens = Math.ceil(allText.length / 4);
  const completionTokens = Math.ceil(content.length / 4);
  const id = `chatcmpl-mock-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const delay = BASE_LATENCY + Math.round((Math.random() - 0.5) * 2 * JITTER);

  if (!body.stream) {
    await new Promise((r) => setTimeout(r, delay));
    return {
      id, object: "chat.completion", created, model: body.model ?? "n-atlas-8b",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    };
  }

  // Streaming: time-to-first-token is ~45% of the full latency, then words trickle out.
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  await new Promise((r) => setTimeout(r, delay * 0.45));
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const chunk = (delta: object, finish: string | null = null) => ({
    id, object: "chat.completion.chunk", created, model: body.model ?? "n-atlas-8b",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  send(chunk({ role: "assistant", content: "" }));
  // Split into small pieces, deliberately cutting through tokens like "[NIN_1]".
  const pieces = content.match(/.{1,6}/gs) ?? [];
  for (const piece of pieces) {
    send(chunk({ content: piece }));
    await new Promise((r) => setTimeout(r, 12));
  }
  send(chunk({}, "stop"));
  send({ id, object: "chat.completion.chunk", created, model: body.model, choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } });
  res.write("data: [DONE]\n\n");
  res.end();
});
}
