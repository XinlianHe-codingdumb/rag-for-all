CREATE TABLE `model_usage_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`owner_id` text,
	`day` text NOT NULL,
	`reserved_tokens` integer NOT NULL,
	`actual_tokens` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_usage_daily_day` ON `model_usage_daily` (`day`);--> statement-breakpoint
CREATE INDEX `idx_model_usage_daily_owner_day` ON `model_usage_daily` (`owner_id`,`day`);