CREATE TABLE `overtime_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `assignment_id` integer REFERENCES `assignments`(`id`),
  `guard_id` integer NOT NULL REFERENCES `guards`(`id`),
  `service_date` text NOT NULL,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `planned_minutes` integer NOT NULL,
  `confirmed_minutes` integer,
  `status` text DEFAULT 'pending' NOT NULL,
  `source` text DEFAULT 'schedule' NOT NULL,
  `location` text,
  `request_ref` text,
  `notes` text,
  `confirmed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_overtime_entries_assignment` ON `overtime_entries` (`assignment_id`);
--> statement-breakpoint
CREATE INDEX `idx_overtime_entries_guard_date` ON `overtime_entries` (`guard_id`,`service_date`);
--> statement-breakpoint
CREATE INDEX `idx_overtime_entries_status_date` ON `overtime_entries` (`status`,`service_date`);
--> statement-breakpoint
PRAGMA optimize;
