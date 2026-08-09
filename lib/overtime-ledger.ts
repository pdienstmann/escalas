import { env } from "cloudflare:workers";

export async function syncScheduleOvertime() {
  await env.DB.prepare(
    `DELETE FROM overtime_entries
     WHERE source='schedule' AND status='pending'
       AND (assignment_id IS NULL OR assignment_id NOT IN (SELECT id FROM assignments WHERE status='overtime'))`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO overtime_entries
      (assignment_id,guard_id,service_date,starts_at,ends_at,planned_minutes,status,source,location,request_ref)
     SELECT a.id,a.guard_id,date(a.starts_at),COALESCE(a.regular_ends_at,a.starts_at),a.ends_at,
       CAST(ROUND((julianday(a.ends_at)-julianday(COALESCE(a.regular_ends_at,a.starts_at)))*1440) AS INTEGER),
       'pending','schedule',COALESCE(p.name,v.prefix,'Sem posto'),a.request_ref
     FROM assignments a
     LEFT JOIN posts p ON p.id=a.post_id
     LEFT JOIN vehicles v ON v.id=a.vehicle_id
     LEFT JOIN overtime_month_closures c ON c.month=substr(date(a.starts_at),1,7)
     WHERE a.status='overtime' AND COALESCE(c.status,'open')<>'closed'
     ON CONFLICT(assignment_id) DO UPDATE SET
       guard_id=excluded.guard_id,
       service_date=excluded.service_date,
       starts_at=excluded.starts_at,
       ends_at=excluded.ends_at,
       planned_minutes=excluded.planned_minutes,
       location=excluded.location,
       request_ref=excluded.request_ref,
       updated_at=CURRENT_TIMESTAMP
     WHERE overtime_entries.status='pending'`,
  ).run();
}
