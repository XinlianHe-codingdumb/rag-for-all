CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_name` text NOT NULL,
	`section` text,
	`path` text NOT NULL,
	`properties_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_analytics_events_created_at` ON `analytics_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_analytics_events_event_created_at` ON `analytics_events` (`event_name`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_analytics_events_session_created_at` ON `analytics_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
