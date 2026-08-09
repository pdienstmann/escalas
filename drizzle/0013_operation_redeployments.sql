CREATE TABLE IF NOT EXISTS `operation_slot_origins` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `slot_id` integer NOT NULL REFERENCES `operation_slots`(`id`) ON DELETE CASCADE,
  `assignment_id` integer NOT NULL REFERENCES `assignments`(`id`),
  `post_id` integer REFERENCES `posts`(`id`),
  `vehicle_id` integer REFERENCES `vehicles`(`id`),
  `role` text NOT NULL,
  `was_reassigned` integer DEFAULT 0 NOT NULL,
  `reassignment_note` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_operation_slot_origin_unique`
  ON `operation_slot_origins` (`slot_id`,`assignment_id`);
CREATE INDEX IF NOT EXISTS `idx_operation_slot_origins_assignment`
  ON `operation_slot_origins` (`assignment_id`,`slot_id`);
