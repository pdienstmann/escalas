CREATE TABLE `users` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL UNIQUE, `name` text NOT NULL, `role` text DEFAULT 'viewer' NOT NULL, `active` integer DEFAULT true NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `guards` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `registration` text NOT NULL UNIQUE, `name` text NOT NULL, `platoon` text, `base_shift` text, `active` integer DEFAULT true NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `posts` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `name` text NOT NULL, `group_name` text NOT NULL, `sort_order` integer DEFAULT 0 NOT NULL, `active` integer DEFAULT true NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `vehicles` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `prefix` text NOT NULL UNIQUE, `type` text NOT NULL, `zone` text, `active` integer DEFAULT true NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `schedules` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `date` text NOT NULL, `status` text DEFAULT 'draft' NOT NULL, `published_at` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_schedules_date` ON `schedules` (`date`);
--> statement-breakpoint
CREATE TABLE `assignments` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `schedule_id` integer NOT NULL REFERENCES `schedules`(`id`), `guard_id` integer NOT NULL REFERENCES `guards`(`id`), `post_id` integer REFERENCES `posts`(`id`), `vehicle_id` integer REFERENCES `vehicles`(`id`), `shift` text NOT NULL, `role` text DEFAULT 'guard' NOT NULL, `starts_at` text NOT NULL, `ends_at` text NOT NULL, `status` text DEFAULT 'normal' NOT NULL, `request_ref` text, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assignments_schedule_guard_time` ON `assignments` (`schedule_id`,`guard_id`,`starts_at`);
--> statement-breakpoint
CREATE TABLE `movements` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `guard_id` integer NOT NULL REFERENCES `guards`(`id`), `type` text NOT NULL, `starts_at` text NOT NULL, `ends_at` text NOT NULL, `request_ref` text, `notes` text, `status` text DEFAULT 'approved' NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `leave_campaigns` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `month` text NOT NULL UNIQUE, `title` text NOT NULL, `weekday_quota` integer DEFAULT 1 NOT NULL, `weekend_quota` integer DEFAULT 1 NOT NULL, `status` text DEFAULT 'draft' NOT NULL, `access_code` text NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE TABLE `leave_day_limits` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `campaign_id` integer NOT NULL REFERENCES `leave_campaigns`(`id`), `date` text NOT NULL, `platoon` text, `capacity` integer NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leave_limits_campaign_date_platoon` ON `leave_day_limits` (`campaign_id`,`date`,`platoon`);
--> statement-breakpoint
CREATE TABLE `leave_choices` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `campaign_id` integer NOT NULL REFERENCES `leave_campaigns`(`id`), `guard_id` integer NOT NULL REFERENCES `guards`(`id`), `date` text NOT NULL, `category` text NOT NULL, `status` text NOT NULL, `position` integer, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_leave_choices_campaign_guard_category` ON `leave_choices` (`campaign_id`,`guard_id`,`category`);
--> statement-breakpoint
PRAGMA optimize;
