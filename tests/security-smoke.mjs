import assert from "node:assert/strict";
import { File } from "node:buffer";

const baseUrl = process.env.RAG_FOR_ALL_URL ?? "http://localhost:3000";

const crossSite = await fetch(`${baseUrl}/api/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  body: JSON.stringify({ name: "page_view", path: "/" }),
});
assert.equal(crossSite.status, 403);
await crossSite.text();

const invalidJson = await fetch(`${baseUrl}/api/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{not-json",
});
assert.equal(invalidJson.status, 400);
assert.equal((await invalidJson.json()).code, "INVALID_JSON");

const oversized = await fetch(`${baseUrl}/api/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "page_view", path: "/", padding: "x".repeat(5_000) }),
});
assert.equal(oversized.status, 413);
assert.equal((await oversized.json()).code, "REQUEST_TOO_LARGE");

const form = new FormData();
const disguised = new File(["not a supported document"], "payload.exe", { type: "application/pdf" });
form.set("file", disguised);
form.set("parsed", JSON.stringify({
  id: crypto.randomUUID(),
  text: "not a supported document",
  pages: [{ pageNumber: 1, text: "not a supported document" }],
  warnings: [],
  parsedAt: new Date().toISOString(),
}));
const invalidUpload = await fetch(`${baseUrl}/api/documents`, { method: "POST", body: form });
assert.equal(invalidUpload.status, 415);

const statusResponse = await fetch(`${baseUrl}/api/status`);
assert.equal(statusResponse.status, 200);
const status = await statusResponse.json();
assert.equal("userDailyTokenBudget" in status, false);

console.log("Security smoke passed: cross-site, malformed, oversized, disguised-file, and metadata checks");
