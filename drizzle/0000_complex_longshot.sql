CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`page_count` integer NOT NULL,
	`character_count` integer NOT NULL,
	`original_key` text NOT NULL,
	`parsed_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_documents_created_at` ON `documents` (`created_at`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`experiment` text NOT NULL,
	`query` text NOT NULL,
	`config_json` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_document_id` ON `pipeline_runs` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_created_at` ON `pipeline_runs` (`created_at`);