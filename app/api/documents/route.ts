import { ensureStorageSchema, getLaunchPolicy, requireStorageBindings } from "../../../db/runtime";
import { apiError, apiJson, beginApiRequest, readJsonBody, readMultipartBody, type ApiContext } from "../../lib/api-guard";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PARSED_CHARACTERS = 2_000_000;
const MAX_PARSED_JSON_BYTES = 3_000_000;
const MAX_PAGES = 5_000;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + MAX_PARSED_JSON_BYTES + 1_000_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_TYPES: Record<string, { mimeType: string; accepted: Set<string> }> = {
  pdf: { mimeType: "application/pdf", accepted: new Set(["application/pdf", "application/octet-stream"]) },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", accepted: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"]) },
  txt: { mimeType: "text/plain", accepted: new Set(["text/plain", "application/octet-stream"]) },
  md: { mimeType: "text/markdown", accepted: new Set(["text/markdown", "text/plain", "text/x-markdown", "application/octet-stream"]) },
  markdown: { mimeType: "text/markdown", accepted: new Set(["text/markdown", "text/plain", "text/x-markdown", "application/octet-stream"]) },
};

export async function GET(request: Request) {
  const authorization = await beginApiRequest(request, "documents.list", { bucket: "document_list", limit: 120 });
  if (authorization instanceof Response) return authorization;
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const expiredRemoved = await cleanupExpiredDocuments(DB, DOCUMENTS);
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
    const form = await readMultipartBody(request, authorization, MAX_MULTIPART_BYTES);
    if (form instanceof Response) return form;
    const file = form.get("file");
    const parsed = form.get("parsed");
    if (!(file instanceof File) || typeof parsed !== "string") {
      return apiJson(authorization, { error: "file and parsed document data are required." }, { status: 400 });
    }
    if (new TextEncoder().encode(parsed).byteLength > MAX_PARSED_JSON_BYTES) return apiJson(authorization, { error: "Parsed document data is too large." }, { status: 413 });
    if (file.size > MAX_FILE_BYTES) return apiJson(authorization, { error: "File exceeds the 20 MB limit." }, { status: 413 });
    if (file.size === 0) return apiJson(authorization, { error: "The uploaded file is empty." }, { status: 400 });
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const fileType = FILE_TYPES[extension];
    const declaredType = file.type || "application/octet-stream";
    if (!fileType || !fileType.accepted.has(declaredType)) {
      return apiJson(authorization, { error: "This file type is not supported." }, { status: 415 });
    }
    let metadata: { pages?: unknown[]; text?: string; warnings?: unknown; parsedAt?: unknown };
    try {
      metadata = JSON.parse(parsed) as typeof metadata;
    } catch {
      return apiJson(authorization, { error: "Parsed document data is invalid." }, { status: 400 });
    }
    if (!Array.isArray(metadata.pages) || typeof metadata.text !== "string") {
      return apiJson(authorization, { error: "Parsed document data is invalid." }, { status: 400 });
    }
    if (metadata.text.length > MAX_PARSED_CHARACTERS || metadata.pages.length > MAX_PAGES) {
      return apiJson(authorization, { error: "The parsed document exceeds the current processing limit." }, { status: 413 });
    }
    const pages: Array<{ pageNumber: number; text: string }> = [];
    let pageCharacters = 0;
    for (const rawPage of metadata.pages) {
      if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage)) return apiJson(authorization, { error: "Parsed page data is invalid." }, { status: 400 });
      const page = rawPage as { pageNumber?: unknown; text?: unknown };
      if (!Number.isSafeInteger(page.pageNumber) || Number(page.pageNumber) < 1 || typeof page.text !== "string") return apiJson(authorization, { error: "Parsed page data is invalid." }, { status: 400 });
      pageCharacters += page.text.length;
      if (pageCharacters > MAX_PARSED_CHARACTERS) return apiJson(authorization, { error: "Parsed page data exceeds the current processing limit." }, { status: 413 });
      pages.push({ pageNumber: Number(page.pageNumber), text: page.text });
    }
    const originalBytes = await file.arrayBuffer();
    if (!matchesFileSignature(extension, originalBytes)) return apiJson(authorization, { error: "The file contents do not match the selected file type." }, { status: 415 });
    const id = crypto.randomUUID();
    const safeName = sanitizeFileName(file.name);
    const normalizedMetadata = {
      id,
      name: safeName,
      mimeType: fileType.mimeType,
      size: file.size,
      text: metadata.text,
      pages,
      warnings: Array.isArray(metadata.warnings) ? metadata.warnings.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 500)) : [],
      parsedAt: typeof metadata.parsedAt === "string" && Number.isFinite(Date.parse(metadata.parsedAt)) ? metadata.parsedAt : new Date().toISOString(),
      persisted: true,
    };
    const originalKey = `documents/${authorization.actorHash}/${id}/original`;
    const parsedKey = `documents/${authorization.actorHash}/${id}/parsed.json`;
    const createdAt = Date.now();
    try {
      await Promise.all([
        DOCUMENTS.put(originalKey, originalBytes, { httpMetadata: { contentType: fileType.mimeType } }),
        DOCUMENTS.put(parsedKey, JSON.stringify(normalizedMetadata), { httpMetadata: { contentType: "application/json" } }),
      ]);
      await DB.prepare(`INSERT INTO documents
        (id, name, mime_type, size, page_count, character_count, original_key, parsed_key, owner_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, safeName, fileType.mimeType, file.size, pages.length, metadata.text.length, originalKey, parsedKey, authorization.userId, createdAt)
        .run();
    } catch (error) {
      await Promise.allSettled([DOCUMENTS.delete(originalKey), DOCUMENTS.delete(parsedKey)]);
      throw error;
    }
    return apiJson(
      authorization,
      { document: { id, name: safeName, size: file.size, pageCount: pages.length, characterCount: metadata.text.length, createdAt } },
      { status: 201 },
      { fileBytes: file.size, pageCount: pages.length, characterCount: metadata.text.length, expiredRemoved },
    );
  } catch (error) {
    return storageError(authorization, error);
  }
}

export async function DELETE(request: Request) {
  const authorization = await beginApiRequest(request, "documents.delete", { bucket: "document_delete", limit: 60 });
  if (authorization instanceof Response) return authorization;
  try {
    const { DB, DOCUMENTS } = requireStorageBindings();
    await ensureStorageSchema(DB);
    const payload = await readJsonBody<{ id?: string }>(request, authorization, 2_048);
    if (payload instanceof Response) return payload;
    if (!payload.id || !UUID_V4.test(payload.id)) return apiJson(authorization, { error: "A valid document id is required." }, { status: 400 });
    const row = await DB.prepare(`SELECT original_key AS originalKey, parsed_key AS parsedKey FROM documents
      WHERE id = ? AND owner_id = ?`)
      .bind(payload.id, authorization.userId).first<{ originalKey: string; parsedKey: string }>();
    if (!row) return apiJson(authorization, { error: "Document not found." }, { status: 404 });
    if (row) await Promise.all([DOCUMENTS.delete(row.originalKey), DOCUMENTS.delete(row.parsedKey)]);
    await DB.batch([
      DB.prepare("DELETE FROM pipeline_runs WHERE document_id = ? AND owner_id = ?").bind(payload.id, authorization.userId),
      DB.prepare("DELETE FROM documents WHERE id = ? AND owner_id = ?").bind(payload.id, authorization.userId),
    ]);
    return apiJson(authorization, { deleted: true });
  } catch (error) {
    return storageError(authorization, error);
  }
}

export async function cleanupExpiredDocuments(database: D1Database, bucket: R2Bucket) {
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

function sanitizeFileName(value: string) {
  return [...value]
    .map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\" ? "_" : character)
    .join("")
    .trim()
    .slice(0, 180) || "document";
}

function matchesFileSignature(extension: string, buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (extension === "pdf") return new TextDecoder("ascii").decode(bytes.slice(0, 1_024)).includes("%PDF-");
  if (extension === "docx") return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => bytes[2] === a && bytes[3] === b);
  return !bytes.slice(0, Math.min(bytes.length, 8_192)).includes(0);
}

function storageError(context: ApiContext, error: unknown) {
  return apiError(context, error, "Document storage is temporarily unavailable.", "STORAGE_UNAVAILABLE");
}
