import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("isolates storage and paid-model API routes with server-side anonymous identity", async () => {
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
  assert.match(guard, /rfa_session/);
  assert.match(guard, /anon:/);
  assert.match(guard, /cf-connecting-ip/);
  assert.match(guard, /ANALYTICS_HASH_SALT/);
  assert.doesNotMatch(guard, /rawIp|raw_ip/);
  assert.match(guard, /X-Request-Id/);
  assert.match(guard, /api_rate_limits/);
  assert.match(guard, /service: "rag-for-all"/);
  assert.doesNotMatch(guard, /documentText|promptText|apiKey/);
  assert.match(schema, /apiRateLimits/);
  assert.match(schema, /modelUsageDaily/);
  assert.match(guard, /reserveModelUsage/);
  assert.match(guard, /DAILY_USER_BUDGET_REACHED/);
  assert.match(guard, /DAILY_SITE_BUDGET_REACHED/);
  assert.match(guard, /MODEL_CALLS_DISABLED/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /Permissions-Policy/);
});

test("publishes public-beta privacy, analytics, retention, and terms in plain English", async () => {
  const [privacy, terms, documents, studio] = await Promise.all([
    read("../app/privacy/page.tsx"),
    read("../app/terms/page.tsx"),
    read("../app/api/documents/route.ts"),
    read("../app/rag-studio.tsx"),
  ]);
  assert.match(privacy, /automatic deletion seven days after upload/i);
  assert.match(privacy, /Anonymous product analytics are retained for up to 90 days/i);
  assert.match(privacy, /raw IP addresses/i);
  assert.match(privacy, /without an account/i);
  assert.match(privacy, /sent to the configured OpenAI API/i);
  assert.match(terms, /Upload only files you have the right to use/i);
  assert.match(documents, /cleanupExpiredDocuments/);
  assert.match(studio, /href="\/privacy"/);
  assert.match(studio, /href="\/terms"/);
});

test("allows only privacy-safe analytics fields and protects owner controls", async () => {
  const [events, adminRoute, adminAuth, adminPage, schema, studio] = await Promise.all([
    read("../app/api/events/route.ts"),
    read("../app/api/admin/analytics/route.ts"),
    read("../app/lib/admin-auth.ts"),
    read("../app/admin/page.tsx"),
    read("../db/schema.ts"),
    read("../app/rag-studio.tsx"),
  ]);
  assert.match(events, /EVENT_NAMES/);
  assert.match(events, /PROPERTY_NAMES/);
  assert.doesNotMatch(events, /"(filename|question|prompt|answer|documentText|email)"/);
  assert.match(events, /90 \* 24 \* 60 \* 60/);
  assert.match(adminAuth, /ADMIN_OWNER_ID/);
  assert.match(adminAuth, /ADMIN_OWNER_EMAIL/);
  assert.match(adminAuth, /ADMIN_REQUIRED/);
  assert.match(adminPage, /requireChatGPTUser\("\/admin"\)/);
  assert.match(adminPage, /force-dynamic/);
  assert.match(adminRoute, /model_calls_enabled/);
  assert.match(adminRoute, /site_daily_token_budget/);
  assert.match(schema, /analyticsEvents/);
  assert.match(schema, /siteSettings/);
  assert.match(studio, /section_view/);
  assert.match(studio, /answer_generated/);
});
