CREATE TABLE IF NOT EXISTS `operations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `schedule_id` integer NOT NULL REFERENCES `schedules`(`id`),
  `title` text NOT NULL,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `location` text,
  `commander` text,
  `reference` text,
  `notes` text,
  `requested_guards` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_operations_schedule_time`
  ON `operations` (`schedule_id`,`starts_at`,`ends_at`);

CREATE TABLE IF NOT EXISTS `operation_vehicles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `operation_id` integer NOT NULL REFERENCES `operations`(`id`) ON DELETE CASCADE,
  `vehicle_id` integer NOT NULL REFERENCES `vehicles`(`id`),
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_operation_vehicle_unique`
  ON `operation_vehicles` (`operation_id`,`vehicle_id`);
CREATE INDEX IF NOT EXISTS `idx_operation_vehicles_vehicle`
  ON `operation_vehicles` (`vehicle_id`,`operation_id`);

CREATE TABLE IF NOT EXISTS `operation_slots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `operation_id` integer NOT NULL REFERENCES `operations`(`id`) ON DELETE CASCADE,
  `operation_vehicle_id` integer REFERENCES `operation_vehicles`(`id`) ON DELETE CASCADE,
  `role` text DEFAULT 'guard' NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `guard_id` integer REFERENCES `guards`(`id`),
  `source_type` text DEFAULT 'pending' NOT NULL,
  `origin_assignment_id` integer REFERENCES `assignments`(`id`),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_operation_slots_operation`
  ON `operation_slots` (`operation_id`,`operation_vehicle_id`,`position`);
CREATE INDEX IF NOT EXISTS `idx_operation_slots_guard`
  ON `operation_slots` (`guard_id`,`operation_id`);
