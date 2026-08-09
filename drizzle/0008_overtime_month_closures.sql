CREATE TABLE `overtime_month_closures` (
  `month` text PRIMARY KEY NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `closed_at` text,
  `closure_note` text,
  `reopened_at` text,
  `reopen_reason` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX `idx_overtime_month_closures_status` ON `overtime_month_closures` (`status`);

PRAGMA optimize;
