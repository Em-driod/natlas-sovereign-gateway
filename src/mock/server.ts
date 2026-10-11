// Standalone mock N-ATLAS on its own port (npm run mock). Demo mode mounts the same routes on the gateway instead.
import Fastify from "fastify";
import { mockRoutes } from "./upstream.js";

const PORT = Number(process.env.MOCK_PORT ?? 9090);
const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
await app.register(mockRoutes);
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`[mock N-ATLAS] listening on http://127.0.0.1:${PORT}/v1  (latency ~${process.env.MOCK_LATENCY_MS ?? 1400}ms)`);
