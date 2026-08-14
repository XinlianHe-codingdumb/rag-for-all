import assert from "node:assert/strict";
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.RAG_FOR_ALL_URL ?? "http://localhost:3000";
const id = `storage-smoke-${Date.now()}`;
const bytes = await readFile(new URL("./fixtures/northstar-handbook.pdf", import.meta.url));
const file = new File([bytes], "northstar-handbook.pdf", { type: "application/pdf" });
const parsed = {
  id,
  name: file.name,
  mimeType: file.type,
  size: file.size,
  text: "Learning allowance is SGD 1,200.",
  pages: [{ pageNumber: 1, text: "Learning allowance is SGD 1,200." }],
  warnings: [],
  parsedAt: new Date().toISOString(),
  persisted: false,
};

let created = false;
try {
  const form = new FormData();
  form.set("file", file);
  form.set("parsed", JSON.stringify(parsed));
  const createResponse = await fetch(`${baseUrl}/api/documents`, { method: "POST", body: form });
  assert.equal(createResponse.status, 201, await createResponse.text());
  created = true;

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.ok(list.documents.some((document) => document.id === id));

  const deleteResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  assert.equal(deleteResponse.status, 200);
  created = false;

  const finalList = await (await fetch(`${baseUrl}/api/documents`)).json();
  assert.ok(!finalList.documents.some((document) => document.id === id));
  console.log("Storage smoke passed: create -> list -> delete -> absent");
} finally {
  if (created) {
    await fetch(`${baseUrl}/api/documents`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }
}
