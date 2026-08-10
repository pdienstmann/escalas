CREATE TABLE IF NOT EXISTS `service_adjustments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `subtype` text NOT NULL,
  `guard_id` integer NOT NULL REFERENCES `guards`(`id`),
  `counterpart_guard_id` integer REFERENCES `guards`(`id`),
  `service_date` text NOT NULL,
  `starts_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `hours` real,
  `counterpart_service_date` text,
  `counterpart_starts_at` text,
  `counterpart_ends_at` text,
  `settlement_date` text,
  `settlement_starts_at` text,
  `settlement_ends_at` text,
  `settlement_hours` real,
  `request_ref` text,
  `notes` text,
  `status` text DEFAULT 'active' NOT NULL,
  `snapshot_json` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_service_adjustments_date` ON `service_adjustments` (`service_date`,`status`);
CREATE INDEX IF NOT EXISTS `idx_service_adjustments_counterpart_date` ON `service_adjustments` (`counterpart_service_date`,`status`);
CREATE INDEX IF NOT EXISTS `idx_service_adjustments_settlement_date` ON `service_adjustments` (`settlement_date`,`status`);
