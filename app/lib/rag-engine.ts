import { countTokens, decode, encode } from "gpt-tokenizer";
import type {
  DocumentPage,
  EmbeddingState,
  ParsedDocument,
  PipelineConfig,
  RagChunk,
  RankedChunk,
} from "./rag-types";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from",
  "how", "i", "in", "is", "it", "my", "of", "on", "or", "that", "the", "this", "to",
  "was", "what", "when", "where", "which", "who", "with", "you", "your",
]);

export function createChunks(document: ParsedDocument, config: PipelineConfig): RagChunk[] {
  const units = document.pages.flatMap((page) => splitPage(page, config.strategy));
  const chunks: RagChunk[] = [];
  let buffer: number[] = [];
  let pageStart = 1;
  let pageEnd = 1;

  const flush = () => {
    if (!buffer.length) return;
    const text = decode(buffer).trim();
    if (text) {
      chunks.push({
        id: chunks.length + 1,
        text,
        tokenCount: buffer.length,
        pageStart,
        pageEnd,
      });
    }
    const overlap = Math.min(config.overlap, Math.max(0, buffer.length - 1));
    buffer = overlap ? buffer.slice(-overlap) : [];
    pageStart = pageEnd;
  };

  for (const unit of units) {
    const tokens = encode(unit.text);
    let cursor = 0;
    while (cursor < tokens.length) {
      if (!buffer.length) pageStart = unit.pageNumber;
      pageEnd = unit.pageNumber;
      const capacity = Math.max(1, config.chunkSize - buffer.length);
      const take = tokens.slice(cursor, cursor + capacity);
      buffer.push(...take);
      cursor += take.length;
      if (buffer.length >= config.chunkSize) flush();
    }
  }
  flush();
  return chunks;
}

export function countTextTokens(text: string) {
  return countTokens(text);
}

export function createLocalEmbeddings(chunks: RagChunk[], query: string): EmbeddingState {
  const vectors = tfidf([query, ...chunks.map((chunk) => chunk.text)]);
  return {
    queryVector: vectors[0] ?? [],
    vectors: vectors.slice(1),
    source: "Local TF-IDF",
    model: "Browser TF-IDF",
  };
}

export function rankChunks(
  chunks: RagChunk[],
  query: string,
  config: PipelineConfig,
  embeddings: EmbeddingState,
): RankedChunk[] {
  const keyword = bm25Scores(chunks.map((chunk) => chunk.text), query);
  const vector = chunks.map((_, index) => cosine(embeddings.queryVector, embeddings.vectors[index] ?? []));
  const normalizedKeyword = normalizeScores(keyword);
  const normalizedVector = normalizeScores(vector);

  return chunks
    .map((chunk, index) => {
      const vectorScore = normalizedVector[index] ?? 0;
      const keywordScore = normalizedKeyword[index] ?? 0;
      const score = config.method === "Keyword"
        ? keywordScore
        : config.method === "Hybrid"
          ? vectorScore * 0.65 + keywordScore * 0.35
          : vectorScore;
      return { ...chunk, score, vectorScore, keywordScore, rank: 0 };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, Math.min(config.topK, chunks.length))
    .map((chunk, index) => ({ ...chunk, rank: index + 1 }));
}

export function buildPrompt(query: string, ranked: RankedChunk[]) {
  const context = ranked
    .map((item) => `[Chunk ${item.id} | ${pageLabel(item.pageStart, item.pageEnd)}]\n${item.text}`)
    .join("\n\n");
  return `SYSTEM\nAnswer only from the supplied context. Cite chunk IDs in square brackets. If the context is insufficient, say what is missing.\n\nCONTEXT\n${context}\n\nUSER\n${query}`;
}

export function extractiveAnswer(query: string, ranked: RankedChunk[]) {
  const terms = termsFor(query);
  const candidates = ranked.flatMap((chunk) =>
    chunk.text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => ({
        sentence: sentence.trim(),
        chunkId: chunk.id,
        score: terms.reduce((sum, term) => sum + (sentence.toLowerCase().includes(term) ? 1 : 0), 0),
      })),
  );
  const selected = candidates
    .filter((item) => item.sentence.length > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!selected.length) return "The retrieved context does not contain enough readable evidence to answer this question.";
  return selected.map((item) => `${item.sentence} [Chunk ${item.chunkId}]`).join(" ");
}

export function projectVector(vector: number[], index: number) {
  if (!vector.length) return { x: 50, y: 50 };
  let x = 0;
  let y = 0;
  let magnitude = 0;
  vector.forEach((value, dimension) => {
    x += value * Math.sin((dimension + 1) * 12.9898 + index);
    y += value * Math.cos((dimension + 1) * 78.233 + index);
    magnitude += Math.abs(value);
  });
  const scale = Math.max(0.0001, magnitude);
  return {
    x: Math.max(9, Math.min(91, 50 + (x / scale) * 48)),
    y: Math.max(12, Math.min(88, 50 + (y / scale) * 48)),
  };
}

export function pageLabel(start: number, end: number) {
  return start === end ? `Page ${start}` : `Pages ${start}-${end}`;
}

function splitPage(page: DocumentPage, strategy: PipelineConfig["strategy"]) {
  if (strategy === "Fixed token") return [{ pageNumber: page.pageNumber, text: page.text }];
  const pieces = strategy === "Sentence"
    ? page.text.split(/(?<=[.!?])\s+/)
    : page.text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/);
  return pieces
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ pageNumber: page.pageNumber, text: `${text} ` }));
}

function termsFor(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function tfidf(texts: string[]) {
  const documents = texts.map(termsFor);
  const documentFrequency = new Map<string, number>();
  for (const terms of documents) {
    for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const vocabulary = [...documentFrequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 512)
    .map(([term]) => term);
  return documents.map((terms) => {
    const counts = new Map<string, number>();
    terms.forEach((term) => counts.set(term, (counts.get(term) ?? 0) + 1));
    return vocabulary.map((term) => {
      const tf = (counts.get(term) ?? 0) / Math.max(1, terms.length);
      const idf = Math.log((texts.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
      return tf * idf;
    });
  });
}

function bm25Scores(documents: string[], query: string) {
  const tokenized = documents.map(termsFor);
  const queryTerms = termsFor(query);
  const averageLength = tokenized.reduce((sum, terms) => sum + terms.length, 0) / Math.max(1, tokenized.length);
  const k1 = 1.5;
  const b = 0.75;
  return tokenized.map((terms) => {
    const counts = new Map<string, number>();
    terms.forEach((term) => counts.set(term, (counts.get(term) ?? 0) + 1));
    return queryTerms.reduce((score, term) => {
      const frequency = counts.get(term) ?? 0;
      const docsWithTerm = tokenized.filter((doc) => doc.includes(term)).length;
      const idf = Math.log(1 + (documents.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
      const numerator = frequency * (k1 + 1);
      const denominator = frequency + k1 * (1 - b + b * (terms.length / Math.max(1, averageLength)));
      return score + (denominator ? idf * (numerator / denominator) : 0);
    }, 0);
  });
}

function cosine(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

function normalizeScores(scores: number[]) {
  const max = Math.max(...scores, 0);
  if (!max) return scores.map(() => 0);
  return scores.map((score) => score / max);
}
