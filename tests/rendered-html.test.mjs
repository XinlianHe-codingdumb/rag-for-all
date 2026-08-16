import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RAG FOR ALL workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  assert.match(html, /<title>RAG FOR ALL/);
  assert.match(html, /See the evidence behind the answer/);
  assert.match(html, /RAG is how an <span class="agent-phrase">AI agent<\/span> becomes/);
  assert.match(html, /headline-yours">yours\./);
  assert.match(html, /NEW TO RAG/);
  assert.match(html, /ALREADY KNOW RAG/);
  assert.match(html, /I should learn what RAG is first/);
  assert.match(html, /I know the theory/);
  assert.match(html, /WHY RAG CHANGES THE CONVERSATION/);
  assert.match(html, /Same question\. Very different assistant/);
  assert.match(html, /went official with someone else yesterday/);
  assert.match(html, /Generic information only/);
  assert.match(html, /But she made plans with me yesterday/);
  assert.match(html, /Congratulations—you have a date/);
  assert.match(html, /Never mind\. Leave me alone/);
  assert.match(html, /basketball with friends on your calendar tonight/);
  assert.match(html, /doodle-walking\.png/);
  assert.match(html, /doodle-lounging\.png/);
  assert.match(html, /doodle-agent\.png/);
  assert.match(html, /doodle-agent-confused\.png/);
  assert.match(html, /doodle-agent-celebrate\.png/);
  assert.match(html, /doodle-agent-basketball\.png/);
  assert.doesNotMatch(html, /See every hand-off/);
  assert.match(html, /RAG, FROM IDEA TO TRUST/);
  assert.match(html, /Give AI an open book/);
  assert.match(html, /Next card/);
  assert.match(html, /Back to intro/);
  assert.match(html, /Skip to interactive pipeline/);
  assert.doesNotMatch(html, /Start again/);
  assert.match(html, /THE COMPLETE RAG JOURNEY/);
  assert.match(html, /Turn one document into an answer you can trace/);
  assert.match(html, /Start with Document/);
  assert.match(html, /Open Document step/);
  assert.match(html, /THE LEARNING LOOP/);
  assert.match(html, /two pipelines/);
  assert.match(html, /Northstar Handbook/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("renders route-specific legal metadata without the homepage social image", async () => {
  for (const [path, title, description] of [
    ["/privacy", "Privacy — RAG FOR ALL", "How the RAG FOR ALL private beta handles documents"],
    ["/terms", "Terms — RAG FOR ALL", "Private-beta terms for using RAG FOR ALL"],
  ]) {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(`<title>${title}`));
    assert.match(html, new RegExp(description));
    assert.doesNotMatch(html, /og\.png/);
  }
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
  assert.match(studio, /See exactly what the question connects to/);
  assert.match(studio, /Fit Top K/);
  assert.match(studio, /AUTO-FITTED/);
  assert.match(studio, /Similarity finds candidates\. Reranking chooses evidence/);
  assert.match(studio, /SECOND PASS · WHAT REACHED THE LLM/);
  assert.match(studio, /Now show me the pipeline/);
  assert.doesNotMatch(studio, /WHAT HAPPENS|FROM THE LAST STEP|WATCH FOR/);
});
