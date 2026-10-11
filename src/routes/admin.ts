import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import type { GatewayContext } from "../context.js";
import { generateKey, hashKey, rateLimit } from "../security/tenants.js";
import { Vault, redactText } from "../pii/redactor.js";
import { scoreText } from "../security/injection.js";
import { detectLanguage } from "../lib/language.js";
import { dashboardHtml } from "../dashboard/page.js";
import { complianceReportHtml } from "../dashboard/report.js";
import { betaEvidenceHtml, type Feedback } from "../dashboard/beta.js";
import { currentUpstream, switchUpstream } from "../upstream/registry.js";

const FEEDBACK_KEY = "feedback:v1";

const isAdmin = (req: FastifyRequest) => {
  if (!config.adminToken) return true; // open in local dev
  const header = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const query = (req.query as { token?: string })?.token;
  return header === config.adminToken || query === config.adminToken;
};

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isAdmin(req)) return true;
  reply.code(401).send({ error: { message: "Admin token required", type: "authentication_error" } });
  return false;
}

/** Public views show built-in demo tenants by name, everyone else as a short pseudonym. */
const publicTenant = (id: string) => (id.startsWith("demo") || id === "anonymous" || id === "unknown" ? id : `tenant-${hashKey(id).slice(0, 6)}`);

export function upstreamInfo() {
  const u = currentUpstream();
  return { mode: u.mode, model: u.model, provider: u.label };
}

export function registerAdminRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.get("/", async (_req, reply) => reply.type("text/html; charset=utf-8").send(dashboardHtml()));

  app.get("/healthz", async () => ({ ok: true, store: ctx.store.kind, upstream: upstreamInfo() }));

  app.get("/v1/models", async () => ({
    object: "list",
    data: [{ id: "n-atlas-8b", object: "model", created: 1727740800, owned_by: "ncair-via-sovereign-gateway" }],
  }));

  // What the gateway sees about the caller, versus what it forwards (nothing). Useful to demo network shielding.
  app.get("/v1/gateway/whoami", async (req) => ({
    clientIpSeenByGateway: req.ip,
    forwardedToModel: { clientIp: null, cookies: null, userAgent: "natlas-sovereign-gateway/1.0", tenantKey: null },
  }));

  // Aggregates only: safe to show publicly on the dashboard.
  app.get("/admin/stats", async () => ({
    ...ctx.stats.snapshot(),
    store: ctx.store.kind,
    cacheEnabled: config.cache.enabled,
    injectionMode: config.security.injectionMode,
    upstream: upstreamInfo(),
  }));

  // Public tail with tenants pseudonymised; the admin token shows real tenant ids.
  app.get("/admin/audit", async (req) => {
    const n = Math.min(200, Number((req.query as { n?: string }).n ?? 50));
    const records = ctx.audit.tail(n);
    return { records: isAdmin(req) ? records : records.map((r) => ({ ...r, tenantId: publicTenant(r.tenantId), requestId: r.requestId.slice(0, 15) + "…" })) };
  });

  app.get("/admin/audit/verify", async () => await ctx.audit.verify());

  app.get("/admin/tenants", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { tenants: ctx.tenants.list().map(({ keyHash, ...t }) => ({ ...t, keyFingerprint: keyHash.slice(0, 12) })) };
  });

  app.post("/admin/tenants", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body ?? {}) as { name?: string; rpm?: number; dailyTokenBudget?: number; zeroRetention?: boolean };
    if (!b.name) return reply.code(400).send({ error: { message: "name is required" } });
    const key = generateKey();
    const id = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32) + "-" + Date.now().toString(36);
    await ctx.tenants.add({ id, name: b.name, keyHash: hashKey(key), rpm: b.rpm ?? 60, dailyTokenBudget: b.dailyTokenBudget ?? 500_000, zeroRetention: !!b.zeroRetention, createdAt: new Date().toISOString() });
    return reply.code(201).send({ id, apiKey: key, note: "Shown once. Store it securely; the gateway keeps only its hash." });
  });

  // Printable NDPA report. Aggregates only, so it is as public as /admin/stats.
  app.get("/admin/report", async (req, reply) =>
    reply.type("text/html; charset=utf-8").send(await complianceReportHtml(ctx.audit, req.headers.host ?? "gateway"))
  );

  // Self-serve sandbox keys for developers trying the gateway: low limits, and a few keys per IP per hour.
  app.post("/v1/gateway/keys", async (req, reply) => {
    const rl = await rateLimit(ctx.store, `signup:${req.ip}`, 5, 3600);
    if (!rl.allowed) return reply.code(429).send({ error: { message: "Too many keys created from this network. Try again later.", type: "rate_limit_error" } });
    const b = (req.body ?? {}) as { name?: string; org?: string; contact?: string; listPublicly?: boolean };
    const clean = (v: unknown, max: number) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);
    const name = clean(b.name, 60) || "Sandbox developer";
    const key = generateKey();
    const id = "sandbox-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "dev") + "-" + Date.now().toString(36);
    const tenant = {
      id, name, keyHash: hashKey(key), rpm: 30, dailyTokenBudget: 100_000, zeroRetention: false,
      createdAt: new Date().toISOString(), org: clean(b.org, 80) || undefined, contact: clean(b.contact, 120) || undefined, listPublicly: b.listPublicly === true,
    };
    await ctx.tenants.add(tenant);
    return reply.code(201).send({ id, name, apiKey: key, rpm: tenant.rpm, dailyTokenBudget: tenant.dailyTokenBudget, note: "Sandbox key, shown once. The gateway stores only its hash." });
  });

  // Beta-tester feedback, tied to the tester's sandbox key when one is sent.
  app.post("/v1/gateway/feedback", async (req, reply) => {
    const rl = await rateLimit(ctx.store, `feedback:${req.ip}`, 20, 3600);
    if (!rl.allowed) return reply.code(429).send({ error: { message: "Too much feedback from this network. Thank you!", type: "rate_limit_error" } });
    const b = (req.body ?? {}) as { rating?: number; worked?: string; improve?: string; useCase?: string };
    const rating = Math.round(Number(b.rating));
    if (!(rating >= 1 && rating <= 5)) return reply.code(400).send({ error: { message: "rating must be 1 to 5" } });
    const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    const tenant = key ? ctx.tenants.authenticate(key) : undefined;
    // Feedback text is stored as written, so redact any PII a tester pastes in.
    const scrub = (v: unknown) => redactText(String(v ?? "").replace(/[<>]/g, "").trim().slice(0, 1000), new Vault());
    const fb: Feedback = {
      ts: new Date().toISOString(),
      tenantId: tenant?.id ?? "anonymous",
      name: tenant?.name ?? "Anonymous",
      rating,
      useCase: scrub(b.useCase).slice(0, 200),
      worked: scrub(b.worked),
      improve: scrub(b.improve),
    };
    await ctx.store.push(FEEDBACK_KEY, JSON.stringify(fb), 2000);
    return reply.code(201).send({ ok: true });
  });

  // Real-world validation evidence: sandbox testers, their usage, and their feedback.
  app.get("/beta", async (req, reply) => {
    const admin = isAdmin(req) && Boolean((req.query as { token?: string }).token || !config.adminToken);
    const feedback = (await ctx.store.range(FEEDBACK_KEY, 0, -1)).map((l) => JSON.parse(l) as Feedback);
    const summary = await ctx.audit.summarize();
    const testers = ctx.tenants.list().filter((t) => t.id.startsWith("sandbox-"));
    return reply.type("text/html; charset=utf-8").send(betaEvidenceHtml({ testers, feedback, requestsByTenant: summary.requestsByTenant, admin, host: req.headers.host ?? "" }));
  });

  // Hot-swap the N-ATLAS endpoint without a redeploy (validated with a live call first).
  app.get("/admin/upstream", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return currentUpstream();
  });

  app.post("/admin/upstream", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body ?? {}) as { url?: string; apiKey?: string; model?: string; label?: string; useMock?: boolean };
    const url = b.useMock ? `http://127.0.0.1:${config.port}/mock/v1` : b.url;
    if (!url) return reply.code(400).send({ error: { message: "url (or useMock: true) is required" } });
    const result = await switchUpstream(ctx.store, { url, apiKey: b.useMock ? "" : b.apiKey, model: b.useMock ? "n-atlas-8b" : b.model, label: b.useMock ? "" : b.label });
    return reply.code(result.ok ? 200 : 502).send({ ...result, upstream: currentUpstream() });
  });

  // Inspect redaction and injection scoring without calling the model (handy for demos and tests).
  app.post("/v1/gateway/inspect", async (req) => {
    const text = String((req.body as { text?: string })?.text ?? "");
    const vault = new Vault();
    return { redacted: redactText(text, vault), redactions: vault.counts, injection: scoreText(text), language: detectLanguage(text) };
  });
}
