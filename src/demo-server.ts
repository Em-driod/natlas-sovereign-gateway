// One command for judges: mock N-ATLAS + gateway in a single process (no model access needed).
process.env.MOCK_UPSTREAM ??= "true";
process.env.UPSTREAM_URL ??= `http://127.0.0.1:${process.env.MOCK_PORT ?? 9090}/v1`;
await import("./index.js");
