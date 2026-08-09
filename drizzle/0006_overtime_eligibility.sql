ALTER TABLE `guards` ADD `overtime_eligible` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `guards` ADD `overtime_note` text;
--> statement-breakpoint
CREATE INDEX `idx_guards_overtime_eligible` ON `guards` (`active`,`overtime_eligible`);
--> statement-breakpoint
PRAGMA optimize;
