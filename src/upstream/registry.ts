import { config } from "../config.js";
import type { KvStore } from "../cache/store.js";

/**
 * Hot-swappable upstream. Operators can point the gateway at a new N-ATLAS
 * endpoint (a vLLM box, a Colab tunnel, a hosted provider) without a redeploy;
 * the choice is kept in the durable store so it survives restarts.
 */
export interface UpstreamSettings {
  url: string;
  apiKey: string;
  model: string;
  label: string;
}

const KEY = "upstream:v1";

export function currentUpstream(): Omit<UpstreamSettings, "apiKey"> & { hasKey: boolean; mode: "mock" | "n-atlas" } {
  const mock = /\/mock\/v1$/.test(config.upstreamUrl);
  let host = "";
  try {
    host = new URL(config.upstreamUrl).host;
  } catch {}
  return {
    url: config.upstreamUrl.replace(/\/\/[^@/]*@/, "//"),
    model: config.upstreamModel,
    label: mock ? "built-in mock" : config.upstreamLabel || host,
    hasKey: Boolean(config.upstreamApiKey),
    mode: mock ? "mock" : "n-atlas",
  };
}

function apply(s: Partial<UpstreamSettings>) {
  const c = config as { upstreamUrl: string; upstreamApiKey: string; upstreamModel: string; upstreamLabel: string };
  if (s.url) c.upstreamUrl = s.url.replace(/\/$/, "");
  if (s.apiKey !== undefined) c.upstreamApiKey = s.apiKey;
  if (s.model) c.upstreamModel = s.model;
  if (s.label !== undefined) c.upstreamLabel = s.label;
}

export async function loadUpstream(store: KvStore): Promise<void> {
  const raw = await store.getDurable(KEY).catch(() => null);
  if (raw) apply(JSON.parse(raw) as UpstreamSettings);
}

/** Validates the endpoint with a real call before switching, so a typo never takes the gateway down. */
export async function switchUpstream(store: KvStore, s: Partial<UpstreamSettings> & { url: string }): Promise<{ ok: boolean; error?: string; sample?: string; model?: string }> {
  const url = s.url.replace(/\/$/, "");
  if (!/^https?:\/\//.test(url)) return { ok: false, error: "url must start with http:// or https://" };
  const model = s.model || config.upstreamModel;
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}) },
      body: JSON.stringify({ model, max_tokens: 16, temperature: 0, messages: [{ role: "user", content: "Say hello in Yoruba." }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { ok: false, error: `upstream returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const settings: UpstreamSettings = { url, apiKey: s.apiKey ?? "", model, label: s.label ?? "" };
    apply(settings);
    await store.setDurable(KEY, JSON.stringify(settings));
    return { ok: true, sample: data.choices?.[0]?.message?.content ?? "", model: data.model };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
