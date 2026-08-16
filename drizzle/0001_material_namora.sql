CREATE TABLE `api_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bucket` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_api_rate_limits_owner_bucket` ON `api_rate_limits` (`owner_id`,`bucket`);--> statement-breakpoint
CREATE INDEX `idx_api_rate_limits_window_start` ON `api_rate_limits` (`window_start`);--> statement-breakpoint
ALTER TABLE `documents` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `idx_documents_owner_created_at` ON `documents` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `owner_id` text;--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_owner_created_at` ON `pipeline_runs` (`owner_id`,`created_at`);