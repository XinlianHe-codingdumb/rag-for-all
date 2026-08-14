import { getOpenAIConfig } from "../../../db/runtime";

export async function POST(request: Request) {
  const config = getOpenAIConfig();
  if (!config.apiKey) {
    return Response.json(
      { error: "OpenAI is not configured. The interface will use an extractive fallback.", code: "OPENAI_KEY_MISSING" },
      { status: 503 },
    );
  }
  const payload = (await request.json()) as { question?: unknown; context?: unknown };
  const question = String(payload.question ?? "").trim();
  const context = Array.isArray(payload.context)
    ? payload.context.slice(0, 12).map((item) => String(item)).join("\n\n")
    : "";
  if (!question || !context) return Response.json({ error: "question and context are required." }, { status: 400 });
  if (question.length > 4_000 || context.length > 120_000) {
    return Response.json({ error: "The question or retrieved context exceeds the current safety limit." }, { status: 400 });
  }

  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.responseModel,
      instructions: "Answer only from the provided RAG context. Cite supporting chunk IDs in square brackets. If evidence is insufficient, state what is missing. Be concise and plain-spoken.",
      input: `CONTEXT\n${context}\n\nQUESTION\n${question}`,
      max_output_tokens: 700,
      store: false,
      text: { verbosity: "low" },
    }),
  });
  const body = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!response.ok) {
    return Response.json({ error: body.error?.message || "Answer generation failed." }, { status: response.status || 502 });
  }
  const text = body.output_text || body.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n") || "";
  return Response.json({
    text,
    model: body.model || config.responseModel,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    durationMs: Date.now() - startedAt,
  });
}
