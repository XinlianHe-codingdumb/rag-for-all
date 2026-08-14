export type ChunkStrategy = "Recursive" | "Sentence" | "Fixed token";
export type RetrievalMethod = "Vector" | "Hybrid" | "Keyword";

export type DocumentPage = {
  pageNumber: number;
  text: string;
};

export type ParsedDocument = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  text: string;
  pages: DocumentPage[];
  warnings: string[];
  parsedAt: string;
  persisted: boolean;
};

export type PipelineConfig = {
  chunkSize: number;
  overlap: number;
  topK: number;
  method: RetrievalMethod;
  strategy: ChunkStrategy;
};

export type RagChunk = {
  id: number;
  text: string;
  tokenCount: number;
  pageStart: number;
  pageEnd: number;
};

export type RankedChunk = RagChunk & {
  score: number;
  vectorScore: number;
  keywordScore: number;
  rank: number;
};

export type EmbeddingState = {
  vectors: number[][];
  queryVector: number[];
  source: "OpenAI" | "Local TF-IDF";
  model: string;
  inputTokens?: number;
};

export type AnswerState = {
  text: string;
  source: "OpenAI" | "Extractive fallback";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
};

export type StoredDocument = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  pageCount: number;
  characterCount: number;
  createdAt: number;
};
