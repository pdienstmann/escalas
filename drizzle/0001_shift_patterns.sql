CREATE TABLE `shift_patterns` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`code` text NOT NULL UNIQUE,`name` text NOT NULL,`period` text NOT NULL,`parity` integer NOT NULL,`anchor_date` text NOT NULL,`active` integer DEFAULT true NOT NULL,`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `pattern_slots` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`pattern_id` integer NOT NULL REFERENCES `shift_patterns`(`id`),`guard_id` integer NOT NULL REFERENCES `guards`(`id`),`post_id` integer REFERENCES `posts`(`id`),`vehicle_id` integer REFERENCES `vehicles`(`id`),`role` text NOT NULL,`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pattern_slots_pattern_guard` ON `pattern_slots` (`pattern_id`,`guard_id`);
--> statement-breakpoint
CREATE TABLE `schedule_patterns` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`schedule_id` integer NOT NULL REFERENCES `schedules`(`id`),`day_pattern_id` integer NOT NULL REFERENCES `shift_patterns`(`id`),`night_pattern_id` integer NOT NULL REFERENCES `shift_patterns`(`id`),`applied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedule_patterns_schedule` ON `schedule_patterns` (`schedule_id`);
--> statement-breakpoint
PRAGMA optimize;
