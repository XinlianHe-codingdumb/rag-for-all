import { ensureStorageSchema, getLaunchPolicy, requireStorageBindings } from "../../../db/runtime";
import { apiError, apiJson, beginApiRequest, type ApiContext } from "../../lib/api-guard";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PARSED_CHARACTERS = 2_000_000;
const MAX_PAGES = 5_000;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "application/octet-stream",
]);

export async function GET(request: Request) {
  const authorization = await beginApiRequest(request, "documents.list");
  if (authorization instanceof Response) return authorization;
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const expiredRemoved = await cleanupExpiredDocuments(DB, DOCUMENTS);
    await claimLegacyDocuments(DB, authorization.userId);
    const rows = await DB.prepare(`SELECT id, name, mime_type AS mimeType, size, page_count AS pageCount,
      character_count AS characterCount, created_at AS createdAt FROM documents
      WHERE owner_id = ? ORDER BY created_at DESC LIMIT 30`).bind(authorization.userId).all();
    return apiJson(authorization, { documents: rows.results ?? [] }, {}, { expiredRemoved });
  } catch (error) {
    return storageError(authorization, error);
  }
}

export async function POST(request: Request) {
  const authorization = await beginApiRequest(request, "documents.create", { bucket: "document_upload", limit: 20 });
  if (authorization instanceof Response) return authorization;
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const expiredRemoved = await cleanupExpiredDocuments(DB, DOCUMENTS);
    const form = await request.formData();
    const file = form.get("file");
    const parsed = form.get("parsed");
    if (!(file instanceof File) || typeof parsed !== "string") {
      return apiJson(authorization, { error: "file and parsed document data are required." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) return apiJson(authorization, { error: "File exceeds the 20 MB limit." }, { status: 413 });
    const contentType = file.type || "application/octet-stream";
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return apiJson(authorization, { error: "This file type is not supported." }, { status: 415 });
    }
    const metadata = JSON.parse(parsed) as { id?: string; pages?: unknown[]; text?: string; mimeType?: string };
    if (!metadata.id || !Array.isArray(metadata.pages) || typeof metadata.text !== "string") {
      return apiJson(authorization, { error: "Parsed document data is invalid." }, { status: 400 });
    }
    if (metadata.text.length > MAX_PARSED_CHARACTERS || metadata.pages.length > MAX_PAGES) {
      return apiJson(authorization, { error: "The parsed document exceeds the current processing limit." }, { status: 413 });
    }
    const id = metadata.id;
    const originalKey = `documents/${authorization.actorHash}/${id}/original`;
    const parsedKey = `documents/${authorization.actorHash}/${id}/parsed.json`;
    const originalBytes = await file.arrayBuffer();
    await Promise.all([
      DOCUMENTS.put(originalKey, originalBytes, { httpMetadata: { contentType: file.type || metadata.mimeType } }),
      DOCUMENTS.put(parsedKey, JSON.stringify(metadata), { httpMetadata: { contentType: "application/json" } }),
    ]);
    const createdAt = Date.now();
    await DB.prepare(`INSERT INTO documents
      (id, name, mime_type, size, page_count, character_count, original_key, parsed_key, owner_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, file.name, contentType || metadata.mimeType, file.size, metadata.pages.length, metadata.text.length, originalKey, parsedKey, authorization.userId, createdAt)
      .run();
    return apiJson(
      authorization,
      { document: { id, name: file.name, size: file.size, pageCount: metadata.pages.length, characterCount: metadata.text.length, createdAt } },
      { status: 201 },
      { fileBytes: file.size, pageCount: metadata.pages.length, characterCount: metadata.text.length, expiredRemoved },
    );
  } catch (error) {
    return storageError(authorization, error);
  }
}

export async function DELETE(request: Request) {
  const authorization = await beginApiRequest(request, "documents.delete");
  if (authorization instanceof Response) return authorization;
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const payload = await request.json() as { id?: string };
    if (!payload.id) return apiJson(authorization, { error: "id is required." }, { status: 400 });
    const row = await DB.prepare(`SELECT original_key AS originalKey, parsed_key AS parsedKey FROM documents
      WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)`)
      .bind(payload.id, authorization.userId).first<{ originalKey: string; parsedKey: string }>();
    if (!row) return apiJson(authorization, { error: "Document not found." }, { status: 404 });
    if (row) await Promise.all([DOCUMENTS.delete(row.originalKey), DOCUMENTS.delete(row.parsedKey)]);
    await DB.batch([
      DB.prepare("DELETE FROM pipeline_runs WHERE document_id = ? AND (owner_id = ? OR owner_id IS NULL)").bind(payload.id, authorization.userId),
      DB.prepare("DELETE FROM documents WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)").bind(payload.id, authorization.userId),
    ]);
    return apiJson(authorization, { deleted: true });
  } catch (error) {
    return storageError(authorization, error);
  }
}

async function claimLegacyDocuments(database: D1Database, ownerId: string) {
  await database.prepare("UPDATE documents SET owner_id = ? WHERE owner_id IS NULL").bind(ownerId).run();
}

async function cleanupExpiredDocuments(database: D1Database, bucket: R2Bucket) {
  const cutoff = Date.now() - getLaunchPolicy().retentionDays * 24 * 60 * 60 * 1_000;
  const expired = await database.prepare(`SELECT id, original_key AS originalKey, parsed_key AS parsedKey
    FROM documents WHERE created_at < ? ORDER BY created_at ASC LIMIT 50`)
    .bind(cutoff)
    .all<{ id: string; originalKey: string; parsedKey: string }>();
  let removed = 0;
  for (const row of expired.results ?? []) {
    try {
      await Promise.all([bucket.delete(row.originalKey), bucket.delete(row.parsedKey)]);
      await database.batch([
        database.prepare("DELETE FROM pipeline_runs WHERE document_id = ?").bind(row.id),
        database.prepare("DELETE FROM documents WHERE id = ?").bind(row.id),
      ]);
      removed += 1;
    } catch (error) {
      console.warn(JSON.stringify({ service: "rag-for-all", event: "retention.delete_failed", timestamp: new Date().toISOString(), errorType: error instanceof Error ? error.name : "UnknownError" }));
    }
  }
  return removed;
}

function storageError(context: ApiContext, error: unknown) {
  return apiError(context, error, "Document storage is temporarily unavailable.", "STORAGE_UNAVAILABLE");
}
