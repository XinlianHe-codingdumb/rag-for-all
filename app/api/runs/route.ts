import { ensureStorageSchema, requireStorageBindings } from "../../../db/runtime";

export async function GET(request: Request) {
  try {
    const { DB } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const documentId = new URL(request.url).searchParams.get("documentId");
    const statement = documentId
      ? DB.prepare("SELECT * FROM pipeline_runs WHERE document_id = ? ORDER BY created_at DESC LIMIT 30").bind(documentId)
      : DB.prepare("SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 30");
    const rows = await statement.all();
    return Response.json({ runs: rows.results ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run history is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
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
      return Response.json({ error: "documentId, experiment, and query are required." }, { status: 400 });
    }
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    await DB.prepare(`INSERT INTO pipeline_runs
      (id, document_id, experiment, query, config_json, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, payload.documentId, payload.experiment, payload.query, JSON.stringify(payload.config ?? {}), JSON.stringify(payload.result ?? {}), createdAt)
      .run();
    return Response.json({ run: { id, createdAt } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run could not be saved." }, { status: 503 });
  }
}
