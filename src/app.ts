import Fastify, { type FastifyInstance } from "fastify";
import compress from "@fastify/compress";
import { config } from "./config.js";
import type { GatewayContext } from "./context.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerAdminRoutes } from "./routes/admin.js";

export async function buildApp(ctx: GatewayContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: config.logLevel,
      // Never log bodies or auth headers: prompts can carry PII.
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body"],
    },
    bodyLimit: config.security.maxBodyBytes,
    trustProxy: true,
  });

  // Mobile-first compression: brotli/gzip for JSON responses (SSE streams bypass this via hijack).
  await app.register(compress, { global: true, threshold: 512, encodings: ["br", "gzip", "deflate"] });

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-powered-by", "N-ATLAS Sovereign Gateway");
    reply.header("x-content-type-options", "nosniff");
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({ error: { message: status === 500 ? "Internal gateway error" : err.message, type: status === 500 ? "api_error" : "invalid_request_error" } });
  });

  registerChatRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  return app;
}
