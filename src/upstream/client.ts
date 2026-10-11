import { config } from "../config.js";

/**
 * Network shield: the upstream sees only the gateway. No client IP, forwarding
 * headers, cookies, user agent or tenant key is ever passed through; requests
 * leave with the gateway's own credentials and a fresh, minimal header set.
 */
export function upstreamHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "natlas-sovereign-gateway/1.0",
  };
  if (config.upstreamApiKey) h.authorization = `Bearer ${config.upstreamApiKey}`;
  return h;
}

/** Only these request fields are forwarded; anything else a client sends is dropped. */
const FORWARDED_FIELDS = [
  "temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "presence_penalty",
  "frequency_penalty", "seed", "response_format", "tools", "tool_choice", "logit_bias",
] as const;

export function buildUpstreamBody(body: Record<string, unknown>, messages: unknown[], stream: boolean, user?: string) {
  const out: Record<string, unknown> = { model: config.upstreamModel, messages, stream };
  for (const f of FORWARDED_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  if (stream) out.stream_options = { include_usage: true };
  if (user) out.user = user;
  return out;
}

export async function callUpstream(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(config.upstreamTimeoutMs);
  return fetch(`${config.upstreamUrl}/chat/completions`, {
    method: "POST",
    headers: upstreamHeaders(),
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}
