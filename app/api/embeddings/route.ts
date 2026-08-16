import { getOpenAIConfig } from "../../../db/runtime";
import { apiError, apiJson, beginApiRequest, recordModelUsage, reserveModelUsage } from "../../lib/api-guard";

const MAX_TEXTS = 100;
const MAX_CHARACTERS_PER_TEXT = 30_000;

export async function POST(request: Request) {
  const authorization = await beginApiRequest(request, "model.embeddings", { bucket: "embeddings", limit: 40 });
  if (authorization instanceof Response) return authorization;
  const config = getOpenAIConfig();
  if (!config.apiKey) {
    return apiJson(
      authorization,
      { error: "OpenAI is not configured. Local TF-IDF retrieval remains available.", code: "OPENAI_KEY_MISSING" },
      { status: 503 },
    );
  }

  try {
    const payload = (await request.json()) as { texts?: unknown };
    if (!Array.isArray(payload.texts) || !payload.texts.length || payload.texts.length > MAX_TEXTS) {
      return apiJson(authorization, { error: `texts must contain 1-${MAX_TEXTS} strings.` }, { status: 400 });
    }
    const texts = payload.texts.map((value) => String(value));
    if (texts.some((text) => !text.trim() || text.length > MAX_CHARACTERS_PER_TEXT)) {
      return apiJson(authorization, { error: `Each text must contain 1-${MAX_CHARACTERS_PER_TEXT} characters.` }, { status: 400 });
    }
    const usageReservation = await reserveModelUsage(authorization, Math.ceil(texts.reduce((total, text) => total + text.length, 0) / 4), "embeddings");
    if (usageReservation instanceof Response) return usageReservation;

    const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.embeddingModel, input: texts, encoding_format: "float" }),
  });
    const body = await response.json() as {
    data?: Array<{ embedding: number[]; index: number }>;
    model?: string;
    usage?: { total_tokens?: number };
    error?: { message?: string };
  };
    if (!response.ok || !body.data) {
      return apiJson(authorization, { error: body.error?.message || "Embedding request failed." }, { status: response.status || 502 }, { provider: "openai" });
    }
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    const inputTokens = body.usage?.total_tokens ?? 0;
    await recordModelUsage(authorization, usageReservation, inputTokens);
    return apiJson(
      authorization,
      { vectors, model: body.model || config.embeddingModel, inputTokens },
      {},
      { provider: "openai", model: body.model || config.embeddingModel, inputTokens, itemCount: texts.length },
    );
  } catch (error) {
    return apiError(authorization, error, "Embedding request failed.", "EMBEDDING_FAILED", 502);
  }
}
