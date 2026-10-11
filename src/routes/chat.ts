import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import type { GatewayContext } from "../context.js";
import { Vault, redactMessages, redactText, rehydrateText, StreamRehydrator, type ChatMessage } from "../pii/redactor.js";
import { detectLanguage } from "../lib/language.js";
import { scoreMessages } from "../security/injection.js";
import { rateLimit, tokensUsedToday, chargeTokens, pseudonymise, type Tenant } from "../security/tenants.js";
import { cacheKeyParts, type CachedCompletion } from "../cache/semantic-cache.js";
import { buildUpstreamBody, callUpstream } from "../upstream/client.js";
import type { AuditEvent } from "../audit/audit-log.js";

/** Time spent in each pipeline stage, in milliseconds. */
export class Trace {
  private last = performance.now();
  readonly stages: Array<[string, number]> = [];
  mark(stage: string) {
    const now = performance.now();
    this.stages.push([stage, now - this.last]);
    this.last = now;
  }
  header(): string {
    return this.stages.map(([s, ms]) => `${s}=${ms.toFixed(3)}`).join(";");
  }
  toJSON(): Record<string, number> {
    return Object.fromEntries(this.stages.map(([s, ms]) => [s, Math.round(ms * 1000) / 1000]));
  }
}

const ANON: Tenant = { id: "anonymous", name: "Anonymous (demo)", keyHash: "", rpm: 60, dailyTokenBudget: 200_000, zeroRetention: false };

function openAiError(reply: FastifyReply, status: number, code: string, message: string, type = "invalid_request_error") {
  return reply.code(status).send({ error: { message, type, code, param: null } });
}

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

function redactionHeader(counts: Record<string, number | undefined>): string {
  const parts = Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(",") : "none";
}

export function registerChatRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.post("/v1/chat/completions", async (req: FastifyRequest, reply: FastifyReply) => {
    const t0 = performance.now();
    const requestId = `natlas-${randomUUID()}`;
    reply.header("x-request-id", requestId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stream = body.stream === true;
    const model = typeof body.model === "string" ? body.model : "n-atlas-8b";

    const audit: AuditEvent = {
      requestId, tenantId: "unknown", route: "chat.completions", model, status: 200, outcome: "served",
      cache: "miss", redactions: {}, injectionScore: 0, injectionRules: [], latencyMs: 0,
      zeroRetention: false, stream,
    };
    const finish = (status: number, outcome: AuditEvent["outcome"]) => {
      audit.status = status;
      audit.outcome = outcome;
      audit.latencyMs = Math.round(performance.now() - t0);
      ctx.audit.write(audit);
    };
    ctx.stats.requests++;

    // Per-stage timings for the dashboard X-ray, sent as x-natlas-trace (see app.ts onSend and sseHead).
    const trace = new Trace();
    (req as FastifyRequest & { natlasTrace?: Trace }).natlasTrace = trace;

    // 1. Authenticate the tenant.
    const auth = req.headers.authorization ?? "";
    const key = auth.replace(/^Bearer\s+/i, "").trim();
    let tenant = key ? ctx.tenants.authenticate(key) : undefined;
    if (!tenant && config.allowAnonymous && !key) tenant = ANON;
    if (!tenant) {
      finish(401, "unauthorized");
      return openAiError(reply, 401, "invalid_api_key", "Missing or invalid gateway API key. Use a key that starts with sk-natlas-.", "authentication_error");
    }
    audit.tenantId = tenant.id;
    trace.mark("auth");
    audit.zeroRetention = tenant.zeroRetention || req.headers["x-natlas-zero-retention"] === "1";

    // 2. Rate limits: per client IP (DDoS shield) and per tenant.
    const ipRl = await rateLimit(ctx.store, `ip:${req.ip}`, config.security.ipRateLimitPerMinute);
    const tRl = await rateLimit(ctx.store, `tenant:${tenant.id}`, tenant.rpm);
    reply.header("x-ratelimit-limit-requests", tenant.rpm);
    reply.header("x-ratelimit-remaining-requests", tRl.remaining);
    if (!ipRl.allowed || !tRl.allowed) {
      ctx.stats.rateLimited++;
      finish(429, "rate_limited");
      reply.header("retry-after", Math.min(ipRl.retryAfter, tRl.retryAfter));
      return openAiError(reply, 429, "rate_limit_exceeded", "Rate limit reached for this key or network. Retry shortly.", "rate_limit_error");
    }

    // 3. Budget ceiling.
    const used = await tokensUsedToday(ctx.store, tenant.id);
    reply.header("x-natlas-budget-remaining", Math.max(0, tenant.dailyTokenBudget - used));
    if (used >= tenant.dailyTokenBudget) {
      ctx.stats.budgetExceeded++;
      finish(429, "budget_exceeded");
      return openAiError(reply, 429, "budget_exceeded", `Daily token budget of ${tenant.dailyTokenBudget} reached. It resets at 00:00 UTC.`, "insufficient_quota");
    }

    trace.mark("limits");

    // 4. Validate.
    const messages = body.messages as ChatMessage[] | undefined;
    if (!Array.isArray(messages) || messages.length === 0 || messages.some((m) => !m || typeof m.role !== "string")) {
      finish(400, "bad_request");
      return openAiError(reply, 400, "invalid_messages", "`messages` must be a non-empty array of {role, content}.");
    }

    // 5. Prompt-injection defence (scored on the original text).
    const verdict = scoreMessages(messages);
    audit.injectionScore = verdict.score;
    audit.injectionRules = verdict.matched;
    reply.header("x-natlas-injection-score", verdict.score);
    if (verdict.score >= config.security.injectionThreshold && config.security.injectionMode === "block") {
      ctx.stats.blockedInjection++;
      finish(400, "blocked_injection");
      return openAiError(reply, 400, "prompt_injection_detected", `Request blocked by the N-ATLAS gateway: possible prompt injection (${verdict.matched.join(", ")}).`);
    }

    trace.mark("scan");

    // 6. Redact Nigerian PII. The vault lives only for this request.
    const vault = new Vault();
    const redacted = redactMessages(messages, vault);
    audit.redactions = vault.counts as Record<string, number>;
    ctx.stats.addRedactions(vault.counts);
    reply.header("x-natlas-redactions", redactionHeader(vault.counts));

    // Which N-ATLAS language the user wrote in (yo, ha, ig, pcm, en), for routing and analytics.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lang = detectLanguage(typeof lastUser?.content === "string" ? lastUser.content : "");
    audit.language = lang.code;
    ctx.stats.languages[lang.code] = (ctx.stats.languages[lang.code] ?? 0) + 1;
    reply.header("x-natlas-language", lang.code);

    trace.mark("redact");

    // 7. Semantic cache (redacted prompts only).
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
    const cacheable =
      config.cache.enabled &&
      !audit.zeroRetention &&
      req.headers["x-natlas-cache"] !== "bypass" &&
      temperature <= config.cache.maxCacheableTemperature &&
      !body.tools && (body.n === undefined || body.n === 1);
    const cacheParams = { max_tokens: body.max_tokens ?? null, response_format: body.response_format ?? null, stop: body.stop ?? null };
    const parts = cacheKeyParts(model, redacted, cacheParams);
    const namespace = "shared";
    const debug = req.headers["x-natlas-debug"] === "1";
    const lite = req.headers["x-natlas-lite"] === "1";

    if (!cacheable) {
      audit.cache = "bypass";
    } else {
      const found = await ctx.cache.lookup(parts, namespace);
      trace.mark("cache");
      if (found.hit && found.entry) {
        const entry = found.entry;
        audit.cache = found.hit;
        found.hit === "exact" ? ctx.stats.cacheExact++ : ctx.stats.cacheSemantic++;
        ctx.stats.tokensSaved += entry.usage.total_tokens;
        const content = rehydrateText(entry.content, vault);
        trace.mark("rehydrate");
        const ms = performance.now() - t0;
        ctx.stats.cachedLatency.add(ms);
        reply.header("x-natlas-cache", `HIT-${found.hit.toUpperCase()}`);
        if (found.similarity !== undefined) reply.header("x-natlas-similarity", found.similarity.toFixed(3));
        reply.header("x-natlas-latency-ms", Math.round(ms));
        audit.completionTokens = 0;
        finish(200, "cache_hit");
        const meta = { request_id: requestId, cache: found.hit, similarity: found.similarity, redactions: vault.counts, latency_ms: Math.round(ms), trace: trace.toJSON(), ...(debug ? { model_saw: redacted } : {}) };
        if (stream) return sendCachedStream(reply, requestId, model, content, meta);
        if (lite) return { id: requestId, content, cache: found.hit, ms: Math.round(ms) };
        return completionBody(requestId, model, content, entry.finishReason, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, meta);
      }
      audit.cache = "miss";
      ctx.stats.cacheMiss++;
    }
    reply.header("x-natlas-cache", cacheable ? "MISS" : "BYPASS");

    if (!cacheable) trace.mark("cache");

    // 8. Forward to N-ATLAS, shielded.
    const user = typeof body.user === "string" ? pseudonymise(config.pseudonymSecret, `${tenant.id}:${body.user}`) : undefined;
    const payload = buildUpstreamBody(body, redacted, stream, user);
    const tUp = performance.now();
    let upstream: Response;
    try {
      upstream = await callUpstream(payload);
    } catch (err) {
      ctx.stats.upstreamErrors++;
      finish(502, "upstream_error");
      req.log.warn({ requestId, err: (err as Error).message }, "upstream unreachable");
      return openAiError(reply, 502, "upstream_unavailable", "N-ATLAS inference endpoint is unreachable. Please retry.", "api_error");
    }
    if (!upstream.ok) {
      ctx.stats.upstreamErrors++;
      const detail = (await upstream.text()).slice(0, 300);
      finish(502, "upstream_error");
      req.log.warn({ requestId, status: upstream.status }, "upstream error");
      return openAiError(reply, 502, "upstream_error", `N-ATLAS returned ${upstream.status}. ${rehydrateText(detail, new Vault())}`, "api_error");
    }

    const store = async (content: string, finishReason: string, usage: CachedCompletion["usage"]) => {
      if (!cacheable || !content) return;
      await ctx.cache.put(parts, namespace, { content, finishReason, model, usage, storedAt: Date.now() });
    };

    if (stream) {
      return relayStream(req, reply, ctx, upstream, vault, {
        onDone: async (redactedContent, usage) => {
          const upMs = performance.now() - tUp;
          ctx.stats.upstreamLatency.add(performance.now() - t0);
          const u = usage ?? { prompt_tokens: estimateTokens(JSON.stringify(redacted)), completion_tokens: estimateTokens(redactedContent), total_tokens: 0 };
          u.total_tokens ||= u.prompt_tokens + u.completion_tokens;
          await chargeTokens(ctx.store, tenant.id, u.total_tokens);
          ctx.stats.tokensServed += u.total_tokens;
          await store(redactedContent, "stop", u);
          audit.upstreamMs = Math.round(upMs);
          audit.promptTokens = u.prompt_tokens;
          audit.completionTokens = u.completion_tokens;
          finish(200, "served");
        },
      });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown }; finish_reason?: string }>;
      usage?: CachedCompletion["usage"];
      model?: string;
    };
    const upMs = performance.now() - tUp;
    trace.mark("model");
    const choice = data.choices?.[0];
    // Egress DLP: personal data in the answer that the caller never sent (the model invented or leaked it)
    // is withheld one-way. The caller's own values are still tokens at this point, so they are untouched.
    const egress = new Vault("withheld");
    const redactedContent = redactText(choice?.message?.content ?? "", egress);
    if (egress.total()) {
      audit.egressRedactions = egress.counts as Record<string, number>;
      ctx.stats.addEgress(egress.counts);
      reply.header("x-natlas-egress-redactions", redactionHeader(egress.counts));
    }
    const usage = data.usage ?? {
      prompt_tokens: estimateTokens(JSON.stringify(redacted)),
      completion_tokens: estimateTokens(redactedContent),
      total_tokens: 0,
    };
    usage.total_tokens ||= usage.prompt_tokens + usage.completion_tokens;
    await chargeTokens(ctx.store, tenant.id, usage.total_tokens);
    ctx.stats.tokensServed += usage.total_tokens;
    await store(redactedContent, choice?.finish_reason ?? "stop", usage);

    const content = rehydrateText(redactedContent, vault);
    trace.mark("rehydrate");
    const ms = performance.now() - t0;
    ctx.stats.upstreamLatency.add(ms);
    reply.header("x-natlas-latency-ms", Math.round(ms));
    reply.header("x-natlas-upstream-ms", Math.round(upMs));
    audit.upstreamMs = Math.round(upMs);
    audit.promptTokens = usage.prompt_tokens;
    audit.completionTokens = usage.completion_tokens;
    finish(200, "served");

    const meta = { request_id: requestId, cache: cacheable ? "miss" : "bypass", redactions: vault.counts, latency_ms: Math.round(ms), upstream_ms: Math.round(upMs), upstream_model: data.model, language: lang.code, egress: egress.counts, trace: trace.toJSON(), ...(debug ? { model_saw: redacted } : {}) };
    if (lite) return { id: requestId, content, cache: meta.cache, ms: Math.round(ms) };
    const out = completionBody(requestId, model, content, choice?.finish_reason ?? "stop", usage, meta);
    if (choice?.message?.tool_calls) (out.choices[0]!.message as Record<string, unknown>).tool_calls = choice.message.tool_calls;
    return out;
  });
}

function completionBody(id: string, model: string, content: string, finishReason: string, usage: CachedCompletion["usage"], meta: object) {
  return {
    id,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content } as Record<string, unknown>, finish_reason: finishReason }],
    usage,
    natlas: meta,
  };
}

function sseHead(reply: FastifyReply) {
  const trace = (reply.request as FastifyRequest & { natlasTrace?: Trace }).natlasTrace;
  if (trace) reply.header("x-natlas-trace", trace.header());
  reply.hijack();
  const res = reply.raw;
  const headers: Record<string, string | number> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
  for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as string;
  res.writeHead(200, headers);
  return res;
}

function sendCachedStream(reply: FastifyReply, id: string, model: string, content: string, meta: object) {
  const res = sseHead(reply);
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  // Large slices: on 2G/3G fewer frames beat a word-by-word trickle.
  let out = chunk({ role: "assistant", content: "" });
  for (const piece of content.match(/[\s\S]{1,400}/g) ?? []) out += chunk({ content: piece });
  out += chunk({}, "stop");
  out += `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], natlas: meta })}\n\n`;
  out += "data: [DONE]\n\n";
  res.end(out);
}

async function relayStream(
  req: FastifyRequest,
  reply: FastifyReply,
  ctx: GatewayContext,
  upstream: Response,
  vault: Vault,
  hooks: { onDone: (redactedContent: string, usage?: CachedCompletion["usage"]) => Promise<void> }
) {
  const res = sseHead(reply);
  const rehydrator = new StreamRehydrator(vault);
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let usage: CachedCompletion["usage"] | undefined;
  let lastChunk: Record<string, unknown> | undefined;

  const emit = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const reader = upstream.body!.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let obj: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; usage?: CachedCompletion["usage"] };
        try {
          obj = JSON.parse(data);
        } catch {
          continue;
        }
        if (obj.usage) usage = obj.usage;
        lastChunk = obj as Record<string, unknown>;
        const delta = obj.choices?.[0]?.delta;
        if (delta && typeof delta.content === "string") {
          full += delta.content;
          delta.content = rehydrator.push(delta.content);
          // Hold back chunks whose text is entirely buffered (mid-token) unless they carry other info.
          if (delta.content === "" && !obj.choices?.[0]?.finish_reason && Object.keys(delta).length === 1) continue;
        }
        if (obj.choices?.[0]?.finish_reason) {
          const rest = rehydrator.flush();
          if (rest) emit({ ...obj, choices: [{ index: 0, delta: { content: rest }, finish_reason: null }] });
        }
        emit(obj);
      }
    }
    const rest = rehydrator.flush();
    if (rest && lastChunk) emit({ ...lastChunk, choices: [{ index: 0, delta: { content: rest }, finish_reason: null }] });
    res.write("data: [DONE]\n\n");
  } catch (err) {
    req.log.warn({ err: (err as Error).message }, "stream relay interrupted");
    ctx.stats.upstreamErrors++;
  } finally {
    res.end();
  }
  await hooks.onDone(full, usage);
}
