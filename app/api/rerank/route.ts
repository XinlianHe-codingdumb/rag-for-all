import { getOpenAIConfig } from "../../../db/runtime";
import { apiError, apiJson, beginApiRequest } from "../../lib/api-guard";

type Candidate = { id: number; text: string };

export async function POST(request: Request) {
  const authorization = await beginApiRequest(request, "model.rerank", { bucket: "rerank", limit: 60 });
  if (authorization instanceof Response) return authorization;
  const config = getOpenAIConfig();
  if (!config.apiKey) {
    return apiJson(
      authorization,
      { error: "OpenAI is not configured. Local relevance reranking remains available.", code: "OPENAI_KEY_MISSING" },
      { status: 503 },
    );
  }

  try {
    const payload = (await request.json()) as { question?: unknown; candidates?: unknown };
  const question = String(payload.question ?? "").trim();
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates.slice(0, 24).map((item) => {
      const candidate = item as Partial<Candidate>;
      return { id: Number(candidate.id), text: String(candidate.text ?? "").slice(0, 12_000) };
    }).filter((item) => Number.isInteger(item.id) && item.id > 0 && item.text.trim())
    : [];
    if (!question || !candidates.length) return apiJson(authorization, { error: "question and candidates are required." }, { status: 400 });
    if (question.length > 4_000) return apiJson(authorization, { error: "The question exceeds the current safety limit." }, { status: 400 });

  const startedAt = Date.now();
  const candidateText = candidates.map((item) => `CHUNK ${item.id}\n${item.text}`).join("\n\n---\n\n");
    const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.responseModel,
      instructions: "You are the second-stage reranker in a RAG pipeline. Judge whether each candidate passage directly helps answer the complete question. Return only strict JSON in this exact shape: {\"results\":[{\"id\":1,\"score\":87,\"reason\":\"Short plain-English reason\"}]}. Include every supplied chunk exactly once. Scores are integers from 0 to 100. Prefer direct answer-bearing evidence over passages that merely share words.",
      input: `QUESTION\n${question}\n\nCANDIDATES\n${candidateText}`,
      max_output_tokens: 1_200,
      store: false,
      text: { verbosity: "low" },
    }),
  });
    const body = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    model?: string;
    error?: { message?: string };
  };
    if (!response.ok) return apiJson(authorization, { error: body.error?.message || "Reranking failed." }, { status: response.status || 502 }, { provider: "openai" });
    const output = body.output_text || body.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n") || "";
    const parsed = JSON.parse(extractJson(output)) as { results?: Array<{ id?: unknown; score?: unknown; reason?: unknown }> };
    const allowed = new Set(candidates.map((item) => item.id));
    const signals = (parsed.results ?? [])
      .map((item) => ({ id: Number(item.id), score: Math.max(0, Math.min(1, Number(item.score) / 100)), reason: String(item.reason ?? "Relevant to the complete question.").slice(0, 220) }))
      .filter((item) => allowed.has(item.id) && Number.isFinite(item.score));
    if (signals.length !== candidates.length) throw new Error("The reranker returned an incomplete candidate list.");
    return apiJson(
      authorization,
      { signals, model: body.model || config.responseModel, durationMs: Date.now() - startedAt },
      {},
      { provider: "openai", model: body.model || config.responseModel, candidateCount: candidates.length },
    );
  } catch (error) {
    return apiError(authorization, error, "Reranking failed.", "RERANK_FAILED", 502);
  }
}

function extractJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The reranker did not return JSON.");
  return value.slice(start, end + 1);
}
