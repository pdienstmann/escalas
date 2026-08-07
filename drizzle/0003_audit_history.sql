CREATE TABLE `audit_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `action` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text,
  `summary` text NOT NULL,
  `before_json` text,
  `after_json` text,
  `actor_id` text NOT NULL,
  `actor_email` text NOT NULL,
  `actor_name` text NOT NULL,
  `undoable` integer DEFAULT 0 NOT NULL,
  `undone_at` text,
  `undone_by_id` text,
  `undone_by_email` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_created_at` ON `audit_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_entity` ON `audit_events` (`entity_type`,`entity_id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_actor` ON `audit_events` (`actor_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
