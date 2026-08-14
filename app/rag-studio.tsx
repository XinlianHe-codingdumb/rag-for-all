"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseDocumentFile } from "./lib/document-parser";
import {
  buildPrompt,
  countTextTokens,
  createChunks,
  createLocalEmbeddings,
  extractiveAnswer,
  pageLabel,
  projectVector,
  rankChunks,
} from "./lib/rag-engine";
import type {
  AnswerState,
  EmbeddingState,
  ParsedDocument,
  PipelineConfig,
  RankedChunk,
} from "./lib/rag-types";

type StepKey = "upload" | "parse" | "chunk" | "embed" | "retrieve" | "rerank" | "prompt" | "answer" | "compare";
type ExperimentName = "A" | "B";
type ApiStatus = {
  openaiConfigured: boolean;
  embeddingModel: string;
  responseModel: string;
  persistenceConfigured: boolean;
};

const STEPS: Array<{ key: StepKey; number: string; title: string; note: string }> = [
  { key: "upload", number: "01", title: "Document", note: "Bring the knowledge" },
  { key: "parse", number: "02", title: "Parse", note: "Turn files into text" },
  { key: "chunk", number: "03", title: "Chunk", note: "Cut, but with manners" },
  { key: "embed", number: "04", title: "Embed", note: "Meaning becomes math" },
  { key: "retrieve", number: "05", title: "Retrieve", note: "Find the useful bits" },
  { key: "rerank", number: "06", title: "Rerank", note: "Put the best first" },
  { key: "prompt", number: "07", title: "Prompt", note: "Pack the context" },
  { key: "answer", number: "08", title: "Answer", note: "Let the model speak" },
  { key: "compare", number: "A/B", title: "Compare", note: "Receipts, not vibes" },
];

const SAMPLE_PAGES = [
  `Northstar Coffee is a fictional company with a very real obsession: making office coffee less tragic. The company was founded in Singapore in 2022 and now operates small coffee bars inside twelve shared offices.

Employees receive an annual learning allowance of SGD 1,200. The allowance may be used for courses, books, conferences, or professional software. Espresso machines are not professional software, no matter how persuasive the product page looks.

Learning requests below SGD 300 can be approved by a direct manager. Requests from SGD 300 to SGD 1,200 also need approval from People Operations. Unused allowance expires on 31 December and does not roll over to the next year.`,
  `Northstar supports flexible work. Team members may work remotely up to three days per week. Tuesdays are the shared in-office day for product, design, and engineering. Employees may work abroad for up to twenty business days per calendar year after receiving manager approval.

Annual leave starts at eighteen days. Employees receive one additional day after every completed year of service, capped at twenty-four days. Sick leave follows local employment requirements and does not reduce annual leave.

For information security, confidential documents must remain in approved company storage. Personal cloud drives are not approved. Lost devices must be reported to the security team within one hour. This is not the moment to hope the laptop finds itself.`,
  `Business expenses should be submitted within thirty days. Receipts are required for expenses above SGD 25. Client meals require the names of attendees and a short business purpose. Finance reviews complete claims every Friday.

The company provides a wellness allowance of SGD 60 per month. It covers gym memberships, fitness classes, meditation apps, and sports equipment. Coffee beans are excluded because the company already provides more coffee than medical science can comfortably defend.`,
];

const SAMPLE_DOCUMENT: ParsedDocument = {
  id: "sample-northstar",
  name: "northstar-handbook.md",
  mimeType: "text/markdown",
  size: SAMPLE_PAGES.join("\n\n").length,
  text: SAMPLE_PAGES.join("\n\n"),
  pages: SAMPLE_PAGES.map((text, index) => ({ pageNumber: index + 1, text })),
  warnings: [],
  parsedAt: new Date(0).toISOString(),
  persisted: false,
};

const DEFAULTS: Record<ExperimentName, PipelineConfig> = {
  A: { chunkSize: 100, overlap: 20, topK: 3, method: "Hybrid", strategy: "Recursive" },
  B: { chunkSize: 180, overlap: 36, topK: 5, method: "Vector", strategy: "Sentence" },
};

export function RagStudio() {
  const [activeStep, setActiveStep] = useState<StepKey>("upload");
  const [mode, setMode] = useState<"Basic" | "Advanced">("Basic");
  const [activeExperiment, setActiveExperiment] = useState<ExperimentName>("A");
  const [experiments, setExperiments] = useState(DEFAULTS);
  const [document, setDocument] = useState<ParsedDocument | null>(SAMPLE_DOCUMENT);
  const [query, setQuery] = useState("How much can I spend on learning?");
  const [remoteEmbedding, setRemoteEmbedding] = useState<EmbeddingState | null>(null);
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [notice, setNotice] = useState("Sample project is ready. Upload your own document whenever you like.");
  const [busy, setBusy] = useState<string | null>(null);
  const [pipelineRan, setPipelineRan] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((status: ApiStatus) => setApiStatus(status))
      .catch(() => setApiStatus({ openaiConfigured: false, embeddingModel: "Local TF-IDF", responseModel: "Extractive fallback", persistenceConfigured: false }));
  }, []);

  const config = experiments[activeExperiment];
  const chunks = useMemo(() => document ? createChunks(document, config) : [], [document, config]);
  const localEmbedding = useMemo(() => createLocalEmbeddings(chunks, query), [chunks, query]);
  const currentEmbeddingKey = useMemo(
    () => `${document?.id ?? "none"}:${activeExperiment}:${config.chunkSize}:${config.overlap}:${config.strategy}:${query}`,
    [document, activeExperiment, config.chunkSize, config.overlap, config.strategy, query],
  );
  const embedding = embeddingKey === currentEmbeddingKey && remoteEmbedding?.vectors.length === chunks.length
    ? remoteEmbedding
    : localEmbedding;
  const ranked = useMemo(() => rankChunks(chunks, query, config, embedding), [chunks, query, config, embedding]);
  const prompt = useMemo(() => buildPrompt(query, ranked), [query, ranked]);

  const comparisons = useMemo(() => (["A", "B"] as const).map((name) => {
    const settings = experiments[name];
    const candidateChunks = document ? createChunks(document, settings) : [];
    const candidateEmbedding = createLocalEmbeddings(candidateChunks, query);
    const results = rankChunks(candidateChunks, query, settings, candidateEmbedding);
    return {
      name,
      settings,
      chunks: candidateChunks.length,
      contextTokens: results.reduce((sum, item) => sum + item.tokenCount, 0),
      best: results[0]?.score ?? 0,
      results,
    };
  }), [document, experiments, query]);

  const updateConfig = (patch: Partial<PipelineConfig>) => {
    setExperiments((current) => ({
      ...current,
      [activeExperiment]: { ...current[activeExperiment], ...patch },
    }));
    setPipelineRan(false);
    setAnswer(null);
  };

  const chooseFile = () => inputRef.current?.click();

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const loadFile = async (file: File) => {
    setBusy("Reading and cleaning the document…");
    setAnswer(null);
    setPipelineRan(false);
    try {
      let parsed = await parseDocumentFile(file);
      setDocument(parsed);
      setRemoteEmbedding(null);
      setEmbeddingKey("");
      setActiveStep("parse");
      setNotice(`${file.name} parsed successfully: ${parsed.pages.length} page${parsed.pages.length === 1 ? "" : "s"}, ${parsed.text.length.toLocaleString()} characters.`);

      try {
        const form = new FormData();
        form.set("file", file);
        form.set("parsed", JSON.stringify(parsed));
        const response = await fetch("/api/documents", { method: "POST", body: form });
        if (response.ok) {
          parsed = { ...parsed, persisted: true };
          setDocument(parsed);
          setNotice(`${file.name} parsed and saved privately. Delete removes the original, parsed text, and run history.`);
        }
      } catch {
        setNotice(`${file.name} parsed locally. Persistent storage is unavailable, so nothing was uploaded.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This document could not be parsed.");
    } finally {
      setBusy(null);
    }
  };

  const runPipeline = async () => {
    if (!document || !chunks.length) {
      setNotice("Upload a readable document before running the pipeline.");
      setActiveStep("upload");
      return;
    }
    setBusy("Embedding and retrieving the best evidence…");
    setAnswer(null);
    let nextEmbedding = localEmbedding;
    try {
      const response = await fetch("/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [query, ...chunks.map((chunk) => chunk.text)] }),
      });
      if (response.ok) {
        const body = await response.json() as { vectors: number[][]; model: string; inputTokens: number };
        nextEmbedding = {
          queryVector: body.vectors[0] ?? [],
          vectors: body.vectors.slice(1),
          source: "OpenAI",
          model: body.model,
          inputTokens: body.inputTokens,
        };
        setRemoteEmbedding(nextEmbedding);
        setEmbeddingKey(currentEmbeddingKey);
      } else {
        setRemoteEmbedding(null);
        setEmbeddingKey("");
      }
    } catch {
      setRemoteEmbedding(null);
      setEmbeddingKey("");
    }
    const nextResults = rankChunks(chunks, query, config, nextEmbedding);
    setPipelineRan(true);
    setBusy(null);
    setNotice(`Experiment ${activeExperiment} retrieved ${nextResults.length} of ${chunks.length} chunks using ${nextEmbedding.source}.`);
    void saveRun(nextResults, nextEmbedding);
  };

  const saveRun = async (results: RankedChunk[], usedEmbedding: EmbeddingState) => {
    if (!document?.persisted) return;
    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          experiment: activeExperiment,
          query,
          config,
          result: {
            embeddingSource: usedEmbedding.source,
            chunks: results.map((item) => ({ id: item.id, score: item.score, pageStart: item.pageStart, pageEnd: item.pageEnd })),
          },
        }),
      });
    } catch {
      // A failed history write must not break the educational pipeline.
    }
  };

  const generateAnswer = async () => {
    if (!ranked.length) return;
    setBusy("Generating a grounded answer…");
    const startedAt = performance.now();
    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: query,
          context: ranked.map((item) => `[Chunk ${item.id} | ${pageLabel(item.pageStart, item.pageEnd)}]\n${item.text}`),
        }),
      });
      if (response.ok) {
        const body = await response.json() as { text: string; model: string; inputTokens: number; outputTokens: number; durationMs: number };
        setAnswer({
          text: body.text,
          source: "OpenAI",
          model: body.model,
          inputTokens: body.inputTokens,
          outputTokens: body.outputTokens,
          durationMs: body.durationMs,
        });
        setNotice(`Grounded answer generated with ${body.model}. Follow the chunk citations before trusting it.`);
      } else {
        setAnswer({ text: extractiveAnswer(query, ranked), source: "Extractive fallback", model: "Local sentence selection", durationMs: Math.round(performance.now() - startedAt) });
        setNotice("OpenAI is not configured, so the answer uses retrieved sentences directly. No paid API call was made.");
      }
    } catch {
      setAnswer({ text: extractiveAnswer(query, ranked), source: "Extractive fallback", model: "Local sentence selection", durationMs: Math.round(performance.now() - startedAt) });
      setNotice("The model API was unavailable, so RAG FOR ALL used a local extractive answer.");
    } finally {
      setBusy(null);
    }
  };

  const deleteDocument = async () => {
    const id = document?.id;
    const persisted = document?.persisted;
    setDocument(null);
    setRemoteEmbedding(null);
    setEmbeddingKey("");
    setAnswer(null);
    setPipelineRan(false);
    setActiveStep("upload");
    setNotice("Document removed from this session. Clean desk, clean vectors.");
    if (id && persisted) {
      try {
        await fetch("/api/documents", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        setNotice("Document, parsed text, and experiment history were deleted from storage.");
      } catch {
        setNotice("The local document was cleared, but the storage deletion could not be confirmed.");
      }
    }
  };

  const restoreSample = () => {
    setDocument(SAMPLE_DOCUMENT);
    setAnswer(null);
    setRemoteEmbedding(null);
    setEmbeddingKey("");
    setPipelineRan(false);
    setNotice("Sample handbook restored. It is synthetic and stays in the browser.");
    setActiveStep("parse");
  };

  const activeMeta = STEPS.find((step) => step.key === activeStep)!;
  const completed = (step: StepKey) => {
    if (step === "upload" || step === "parse" || step === "chunk") return Boolean(document);
    if (["embed", "retrieve", "rerank", "prompt"].includes(step)) return pipelineRan;
    if (step === "answer") return Boolean(answer);
    return false;
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">R</div>
          <div><strong>RAG FOR ALL</strong><span>See what your RAG is thinking.</span></div>
        </div>
        <div className="top-actions">
          <div className={`privacy-pill ${apiStatus?.openaiConfigured ? "connected" : ""}`}>
            <i /> {apiStatus?.openaiConfigured ? "OpenAI connected" : "Local mode"}
          </div>
          <button className="quiet-button" type="button" onClick={() => setNotice("The plain-English guide will grow with each real pipeline step.")}>Guide</button>
          <button className="avatar" type="button" aria-label="Open profile">XL</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="project-card">
            <span>PROJECT</span>
            <strong>{document ? friendlyProjectName(document.name) : "No document"}</strong>
            <small>{document?.name ?? "Upload to begin"}</small>
          </div>
          <nav aria-label="RAG pipeline">
            <p className="nav-label">PIPELINE</p>
            {STEPS.map((step) => (
              <button type="button" key={step.key} className={`nav-step ${activeStep === step.key ? "active" : ""}`} onClick={() => setActiveStep(step.key)}>
                <span className="step-number">{step.number}</span>
                <span className="step-copy"><strong>{step.title}</strong><small>{step.note}</small></span>
                <span className={`step-state ${completed(step.key) ? "done" : ""}`}>{completed(step.key) ? "✓" : "·"}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <button type="button" onClick={() => setActiveStep("compare")}><span>⌁</span> Experiment history</button>
            <button type="button" onClick={() => setNotice("Blue labels explain what changes; gray labels explain why it matters.")}><span>?</span> Plain-English guide</button>
          </div>
        </aside>

        <section className="content">
          {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}
          {busy && <div className="busy-bar" role="status"><i />{busy}</div>}

          <div className="content-header">
            <div>
              <p className="eyebrow">STEP {activeMeta.number} · {activeMeta.note.toUpperCase()}</p>
              <h1>{activeMeta.title}</h1>
              <p>{stepIntro(activeStep)}</p>
            </div>
            <div className="mode-switch" aria-label="Interface mode">
              {(["Basic", "Advanced"] as const).map((item) => <button key={item} type="button" className={mode === item ? "selected" : ""} onClick={() => setMode(item)}>{item}</button>)}
            </div>
          </div>

          <div className="experiment-bar">
            <div className="experiment-tabs">
              {(["A", "B"] as const).map((item) => (
                <button key={item} type="button" className={activeExperiment === item ? "active" : ""} onClick={() => setActiveExperiment(item)}>
                  Experiment {item}<small>{item === "A" ? "Baseline" : "Challenger"}</small>
                </button>
              ))}
            </div>
            <button className="run-button" type="button" onClick={() => void runPipeline()} disabled={Boolean(busy) || !document}><span>▶</span>{busy ? "Working…" : "Run pipeline"}</button>
          </div>

          <div className="stage">
            {activeStep === "upload" && (
              <section className="upload-stage">
                <div className="drop-zone" onClick={chooseFile} onDrop={onDrop} onDragOver={(event) => event.preventDefault()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") chooseFile(); }}>
                  <div className="upload-icon">↑</div>
                  <h2>{document && document.id !== SAMPLE_DOCUMENT.id ? "Replace this document" : "Drop knowledge here"}</h2>
                  <p>Text PDF, DOCX, TXT, or Markdown · 20 MB maximum</p>
                  <button type="button" onClick={(event) => { event.stopPropagation(); chooseFile(); }}>Choose a document</button>
                  <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.md,.markdown" onChange={onFileInput} hidden />
                  {document && <div className="loaded-file"><strong>{document.name}</strong><span>{document.pages.length} page{document.pages.length === 1 ? "" : "s"} · {formatBytes(document.size)} · {countTextTokens(document.text).toLocaleString()} tokens</span></div>}
                </div>
                <div className="privacy-card">
                  <span>Privacy by default</span>
                  <p>Parsing starts in your browser. When storage is available, originals and parsed text are stored together and share one deletion path.</p>
                  <strong className="storage-state">{document?.persisted ? "Saved privately" : "Browser session only"}</strong>
                  {document && <button type="button" onClick={() => void deleteDocument()}>Delete current document</button>}
                  {!document && <button type="button" onClick={restoreSample}>Restore sample handbook</button>}
                </div>
              </section>
            )}

            {activeStep === "parse" && (
              <section className="panel-grid parse-layout">
                <div className="paper-preview">
                  <div className="paper-head"><span>{document?.name ?? "No document"}</span><small>EXTRACTED TEXT</small></div>
                  <div className="paper-body">{document?.pages.map((page) => <section className="parsed-page" key={page.pageNumber}><small>PAGE {page.pageNumber}</small><p>{page.text}</p></section>) ?? "Upload a document to inspect its extracted text."}</div>
                </div>
                <div className="inspector">
                  <h3>Parser report</h3>
                  <Stat label="Characters" value={(document?.text.length ?? 0).toLocaleString()} />
                  <Stat label="Tokens" value={document ? countTextTokens(document.text).toLocaleString() : "0"} />
                  <Stat label="Pages" value={String(document?.pages.length ?? 0)} />
                  <Stat label="File size" value={formatBytes(document?.size ?? 0)} />
                  <Stat label="Storage" value={document?.persisted ? "Private storage" : "Local session"} accent={document?.persisted} />
                  {document?.warnings.length ? <div className="warning-list"><strong>Heads up</strong>{document.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : <div className="callout"><strong>Looks tidy.</strong><span>Readable text was extracted without needing interpretive dance.</span></div>}
                </div>
              </section>
            )}

            {activeStep === "chunk" && (
              <section className="panel-grid chunk-layout">
                <div className="chunk-canvas">
                  <div className="panel-title"><div><span>LIVE TOKEN PREVIEW</span><h2>{chunks.length} chunks from {document?.pages.length ?? 0} page{document?.pages.length === 1 ? "" : "s"}</h2></div><div className="legend"><i /> Real BPE token counts</div></div>
                  <div className="chunk-list">
                    {chunks.map((chunk, index) => <article className="chunk-card" key={chunk.id}>
                      <div className="chunk-id">{String(chunk.id).padStart(2, "0")}</div>
                      <div><header><strong>{pageLabel(chunk.pageStart, chunk.pageEnd)}</strong></header><p>{chunk.text}</p><footer><span>{chunk.tokenCount} tokens</span><span>{chunk.text.split(/\s+/).length} words</span>{index < chunks.length - 1 && config.overlap > 0 && <span className="overlap-tag">up to {config.overlap} token overlap</span>}</footer></div>
                    </article>)}
                    {!chunks.length && <EmptyState text="Upload a readable document to create chunks." />}
                  </div>
                </div>
                <ChunkControls config={config} mode={mode} update={updateConfig} experiment={activeExperiment} />
              </section>
            )}

            {activeStep === "embed" && (
              <section className="embedding-stage">
                <div className="vector-map">
                  <div className="map-grid" />
                  {chunks.map((chunk, index) => {
                    const point = projectVector(embedding.vectors[index] ?? [], index);
                    return <button className="vector-dot" style={{ left: `${point.x}%`, top: `${point.y}%` }} key={chunk.id} title={`Chunk ${chunk.id} · ${pageLabel(chunk.pageStart, chunk.pageEnd)}`} type="button">{chunk.id}</button>;
                  })}
                  <div className="axis x">projected meaning →</div><div className="axis y">topic difference →</div>
                </div>
                <div className="embedding-copy">
                  <span>REAL VECTOR PROJECTION</span><h2>Meaning becomes a location.</h2>
                  <p>The positions are calculated from the current vectors. This is a two-dimensional random projection: useful for orientation, not a claim that meaning naturally lives on a flat map.</p>
                  <div className="model-row"><span>Current source</span><strong>{embedding.source}</strong></div>
                  <div className="model-row"><span>Model</span><strong>{embedding.model}</strong></div>
                  <div className="model-row"><span>Dimensions</span><strong>{embedding.vectors[0]?.length.toLocaleString() ?? "0"}</strong></div>
                  {!apiStatus?.openaiConfigured && <div className="plain-tip"><strong>Local mode is real.</strong><p>TF-IDF vectors are calculated in your browser. Add an API key later to compare them with semantic embeddings.</p></div>}
                </div>
              </section>
            )}

            {(activeStep === "retrieve" || activeStep === "rerank") && (
              <section className="retrieval-stage">
                <QuestionBox query={query} setQuery={(value) => { setQuery(value); setAnswer(null); setPipelineRan(false); }} run={() => void runPipeline()} busy={Boolean(busy)} />
                {config.topK > chunks.length && chunks.length > 0 && <div className="inline-warning">You asked for {config.topK}, but this document only has {chunks.length} chunks. Tiny document, tiny buffet.</div>}
                <div className="retrieval-layout">
                  <div className="results-panel">
                    <div className="panel-title"><div><span>TOP {Math.min(config.topK, chunks.length)}</span><h2>{activeStep === "rerank" ? "Evidence with score breakdown" : "Closest chunks"}</h2></div><small>{config.method} · {embedding.source}</small></div>
                    {ranked.map((item) => <ResultCard item={item} key={item.id} showBreakdown={activeStep === "rerank" || mode === "Advanced"} documentName={document?.name ?? "Document"} />)}
                    {!ranked.length && <EmptyState text="Ask a question after uploading a document." />}
                  </div>
                  <RetrievalControls config={config} update={updateConfig} embedding={embedding} />
                </div>
              </section>
            )}

            {activeStep === "prompt" && (
              <section className="prompt-stage">
                <div className="prompt-toolbar"><div><span>FINAL PAYLOAD</span><h2>This is what the answer model will actually see.</h2></div><button type="button" onClick={() => void navigator.clipboard?.writeText(prompt)}>Copy prompt</button></div>
                <pre>{prompt}</pre>
                <div className="prompt-stats"><Stat label="Context chunks" value={ranked.length.toString()} /><Stat label="Exact prompt tokens" value={countTextTokens(prompt).toLocaleString()} /><Stat label="Embedding source" value={embedding.source} accent={embedding.source === "OpenAI"} /></div>
              </section>
            )}

            {activeStep === "answer" && (
              <section className="answer-stage">
                <div className="answer-card">
                  <div className="answer-head"><span className={`preview-badge ${answer?.source === "OpenAI" ? "live" : ""}`}>{answer?.source ?? "NOT GENERATED"}</span><button type="button" onClick={() => void generateAnswer()} disabled={Boolean(busy) || !ranked.length}>{answer ? "Generate again" : "Generate grounded answer"}</button></div>
                  <h2>{query}</h2>
                  <p className="answer-text">{answer?.text ?? "Generate an answer after reviewing the retrieved evidence. RAG is more trustworthy when the receipts arrive before the confidence."}</p>
                  <div className="citations">{ranked.map((item) => <button type="button" key={item.id} onClick={() => setActiveStep("retrieve")}>Chunk {item.id} · {pageLabel(item.pageStart, item.pageEnd)}</button>)}</div>
                </div>
                <div className="answer-metrics">
                  <Stat label="Answer model" value={answer?.model ?? apiStatus?.responseModel ?? "Not configured"} />
                  <Stat label="Input tokens" value={answer?.inputTokens?.toLocaleString() ?? "—"} />
                  <Stat label="Output tokens" value={answer?.outputTokens?.toLocaleString() ?? "—"} />
                  <Stat label="Latency" value={answer ? `${answer.durationMs.toLocaleString()} ms` : "—"} />
                  <div className="plain-tip"><strong>Trust, then verify.</strong><p>Click every cited chunk. A polished sentence is not evidence wearing a nice shirt.</p></div>
                </div>
              </section>
            )}

            {activeStep === "compare" && (
              <section className="compare-stage">
                <div className="compare-intro"><span>SAME QUESTION. DIFFERENT PIPELINES.</span><h2>Which setup earns its keep?</h2><p>These metrics are recalculated from the current document and question, not hard-coded demo values.</p></div>
                <QuestionBox query={query} setQuery={(value) => setQuery(value)} run={() => setNotice("Both experiments recalculate instantly with local retrieval.")} busy={false} buttonLabel="Refresh comparison" />
                <div className="compare-grid">{comparisons.map((item) => <article className={`compare-card ${activeExperiment === item.name ? "selected" : ""}`} key={item.name}>
                  <header><div><span>EXPERIMENT</span><strong>{item.name}</strong></div><button type="button" onClick={() => setActiveExperiment(item.name)}>Edit</button></header>
                  <div className="compare-method">{item.settings.method}<span>{item.settings.strategy}</span></div>
                  <div className="compare-metrics"><Stat label="Chunk size" value={`${item.settings.chunkSize} tokens`} /><Stat label="Overlap" value={`${item.settings.overlap} tokens`} /><Stat label="Total chunks" value={String(item.chunks)} /><Stat label="Top K returned" value={String(item.results.length)} /><Stat label="Context sent" value={`${item.contextTokens} tokens`} /><Stat label="Best match" value={`${Math.round(item.best * 100)}%`} accent={item.best === Math.max(...comparisons.map((candidate) => candidate.best))} /></div>
                  <div className="compare-evidence">{item.results.slice(0, 3).map((result) => <span key={result.id}>#{result.id} {Math.round(result.score * 100)}%</span>)}</div>
                </article>)}</div>
                <div className="verdict"><div className="verdict-icon">↗</div><div><span>READ THE TRADE-OFF</span><strong>{comparisonVerdict(comparisons)}</strong><p>Better retrieval is not always the configuration with the most context. Extra tokens are not a personality trait.</p></div></div>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className={`stat ${accent ? "stat-accent" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><strong>Nothing to show yet.</strong><span>{text}</span></div>;
}

function QuestionBox({ query, setQuery, run, busy, buttonLabel = "Retrieve evidence" }: { query: string; setQuery: (value: string) => void; run: () => void; busy: boolean; buttonLabel?: string }) {
  return <div className="query-box"><span>YOUR QUESTION</span><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Question" /><button type="button" onClick={run} disabled={busy || !query.trim()}>{busy ? "Working…" : buttonLabel}</button></div>;
}

function ChunkControls({ config, mode, update, experiment }: { config: PipelineConfig; mode: "Basic" | "Advanced"; update: (patch: Partial<PipelineConfig>) => void; experiment: ExperimentName }) {
  return <div className="controls-panel"><div className="controls-head"><span>EXPERIMENT {experiment}</span><strong>Chunk settings</strong></div>
    <RangeSetting label="Chunk size" value={config.chunkSize} min={40} max={800} step={20} help="Exact BPE tokens per chunk" onValue={(value) => update({ chunkSize: value, overlap: Math.min(config.overlap, value - 1) })} />
    <RangeSetting label="Overlap" value={config.overlap} min={0} max={Math.min(200, config.chunkSize - 1)} step={5} help="Repeated tokens between neighbors" onValue={(value) => update({ overlap: value })} />
    <label><span>Strategy</span><select value={config.strategy} onChange={(event) => update({ strategy: event.target.value as PipelineConfig["strategy"] })}><option>Recursive</option><option>Sentence</option>{mode === "Advanced" && <option>Fixed token</option>}</select></label>
    <div className="plain-tip"><strong>Why overlap?</strong><p>It stops a useful sentence from being chopped exactly where it gets interesting.</p></div>
  </div>;
}

function RetrievalControls({ config, update, embedding }: { config: PipelineConfig; update: (patch: Partial<PipelineConfig>) => void; embedding: EmbeddingState }) {
  return <div className="controls-panel compact"><div className="controls-head"><span>SEARCH SETTINGS</span><strong>What gets through?</strong></div>
    <RangeSetting label="Top K" value={config.topK} min={1} max={12} step={1} onValue={(value) => update({ topK: value })} />
    <label><span>Method</span><select value={config.method} onChange={(event) => update({ method: event.target.value as PipelineConfig["method"] })}><option>Vector</option><option>Hybrid</option><option>Keyword</option></select></label>
    <div className="model-row"><span>Vector source</span><strong>{embedding.source}</strong></div>
    <div className="plain-tip"><strong>Hybrid search</strong><p>Semantic similarity meets exact words. Useful when product names and policy numbers refuse to be poetic.</p></div>
  </div>;
}

function RangeSetting({ label, value, min, max, step, help, onValue }: { label: string; value: number; min: number; max: number; step: number; help?: string; onValue: (value: number) => void }) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  return <label className="range-setting">
    <span>{label} <b>{value}</b></span>
    <div className="range-row">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onValue(clamp(value - step))} disabled={value <= min}>−</button>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={`${label} ${value}${help ? ` ${help}` : ""}`} onInput={(event) => onValue(Number(event.currentTarget.value))} />
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onValue(clamp(value + step))} disabled={value >= max}>+</button>
    </div>
    {help && <small>{help}</small>}
  </label>;
}

function ResultCard({ item, showBreakdown, documentName }: { item: RankedChunk; showBreakdown: boolean; documentName: string }) {
  return <article className="result-card"><div className="rank">{item.rank}</div><div className="result-main"><header><strong>Chunk {item.id}</strong><span>{documentName} · {pageLabel(item.pageStart, item.pageEnd)}</span></header><p>{item.text}</p>{showBreakdown && <footer><span>Vector {Math.round(item.vectorScore * 100)}%</span><span>Keyword {Math.round(item.keywordScore * 100)}%</span></footer>}</div><div className="score"><strong>{Math.round(item.score * 100)}%</strong><span>match</span></div></article>;
}

function comparisonVerdict(comparisons: Array<{ name: ExperimentName; best: number; contextTokens: number }>) {
  const [a, b] = comparisons;
  if (!a || !b) return "Run both experiments to compare them.";
  const winner = b.best > a.best ? b : a;
  const leaner = b.contextTokens < a.contextTokens ? b : a;
  if (winner.name === leaner.name) return `Experiment ${winner.name} currently has the stronger top match and the smaller context.`;
  return `Experiment ${winner.name} has the stronger top match; Experiment ${leaner.name} sends fewer tokens.`;
}

function friendlyProjectName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stepIntro(step: StepKey) {
  const copy: Record<StepKey, string> = {
    upload: "Start with a real document. Parsing begins locally, and every later result stays traceable to its source.",
    parse: "Inspect exactly what the parser recovered before trusting anything downstream.",
    chunk: "Split the extracted text with a real tokenizer and see every page-aware boundary.",
    embed: "Turn each chunk into vectors, then inspect a readable projection of the current representation.",
    retrieve: "Ask a question and watch the system choose which chunks deserve a seat at the table.",
    rerank: "Inspect how semantic and keyword evidence contribute to the final ranking.",
    prompt: "Review the exact instructions, retrieved context, and question prepared for the answer model.",
    answer: "Generate a grounded answer, then follow every citation back to the evidence.",
    compare: "Run two configurations side by side. Tiny sliders can have surprisingly expensive opinions.",
  };
  return copy[step];
}
