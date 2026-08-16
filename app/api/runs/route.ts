import { ensureStorageSchema, requireStorageBindings } from "../../../db/runtime";
import { apiError, apiJson, beginApiRequest } from "../../lib/api-guard";

export async function GET(request: Request) {
  const authorization = await beginApiRequest(request, "runs.list");
  if (authorization instanceof Response) return authorization;
  try {
    const { DB } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const documentId = new URL(request.url).searchParams.get("documentId");
    const statement = documentId
      ? DB.prepare("SELECT * FROM pipeline_runs WHERE document_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 30").bind(documentId, authorization.userId)
      : DB.prepare("SELECT * FROM pipeline_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 30").bind(authorization.userId);
    const rows = await statement.all();
    return apiJson(authorization, { runs: rows.results ?? [] });
  } catch (error) {
    return apiError(authorization, error, "Run history is temporarily unavailable.", "RUN_HISTORY_UNAVAILABLE");
  }
}

export async function POST(request: Request) {
  const authorization = await beginApiRequest(request, "runs.create", { bucket: "run_history", limit: 120 });
  if (authorization instanceof Response) return authorization;
  try {
    const { DB } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const payload = await request.json() as {
      documentId?: string;
      experiment?: string;
      query?: string;
      config?: unknown;
      result?: unknown;
    };
    if (!payload.documentId || !payload.experiment || !payload.query) {
      return apiJson(authorization, { error: "documentId, experiment, and query are required." }, { status: 400 });
    }
    const ownedDocument = await DB.prepare("SELECT id FROM documents WHERE id = ? AND owner_id = ?")
      .bind(payload.documentId, authorization.userId).first<{ id: string }>();
    if (!ownedDocument) return apiJson(authorization, { error: "Document not found." }, { status: 404 });
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    await DB.prepare(`INSERT INTO pipeline_runs
      (id, document_id, experiment, query, config_json, result_json, owner_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, payload.documentId, payload.experiment, payload.query, JSON.stringify(payload.config ?? {}), JSON.stringify(payload.result ?? {}), authorization.userId, createdAt)
      .run();
    return apiJson(authorization, { run: { id, createdAt } }, { status: 201 });
  } catch (error) {
    return apiError(authorization, error, "Run history could not be saved.", "RUN_SAVE_FAILED");
  }
}
