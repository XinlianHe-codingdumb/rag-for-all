import { ensureStorageSchema, requireStorageBindings } from "../../../db/runtime";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function GET() {
  try {
    const { DB } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const rows = await DB.prepare(`SELECT id, name, mime_type AS mimeType, size, page_count AS pageCount,
      character_count AS characterCount, created_at AS createdAt FROM documents ORDER BY created_at DESC LIMIT 30`).all();
    return Response.json({ documents: rows.results ?? [] });
  } catch (error) {
    return storageError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const form = await request.formData();
    const file = form.get("file");
    const parsed = form.get("parsed");
    if (!(file instanceof File) || typeof parsed !== "string") {
      return Response.json({ error: "file and parsed document data are required." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) return Response.json({ error: "File exceeds the 20 MB limit." }, { status: 413 });
    const metadata = JSON.parse(parsed) as { id?: string; pages?: unknown[]; text?: string; mimeType?: string };
    if (!metadata.id || !Array.isArray(metadata.pages) || typeof metadata.text !== "string") {
      return Response.json({ error: "Parsed document data is invalid." }, { status: 400 });
    }
    const id = metadata.id;
    const originalKey = `documents/${id}/original`;
    const parsedKey = `documents/${id}/parsed.json`;
    const originalBytes = await file.arrayBuffer();
    await Promise.all([
      DOCUMENTS.put(originalKey, originalBytes, { httpMetadata: { contentType: file.type || metadata.mimeType } }),
      DOCUMENTS.put(parsedKey, JSON.stringify(metadata), { httpMetadata: { contentType: "application/json" } }),
    ]);
    const createdAt = Date.now();
    await DB.prepare(`INSERT INTO documents
      (id, name, mime_type, size, page_count, character_count, original_key, parsed_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, file.name, file.type || metadata.mimeType || "application/octet-stream", file.size, metadata.pages.length, metadata.text.length, originalKey, parsedKey, createdAt)
      .run();
    return Response.json({ document: { id, name: file.name, size: file.size, pageCount: metadata.pages.length, characterCount: metadata.text.length, createdAt } }, { status: 201 });
  } catch (error) {
    return storageError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const payload = await request.json() as { id?: string };
    if (!payload.id) return Response.json({ error: "id is required." }, { status: 400 });
    const row = await DB.prepare("SELECT original_key AS originalKey, parsed_key AS parsedKey FROM documents WHERE id = ?")
      .bind(payload.id).first<{ originalKey: string; parsedKey: string }>();
    if (row) await Promise.all([DOCUMENTS.delete(row.originalKey), DOCUMENTS.delete(row.parsedKey)]);
    await DB.batch([
      DB.prepare("DELETE FROM pipeline_runs WHERE document_id = ?").bind(payload.id),
      DB.prepare("DELETE FROM documents WHERE id = ?").bind(payload.id),
    ]);
    return Response.json({ deleted: true });
  } catch (error) {
    return storageError(error);
  }
}

function storageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Storage request failed.";
  return Response.json({ error: message, code: "STORAGE_UNAVAILABLE" }, { status: 503 });
}
