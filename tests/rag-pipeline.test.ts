import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { File } from "node:buffer";

import { parseDocumentFile } from "../app/lib/document-parser";
import {
  buildPrompt,
  createChunks,
  createLocalEmbeddings,
  extractiveAnswer,
  rankChunks,
  rerankChunks,
  retrievalCandidateCount,
} from "../app/lib/rag-engine";
import type { ParsedDocument, PipelineConfig } from "../app/lib/rag-types";

const config: PipelineConfig = {
  chunkSize: 36,
  overlap: 6,
  topK: 2,
  method: "Hybrid",
  strategy: "Recursive",
};

async function fixtureFile(name: string, type: string) {
  const bytes = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  return new File([bytes], name, { type }) as unknown as globalThis.File;
}

test("PDF parsing preserves page boundaries and readable facts", async () => {
  const file = await fixtureFile("northstar-handbook.pdf", "application/pdf");
  const parsed = await parseDocumentFile(file);
  assert.equal(parsed.pages.length, 3);
  assert.match(parsed.pages[0].text, /SGD 1,200 learning allowance/);
  assert.match(parsed.pages[1].text, /18 days of annual leave/);
  assert.match(parsed.pages[2].text, /SGD 500/);
});

test("DOCX parsing extracts its facts and explains its page limitation", async () => {
  const file = await fixtureFile(
    "northstar-handbook.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const parsed = await parseDocumentFile(file);
  assert.match(parsed.text, /SGD 1,200 learning allowance/);
  assert.match(parsed.text, /18 days of annual leave/);
  assert.ok(parsed.warnings.some((warning) => warning.includes("page numbers")));
});

test("chunking respects token limits and retrieval respects Top-K", () => {
  const document: ParsedDocument = {
    id: "fixture",
    name: "handbook.txt",
    mimeType: "text/plain",
    size: 500,
    text: "",
    pages: [
      { pageNumber: 1, text: "Learning allowance. Every teammate receives SGD 1,200 for courses with manager approval." },
      { pageNumber: 2, text: "Annual leave. Employees receive 18 days of annual leave each year." },
      { pageNumber: 3, text: "Home office support. The company reimburses SGD 500 for ergonomic equipment." },
    ],
    warnings: [],
    parsedAt: new Date(0).toISOString(),
    persisted: false,
  };
  const chunks = createChunks(document, config);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.tokenCount <= config.chunkSize));

  const query = "How much is the learning allowance?";
  const embeddings = createLocalEmbeddings(chunks, query);
  const ranked = rankChunks(chunks, query, config, embeddings);
  assert.equal(ranked.length, Math.min(config.topK, chunks.length));
  assert.match(ranked[0].text, /1,200/);

  const topOne = rankChunks(chunks, query, { ...config, topK: 1 }, embeddings);
  assert.equal(topOne.length, 1);
  assert.match(buildPrompt(query, topOne), /\[Chunk \d+ \| Page/);
  assert.match(extractiveAnswer(query, topOne), /\[Chunk \d+\]/);
});

test("different chunk sizes produce a different experiment", () => {
  const page = Array.from({ length: 24 }, (_, index) => `Policy sentence ${index + 1} has a useful detail.`).join(" ");
  const document: ParsedDocument = {
    id: "ab-fixture",
    name: "ab.txt",
    mimeType: "text/plain",
    size: page.length,
    text: page,
    pages: [{ pageNumber: 1, text: page }],
    warnings: [],
    parsedAt: new Date(0).toISOString(),
    persisted: false,
  };
  const small = createChunks(document, { ...config, chunkSize: 24, overlap: 4 });
  const large = createChunks(document, { ...config, chunkSize: 80, overlap: 8 });
  assert.ok(small.length > large.length);
});

test("reranking is a distinct second pass that can change retrieval order", () => {
  const candidates = [
    {
      id: 1, text: "Learning programs and learning culture are discussed throughout the handbook.", tokenCount: 10,
      pageStart: 1, pageEnd: 1, score: .95, vectorScore: .95, keywordScore: .8, rank: 1,
    },
    {
      id: 2, text: "The annual learning allowance is SGD 1,200 for approved courses.", tokenCount: 12,
      pageStart: 2, pageEnd: 2, score: .7, vectorScore: .7, keywordScore: .65, rank: 2,
    },
  ];
  const reranked = rerankChunks(candidates, "What is the annual learning allowance amount?", 1);
  assert.equal(reranked[0].id, 2);
  assert.equal(reranked[0].retrievalRank, 2);
  assert.equal(reranked[0].rerankRank, 1);
  assert.match(reranked[0].rerankReason, /question terms/);
  assert.equal(retrievalCandidateCount(3, 100), 9);
  assert.equal(retrievalCandidateCount(12, 100), 24);
});
