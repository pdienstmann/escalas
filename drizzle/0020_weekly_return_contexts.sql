CREATE TABLE IF NOT EXISTS `weekly_return_contexts` (
  `guard_id` integer PRIMARY KEY NOT NULL REFERENCES `guards`(`id`),
  `pattern_slots_json` text DEFAULT '[]' NOT NULL,
  `pattern_groups_json` text DEFAULT '[]' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
