ALTER TABLE `assignments` ADD `regular_ends_at` text;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `break_starts_at` text;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `break_ends_at` text;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `work_kind` text DEFAULT 'shift' NOT NULL;
--> statement-breakpoint
CREATE TABLE `schedule_sections` (`section_key` text PRIMARY KEY NOT NULL, `label` text NOT NULL, `sort_order` integer DEFAULT 0 NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_schedule_sections_order` ON `schedule_sections` (`sort_order`);
--> statement-breakpoint
PRAGMA optimize;
