ALTER TABLE `guards` ADD `work_regime` text DEFAULT '12x36' NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `is_reassigned` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `reassignment_note` text;
--> statement-breakpoint
CREATE TABLE `weekly_slots` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `guard_id` integer NOT NULL REFERENCES `guards`(`id`), `weekdays` text DEFAULT '1,2,3,4,5' NOT NULL, `post_id` integer REFERENCES `posts`(`id`), `vehicle_id` integer REFERENCES `vehicles`(`id`), `role` text DEFAULT 'guard' NOT NULL, `starts_at` text DEFAULT '08:00' NOT NULL, `break_start` text, `break_end` text, `regular_end` text DEFAULT '17:00' NOT NULL, `overtime_end` text, `active` integer DEFAULT 1 NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_weekly_slots_guard` ON `weekly_slots` (`guard_id`);
--> statement-breakpoint
CREATE INDEX `idx_weekly_slots_active` ON `weekly_slots` (`active`);
--> statement-breakpoint
CREATE TABLE `vehicle_outages` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `vehicle_id` integer NOT NULL REFERENCES `vehicles`(`id`), `starts_on` text NOT NULL, `ends_on` text, `reason` text, `active` integer DEFAULT 1 NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_vehicle_outages_vehicle_period` ON `vehicle_outages` (`vehicle_id`,`starts_on`,`ends_on`);
--> statement-breakpoint
PRAGMA optimize;
