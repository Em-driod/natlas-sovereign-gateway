import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import type { GatewayContext } from "../context.js";
import { generateKey, hashKey } from "../security/tenants.js";
import { Vault, redactText } from "../pii/redactor.js";
import { scoreText } from "../security/injection.js";
import { dashboardHtml } from "../dashboard/page.js";

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.adminToken) return true; // open in local dev
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (token === config.adminToken) return true;
  reply.code(401).send({ error: { message: "Admin token required", type: "authentication_error" } });
  return false;
}

export function registerAdminRoutes(app: FastifyInstance, ctx: GatewayContext) {
  app.get("/", async (_req, reply) => reply.type("text/html; charset=utf-8").send(dashboardHtml()));

  app.get("/healthz", async () => ({ ok: true, store: ctx.store.kind, upstream: config.upstreamUrl.replace(/\/\/[^@]*@/, "//") }));

  app.get("/v1/models", async () => ({
    object: "list",
    data: [{ id: "n-atlas-8b", object: "model", created: 1727740800, owned_by: "ncair-via-sovereign-gateway" }],
  }));

  // Aggregates only: safe to show publicly on the dashboard.
  app.get("/admin/stats", async () => ({ ...ctx.stats.snapshot(), store: ctx.store.kind, cacheEnabled: config.cache.enabled, injectionMode: config.security.injectionMode }));

  app.get("/admin/audit", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const n = Math.min(200, Number((req.query as { n?: string }).n ?? 50));
    return { records: ctx.audit.tail(n) };
  });

  app.get("/admin/audit/verify", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return ctx.audit.verify();
  });

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
    ctx.tenants.add({ id, name: b.name, keyHash: hashKey(key), rpm: b.rpm ?? 60, dailyTokenBudget: b.dailyTokenBudget ?? 500_000, zeroRetention: !!b.zeroRetention });
    return reply.code(201).send({ id, apiKey: key, note: "Shown once. Store it securely; the gateway keeps only its hash." });
  });

  // Inspect redaction and injection scoring without calling the model (handy for demos and tests).
  app.post("/v1/gateway/inspect", async (req) => {
    const text = String((req.body as { text?: string })?.text ?? "");
    const vault = new Vault();
    return { redacted: redactText(text, vault), redactions: vault.counts, injection: scoreText(text) };
  });
}
