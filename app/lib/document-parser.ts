import type { ParsedDocument } from "./rag-types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "markdown"]);

export async function parseDocumentFile(file: File): Promise<ParsedDocument> {
  validateFile(file);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let pages: Array<{ pageNumber: number; text: string }> = [];
  const warnings: string[] = [];

  if (extension === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(data);
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text.map((text, index) => ({
      pageNumber: index + 1,
      text: cleanExtractedText(text),
    }));
    const nonEmptyPages = pages.filter((page) => page.text.length > 20).length;
    if (nonEmptyPages < Math.max(1, Math.ceil(result.totalPages * 0.25))) {
      warnings.push("Most pages contain little extractable text. This may be a scanned PDF; OCR is not enabled yet.");
    }
  } else if (extension === "docx") {
    const mammothModule = await import("mammoth");
    const mammoth = mammothModule.default ?? mammothModule;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({
      arrayBuffer,
      // Mammoth's browser build reads `arrayBuffer`; its Node build reads `buffer`.
      // Supplying both keeps parsing consistent in the UI and in server-side tests.
      buffer: new Uint8Array(arrayBuffer),
    } as Parameters<typeof mammoth.extractRawText>[0]);
    pages = [{ pageNumber: 1, text: cleanExtractedText(result.value) }];
    for (const message of result.messages) {
      if (message.type === "warning") warnings.push(message.message);
    }
    warnings.push("DOCX does not expose reliable page numbers after text extraction, so citations use a document-level page marker.");
  } else {
    pages = [{ pageNumber: 1, text: cleanExtractedText(await file.text()) }];
  }

  const text = pages.map((page) => page.text).filter(Boolean).join("\n\n").trim();
  if (!text) throw new Error("No readable text was found in this document.");
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error("The extracted document is too large for this learning workspace. Please use a document under 2 million characters.");
  }

  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || mimeFromExtension(extension),
    size: file.size,
    text,
    pages,
    warnings,
    parsedAt: new Date().toISOString(),
    persisted: false,
  };
}

function validateFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported file type. Use PDF, DOCX, TXT, or Markdown.");
  }
  if (file.size === 0) throw new Error("This file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("This file is larger than the current 20 MB limit.");
}

function cleanExtractedText(value: string) {
  return value
    .replaceAll(String.fromCharCode(0), "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function mimeFromExtension(extension: string) {
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  return "text/plain";
}
