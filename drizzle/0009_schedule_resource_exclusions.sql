CREATE TABLE IF NOT EXISTS `schedule_resource_exclusions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `schedule_id` integer NOT NULL REFERENCES `schedules`(`id`),
  `resource_kind` text NOT NULL,
  `resource_id` integer NOT NULL,
  `reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_schedule_resource_exclusion`
  ON `schedule_resource_exclusions` (`schedule_id`,`resource_kind`,`resource_id`);

PRAGMA optimize;
