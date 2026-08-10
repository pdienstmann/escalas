ALTER TABLE `assignments` ADD COLUMN `lane_order` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assignments_lane_order` ON `assignments` (`schedule_id`,`post_id`,`vehicle_id`,`lane_order`);
