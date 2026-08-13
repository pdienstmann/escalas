CREATE TABLE IF NOT EXISTS `pattern_operational_group_members` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `pattern_id` integer NOT NULL REFERENCES `shift_patterns`(`id`),
  `group_id` integer NOT NULL REFERENCES `operational_groups`(`id`),
  `resource_kind` text NOT NULL,
  `resource_id` integer NOT NULL,
  `team_label` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(`pattern_id`,`resource_kind`,`resource_id`)
);
CREATE INDEX IF NOT EXISTS `idx_pattern_operational_group_members_pattern`
  ON `pattern_operational_group_members` (`pattern_id`,`resource_kind`,`resource_id`);
