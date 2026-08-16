import { env } from "cloudflare:workers";

type RuntimeBindings = {
  DB?: D1Database;
  DOCUMENTS?: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_RESPONSE_MODEL?: string;
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
