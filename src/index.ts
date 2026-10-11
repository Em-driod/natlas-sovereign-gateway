import { config } from "./config.js";
import { createContext } from "./context.js";
import { buildApp } from "./app.js";

// Single-process demo deploys: MOCK_UPSTREAM=true starts the mock N-ATLAS next to the gateway.
if (/^(1|true|yes)$/i.test(process.env.MOCK_UPSTREAM ?? "")) {
  await import("./mock/upstream.js");
}

const ctx = await createContext();
const app = await buildApp(ctx);

const address = await app.listen({ port: config.port, host: config.host });
console.log(`[gateway] bound to ${address} (HOST env: ${process.env.HOST ?? "unset"})`);

console.log(`
  N-ATLAS Sovereign Gateway
  -------------------------
  Gateway    http://localhost:${config.port}/v1
  Dashboard  http://localhost:${config.port}/
  Upstream   ${config.upstreamUrl}  (model: ${config.upstreamModel})
  Store      ${ctx.store.kind}${config.cache.enabled ? `, semantic cache on (threshold ${config.cache.semanticThreshold})` : ", cache off"}
  Injection  ${config.security.injectionMode} at score >= ${config.security.injectionThreshold}
  Demo key   ${process.env.DEMO_API_KEY ?? "sk-natlas-demo-key"}
`);

const shutdown = async () => {
  await app.close();
  await ctx.store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
