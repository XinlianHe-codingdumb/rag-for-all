"use client";

import { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
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
  rerankChunks,
  retrievalCandidateCount,
} from "./lib/rag-engine";
import type {
  AnswerState,
  EmbeddingState,
  ParsedDocument,
  PipelineConfig,
  RagChunk,
  RankedChunk,
  RerankedChunk,
  RerankState,
} from "./lib/rag-types";

type StepKey = "overview" | "upload" | "parse" | "chunk" | "embed" | "retrieve" | "rerank" | "prompt" | "answer" | "compare";
type ExperimentName = "A" | "B";
type ApiStatus = {
  openaiConfigured: boolean;
  embeddingModel: string;
  responseModel: string;
  persistenceConfigured: boolean;
};

const STEPS: Array<{ key: Exclude<StepKey, "overview">; number: string; title: string; note: string; icon: string }> = [
  { key: "upload", number: "01", title: "Document", note: "Bring the knowledge", icon: "□" },
  { key: "parse", number: "02", title: "Parse", note: "Turn files into text", icon: "¶" },
  { key: "chunk", number: "03", title: "Chunk", note: "Cut, but with manners", icon: "//" },
  { key: "embed", number: "04", title: "Embedding", note: "Meaning becomes math", icon: "⠿" },
  { key: "retrieve", number: "05", title: "Retrieve", note: "Find the useful bits", icon: "?" },
  { key: "rerank", number: "06", title: "Rerank", note: "Put the best first", icon: "↕" },
  { key: "prompt", number: "07", title: "Prompt", note: "Pack the context", icon: "{}" },
  { key: "answer", number: "08", title: "Answer", note: "Let the model speak", icon: "✦" },
  { key: "compare", number: "A/B", title: "Compare", note: "Receipts, not vibes", icon: "⇄" },
];

type ConceptVisualKind = "open-book" | "agent-action" | "blind-spot" | "two-moments" | "choice" | "trust";

const RAG_CONCEPTS: Array<{ kicker: string; title: string; body: string; visual: ConceptVisualKind }> = [
  {
    kicker: "WHAT RAG IS",
    title: "Give AI an open book.",
    body: "RAG stands for Retrieval-Augmented Generation. Before an AI answers, it looks for useful evidence in a knowledge base and places that evidence beside the question. The model still writes the response; RAG gives it the right notes at the right moment.",
    visual: "open-book",
  },
  {
    kicker: "WHY IT MATTERS NOW",
    title: "An answer can be wrong. An agent can act on it.",
    body: "AI agents can search, decide, write, and trigger actions. When they rely only on model memory, a confident mistake can travel much further. RAG gives an agent current, relevant evidence before it responds or acts.",
    visual: "agent-action",
  },
  {
    kicker: "THE KNOWLEDGE GAP",
    title: "The model does not know your world.",
    body: "A model knows patterns from training and whatever is inside the current conversation. It may not know your handbook, customer history, latest policy, or today’s product data. RAG connects the model to knowledge you control without retraining it every time the facts change.",
    visual: "blind-spot",
  },
  {
    kicker: "THE SIMPLE MENTAL MODEL",
    title: "Find first. Answer second.",
    body: "RAG has two jobs: retrieve a small set of useful passages, then give those passages to the language model as context. Think of it like an open-book exam—the model does the writing, but it gets to open the right pages first.",
    visual: "two-moments",
  },
  {
    kicker: "WHEN RAG FITS",
    title: "Use RAG when the knowledge is private, large, or changing.",
    body: "RAG is a good fit when answers live across many documents, update often, or should stay under your control. If the material is short, sending the whole thing may be simpler. Fine-tuning changes how a model behaves; RAG changes what evidence it can see right now.",
    visual: "choice",
  },
  {
    kicker: "WHAT TRUST LOOKS LIKE",
    title: "Evidence helps. It is not magic.",
    body: "RAG can retrieve the wrong passage, miss the right one, or let the model misunderstand good evidence. A trustworthy system shows sources, admits when evidence is missing, and tests whether the right passage was found and used correctly. Citations are receipts—not decorations.",
    visual: "trust",
  },
];

const STEP_INTROS: Record<Exclude<StepKey, "overview">, string> = {
  upload: "A RAG system begins with a trusted set of documents: the knowledge the AI is allowed to use. Uploading creates that source of truth and keeps the original file, its type, and its identity connected so every later chunk, result, and citation can be traced back. The next step will turn the file into readable text; if the source is outdated, incomplete, or sensitive, every step after this inherits the problem.",
  parse: "Parsing converts a PDF, DOCX, or text file into machine-readable text and metadata. It tries to preserve pages, headings, paragraphs, lists, and tables because the AI cannot retrieve information the parser failed to recover. The uploaded file becomes clean input for chunking, while scanned pages may require OCR and complex layouts should be checked before the knowledge is indexed.",
  chunk: "Chunking divides the parsed document into passages small enough to search and send to an LLM. Smaller chunks can match a question precisely but may lose surrounding meaning; larger chunks keep more context but add noise and consume more prompt space. Each chunk keeps its source page, then moves to Embedding, where its meaning is represented numerically for search.",
  embed: "Embedding converts every chunk into a vector—a long list of numbers that represents patterns in its meaning. The question will be converted with the same model, allowing the system to find related ideas even when they use different words. Each dot below is one chunk projected from many dimensions onto a 2D map; this representation powers semantic retrieval, but the flat picture is only a guide, not the real vector space.",
  retrieve: "Retrieval compares the user’s question with the indexed chunks and returns the Top K candidates most likely to contain useful evidence. Semantic search follows meaning, keyword search catches exact names or codes, and hybrid search combines both. These candidates came from Embedding and will be passed to Reranking; too few may miss the answer, while too many can distract the LLM with irrelevant context.",
  rerank: "Reranking gives the first retrieval shortlist a slower, more careful second look. It scores each candidate against the complete question and moves the strongest evidence upward before anything reaches the LLM. This can rescue a useful passage that simple similarity placed too low, but it adds computation and latency; the winning chunks become the evidence assembled in the final prompt.",
  prompt: "Prompt assembly creates the exact package sent to the answer model: system instructions, the user’s question, selected evidence, source labels, and citation rules. This is the bridge between retrieval and generation, because the LLM can only use evidence that fits inside this context. Clear boundaries, sensible ordering, and a controlled token budget help prevent missing evidence, duplicated passages, and document text being mistaken for instructions.",
  answer: "The LLM now reads the prepared prompt and turns the retrieved evidence into a useful response. It is generating language, not searching the documents again, so a grounded answer should connect important claims to source chunks and say when the available evidence is insufficient. Fluent writing is not proof of correctness; citations let the user travel backward through the pipeline and verify what the model used.",
  compare: "A/B testing runs the same document and the same question through two pipeline configurations so only the chosen settings change. It shows whether different chunk sizes, overlap, search methods, or Top K values caused different evidence to reach the LLM. Judge retrieval and answer quality first, then consider context size, latency, and cost; one question is a demonstration, while a reliable decision requires a representative test set.",
};

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
  const [activeStep, setActiveStep] = useState<StepKey>("overview");
  const [mode, setMode] = useState<"Basic" | "Advanced">("Basic");
  const [activeExperiment, setActiveExperiment] = useState<ExperimentName>("A");
  const [experiments, setExperiments] = useState(DEFAULTS);
  const [document, setDocument] = useState<ParsedDocument | null>(SAMPLE_DOCUMENT);
  const [query, setQuery] = useState("How much can I spend on learning?");
  const [remoteEmbedding, setRemoteEmbedding] = useState<EmbeddingState | null>(null);
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [remoteRerank, setRemoteRerank] = useState<RerankState | null>(null);
  const [rerankKey, setRerankKey] = useState("");
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pipelineRan, setPipelineRan] = useState(false);
  const [embeddingView, setEmbeddingView] = useState({ zoom: 1, x: 0, y: 0 });
  const [selectedVectorId, setSelectedVectorId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapPanRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);

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
  const candidateCount = retrievalCandidateCount(config.topK, chunks.length);
  const retrievedCandidates = useMemo(
    () => rankChunks(chunks, query, config, embedding, candidateCount),
    [chunks, query, config, embedding, candidateCount],
  );
  const currentRerankKey = `${currentEmbeddingKey}:${config.method}:${config.topK}`;
  const activeRerank = rerankKey === currentRerankKey ? remoteRerank : null;
  const finalEvidence = useMemo(
    () => rerankChunks(retrievedCandidates, query, config.topK, activeRerank?.signals),
    [retrievedCandidates, query, config.topK, activeRerank],
  );
  const prompt = useMemo(() => buildPrompt(query, finalEvidence), [query, finalEvidence]);
  const projection = useMemo(() => {
    const vectors = [embedding.queryVector, ...embedding.vectors];
    const raw = vectors.map((vector, index) => projectVector(vector, index));
    if (raw.length <= 1) return raw.map(() => ({ x: 50, y: 50 }));
    const minX = Math.min(...raw.map((point) => point.x));
    const maxX = Math.max(...raw.map((point) => point.x));
    const minY = Math.min(...raw.map((point) => point.y));
    const maxY = Math.max(...raw.map((point) => point.y));
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    return raw.map((point, index) => ({
      x: rangeX > 0.4 ? 14 + ((point.x - minX) / rangeX) * 72 : 50 + Math.cos(index * 2.4) * 30,
      y: rangeY > 0.4 ? 14 + ((point.y - minY) / rangeY) * 72 : 50 + Math.sin(index * 2.4) * 30,
    }));
  }, [embedding.queryVector, embedding.vectors]);
  const queryPoint = projection[0] ?? { x: 50, y: 50 };
  const embeddingPoints = projection.slice(1);
  const retrievedChunkIds = useMemo(() => new Set(retrievedCandidates.map((item) => item.id)), [retrievedCandidates]);
  const finalChunkIds = useMemo(() => new Set(finalEvidence.map((item) => item.id)), [finalEvidence]);
  const selectedVector = chunks.find((chunk) => chunk.id === selectedVectorId) ?? null;

  const comparisons = useMemo(() => (["A", "B"] as const).map((name) => {
    const settings = experiments[name];
    const candidateChunks = document ? createChunks(document, settings) : [];
    const candidateEmbedding = createLocalEmbeddings(candidateChunks, query);
    const poolSize = retrievalCandidateCount(settings.topK, candidateChunks.length);
    const retrievals = rankChunks(candidateChunks, query, settings, candidateEmbedding, poolSize);
    const results = rerankChunks(retrievals, query, settings.topK);
    return {
      name,
      settings,
      chunks: candidateChunks.length,
      contextTokens: results.reduce((sum, item) => sum + item.tokenCount, 0),
      best: results[0]?.rerankScore ?? 0,
      retrievals,
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
    setRemoteRerank(null);
    setRerankKey("");
  };

  const chooseFile = () => inputRef.current?.click();

  const changeEmbeddingZoom = (delta: number) => {
    setEmbeddingView((current) => ({ ...current, zoom: Math.max(0.75, Math.min(2.5, current.zoom + delta)) }));
  };

  const resetEmbeddingView = () => setEmbeddingView({ zoom: 1, x: 0, y: 0 });

  const beginEmbeddingPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    mapPanRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: embeddingView.x, y: embeddingView.y };
  };

  const moveEmbeddingPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = mapPanRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setEmbeddingView((current) => ({ ...current, x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY }));
  };

  const endEmbeddingPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mapPanRef.current?.pointerId === event.pointerId) mapPanRef.current = null;
  };

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
      setRemoteRerank(null);
      setRerankKey("");
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
    const nextCandidates = rankChunks(chunks, query, config, nextEmbedding, retrievalCandidateCount(config.topK, chunks.length));
    setBusy("Reranking the candidate evidence…");
    let rerankState: RerankState | null = null;
    try {
      const response = await fetch("/api/rerank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, candidates: nextCandidates.map((item) => ({ id: item.id, text: item.text })) }),
      });
      if (response.ok) {
        const body = await response.json() as RerankState;
        rerankState = { ...body, source: "OpenAI" };
        setRemoteRerank(rerankState);
        setRerankKey(currentRerankKey);
      } else {
        setRemoteRerank(null);
        setRerankKey("");
      }
    } catch {
      setRemoteRerank(null);
      setRerankKey("");
    }
    const nextResults = rerankChunks(nextCandidates, query, config.topK, rerankState?.signals);
    setPipelineRan(true);
    setBusy(null);
    setNotice(`Experiment ${activeExperiment} retrieved ${nextCandidates.length} candidates, then reranked them to ${nextResults.length} final chunks using ${rerankState ? "OpenAI" : "a local relevance fallback"}.`);
    void saveRun(nextResults, nextEmbedding);
  };

  const saveRun = async (results: RerankedChunk[], usedEmbedding: EmbeddingState) => {
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
            chunks: results.map((item) => ({ id: item.id, retrievalScore: item.score, rerankScore: item.rerankScore, pageStart: item.pageStart, pageEnd: item.pageEnd })),
          },
        }),
      });
    } catch {
      // A failed history write must not break the educational pipeline.
    }
  };

  const generateAnswer = async () => {
    if (!finalEvidence.length) return;
    setBusy("Generating a grounded answer…");
    const startedAt = performance.now();
    try {
      const response = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: query,
          context: finalEvidence.map((item) => `[Chunk ${item.id} | ${pageLabel(item.pageStart, item.pageEnd)}]\n${item.text}`),
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
        setAnswer({ text: extractiveAnswer(query, finalEvidence), source: "Extractive fallback", model: "Local sentence selection", durationMs: Math.round(performance.now() - startedAt) });
        setNotice("OpenAI is not configured, so the answer uses retrieved sentences directly. No paid API call was made.");
      }
    } catch {
      setAnswer({ text: extractiveAnswer(query, finalEvidence), source: "Extractive fallback", model: "Local sentence selection", durationMs: Math.round(performance.now() - startedAt) });
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

  const activeMeta = activeStep === "overview" ? null : STEPS.find((step) => step.key === activeStep)!;
  const completed = (step: StepKey) => {
    if (step === "overview") return true;
    if (step === "upload" || step === "parse" || step === "chunk") return Boolean(document);
    if (["embed", "retrieve", "rerank", "prompt"].includes(step)) return pipelineRan;
    if (step === "answer") return Boolean(answer);
    return false;
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <p className="topbar-title"><strong>RAG FOR ALL</strong><span> — See How RAG Works, Step by Step.</span></p>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="project-card">
            <span>PROJECT</span>
            <strong>{document ? friendlyProjectName(document.name) : "No document"}</strong>
            <small>{document?.name ?? "Upload to begin"}</small>
          </div>
          <nav aria-label="RAG pipeline">
            <button type="button" className={`nav-step overview-nav ${activeStep === "overview" ? "active" : ""}`} onClick={() => setActiveStep("overview")}>
              <span className="step-number">00</span>
              <span className="step-copy"><strong>Overview</strong><small>See the whole journey</small></span>
              <span className="step-state">⌂</span>
            </button>
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
            <button type="button" onClick={() => setActiveStep("overview")}><span>?</span> Plain-English guide</button>
          </div>
        </aside>

        <section className="content">
          {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}
          {busy && <div className="busy-bar" role="status"><i />{busy}</div>}

          {activeStep === "overview" ? (
            <OverviewPage
              onStep={setActiveStep}
            />
          ) : <>
            <div className="content-header">
              <div>
                <p className="eyebrow">STEP {activeMeta!.number} · {activeMeta!.note.toUpperCase()}</p>
                <h1>{activeMeta!.title}</h1>
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
                <div className="vector-map" onPointerDown={beginEmbeddingPan} onPointerMove={moveEmbeddingPan} onPointerUp={endEmbeddingPan} onPointerCancel={endEmbeddingPan}>
                  <div className="map-controls" aria-label="Embedding map controls">
                    <button type="button" onClick={() => changeEmbeddingZoom(-0.25)} aria-label="Zoom out">−</button>
                    <span>{Math.round(embeddingView.zoom * 100)}%</span>
                    <button type="button" onClick={() => changeEmbeddingZoom(0.25)} aria-label="Zoom in">+</button>
                    <button type="button" onClick={resetEmbeddingView}>Reset</button>
                  </div>
                  <div className="vector-plane" style={{ transform: `translate(${embeddingView.x}px, ${embeddingView.y}px) scale(${embeddingView.zoom})` }}>
                    <div className="map-grid" /><div className="map-axis-line horizontal" /><div className="map-axis-line vertical" />
                    {chunks.map((chunk, index) => {
                      const point = embeddingPoints[index] ?? { x: 50, y: 50 };
                      const isRetrieved = retrievedChunkIds.has(chunk.id);
                      const isFinal = finalChunkIds.has(chunk.id);
                      return <button className={`vector-dot ${isRetrieved ? "retrieved" : ""} ${isFinal ? "final" : ""} ${selectedVectorId === chunk.id ? "selected" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} key={chunk.id} title={`Chunk ${chunk.id} · ${pageLabel(chunk.pageStart, chunk.pageEnd)}`} type="button" onClick={() => setSelectedVectorId(chunk.id)}>{chunk.id}</button>;
                    })}
                    <div className="axis x">meaning projection →</div><div className="axis y">topic difference →</div>
                  </div>
                  <div className="map-legend"><span><i className="final" /> Final evidence</span><span><i className="retrieved" /> Retrieval candidate</span><span><i /> Other chunk</span></div>
                  <p className="map-help">Drag to move the plane. Use − and + to zoom.</p>
                </div>
                <div className="embedding-copy">
                  <span>INTERACTIVE VECTOR PROJECTION</span><h2>Every dot is one chunk.</h2>
                  <p>Chunks with related vector patterns appear closer together. Highlighted dots are the passages the current question retrieves. Zoom, drag, and select a dot to inspect it—but remember that this is a readable 2D projection of a much larger vector space.</p>
                  {selectedVector && <div className="selected-vector"><span>SELECTED · CHUNK {selectedVector.id}</span><strong>{pageLabel(selectedVector.pageStart, selectedVector.pageEnd)}</strong><p>{selectedVector.text}</p></div>}
                  <div className="model-row"><span>Current source</span><strong>{embedding.source}</strong></div>
                  <div className="model-row"><span>Model</span><strong>{embedding.model}</strong></div>
                  <div className="model-row"><span>Dimensions</span><strong>{embedding.vectors[0]?.length.toLocaleString() ?? "0"}</strong></div>
                  {!apiStatus?.openaiConfigured && <div className="plain-tip"><strong>Local mode is real.</strong><p>TF-IDF vectors are calculated in your browser. Add an API key later to compare them with semantic embeddings.</p></div>}
                </div>
              </section>
            )}

            {activeStep === "retrieve" && (
              <section className="retrieval-stage">
                <QuestionBox query={query} setQuery={(value) => { setQuery(value); setAnswer(null); setPipelineRan(false); }} run={() => void runPipeline()} busy={Boolean(busy)} buttonLabel="Find candidates" />
                {config.topK > chunks.length && chunks.length > 0 && <div className="inline-warning">You asked for {config.topK}, but this document only has {chunks.length} chunks. Tiny document, tiny buffet.</div>}
                <RetrievalMap chunks={chunks} points={embeddingPoints} queryPoint={queryPoint} candidates={retrievedCandidates} topChunks={finalEvidence} topK={config.topK} query={query} />
                <div className="retrieval-layout">
                  <div className="results-panel">
                    <div className="panel-title"><div><span>CANDIDATE POOL · {retrievedCandidates.length}</span><h2>Fast search casts a wider net.</h2></div><small>{config.method} · {embedding.source}</small></div>
                    {retrievedCandidates.map((item) => <ResultCard item={item} key={item.id} showBreakdown={mode === "Advanced"} documentName={document?.name ?? "Document"} />)}
                    {!retrievedCandidates.length && <EmptyState text="Ask a question after uploading a document." />}
                  </div>
                  <RetrievalControls config={config} update={updateConfig} embedding={embedding} candidateCount={candidateCount} />
                </div>
              </section>
            )}

            {activeStep === "rerank" && (
              <section className="rerank-stage">
                <QuestionBox query={query} setQuery={(value) => { setQuery(value); setAnswer(null); setPipelineRan(false); }} run={() => void runPipeline()} busy={Boolean(busy)} buttonLabel="Run both passes" />
                <div className="rerank-layout">
                  <RerankFlow candidates={retrievedCandidates} finalEvidence={finalEvidence} source={activeRerank?.source ?? "Local relevance"} model={activeRerank?.model} />
                  <RetrievalControls config={config} update={updateConfig} embedding={embedding} candidateCount={candidateCount} />
                </div>
              </section>
            )}

            {activeStep === "prompt" && (
              <section className="prompt-stage">
                <div className="prompt-toolbar"><div><span>FINAL PAYLOAD</span><h2>This is what the answer model will actually see.</h2></div><button type="button" onClick={() => void navigator.clipboard?.writeText(prompt)}>Copy prompt</button></div>
                <pre>{prompt}</pre>
                <div className="prompt-stats"><Stat label="Context chunks" value={finalEvidence.length.toString()} /><Stat label="Exact prompt tokens" value={countTextTokens(prompt).toLocaleString()} /><Stat label="Reranker" value={activeRerank?.source ?? "Local relevance"} accent={Boolean(activeRerank)} /></div>
              </section>
            )}

            {activeStep === "answer" && (
              <section className="answer-stage">
                <div className="answer-card">
                  <div className="answer-head"><span className={`preview-badge ${answer?.source === "OpenAI" ? "live" : ""}`}>{answer?.source ?? "NOT GENERATED"}</span><button type="button" onClick={() => void generateAnswer()} disabled={Boolean(busy) || !finalEvidence.length}>{answer ? "Generate again" : "Generate grounded answer"}</button></div>
                  <h2>{query}</h2>
                  <p className="answer-text">{answer?.text ?? "Generate an answer after reviewing the retrieved evidence. RAG is more trustworthy when the receipts arrive before the confidence."}</p>
                  <div className="citations">{finalEvidence.map((item) => <button type="button" key={item.id} onClick={() => setActiveStep("rerank")}>Chunk {item.id} · {pageLabel(item.pageStart, item.pageEnd)}</button>)}</div>
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
                <div className="compare-intro"><span>WHAT THIS A/B TEST IS TESTING</span><h2>Same knowledge. Same question. Different RAG settings.</h2><p>Only chunking and retrieval settings change between A and B. Both sides use the same local second-pass reranker, so you can see which settings changed the final evidence. This view does not generate two LLM answers yet.</p></div>
                <div className="compare-rules">
                  <article><span>KEPT THE SAME</span><strong>Document + question</strong><p>Both experiments solve the exact same task.</p></article>
                  <article><span>CHANGED</span><strong>Chunking + retrieval</strong><p>Size, overlap, strategy, method, and Top K can differ.</p></article>
                  <article><span>WHAT TO JUDGE</span><strong>Evidence quality first</strong><p>Then compare context size, latency, and cost.</p></article>
                </div>
                <div className="comparison-deltas" aria-label="Settings changed from Experiment A to Experiment B">
                  <SettingDelta label="Chunk size" before={`${experiments.A.chunkSize}`} after={`${experiments.B.chunkSize}`} />
                  <SettingDelta label="Overlap" before={`${experiments.A.overlap}`} after={`${experiments.B.overlap}`} />
                  <SettingDelta label="Splitting" before={experiments.A.strategy} after={experiments.B.strategy} />
                  <SettingDelta label="Search" before={experiments.A.method} after={experiments.B.method} />
                  <SettingDelta label="Final Top K" before={`${experiments.A.topK}`} after={`${experiments.B.topK}`} />
                </div>
                <QuestionBox query={query} setQuery={(value) => setQuery(value)} run={() => setNotice("Both experiments recalculated with local retrieval and the same local second-pass reranker.")} busy={false} buttonLabel="Refresh comparison" />
                <div className="compare-grid">{comparisons.map((item) => <article className={`compare-card ${activeExperiment === item.name ? "selected" : ""}`} key={item.name}>
                  <header><div><strong>{item.name}</strong><span>{item.name === "A" ? "BASELINE" : "CHALLENGER"}</span></div><button type="button" onClick={() => setActiveExperiment(item.name)}>Edit {item.name}</button></header>
                  <div className="compare-method">Experiment {item.name}<span>{item.settings.method} search</span></div>
                  <p className="compare-recipe">Cuts the document into <b>{item.settings.chunkSize}-token chunks</b> with <b>{item.settings.overlap} tokens of overlap</b>, uses <b>{item.settings.strategy.toLowerCase()} splitting</b>, then keeps <b>{item.settings.topK} passages after reranking</b>.</p>
                  <div className="compare-metrics"><Stat label="Total chunks" value={String(item.chunks)} /><Stat label="Candidate pool" value={String(item.retrievals.length)} /><Stat label="Final evidence" value={String(item.results.length)} /><Stat label="Context sent" value={`${item.contextTokens} tokens`} /><Stat label="Best second-pass score" value={`${Math.round(item.best * 100)}%`} /></div>
                  <div className="compare-evidence"><strong>FIRST PASS · RETRIEVE</strong><div>{item.retrievals.slice(0, 6).map((result) => <span key={result.id}>#{result.rank} Chunk {result.id}</span>)}</div></div>
                  <div className="compare-evidence final"><strong>SECOND PASS · WHAT REACHED THE LLM</strong><div>{item.results.slice(0, 5).map((result) => <span key={result.id}>#{result.rerankRank} Chunk {result.id} · {Math.round(result.rerankScore * 100)}%</span>)}</div></div>
                </article>)}</div>
                <div className="verdict"><div className="verdict-icon">↗</div><div><span>WHAT THIS RUN SHOWS</span><strong>{comparisonVerdict(comparisons)}</strong><p>Do not choose a permanent winner from one question. Repeat this test with easy, exact-term, ambiguous, and multi-part questions.</p></div></div>
              </section>
            )}
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}

type OverviewPane = "intro" | "concepts" | "pipeline";

function OverviewPage({ onStep }: { onStep: (step: StepKey) => void }) {
  const [pane, setPane] = useState<OverviewPane>("intro");
  const [conceptIndex, setConceptIndex] = useState(0);
  const concept = RAG_CONCEPTS[conceptIndex];
  const mainSteps = STEPS.filter((step) => step.key !== "compare");
  const compareStep = STEPS.find((step) => step.key === "compare")!;
  const showPrevious = () => setConceptIndex((current) => Math.max(0, current - 1));
  const showNext = () => {
    if (conceptIndex === RAG_CONCEPTS.length - 1) {
      setPane("pipeline");
      return;
    }
    setConceptIndex((current) => Math.min(RAG_CONCEPTS.length - 1, current + 1));
  };

  const onOverviewKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (pane !== "concepts") return;
    if (event.key === "ArrowLeft" && conceptIndex > 0) {
      event.preventDefault();
      showPrevious();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showNext();
    }
  };

  return <section className="overview-page">
    <div className={`overview-viewport overview-show-${pane}`} onKeyDown={onOverviewKeyDown}>
      <div className="overview-world">
        <section className="overview-pane intro-pane" aria-label="Introduction to RAG FOR ALL" inert={pane !== "intro"}>
          <div className="intro-main">
            <div className="intro-copy">
              <p className="intro-eyebrow">FROM A SMART AGENT TO YOUR AGENT</p>
              <h1>RAG is how an AI agent becomes <span>yours.</span></h1>
              <p className="intro-body"><strong>RAG FOR ALL</strong> lets you see, change, and compare every RAG step—from document upload to the grounded answer. AI agents can act, but without your knowledge they are still generic. RAG connects an agent to your documents, your plans, and your latest facts, so it can finally work like <em>your</em> assistant.</p>
            </div>
            <RagDifferenceVisual />
          </div>
          <aside className="intro-choices" aria-label="Choose your RAG journey">
            <article className="intro-choice beginner-choice">
              <div className="choice-speech"><small>NEW TO RAG?</small><strong>“I should learn what RAG is first. I’ll be right back.”</strong><span>Take the two-minute concept tour.</span></div>
              <img src="/doodle-walking.png" alt="A curious doodle person walking toward the RAG introduction" />
              <button type="button" onClick={() => setPane("concepts")} aria-label="Open the RAG concept tour">→</button>
            </article>
            <article className="intro-choice experienced-choice">
              <div className="choice-speech"><small>ALREADY KNOW RAG?</small><strong>“I know the theory. Just show me the good stuff.”</strong><span>Jump into the working pipeline.</span></div>
              <img src="/doodle-lounging.png" alt="A relaxed doodle person waiting to see the RAG pipeline" />
              <button type="button" onClick={() => setPane("pipeline")} aria-label="Open the interactive RAG pipeline">↓</button>
            </article>
          </aside>
        </section>

        <section className="overview-pane concept-pane" aria-label="RAG concept tour" inert={pane !== "concepts"}>
          <div className="overview-pane-toolbar">
            <button type="button" onClick={() => setPane("intro")}>← Back to intro</button>
            <button type="button" onClick={() => setPane("pipeline")}>Skip to interactive pipeline ↓</button>
          </div>
          <section className={`concept-deck concept-${concept.visual}`} aria-label="RAG concept cards">
            <div className="concept-stage" key={conceptIndex}>
              <div className="concept-copy">
                <div className="concept-progress"><span>RAG, FROM IDEA TO TRUST</span><b>{String(conceptIndex + 1).padStart(2, "0")} / {String(RAG_CONCEPTS.length).padStart(2, "0")}</b></div>
                <h1 className="concept-kicker">{concept.kicker}</h1>
                <p className="concept-thesis">{concept.title}</p>
                <p className="concept-body">{concept.body}</p>
              </div>
              <ConceptVisual kind={concept.visual} />
            </div>
            <div className="concept-controls">
              <button type="button" className="concept-arrow" onClick={showPrevious} disabled={conceptIndex === 0} aria-label="Previous concept card">←</button>
              <div className="concept-tabs" role="tablist" aria-label="Choose a RAG concept card">
                {RAG_CONCEPTS.map((card, index) => <button type="button" role="tab" aria-selected={index === conceptIndex} aria-label={`Card ${index + 1}: ${card.title}`} className={index === conceptIndex ? "active" : ""} onClick={() => setConceptIndex(index)} key={card.title}><span>{String(index + 1).padStart(2, "0")}</span><i /></button>)}
              </div>
              <button type="button" className="concept-next" onClick={showNext}>{conceptIndex === RAG_CONCEPTS.length - 1 ? "Now show me the pipeline" : "Next card"}<span>{conceptIndex === RAG_CONCEPTS.length - 1 ? "↓" : "→"}</span></button>
            </div>
          </section>
        </section>

        <section className="overview-pane pipeline-pane" aria-label="Interactive RAG pipeline" inert={pane !== "pipeline"}>
          <div className="overview-pane-toolbar">
            <button type="button" onClick={() => setPane("intro")}>← Back to intro</button>
            <button type="button" onClick={() => setPane("concepts")}>Need the big idea? View the RAG tour →</button>
          </div>
          <div className="flow-lab">
            <div className="flow-lab-head">
              <div><span>THE COMPLETE RAG JOURNEY</span><h2>Turn one document into an answer you can trace.</h2><p>Click any step to open the real working pipeline. Change the settings, rerun the same question, and watch what changes downstream.</p></div>
              <button type="button" className="flow-start" onClick={() => onStep("upload")}>Start with Document →</button>
            </div>
            <ol className="flow-map" aria-label="Interactive RAG pipeline map">
              {mainSteps.map((step) => <li key={step.key}>
                <button type="button" className="flow-node" onClick={() => onStep(step.key)} aria-label={`Open ${step.title} step`}>
                  <span className="flow-node-top"><small>{step.number}</small><i>{step.icon}</i></span>
                  <strong>{step.title}</strong>
                  <span>{step.note}</span>
                </button>
              </li>)}
            </ol>
            <div className="compare-branch">
              <div className="branch-line"><i /></div>
              <button type="button" onClick={() => onStep(compareStep.key)}>
                <span className="compare-symbol">{compareStep.icon}</span>
                <span><small>{compareStep.number} · THE LEARNING LOOP</small><strong>{compareStep.title} two pipelines</strong><p>Change the settings, rerun the same question, and see which trade-off actually helps.</p></span>
                <b>Open comparison →</b>
              </button>
            </div>
            <div className="flow-footnotes">
              <span><b>01</b> Source stays traceable</span>
              <span><b>02</b> Every transformation is visible</span>
              <span><b>03</b> Every answer brings receipts</span>
            </div>
          </div>
        </section>

        <div className="overview-pane overview-empty" aria-hidden="true" />
      </div>
    </div>
  </section>;
}

function RagDifferenceVisual() {
  const question = "Can you check tomorrow’s date—where, when, and what should I bring?";
  return <section className="rag-difference" aria-label="The same assistant conversation without and with RAG">
    <header><span>WHY RAG CHANGES THE CONVERSATION</span><strong>Same question. Very different assistant.</strong></header>
    <div className="rag-dialogues">
      <article className="rag-dialogue without-rag">
        <div className="dialogue-label"><span>WITHOUT RAG</span><small>Generic information only</small></div>
        <p className="chat-bubble user-chat">{question}</p>
        <div className="agent-reply"><img src="/doodle-agent-confused.png" alt="A confused empty-handed AI agent scratching its head" /><p className="chat-bubble agent-chat">Sorry, I couldn’t find any information about your date.</p></div>
      </article>
      <article className="rag-dialogue with-rag">
        <div className="dialogue-label"><span>WITH RAG</span><small>Your latest information</small></div>
        <p className="chat-bubble user-chat">{question}</p>
        <div className="agent-reply"><img src="/doodle-agent.png" alt="A cute AI agent robot using retrieved information" /><p className="chat-bubble agent-chat">I found an update: your date went official with someone else yesterday. Still want to go?</p></div>
      </article>
    </div>
  </section>;
}

function ConceptVisual({ kind }: { kind: ConceptVisualKind }) {
  if (kind === "open-book") return <div className="concept-visual open-book-visual" aria-label="Evidence from a knowledge base being handed to an AI">
    <div className="visual-doc-stack"><span>KNOWLEDGE</span><i /><i /><i /></div>
    <div className="visual-transfer"><span>FIND EVIDENCE</span><b>→</b></div>
    <div className="open-book-model"><span>QUESTION + NOTES</span><strong>AI</strong><small>GROUNDED ANSWER</small></div>
  </div>;

  if (kind === "agent-action") return <div className="concept-visual agent-action-visual" aria-label="Evidence reaching an AI agent before it searches, decides, and acts">
    <div className="agent-evidence"><span>FRESH EVIDENCE</span><i /><i /><i /><strong>CHECKED</strong></div>
    <div className="agent-evidence-arrow">→</div>
    <div className="agent-core"><small>AI AGENT</small><strong>ACTS WITH CONTEXT</strong><div><span>SEARCH</span><span>DECIDE</span><span>ACT</span></div></div>
  </div>;

  if (kind === "blind-spot") return <div className="concept-visual" aria-label="A language model separated from private documents">
    <div className="visual-halo"><span>LLM</span><i /><i /><i /></div>
    <div className="visual-gap"><span>CAN’T SEE</span><b>···</b></div>
    <div className="visual-doc-stack"><span>YOUR DOCS</span><i /><i /><i /></div>
  </div>;

  if (kind === "two-moments") return <div className="concept-visual two-moments-visual" aria-label="Documents are indexed before a question retrieves evidence">
    <div className="moment-card"><span>BEFORE QUESTIONS</span><strong>Build the library</strong><div className="mini-library"><i /><i /><i /></div></div>
    <div className="moment-bridge">→</div>
    <div className="moment-card"><span>WHEN ASKED</span><strong>Choose useful pages</strong><div className="mini-results"><i /><i /><i /></div></div>
  </div>;

  if (kind === "choice") return <div className="concept-visual choice-visual" aria-label="Choosing between RAG, long context, and fine-tuning">
    <article><span>CHANGING KNOWLEDGE</span><strong>RAG</strong><small>Find evidence per question</small></article>
    <article><span>SMALL KNOWLEDGE</span><strong>Long context</strong><small>Send it all at once</small></article>
    <article><span>CHANGING BEHAVIOR</span><strong>Fine-tuning</strong><small>Teach a response pattern</small></article>
  </div>;

  if (kind === "trust") return <div className="concept-visual trust-visual" aria-label="A grounded answer with sources that can be checked">
    <div className="trust-question">?</div><div className="trust-line" />
    <div className="trust-evidence"><span>EVIDENCE</span><i /><i /><i /></div><div className="trust-line" />
    <div className="trust-answer"><span>ANSWER</span><strong>“Here is what the sources support.”</strong><small>[1] [2]</small></div>
  </div>;

  return <div className="concept-visual measure-visual" aria-label="Retrieval quality and answer quality measured together">
    <article><span>01</span><strong>Did we find the evidence?</strong><div><i style={{ width: "84%" }} /></div><small>Retrieval quality</small></article>
    <div className="measure-plus">+</div>
    <article><span>02</span><strong>Did the AI use it correctly?</strong><div><i style={{ width: "76%" }} /></div><small>Answer quality</small></article>
  </div>;
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

function RetrievalMap({ chunks, points, queryPoint, candidates, topChunks, topK, query }: { chunks: RagChunk[]; points: Array<{ x: number; y: number }>; queryPoint: { x: number; y: number }; candidates: RankedChunk[]; topChunks: RerankedChunk[]; topK: number; query: string }) {
  const [zoom, setZoom] = useState(1);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const displayedTopChunks = topChunks.length ? topChunks.slice(0, topK) : candidates.slice(0, topK);
  const topKOrder = new Map(displayedTopChunks.map((candidate, index) => [candidate.id, index + 1]));
  const focusPoints = [queryPoint, ...displayedTopChunks.map((candidate) => points[candidate.id - 1] ?? { x: 50, y: 50 })];
  const minX = Math.min(...focusPoints.map((point) => point.x));
  const maxX = Math.max(...focusPoints.map((point) => point.x));
  const minY = Math.min(...focusPoints.map((point) => point.y));
  const maxY = Math.max(...focusPoints.map((point) => point.y));
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const fitScale = Math.min(2.6, 64 / Math.max(18, maxX - minX), 64 / Math.max(18, maxY - minY));
  const displayPoint = (point: { x: number; y: number }) => ({
    x: 50 + (point.x - center.x) * fitScale * zoom,
    y: 50 + (point.y - center.y) * fitScale * zoom,
  });
  const displayedQuery = displayPoint(queryPoint);
  const focusKey = `${query}:${displayedTopChunks.map((chunk) => chunk.id).join(",")}`;

  useEffect(() => setZoom(1), [focusKey]);

  return <section className="retrieval-map-card">
    <div className="retrieval-space" aria-label="Question vector connected to its nearest chunk candidates">
      <div className="retrieval-space-grid" style={{ backgroundSize: `${Math.max(22, 34 * fitScale * zoom)}px ${Math.max(22, 34 * fitScale * zoom)}px` }} />
      <div className="retrieval-map-controls" aria-label="Vector map zoom controls">
        <button type="button" onClick={() => setZoom((current) => Math.max(.75, current - .25))} disabled={zoom <= .75} aria-label="Zoom out">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((current) => Math.min(1.75, current + .25))} disabled={zoom >= 1.75} aria-label="Zoom in">+</button>
        <button type="button" className="fit-top-k" onClick={() => setZoom(1)}>Fit Top K</button>
      </div>
      <div className="retrieval-fit-label">Q + {displayedTopChunks.length} TOP K CHUNKS · AUTO-FITTED</div>
      <svg className="retrieval-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {displayedTopChunks.map((candidate) => {
          const point = displayPoint(points[candidate.id - 1] ?? { x: 50, y: 50 });
          return <line x1={displayedQuery.x} y1={displayedQuery.y} x2={point.x} y2={point.y} opacity={Math.max(.45, Math.min(.88, candidate.score))} vectorEffect="non-scaling-stroke" key={`link-${candidate.id}`} />;
        })}
      </svg>
      {chunks.map((chunk) => {
        const point = displayPoint(points[chunk.id - 1] ?? { x: 50, y: 50 });
        const candidate = candidateById.get(chunk.id);
        const topRank = topKOrder.get(chunk.id);
        return <span className={`retrieval-space-dot ${candidate ? "candidate" : ""} ${topRank ? "top-k" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} title={`Chunk ${chunk.id}${candidate ? ` · ${Math.round(candidate.score * 100)}% retrieval match` : ""}`} key={chunk.id}>{topRank ?? ""}</span>;
      })}
      <span className="query-vector" style={{ left: `${displayedQuery.x}%`, top: `${displayedQuery.y}%` }}>Q</span>
    </div>
    <div className="retrieval-map-copy">
      <span>TOP K · QUESTION-TO-EVIDENCE VIEW</span><h2>See exactly what the question connects to.</h2>
      <p><strong>Q</strong> is the question vector. The numbered green dots are the current Top K chunks that continue to the prompt. This view automatically fits the question, every Top K chunk, and every connecting line into one readable frame.</p>
      <div className="question-preview"><small>QUESTION</small><strong>{query}</strong></div>
      <div className="retrieval-map-legend"><span><i className="query" /> Question</span><span><i className="top-k" /> Top K chunk</span><span><i /> Other chunk</span></div>
      <small className="projection-note">The lines use the real positions in this 2D projection. Retrieval and reranking still use the original high-dimensional scores—not the apparent screen distance.</small>
    </div>
  </section>;
}

function RerankFlow({ candidates, finalEvidence, source, model }: { candidates: RankedChunk[]; finalEvidence: RerankedChunk[]; source: "OpenAI" | "Local relevance"; model?: string }) {
  return <section className="rerank-board">
    <header><div><span>SECOND PASS · CAREFUL READING</span><h2>Similarity finds candidates. Reranking chooses evidence.</h2></div><small>{source}{model ? ` · ${model}` : ""}</small></header>
    <div className="rerank-columns">
      <div className="rerank-column first-pass"><div className="rerank-column-title"><span>01 · RETRIEVE</span><strong>{candidates.length} candidates</strong><small>Fast cosine / BM25 ranking</small></div>
        {candidates.slice(0, 10).map((item) => <article key={item.id}><b>{item.rank}</b><span><strong>Chunk {item.id}</strong><small>{Math.round(item.score * 100)}% first-pass match</small></span></article>)}
      </div>
      <div className="rerank-gate"><span>QUESTION<br />+<br />PASSAGE</span><b>→</b><small>Read together</small></div>
      <div className="rerank-column second-pass"><div className="rerank-column-title"><span>02 · RERANK</span><strong>{finalEvidence.length} final chunks</strong><small>Direct answer relevance</small></div>
        {finalEvidence.map((item) => {
          const movement = item.retrievalRank - item.rerankRank;
          return <article key={item.id}><b>{item.rerankRank}</b><span><strong>Chunk {item.id}</strong><small>{item.rerankReason}</small></span><em className={movement > 0 ? "up" : movement < 0 ? "down" : "same"}>{movement > 0 ? `↑ ${movement}` : movement < 0 ? `↓ ${Math.abs(movement)}` : "—"}</em></article>;
        })}
      </div>
    </div>
    <footer><strong>{source === "OpenAI" ? "The model reread every candidate against the complete question." : "Local fallback: question-term coverage and strongest-sentence coverage created a real second score."}</strong><span>Only the right-hand column continues to Prompt.</span></footer>
  </section>;
}

function SettingDelta({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after;
  return <div className={changed ? "changed" : "same"}><span>{label}</span><strong>{before}</strong><b>→</b><strong>{after}</strong></div>;
}

function ChunkControls({ config, mode, update, experiment }: { config: PipelineConfig; mode: "Basic" | "Advanced"; update: (patch: Partial<PipelineConfig>) => void; experiment: ExperimentName }) {
  return <div className="controls-panel"><div className="controls-head"><span>EXPERIMENT {experiment}</span><strong>Chunk settings</strong></div>
    <RangeSetting label="Chunk size" value={config.chunkSize} min={40} max={800} step={20} help="Exact BPE tokens per chunk" onValue={(value) => update({ chunkSize: value, overlap: Math.min(config.overlap, value - 1) })} />
    <RangeSetting label="Overlap" value={config.overlap} min={0} max={Math.min(200, config.chunkSize - 1)} step={5} help="Repeated tokens between neighbors" onValue={(value) => update({ overlap: value })} />
    <label><span>Strategy</span><select value={config.strategy} onChange={(event) => update({ strategy: event.target.value as PipelineConfig["strategy"] })}><option>Recursive</option><option>Sentence</option>{mode === "Advanced" && <option>Fixed token</option>}</select></label>
    <div className="plain-tip"><strong>Why overlap?</strong><p>It stops a useful sentence from being chopped exactly where it gets interesting.</p></div>
  </div>;
}

function RetrievalControls({ config, update, embedding, candidateCount }: { config: PipelineConfig; update: (patch: Partial<PipelineConfig>) => void; embedding: EmbeddingState; candidateCount: number }) {
  return <div className="controls-panel compact"><div className="controls-head"><span>SEARCH SETTINGS</span><strong>What gets through?</strong></div>
    <RangeSetting label="Final Top K" value={config.topK} min={1} max={12} step={1} help="Chunks kept after reranking" onValue={(value) => update({ topK: value })} />
    <label><span>Method</span><select value={config.method} onChange={(event) => update({ method: event.target.value as PipelineConfig["method"] })}><option>Vector</option><option>Hybrid</option><option>Keyword</option></select></label>
    <div className="model-row"><span>First-pass candidate pool</span><strong>{candidateCount} chunks</strong></div>
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

function comparisonVerdict(comparisons: Array<{ name: ExperimentName; best: number; contextTokens: number; results: RerankedChunk[] }>) {
  const [a, b] = comparisons;
  if (!a || !b) return "Run both experiments to compare them.";
  const aPages = new Set(a.results.flatMap((item) => Array.from({ length: item.pageEnd - item.pageStart + 1 }, (_, index) => item.pageStart + index)));
  const bPages = new Set(b.results.flatMap((item) => Array.from({ length: item.pageEnd - item.pageStart + 1 }, (_, index) => item.pageStart + index)));
  const sharedPages = [...aPages].filter((page) => bPages.has(page)).length;
  return `A sends ${a.contextTokens} context tokens and B sends ${b.contextTokens}. Their final evidence shares ${sharedPages} source page${sharedPages === 1 ? "" : "s"}; inspect the passages before calling either setup better.`;
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

function stepIntro(step: Exclude<StepKey, "overview">) {
  return STEP_INTROS[step];
}
