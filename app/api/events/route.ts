import { apiError, apiJson, beginApiRequest } from "../../lib/api-guard";
import { ensureStorageSchema, getRuntimeBindings } from "../../../db/runtime";

const EVENT_NAMES = new Set([
  "page_view",
  "journey_choice",
  "concept_card_view",
  "section_view",
  "pipeline_step_click",
  "upload_started",
  "upload_completed",
  "upload_failed",
  "pipeline_run",
  "setting_changed",
  "answer_generated",
  "answer_failed",
  "comparison_viewed",
  "citation_viewed",
  "document_deleted",
  "feedback",
]);

const PROPERTY_NAMES = new Set([
  "choice",
  "card",
  "step",
  "experiment",
  "mode",
  "status",
  "fileType",
  "sizeBucket",
  "pageBucket",
  "setting",
  "value",
  "source",
  "method",
  "errorCode",
  "durationBucket",
]);

export async function POST(request: Request) {
  const context = await beginApiRequest(request, "analytics.event", { bucket: "analytics_events", limit: 500 });
  if (context instanceof Response) return context;

  try {
    const input = await request.json() as Record<string, unknown>;
    const eventName = typeof input.name === "string" ? input.name : "";
    if (!EVENT_NAMES.has(eventName)) {
      return apiJson(context, { error: "Unknown analytics event.", code: "INVALID_EVENT", requestId: context.requestId }, { status: 400 });
    }

    const section = cleanText(input.section, 48, true);
    const path = cleanText(input.path, 120, false) || "/";
    const properties = sanitizeProperties(input.properties);
    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for analytics.");
    await ensureStorageSchema(DB);
    const now = Date.now();
    await DB.prepare(`INSERT INTO analytics_events
      (id, session_id, event_name, section, path, properties_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), context.actorHash, eventName, section, path, JSON.stringify(properties), now)
      .run();

    if (Math.random() < 0.02) {
      await DB.prepare("DELETE FROM analytics_events WHERE created_at < ?")
        .bind(now - 90 * 24 * 60 * 60 * 1_000)
        .run();
    }
    return apiJson(context, { accepted: true }, { status: 202 }, { event: "analytics.accepted", eventName });
  } catch (error) {
    return apiError(context, error, "Analytics could not be recorded.", "ANALYTICS_UNAVAILABLE");
  }
}

function cleanText(value: unknown, maxLength: number, nullable: boolean) {
  if (typeof value !== "string") return nullable ? null : "";
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || (nullable ? null : "");
}

function sanitizeProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string | number | boolean> = {};
  for (const [key, rawValue] of Object.entries(value).slice(0, 10)) {
    if (!PROPERTY_NAMES.has(key)) continue;
    if (typeof rawValue === "string") output[key] = rawValue.slice(0, 80);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
  }
  return output;
}
