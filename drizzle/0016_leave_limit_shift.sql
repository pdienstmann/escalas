ALTER TABLE `leave_day_limits` ADD COLUMN `shift` text;
DROP INDEX IF EXISTS `idx_leave_limits_campaign_date_platoon`;
CREATE UNIQUE INDEX IF NOT EXISTS `idx_leave_limits_campaign_date_platoon_shift`
ON `leave_day_limits` (`campaign_id`,`date`,`platoon`,`shift`);
