import { getOpenAIConfig } from "../../../db/runtime";

const MAX_TEXTS = 100;
const MAX_CHARACTERS_PER_TEXT = 30_000;

export async function POST(request: Request) {
  const config = getOpenAIConfig();
  if (!config.apiKey) {
    return Response.json(
      { error: "OpenAI is not configured. Local TF-IDF retrieval remains available.", code: "OPENAI_KEY_MISSING" },
      { status: 503 },
    );
  }

  const payload = (await request.json()) as { texts?: unknown };
  if (!Array.isArray(payload.texts) || !payload.texts.length || payload.texts.length > MAX_TEXTS) {
    return Response.json({ error: `texts must contain 1-${MAX_TEXTS} strings.` }, { status: 400 });
  }
  const texts = payload.texts.map((value) => String(value));
  if (texts.some((text) => !text.trim() || text.length > MAX_CHARACTERS_PER_TEXT)) {
    return Response.json({ error: `Each text must contain 1-${MAX_CHARACTERS_PER_TEXT} characters.` }, { status: 400 });
  }

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
    return Response.json({ error: body.error?.message || "Embedding request failed." }, { status: response.status || 502 });
  }
  const vectors = [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  return Response.json({ vectors, model: body.model || config.embeddingModel, inputTokens: body.usage?.total_tokens ?? 0 });
}
