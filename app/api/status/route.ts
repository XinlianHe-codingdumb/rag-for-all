import { ensureStorageSchema, getEffectiveLaunchPolicy, getLaunchPolicy, getOpenAIConfig, getRuntimeBindings } from "../../../db/runtime";
import { apiError, apiJson, beginApiRequest } from "../../lib/api-guard";
import { cleanupExpiredDocuments } from "../documents/route";

export async function GET(request: Request) {
  const context = await beginApiRequest(request, "status.read", { bucket: "status_read", limit: 120 });
  if (context instanceof Response) return context;
  try {
    const openai = getOpenAIConfig();
    const bindings = getRuntimeBindings();
    let policy = { ...getLaunchPolicy(), modelCallsEnabled: true };
    let expiredRemoved = 0;
    if (bindings.DB) {
      await ensureStorageSchema(bindings.DB);
      policy = await getEffectiveLaunchPolicy(bindings.DB);
      if (bindings.DOCUMENTS) expiredRemoved = await cleanupExpiredDocuments(bindings.DB, bindings.DOCUMENTS);
    }
    return apiJson(context, {
      openaiConfigured: Boolean(openai.apiKey),
      embeddingModel: openai.embeddingModel,
      responseModel: openai.responseModel,
      persistenceConfigured: Boolean(bindings.DB && bindings.DOCUMENTS),
      authenticationMode: "Anonymous first-party session",
      usageProtectionConfigured: Boolean(bindings.DB),
      retentionDays: policy.retentionDays,
      modelCallsEnabled: policy.modelCallsEnabled,
    }, {}, { expiredRemoved });
  } catch (error) {
    return apiError(context, error, "Service status is temporarily unavailable.", "STATUS_UNAVAILABLE");
  }
}
