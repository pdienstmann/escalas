CREATE TABLE `operational_notices` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`effective_date` text NOT NULL,`title` text NOT NULL,`details` text,`status` text DEFAULT 'pending' NOT NULL,`acknowledged_at` text,`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_operational_notices_date_status` ON `operational_notices` (`effective_date`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_assignments_schedule_id` ON `assignments` (`schedule_id`);
--> statement-breakpoint
CREATE INDEX `idx_movements_guard_time` ON `movements` (`guard_id`,`starts_at`,`ends_at`);
--> statement-breakpoint
CREATE INDEX `idx_movements_status_time` ON `movements` (`status`,`starts_at`,`ends_at`);
--> statement-breakpoint
UPDATE `posts` SET `group_name`='SEDE DA GM', `sort_order`=1 WHERE `name` IN ('Sala de Operações','Reserva de Armamento');
--> statement-breakpoint
INSERT INTO `posts` (`name`,`group_name`,`sort_order`) SELECT 'Departamento de Trânsito','SEDE DA GM',3 WHERE NOT EXISTS (SELECT 1 FROM `posts` WHERE `name`='Departamento de Trânsito');
--> statement-breakpoint
INSERT INTO `posts` (`name`,`group_name`,`sort_order`) SELECT 'DALSeg','SEDE DA GM',4 WHERE NOT EXISTS (SELECT 1 FROM `posts` WHERE `name`='DALSeg');
--> statement-breakpoint
INSERT INTO `posts` (`name`,`group_name`,`sort_order`) SELECT 'DEGESP','SEDE DA GM',5 WHERE NOT EXISTS (SELECT 1 FROM `posts` WHERE `name`='DEGESP');
--> statement-breakpoint
INSERT INTO `posts` (`name`,`group_name`,`sort_order`) SELECT 'Acesso principal','SEDE DA GM',6 WHERE NOT EXISTS (SELECT 1 FROM `posts` WHERE `name`='Acesso principal');
--> statement-breakpoint
PRAGMA optimize;
