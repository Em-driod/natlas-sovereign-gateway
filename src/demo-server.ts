// One command for judges: gateway + mock N-ATLAS on a single port (no model access needed).
// The mock is mounted at /mock/v1, so hosts like Render only ever see one open port.
process.env.MOCK_UPSTREAM ??= "true";
process.env.UPSTREAM_URL ??= `http://127.0.0.1:${process.env.PORT ?? 8080}/mock/v1`;
await import("./index.js");
