-- Remove apenas a massa fictícia criada por scripts/stress-test.mjs.
-- Altere os marcadores abaixo se STRESS_MONTH ou STRESS_TAG forem sobrescritos.
DELETE FROM movements
WHERE request_ref LIKE 'STRESS-GMNH-203111-%';

DELETE FROM movements
WHERE request_ref IN (
  SELECT 'FOLGA-' || c.id
  FROM leave_choices c
  JOIN leave_campaigns campaign ON campaign.id = c.campaign_id
  WHERE campaign.month = '2031-11'
);

DELETE FROM leave_day_limits
WHERE campaign_id IN (SELECT id FROM leave_campaigns WHERE month = '2031-11');

DELETE FROM leave_choices
WHERE campaign_id IN (SELECT id FROM leave_campaigns WHERE month = '2031-11');

DELETE FROM leave_campaigns
WHERE month = '2031-11';

DELETE FROM audit_events
WHERE after_json LIKE '%STRESS-GMNH-203111%'
   OR (action = 'import' AND entity_type = 'leave_choice' AND after_json LIKE '%2031-11%');

-- Escalas abertas automaticamente durante as provas de concorrência.
DELETE FROM operation_slot_origins WHERE slot_id IN (SELECT os.id FROM operation_slots os JOIN operations o ON o.id=os.operation_id JOIN schedules s ON s.id=o.schedule_id WHERE (s.date>='2031-11-01' AND s.date<'2031-12-01') OR s.date IN ('2032-01-15','2032-01-16'));
DELETE FROM operation_slots WHERE operation_id IN (SELECT o.id FROM operations o JOIN schedules s ON s.id=o.schedule_id WHERE (s.date>='2031-11-01' AND s.date<'2031-12-01') OR s.date IN ('2032-01-15','2032-01-16'));
DELETE FROM operation_vehicles WHERE operation_id IN (SELECT o.id FROM operations o JOIN schedules s ON s.id=o.schedule_id WHERE (s.date>='2031-11-01' AND s.date<'2031-12-01') OR s.date IN ('2032-01-15','2032-01-16'));
DELETE FROM operations WHERE schedule_id IN (SELECT id FROM schedules WHERE (date>='2031-11-01' AND date<'2031-12-01') OR date IN ('2032-01-15','2032-01-16'));
DELETE FROM overtime_entries WHERE assignment_id IN (SELECT a.id FROM assignments a JOIN schedules s ON s.id=a.schedule_id WHERE (s.date>='2031-11-01' AND s.date<'2031-12-01') OR s.date IN ('2032-01-15','2032-01-16'));
DELETE FROM assignments WHERE schedule_id IN (SELECT id FROM schedules WHERE (date>='2031-11-01' AND date<'2031-12-01') OR date IN ('2032-01-15','2032-01-16'));
DELETE FROM schedule_patterns WHERE schedule_id IN (SELECT id FROM schedules WHERE (date>='2031-11-01' AND date<'2031-12-01') OR date IN ('2032-01-15','2032-01-16'));
DELETE FROM schedule_resource_exclusions WHERE schedule_id IN (SELECT id FROM schedules WHERE (date>='2031-11-01' AND date<'2031-12-01') OR date IN ('2032-01-15','2032-01-16'));
DELETE FROM vehicle_return_reconciliations WHERE schedule_id IN (SELECT id FROM schedules WHERE (date>='2031-11-01' AND date<'2031-12-01') OR date IN ('2032-01-15','2032-01-16'));
DELETE FROM schedules WHERE (date>='2031-11-01' AND date<'2031-12-01') OR date IN ('2032-01-15','2032-01-16');
