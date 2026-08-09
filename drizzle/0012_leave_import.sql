DROP INDEX IF EXISTS `idx_leave_choices_campaign_guard_category`;
CREATE UNIQUE INDEX IF NOT EXISTS `idx_leave_choices_campaign_guard_date`
ON `leave_choices` (`campaign_id`,`guard_id`,`date`);
