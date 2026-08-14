import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    pageCount: integer("page_count").notNull(),
    characterCount: integer("character_count").notNull(),
    originalKey: text("original_key").notNull(),
    parsedKey: text("parsed_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_documents_created_at").on(table.createdAt)],
);

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    experiment: text("experiment").notNull(),
    query: text("query").notNull(),
    configJson: text("config_json").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_pipeline_runs_document_id").on(table.documentId),
    index("idx_pipeline_runs_created_at").on(table.createdAt),
  ],
);
