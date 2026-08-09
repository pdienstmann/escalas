CREATE TABLE IF NOT EXISTS `vehicle_return_reconciliations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `outage_id` integer NOT NULL REFERENCES `vehicle_outages`(`id`),
  `vehicle_id` integer NOT NULL REFERENCES `vehicles`(`id`),
  `schedule_id` integer NOT NULL REFERENCES `schedules`(`id`),
  `return_on` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `linked_assignments` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_vehicle_return_schedule`
  ON `vehicle_return_reconciliations` (`outage_id`,`schedule_id`);
CREATE INDEX IF NOT EXISTS `idx_vehicle_return_pending`
  ON `vehicle_return_reconciliations` (`schedule_id`,`vehicle_id`,`status`);
