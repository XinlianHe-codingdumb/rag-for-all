import { getOpenAIConfig, getRuntimeBindings } from "../../../db/runtime";

export async function GET() {
  const openai = getOpenAIConfig();
  const bindings = getRuntimeBindings();
  return Response.json({
    openaiConfigured: Boolean(openai.apiKey),
    embeddingModel: openai.embeddingModel,
    responseModel: openai.responseModel,
    persistenceConfigured: Boolean(bindings.DB && bindings.DOCUMENTS),
  });
}
