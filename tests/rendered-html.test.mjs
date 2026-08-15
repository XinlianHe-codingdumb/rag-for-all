import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RAG FOR ALL workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RAG FOR ALL/);
  assert.match(html, /See what your RAG is thinking/);
  assert.match(html, /RAG, FROM IDEA TO TRUST/);
  assert.match(html, /Give the model an open book/);
  assert.match(html, /Next card/);
  assert.match(html, /THE COMPLETE RAG JOURNEY/);
  assert.match(html, /Click any step to look inside/);
  assert.doesNotMatch(html, /Start with a document/);
  assert.match(html, /Open Document step/);
  assert.match(html, /THE LEARNING LOOP/);
  assert.match(html, /two pipelines/);
  assert.match(html, /Northstar Handbook/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("keeps API credentials out of client source", async () => {
  const [page, studio, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/rag-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  const source = `${page}\n${studio}\n${layout}`;
  assert.doesNotMatch(source, /sk-[a-zA-Z0-9_-]{20,}/);
  assert.doesNotMatch(source, /OPENAI_API_KEY\s*=/);
  assert.doesNotMatch(source, /_sites-preview|SkeletonPreview/);
  assert.match(studio, /Embedding converts every chunk into a vector/);
  assert.match(studio, /WHAT THIS A\/B TEST IS TESTING/);
  assert.match(studio, /Drag to move the plane/);
  assert.match(studio, /The question enters the same space/);
  assert.match(studio, /Similarity finds candidates\. Reranking chooses evidence/);
  assert.match(studio, /SECOND PASS · WHAT REACHED THE LLM/);
  assert.doesNotMatch(studio, /WHAT HAPPENS|WHY IT MATTERS|FROM THE LAST STEP|WATCH FOR/);
});
