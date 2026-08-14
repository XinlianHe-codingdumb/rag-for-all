"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";

type StepKey =
  | "upload"
  | "parse"
  | "chunk"
  | "embed"
  | "retrieve"
  | "rerank"
  | "prompt"
  | "answer"
  | "compare";

type Experiment = {
  chunkSize: number;
  overlap: number;
  topK: number;
  method: "Vector" | "Hybrid";
};

type Chunk = {
  id: number;
  text: string;
  words: number;
  tokens: number;
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

const SAMPLE_DOCUMENT = `
Northstar Coffee is a fictional company with a very real obsession: making office coffee less tragic. The company was founded in Singapore in 2022 and now operates small coffee bars inside twelve shared offices.

Employees receive an annual learning allowance of SGD 1,200. The allowance may be used for courses, books, conferences, or professional software. Espresso machines are not professional software, no matter how persuasive the product page looks.

Learning requests below SGD 300 can be approved by a direct manager. Requests from SGD 300 to SGD 1,200 also need approval from People Operations. Unused allowance expires on 31 December and does not roll over to the next year.

Northstar supports flexible work. Team members may work remotely up to three days per week. Tuesdays are the shared in-office day for product, design, and engineering. Employees may work abroad for up to twenty business days per calendar year after receiving manager approval.

Annual leave starts at eighteen days. Employees receive one additional day after every completed year of service, capped at twenty-four days. Sick leave follows local employment requirements and does not reduce annual leave.

For information security, confidential documents must remain in approved company storage. Personal cloud drives are not approved. Lost devices must be reported to the security team within one hour. This is not the moment to hope the laptop finds itself.

Business expenses should be submitted within thirty days. Receipts are required for expenses above SGD 25. Client meals require the names of attendees and a short business purpose. Finance reviews complete claims every Friday.

The company provides a wellness allowance of SGD 60 per month. It covers gym memberships, fitness classes, meditation apps, and sports equipment. Coffee beans are excluded because the company already provides more coffee than medical science can comfortably defend.
`.trim();

const DEFAULTS: Record<"A" | "B", Experiment> = {
  A: { chunkSize: 120, overlap: 24, topK: 3, method: "Vector" },
  B: { chunkSize: 220, overlap: 44, topK: 5, method: "Hybrid" },
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "does", "for", "from", "how", "i",
  "in", "is", "it", "my", "of", "on", "the", "to", "what", "when", "with",
]);

function makeChunks(text: string, size: number, overlap: number): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const wordsPerChunk = Math.max(24, Math.round(size / 1.3));
  const overlapWords = Math.min(wordsPerChunk - 1, Math.round(overlap / 1.3));
  const stride = Math.max(1, wordsPerChunk - overlapWords);
  const chunks: Chunk[] = [];

  for (let start = 0; start < words.length; start += stride) {
    const part = words.slice(start, start + wordsPerChunk);
    if (!part.length) break;
    chunks.push({
      id: chunks.length + 1,
      text: part.join(" "),
      words: part.length,
      tokens: Math.ceil(part.length * 1.3),
    });
    if (start + wordsPerChunk >= words.length) break;
  }
  return chunks;
}

function queryTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function rankChunks(chunks: Chunk[], query: string, topK: number, method: Experiment["method"]) {
  const terms = queryTerms(query);
  return chunks
    .map((chunk) => {
      const body = chunk.text.toLowerCase();
      const hits = terms.reduce((total, term) => total + (body.includes(term) ? 1 : 0), 0);
      const phraseBonus = query.toLowerCase().includes("learning") && body.includes("learning allowance") ? 0.22 : 0;
      const hybridBonus = method === "Hybrid" && terms.some((term) => body.includes(term)) ? 0.08 : 0;
      return { ...chunk, score: Math.min(0.98, 0.31 + hits * 0.13 + phraseBonus + hybridBonus) };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, topK);
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function RagStudio() {
  const [activeStep, setActiveStep] = useState<StepKey>("chunk");
  const [mode, setMode] = useState<"Basic" | "Advanced">("Basic");
  const [activeExperiment, setActiveExperiment] = useState<"A" | "B">("A");
  const [experiments, setExperiments] = useState(DEFAULTS);
  const [documentText, setDocumentText] = useState(SAMPLE_DOCUMENT);
  const [documentName, setDocumentName] = useState("northstar-handbook.md");
  const [query, setQuery] = useState("How much can I spend on learning?");
  const [ran, setRan] = useState(true);
  const [notice, setNotice] = useState("Sample project is ready. Nothing has been sent to an AI model.");
  const inputRef = useRef<HTMLInputElement>(null);

  const config = experiments[activeExperiment];
  const chunks = useMemo(
    () => makeChunks(documentText, config.chunkSize, config.overlap),
    [documentText, config.chunkSize, config.overlap],
  );
  const ranked = useMemo(
    () => rankChunks(chunks, query, config.topK, config.method),
    [chunks, query, config.topK, config.method],
  );

  const comparison = useMemo(() => {
    return (["A", "B"] as const).map((name) => {
      const settings = experiments[name];
      const localChunks = makeChunks(documentText, settings.chunkSize, settings.overlap);
      const localRanked = rankChunks(localChunks, query, settings.topK, settings.method);
      return {
        name,
        settings,
        chunks: localChunks.length,
        context: localRanked.reduce((sum, item) => sum + item.tokens, 0),
        best: localRanked[0]?.score ?? 0,
      };
    });
  }, [documentText, experiments, query]);

  const updateConfig = (patch: Partial<Experiment>) => {
    setExperiments((current) => ({
      ...current,
      [activeExperiment]: { ...current[activeExperiment], ...patch },
    }));
    setRan(false);
  };

  const loadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    setDocumentName(file.name);
    if (extension === "txt" || extension === "md") {
      const reader = new FileReader();
      reader.onload = () => {
        setDocumentText(String(reader.result || ""));
        setNotice(`${file.name} is loaded locally. Your document has not left this browser.`);
        setActiveStep("parse");
        setRan(false);
      };
      reader.readAsText(file);
    } else {
      setNotice(`${file.name} is selected. PDF and DOCX extraction arrives in the parser milestone.`);
      setActiveStep("upload");
    }
  };

  const runPipeline = () => {
    setRan(true);
    setNotice(`Experiment ${activeExperiment} finished locally in 84 ms. The LLM step is still in preview mode.`);
  };

  const clearDocument = () => {
    setDocumentText("");
    setDocumentName("No document");
    setNotice("Document removed from this session. Clean desk, clean vectors.");
    setActiveStep("upload");
    setRan(false);
  };

  const prompt = `SYSTEM\nAnswer only from the supplied context. Cite chunk IDs. If the answer is missing, say so.\n\nCONTEXT\n${ranked
    .map((item) => `[Chunk ${item.id}] ${item.text}`)
    .join("\n\n")}\n\nUSER\n${query}`;

  const activeMeta = STEPS.find((step) => step.key === activeStep)!;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">R</div>
          <div>
            <strong>RAG FOR ALL</strong>
            <span>See what your RAG is thinking.</span>
          </div>
        </div>
        <div className="top-actions">
          <div className="privacy-pill"><i /> Private session</div>
          <button className="quiet-button" type="button">Docs</button>
          <button className="avatar" type="button" aria-label="Open profile">XL</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="project-card">
            <span>PROJECT</span>
            <strong>Northstar handbook</strong>
            <small>{documentName}</small>
          </div>

          <nav aria-label="RAG pipeline">
            <p className="nav-label">PIPELINE</p>
            {STEPS.map((step, index) => (
              <button
                type="button"
                key={step.key}
                className={`nav-step ${activeStep === step.key ? "active" : ""}`}
                onClick={() => setActiveStep(step.key)}
              >
                <span className="step-number">{step.number}</span>
                <span className="step-copy">
                  <strong>{step.title}</strong>
                  <small>{step.note}</small>
                </span>
                <span className={`step-state ${index < 8 && ran ? "done" : ""}`}>
                  {index < 8 && ran ? "✓" : "·"}
                </span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button type="button" onClick={() => setActiveStep("compare")}>
              <span>⌁</span> Experiment history
            </button>
            <button type="button"><span>?</span> Plain-English guide</button>
          </div>
        </aside>

        <section className="content">
          <div className="notice-bar">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>Dismiss</button>
          </div>

          <div className="content-header">
            <div>
              <p className="eyebrow">STEP {activeMeta.number} · {activeMeta.note.toUpperCase()}</p>
              <h1>{activeMeta.title}</h1>
              <p>{stepIntro(activeStep)}</p>
            </div>
            <div className="mode-switch" aria-label="Interface mode">
              {(["Basic", "Advanced"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={mode === item ? "selected" : ""}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="experiment-bar">
            <div className="experiment-tabs">
              {(["A", "B"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={activeExperiment === item ? "active" : ""}
                  onClick={() => setActiveExperiment(item)}
                >
                  Experiment {item}
                  <small>{item === "A" ? "Baseline" : "Challenger"}</small>
                </button>
              ))}
            </div>
            <button className="run-button" type="button" onClick={runPipeline}>
              <span>▶</span> Run from here
            </button>
          </div>

          <div className="stage">
            {activeStep === "upload" && (
              <section className="upload-stage">
                <div className="drop-zone" onClick={() => inputRef.current?.click()}>
                  <div className="upload-icon">↑</div>
                  <h2>Drop knowledge here</h2>
                  <p>PDF, DOCX, TXT, or Markdown. Text files work in this first build.</p>
                  <button type="button">Choose a document</button>
                  <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={loadFile} hidden />
                </div>
                <div className="privacy-card">
                  <span>Privacy by default</span>
                  <p>Documents can be deleted at any time. API keys will live in server-side environment settings—not in the browser or GitHub.</p>
                  <button type="button" onClick={clearDocument}>Delete current document</button>
                </div>
              </section>
            )}

            {activeStep === "parse" && (
              <section className="panel-grid parse-layout">
                <div className="paper-preview">
                  <div className="paper-head"><span>{documentName}</span><small>TEXT PREVIEW</small></div>
                  <div className="paper-body">{documentText || "Upload a document to see its extracted text."}</div>
                </div>
                <div className="inspector">
                  <h3>Parser report</h3>
                  <Stat label="Characters" value={documentText.length.toLocaleString()} />
                  <Stat label="Words" value={documentText.split(/\s+/).filter(Boolean).length.toString()} />
                  <Stat label="Language" value="English" />
                  <Stat label="Tables found" value="0" />
                  <div className="callout"><strong>Looks tidy.</strong><span>No mysterious headers joined the body text. A small miracle.</span></div>
                </div>
              </section>
            )}

            {activeStep === "chunk" && (
              <section className="panel-grid chunk-layout">
                <div className="chunk-canvas">
                  <div className="panel-title">
                    <div><span>LIVE PREVIEW</span><h2>{chunks.length} chunks from one document</h2></div>
                    <div className="legend"><i /> Overlap repeats in the next chunk</div>
                  </div>
                  <div className="chunk-list">
                    {chunks.map((chunk, index) => (
                      <article className="chunk-card" key={chunk.id}>
                        <div className="chunk-id">{String(chunk.id).padStart(2, "0")}</div>
                        <div>
                          <p>{chunk.text}</p>
                          <footer>
                            <span>~{chunk.tokens} tokens</span>
                            <span>{chunk.words} words</span>
                            {index < chunks.length - 1 && <span className="overlap-tag">{config.overlap} token overlap</span>}
                          </footer>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="controls-panel">
                  <div className="controls-head"><span>EXPERIMENT {activeExperiment}</span><strong>Chunk settings</strong></div>
                  <label>
                    <span>Chunk size <b>{config.chunkSize}</b></span>
                    <input type="range" min="60" max="360" step="20" value={config.chunkSize} onChange={(e) => updateConfig({ chunkSize: Number(e.target.value) })} />
                    <small>Approximate tokens per chunk</small>
                  </label>
                  <label>
                    <span>Overlap <b>{config.overlap}</b></span>
                    <input type="range" min="0" max="100" step="4" value={config.overlap} onChange={(e) => updateConfig({ overlap: Number(e.target.value) })} />
                    <small>Repeated context between neighbors</small>
                  </label>
                  {mode === "Advanced" && (
                    <label>
                      <span>Strategy</span>
                      <select><option>Recursive text</option><option>Sentence-aware</option><option>Fixed token</option></select>
                    </label>
                  )}
                  <div className="plain-tip"><strong>Why overlap?</strong><p>It stops a useful sentence from being chopped exactly where it gets interesting.</p></div>
                </div>
              </section>
            )}

            {activeStep === "embed" && (
              <section className="embedding-stage">
                <div className="vector-map">
                  <div className="map-grid" />
                  {chunks.map((chunk, index) => (
                    <button
                      className="vector-dot"
                      style={{ left: `${14 + ((index * 23) % 72)}%`, top: `${18 + ((index * 31) % 62)}%` }}
                      key={chunk.id}
                      title={`Chunk ${chunk.id}`}
                      type="button"
                    >{chunk.id}</button>
                  ))}
                  <div className="axis x">similar meaning →</div>
                  <div className="axis y">topic difference →</div>
                </div>
                <div className="embedding-copy">
                  <span>2D CONCEPT MAP</span>
                  <h2>Meaning becomes a location.</h2>
                  <p>Each dot is a chunk. Nearby dots discuss similar ideas. The real vectors have many more dimensions; this map is a readable projection, not the whole mathematical universe.</p>
                  <div className="model-row"><span>Embedding model</span><strong>text-embedding-3-small <em>planned</em></strong></div>
                  <div className="model-row"><span>Current preview</span><strong>Deterministic demo layout</strong></div>
                </div>
              </section>
            )}

            {(activeStep === "retrieve" || activeStep === "rerank") && (
              <section className="retrieval-stage">
                <div className="query-box">
                  <span>YOUR QUESTION</span>
                  <input value={query} onChange={(e) => { setQuery(e.target.value); setRan(false); }} aria-label="Question" />
                  <button type="button" onClick={runPipeline}>Search chunks</button>
                </div>
                <div className="retrieval-layout">
                  <div className="results-panel">
                    <div className="panel-title"><div><span>TOP {config.topK}</span><h2>{activeStep === "rerank" ? "Best evidence, reordered" : "Closest chunks"}</h2></div><small>{config.method} retrieval</small></div>
                    {ranked.map((item, index) => (
                      <article className="result-card" key={item.id}>
                        <div className="rank">{index + 1}</div>
                        <div className="result-main">
                          <header><strong>Chunk {item.id}</strong><span>{documentName}</span></header>
                          <p>{item.text}</p>
                        </div>
                        <div className="score"><strong>{Math.round(item.score * 100)}%</strong><span>{activeStep === "rerank" ? "relevance" : "match"}</span></div>
                      </article>
                    ))}
                  </div>
                  <div className="controls-panel compact">
                    <div className="controls-head"><span>SEARCH SETTINGS</span><strong>What gets through?</strong></div>
                    <label><span>Top K <b>{config.topK}</b></span><input type="range" min="1" max="8" value={config.topK} onChange={(e) => updateConfig({ topK: Number(e.target.value) })} /></label>
                    <label><span>Method</span><select value={config.method} onChange={(e) => updateConfig({ method: e.target.value as Experiment["method"] })}><option>Vector</option><option>Hybrid</option></select></label>
                    {activeStep === "rerank" && <div className="plain-tip"><strong>Reranking</strong><p>A second opinion checks the shortlist. Same candidates, less confidence theatre.</p></div>}
                  </div>
                </div>
              </section>
            )}

            {activeStep === "prompt" && (
              <section className="prompt-stage">
                <div className="prompt-toolbar"><div><span>FINAL PAYLOAD</span><h2>This is what the model will actually see.</h2></div><button type="button" onClick={() => navigator.clipboard?.writeText(prompt)}>Copy prompt</button></div>
                <pre>{prompt}</pre>
                <div className="prompt-stats"><Stat label="Context chunks" value={ranked.length.toString()} /><Stat label="Approx. input" value={`${ranked.reduce((sum, item) => sum + item.tokens, 0) + 54} tokens`} /><Stat label="Model call" value="Preview only" accent /></div>
              </section>
            )}

            {activeStep === "answer" && (
              <section className="answer-stage">
                <div className="answer-card">
                  <span className="preview-badge">PREVIEW — NO LLM CALL YET</span>
                  <h2>Northstar employees receive an annual learning allowance of SGD 1,200.</h2>
                  <p>Requests below SGD 300 need direct manager approval. Requests from SGD 300 to SGD 1,200 also require People Operations approval. Unused allowance expires at the end of the year.</p>
                  <div className="citations"><button type="button" onClick={() => setActiveStep("retrieve")}>Chunk {ranked[0]?.id ?? 1}</button><span>Source: {documentName}</span></div>
                </div>
                <div className="answer-metrics"><Stat label="Evidence coverage" value="3 facts cited" /><Stat label="Latency" value="API not connected" /><Stat label="Estimated cost" value="Available after model setup" /></div>
              </section>
            )}

            {activeStep === "compare" && (
              <section className="compare-stage">
                <div className="compare-intro"><span>SAME QUESTION. DIFFERENT PIPELINES.</span><h2>Which setup earns its keep?</h2><p>Compare evidence, context size, and retrieval confidence before spending tokens on a model answer.</p></div>
                <div className="compare-grid">
                  {comparison.map((item) => (
                    <article className={`compare-card ${activeExperiment === item.name ? "selected" : ""}`} key={item.name}>
                      <header><div><span>EXPERIMENT</span><strong>{item.name}</strong></div><button type="button" onClick={() => setActiveExperiment(item.name)}>Edit</button></header>
                      <div className="compare-method">{item.settings.method}<span>{item.name === "A" ? "Baseline" : "Challenger"}</span></div>
                      <div className="compare-metrics"><Stat label="Chunk size" value={String(item.settings.chunkSize)} /><Stat label="Overlap" value={String(item.settings.overlap)} /><Stat label="Total chunks" value={String(item.chunks)} /><Stat label="Context sent" value={`~${item.context} tokens`} /><Stat label="Best match" value={`${Math.round(item.best * 100)}%`} accent={item.name === "B"} /></div>
                    </article>
                  ))}
                </div>
                <div className="verdict"><div className="verdict-icon">↗</div><div><span>EARLY VERDICT</span><strong>Experiment B finds slightly stronger matches, but sends more context.</strong><p>That is the RAG trade-off in one sentence: better evidence is lovely; paying to repeat the handbook is less lovely.</p></div></div>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function stepIntro(step: StepKey) {
  const copy: Record<StepKey, string> = {
    upload: "Start with a document. We will keep every later answer traceable to its source.",
    parse: "Before retrieval, a file must become clean, usable text. Garbage in still has excellent attendance.",
    chunk: "Split the document into retrievable pieces and see every boundary before you commit.",
    embed: "Turn each chunk into numbers that represent meaning, then inspect the neighborhood.",
    retrieve: "Ask a question and watch the system choose which chunks deserve a seat at the table.",
    rerank: "Give the shortlist a second, more careful relevance check.",
    prompt: "Inspect the exact instructions, context, and question prepared for the language model.",
    answer: "Read the result, follow its citations, and check whether the evidence really supports it.",
    compare: "Run two configurations side by side. Tiny sliders can have surprisingly expensive opinions.",
  };
  return copy[step];
}
