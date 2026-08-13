ALTER TABLE `pattern_operational_group_members` ADD COLUMN `shift` text;
ALTER TABLE `pattern_operational_group_members` ADD COLUMN `vehicle_id` integer REFERENCES `vehicles`(`id`);
ALTER TABLE `pattern_operational_group_members` ADD COLUMN `starts_at` text;
ALTER TABLE `pattern_operational_group_members` ADD COLUMN `ends_at` text;
