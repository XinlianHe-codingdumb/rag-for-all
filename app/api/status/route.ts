import { ensureStorageSchema, getEffectiveLaunchPolicy, getLaunchPolicy, getOpenAIConfig, getRuntimeBindings } from "../../../db/runtime";

export async function GET() {
  const openai = getOpenAIConfig();
  const bindings = getRuntimeBindings();
  let policy = { ...getLaunchPolicy(), modelCallsEnabled: true };
  if (bindings.DB) {
    await ensureStorageSchema(bindings.DB);
    policy = await getEffectiveLaunchPolicy(bindings.DB);
  }
  return Response.json({
    openaiConfigured: Boolean(openai.apiKey),
    embeddingModel: openai.embeddingModel,
    responseModel: openai.responseModel,
    persistenceConfigured: Boolean(bindings.DB && bindings.DOCUMENTS),
    authenticationMode: "Anonymous first-party session",
    usageProtectionConfigured: Boolean(bindings.DB),
    retentionDays: policy.retentionDays,
    userDailyTokenBudget: policy.userDailyTokenBudget,
    modelCallsEnabled: policy.modelCallsEnabled,
  });
}
