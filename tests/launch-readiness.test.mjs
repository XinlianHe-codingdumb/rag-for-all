import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("protects storage and paid-model API routes with server-side identity", async () => {
  const routes = await Promise.all([
    read("../app/api/documents/route.ts"),
    read("../app/api/runs/route.ts"),
    read("../app/api/answer/route.ts"),
    read("../app/api/embeddings/route.ts"),
    read("../app/api/rerank/route.ts"),
  ]);
  for (const route of routes) assert.match(route, /beginApiRequest\(/);
  assert.match(routes[0], /owner_id = \?/);
  assert.match(routes[1], /owner_id = \?/);
});

test("keeps operational logs metadata-only and adds usage protection", async () => {
  const [guard, schema, worker] = await Promise.all([
    read("../app/lib/api-guard.ts"),
    read("../db/schema.ts"),
    read("../worker/index.ts"),
  ]);
  assert.match(guard, /oai-authenticated-user-id/);
  assert.match(guard, /AUTH_REQUIRED/);
  assert.match(guard, /X-Request-Id/);
  assert.match(guard, /api_rate_limits/);
  assert.match(guard, /service: "rag-for-all"/);
  assert.doesNotMatch(guard, /documentText|promptText|apiKey/);
  assert.match(schema, /apiRateLimits/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /Permissions-Policy/);
});
