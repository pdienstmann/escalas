CREATE TABLE IF NOT EXISTS `service_adjustments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `subtype` text NOT NULL,
  `guard_id` integer NOT NULL REFERENCES `guards`(`id`),
  `counterpart_guard_id` integer REFERENCES `guards`(`id`),
  `service_date` text NOT NULL,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `request_ref` text,
  `notes` text,
  `status` text DEFAULT 'active' NOT NULL,
  `snapshot_json` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_adjustments_date` ON `service_adjustments` (`service_date`,`status`);
