# RAG FOR ALL — technical architecture

## Delivery strategy

The project begins as a single TypeScript web application so the learning loop stays fast. Product boundaries remain explicit, allowing parsing, embedding, retrieval, and generation to move into dedicated services later without rewriting the interface.

## Runtime layers

### Interface

- React and TypeScript.
- Step-based RAG workspace.
- Immediate local previews for chunk boundaries and experiment settings.
- Honest preview labels whenever a real model has not been called.

### Application API

- Document upload, metadata, deletion, and experiment routes.
- Provider adapter for embedding and language-model APIs.
- Per-step run records containing input, configuration, output, timing, usage, and errors.

### Storage

- D1/SQLite for projects, document metadata, experiment configurations, pipeline runs, chunks, citations, and metrics.
- R2 for original uploaded files and generated exports.
- Vectors can start in structured storage for the small educational MVP, then move to a vector database when scale justifies it.

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
2. Real TXT/Markdown, PDF, and DOCX parsing with deletion.
3. Real embedding, vector retrieval, and OpenAI Responses integration.
4. Durable projects, exports, and A/B run history.
5. Retrieval quality metrics, hardening, tests, and private deployment.
