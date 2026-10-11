import { config } from "./config.js";
import { createContext } from "./context.js";
import { buildApp } from "./app.js";
import { currentUpstream } from "./upstream/registry.js";

const ctx = await createContext();
const app = await buildApp(ctx);

// Demo deploys: MOCK_UPSTREAM=true mounts the mock N-ATLAS on this same server under /mock.
if (/^(1|true|yes)$/i.test(process.env.MOCK_UPSTREAM ?? "")) {
  const { mockRoutes } = await import("./mock/upstream.js");
  await app.register(mockRoutes, { prefix: "/mock" });
}

await app.listen({ port: config.port, host: config.host });

console.log(`
  N-ATLAS Sovereign Gateway
  -------------------------
  Gateway    http://localhost:${config.port}/v1
  Dashboard  http://localhost:${config.port}/
  Upstream   ${currentUpstream().url}  (model: ${config.upstreamModel}, ${currentUpstream().mode})
  Store      ${ctx.store.kind}${config.cache.enabled ? `, semantic cache on (threshold ${config.cache.semanticThreshold})` : ", cache off"}
  Injection  ${config.security.injectionMode} at score >= ${config.security.injectionThreshold}
  Demo key   ${process.env.DEMO_API_KEY ?? "sk-natlas-demo-key"}
`);

const shutdown = async () => {
  await app.close();
  await ctx.saveStats();
  await ctx.audit.flush();
  ctx.stop();
  await ctx.store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
