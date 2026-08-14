# RAG FOR ALL — technical architecture

## Delivery strategy

The project begins as a single TypeScript web application so the learning loop stays fast. Product boundaries remain explicit, allowing parsing, embedding, retrieval, and generation to move into dedicated services later without rewriting the interface.

## Runtime layers

### Interface

- React and TypeScript.
- Step-based RAG workspace.
- Browser-side PDF/DOCX/text parsing and exact token-based chunking.
- Immediate local TF-IDF/BM25 retrieval so the pipeline remains usable without a paid API.
- Honest source labels on embeddings and answers.

### Application API

- `/api/documents` upload, list, and cascading deletion.
- `/api/embeddings` and `/api/answer` server-only OpenAI adapters.
- `/api/runs` experiment persistence and `/api/status` capability detection.
- Per-step run records containing input, configuration, output, timing, usage, and errors.

### Storage

- D1/SQLite for document metadata and pipeline run summaries.
- R2 for original files and parsed-document JSON.
- Embeddings currently remain ephemeral; durable vector infrastructure can wait until usage justifies it.

### OpenAI provider

- Responses API for answer generation.
- Embeddings API for vector representations.
- API key stored only as a server-side environment secret.
- Provider model IDs remain configurable rather than hard-coded into UI components.

## Pipeline contract

Every executable step produces a common envelope:

```ts
type StepRun<Input, Config, Output> = {
  id: string;
  step: string;
  input: Input;
  config: Config;
  output: Output;
  startedAt: string;
  durationMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCost?: number };
  error?: { code: string; message: string };
};
```

This contract makes partial reruns, history, inspection, and A/B comparison first-class behavior instead of UI decoration.

## Privacy model

- Originals and derived chunks share one project-scoped deletion path.
- Deletion covers file bytes, metadata, chunks, embeddings, runs, and cached answers.
- Logs must not contain document bodies or API keys.
- Upload limits and MIME validation happen server-side.
- The UI always states whether processing is local, on the application server, or at a model provider.

## Milestones

1. Interactive UI shell and deterministic local pipeline preview.
2. Real TXT/Markdown, PDF, and DOCX parsing with deletion — complete.
3. Real embedding, retrieval, and OpenAI Responses integration — complete for the single-document MVP.
4. Durable project history and export flows.
5. Retrieval quality metrics, hardening, accessibility, and private deployment.
