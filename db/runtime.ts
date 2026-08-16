import { env } from "cloudflare:workers";

type RuntimeBindings = {
  DB?: D1Database;
  DOCUMENTS?: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_RESPONSE_MODEL?: string;
  DATA_RETENTION_DAYS?: string;
  MODEL_DAILY_USER_TOKEN_BUDGET?: string;
  MODEL_DAILY_SITE_TOKEN_BUDGET?: string;
  ADMIN_OWNER_ID?: string;
  ANALYTICS_HASH_SALT?: string;
};

export function getRuntimeBindings() {
  return env as unknown as RuntimeBindings;
}

export function requireStorageBindings() {
  const bindings = getRuntimeBindings();
  if (!bindings.DB || !bindings.DOCUMENTS) {
    throw new Error("Persistent storage is unavailable in this runtime.");
  }
  return { DB: bindings.DB, DOCUMENTS: bindings.DOCUMENTS };
}

export async function ensureStorageSchema(database: D1Database) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      page_count INTEGER NOT NULL,
      character_count INTEGER NOT NULL,
      original_key TEXT NOT NULL,
      parsed_key TEXT NOT NULL,
      owner_id TEXT,
      created_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      experiment TEXT NOT NULL,
      query TEXT NOT NULL,
      config_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      owner_id TEXT,
      created_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS api_rate_limits (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS model_usage_daily (
      id TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      owner_id TEXT,
      day TEXT NOT NULL,
      reserved_tokens INTEGER NOT NULL,
      actual_tokens INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      section TEXT,
      path TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
  ]);
  await ensureColumn(database, "documents", "owner_id", "owner_id TEXT");
  await ensureColumn(database, "pipeline_runs", "owner_id", "owner_id TEXT");
  await database.batch([
    database.prepare("CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_documents_owner_created_at ON documents(owner_id, created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_document_id ON pipeline_runs(document_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON pipeline_runs(created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_owner_created_at ON pipeline_runs(owner_id, created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_api_rate_limits_owner_bucket ON api_rate_limits(owner_id, bucket)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start ON api_rate_limits(window_start)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_model_usage_daily_day ON model_usage_daily(day)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_model_usage_daily_owner_day ON model_usage_daily(owner_id, day)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created_at ON analytics_events(event_name, created_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_session_created_at ON analytics_events(session_id, created_at)"),
  ]);
}

async function ensureColumn(database: D1Database, table: string, column: string, definition: string) {
  const info = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!(info.results ?? []).some((item) => item.name === column)) {
    await database.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  }
}

export function getOpenAIConfig() {
  const bindings = getRuntimeBindings();
  const processEnvironment = typeof process !== "undefined" ? process.env : {};
  return {
    apiKey: bindings.OPENAI_API_KEY || processEnvironment.OPENAI_API_KEY || "",
    embeddingModel:
      bindings.OPENAI_EMBEDDING_MODEL || processEnvironment.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    responseModel:
      bindings.OPENAI_RESPONSE_MODEL || processEnvironment.OPENAI_RESPONSE_MODEL || "gpt-5.6-luna",
  };
}

export function getLaunchPolicy() {
  const bindings = getRuntimeBindings();
  const processEnvironment = typeof process !== "undefined" ? process.env : {};
  return {
    retentionDays: positiveInteger(bindings.DATA_RETENTION_DAYS || processEnvironment.DATA_RETENTION_DAYS, 7),
    userDailyTokenBudget: positiveInteger(bindings.MODEL_DAILY_USER_TOKEN_BUDGET || processEnvironment.MODEL_DAILY_USER_TOKEN_BUDGET, 1_000_000),
    siteDailyTokenBudget: positiveInteger(bindings.MODEL_DAILY_SITE_TOKEN_BUDGET || processEnvironment.MODEL_DAILY_SITE_TOKEN_BUDGET, 5_000_000),
  };
}

export async function getEffectiveLaunchPolicy(database: D1Database) {
  const defaults = getLaunchPolicy();
  const rows = await database.prepare("SELECT key, value FROM site_settings WHERE key IN ('model_calls_enabled', 'user_daily_token_budget', 'site_daily_token_budget')")
    .all<{ key: string; value: string }>();
  const settings = new Map((rows.results ?? []).map((row) => [row.key, row.value]));
  return {
    ...defaults,
    modelCallsEnabled: settings.get("model_calls_enabled") !== "false",
    userDailyTokenBudget: positiveInteger(settings.get("user_daily_token_budget"), defaults.userDailyTokenBudget),
    siteDailyTokenBudget: positiveInteger(settings.get("site_daily_token_budget"), defaults.siteDailyTokenBudget),
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
