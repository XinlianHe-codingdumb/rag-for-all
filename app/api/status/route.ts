import { getLaunchPolicy, getOpenAIConfig, getRuntimeBindings } from "../../../db/runtime";

export async function GET() {
  const openai = getOpenAIConfig();
  const bindings = getRuntimeBindings();
  const policy = getLaunchPolicy();
  return Response.json({
    openaiConfigured: Boolean(openai.apiKey),
    embeddingModel: openai.embeddingModel,
    responseModel: openai.responseModel,
    persistenceConfigured: Boolean(bindings.DB && bindings.DOCUMENTS),
    authenticationMode: "Sites authenticated-user headers",
    usageProtectionConfigured: Boolean(bindings.DB),
    retentionDays: policy.retentionDays,
    userDailyTokenBudget: policy.userDailyTokenBudget,
  });
}
