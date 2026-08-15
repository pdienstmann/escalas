import { defaultOperationalGroupStart, operationalGroupAnchorShift, operationalGroupInterval, timeAfterHours } from "./operational-group-schedule";

export const patternDefs = [
  { code: "D1", name: "Diurno · Padrão 1", period: "day", parity: 0 },
  { code: "D2", name: "Diurno · Padrão 2", period: "day", parity: 1 },
  { code: "N1", name: "Noturno · Padrão 1", period: "night", parity: 0 },
  { code: "N2", name: "Noturno · Padrão 2", period: "night", parity: 1 },
];

function times(date: string, shift: string) {
  const map: Record<string, [string, string]> = {
      "2": ["07:00", "13:00"],
      "3": ["13:00", "19:00"],
      "4": ["19:00", "01:00"],
      "1": ["01:00", "07:00"],
    },
    next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const [start, end] = map[shift];
  return {
    start: `${date}T${start}`,
    end: `${shift === "4" ? next.toISOString().slice(0, 10) : date}T${end}`,
  };
}

let patternsReady: Promise<void> | null = null;

async function preparePatterns(db: D1Database) {
  const ready=await db.prepare("SELECT (SELECT COUNT(*) FROM shift_patterns WHERE active=1) patterns,(SELECT COUNT(DISTINCT pattern_id) FROM pattern_slots) populated").first<{patterns:number;populated:number}>();
  if(Number(ready?.patterns||0)>=4&&Number(ready?.populated||0)>=4)return;
  await db.batch(
    patternDefs.map((d) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO shift_patterns (code,name,period,parity,anchor_date) VALUES (?,?,?,?,?)",
        )
        .bind(d.code, d.name, d.period, d.parity, "2026-08-12"),
    ),
  );
  const patterns = (
    await db
      .prepare(
        "SELECT * FROM shift_patterns WHERE active=1 ORDER BY period,parity",
      )
      .all<Record<string, unknown>>()
  ).results;
  const posts = (
    await db
      .prepare("SELECT id FROM posts WHERE active=1 ORDER BY sort_order,id")
      .all<{ id: number }>()
  ).results;
  const vehicles = (
    await db
      .prepare("SELECT id,type FROM vehicles WHERE active=1 ORDER BY prefix")
      .all<{ id: number; type: string | null }>()
  ).results;
  const available = [
    ...posts.map((p) => ({ postId: p.id, vehicleId: null, role: "guard" })),
    ...vehicles.flatMap((v) => String(v.type || "").toLowerCase() === "moto"
      ? [{ postId: null, vehicleId: v.id, role: "driver" }]
      : [
          { postId: null, vehicleId: v.id, role: "driver" },
          { postId: null, vehicleId: v.id, role: "patrol" },
        ]),
  ];
  for (const pattern of patterns) {
    const count = await db
      .prepare("SELECT COUNT(*) total FROM pattern_slots WHERE pattern_id=?")
      .bind(pattern.id)
      .first<{ total: number }>();
    if (Number(count?.total || 0) > 0) continue;
    const guards = (
      await db
        .prepare(
          "SELECT id FROM guards WHERE active=1 AND platoon=? ORDER BY name",
        )
        .bind(pattern.code)
        .all<{ id: number }>()
    ).results;
    const slots = available.slice(0, guards.length);
    if (slots.length)
      await db.batch(
        slots.map((slot, index) =>
          db
            .prepare(
              "INSERT INTO pattern_slots (pattern_id,guard_id,post_id,vehicle_id,shift,role) VALUES (?,?,?,?,?,?)",
            )
            .bind(
              pattern.id,
              guards[index].id,
              slot.postId,
              slot.vehicleId,
              null,
              slot.role,
            ),
        ),
      );
  }
}

export async function ensurePatterns(db: D1Database) {
  if (!patternsReady) {
    patternsReady = preparePatterns(db).catch((error) => {
      patternsReady = null;
      throw error;
    });
  }
  await patternsReady;
}

export async function resolvePatternCodes(db: D1Database, date: string) {
  await ensurePatterns(db);
  const anchorRow = await db
    .prepare("SELECT anchor_date FROM shift_patterns WHERE code='D1'")
    .first<{ anchor_date: string }>();
  const anchorDate = anchorRow?.anchor_date || "2026-08-12";
  const diff = Math.round(
    (new Date(`${date}T12:00:00Z`).getTime() -
      new Date(`${anchorDate}T12:00:00Z`).getTime()) /
      86400000,
  );
  const parity = ((diff % 2) + 2) % 2;
  return {
    anchorDate,
    parity,
    dayCode: parity === 0 ? "D1" : "D2",
    nightCode: parity === 0 ? "N1" : "N2",
  };
}

export async function applyPatternsToSchedule(
  db: D1Database,
  date: string,
  scheduleId: number,
  options: { replace?: boolean; dayCode?: string; nightCode?: string } = {},
) {
  const automatic = await resolvePatternCodes(db, date),
    dayCode = options.dayCode || automatic.dayCode,
    nightCode = options.nightCode || automatic.nightCode;
  const existing = await db
    .prepare("SELECT COUNT(*) total FROM assignments WHERE schedule_id=?")
    .bind(scheduleId)
    .first<{ total: number }>();
  if (Number(existing?.total || 0) > 0 && !options.replace)
    return { ...automatic, dayCode, nightCode, applied: false };
  if (options.replace)
    await db
      .prepare("DELETE FROM assignments WHERE schedule_id=?")
      .bind(scheduleId)
      .run();
  const patterns = (
    await db
      .prepare("SELECT id,code,period FROM shift_patterns WHERE code IN (?,?)")
      .bind(dayCode, nightCode)
      .all<Record<string, unknown>>()
  ).results;
  // A GM linked to a grupamento in the selected pattern is owned by that
  // section of the scale.  Carry the selected turn/VTR into the generated
  // assignment so the daily view does not duplicate the person in the
  // conventional post list.
  const groupAssignmentsByPattern = new Map<number, Record<string, unknown>[]>();
  for (const pattern of patterns) {
    const rows = (
      await db.prepare("SELECT m.resource_id,m.shift,m.vehicle_id,m.starts_at,m.ends_at FROM pattern_operational_group_members m JOIN guards g ON g.id=m.resource_id AND g.active=1 AND COALESCE(g.work_regime,'12x36')='12x36' WHERE m.pattern_id=? AND m.resource_kind='guard'")
        .bind(pattern.id)
        .all<Record<string, unknown>>()
    ).results;
    groupAssignmentsByPattern.set(Number(pattern.id), rows);
  }
  const vehicleTypes = new Map(
    (await db.prepare("SELECT id,type FROM vehicles WHERE active=1").all<{ id: number; type: string | null }>()).results
      .map((vehicle) => [Number(vehicle.id), String(vehicle.type || "")]),
  );
  const commands: D1PreparedStatement[] = [];
  for (const pattern of patterns) {
    const slots = (
        await db
          .prepare("SELECT s.* FROM pattern_slots s JOIN guards g ON g.id=s.guard_id AND g.active=1 AND COALESCE(g.work_regime,'12x36')='12x36' WHERE s.pattern_id=?")
          .bind(pattern.id)
          .all<Record<string, unknown>>()
      ).results,
      shifts = pattern.period === "day" ? ["2", "3"] : ["4", "1"],
      groupRows = groupAssignmentsByPattern.get(Number(pattern.id)) || [],
      groupGuardIds = new Set(groupRows.map((row) => Number(row.resource_id)));

    // Conventional positions remain split into the two visible six-hour
    // quadrants. A GM owned by a grupamento is generated below as one
    // continuous 12-hour assignment, so it can cross any quadrant cleanly.
    for (const slot of slots.filter((item) => !groupGuardIds.has(Number(item.guard_id)))) {
      // A null shift means the position repeats in both turns of the period.
      // Imported pattern sheets can override it with a single turn (for
      // example, Rodoviária has a different GM in the 2º and 3º turns).
      const targetShifts = slot.shift && shifts.includes(String(slot.shift))
        ? [String(slot.shift)]
        : shifts;
      for (const shift of targetShifts) {
        const t = times(date, shift);
        commands.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              scheduleId,
              slot.guard_id,
              slot.post_id,
              slot.vehicle_id,
              shift,
              slot.role,
              t.start,
              t.end,
              "normal",
            ),
        );
      }
    }

    const slotByGuard = new Map(slots.map((slot) => [Number(slot.guard_id), slot]));
    const usedVehicleRoles = new Map<number, Set<string>>();
    for (const groupAssignment of groupRows) {
      const guardId = Number(groupAssignment.resource_id);
      if (!guardId) continue;
      const slot = slotByGuard.get(guardId);
      const vehicleId = groupAssignment.vehicle_id != null ? Number(groupAssignment.vehicle_id) : null;
      let role = vehicleId ? String(slot?.role || "") : "guard";
      if (vehicleId) {
        const used = usedVehicleRoles.get(vehicleId) || new Set<string>();
        if (vehicleTypes.get(vehicleId) === "moto") role = "driver";
        else if (!["driver", "patrol", "third"].includes(role) || used.has(role)) role = !used.has("driver") ? "driver" : !used.has("patrol") ? "patrol" : "third";
        used.add(role);
        usedVehicleRoles.set(vehicleId, used);
      }
      const startsAt = String(groupAssignment.starts_at || defaultOperationalGroupStart(pattern.period));
      const endsAt = String(groupAssignment.ends_at || timeAfterHours(startsAt, 12));
      const interval = operationalGroupInterval(date, pattern.period, startsAt, endsAt);
      if (!interval) continue;
      commands.push(db.prepare(
        "INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,?)",
      ).bind(scheduleId, guardId, null, vehicleId, operationalGroupAnchorShift(startsAt), role, interval.start, interval.end, "normal"));
    }
  }
  if (commands.length) await db.batch(commands);
  const day = patterns.find((p) => p.code === dayCode),
    night = patterns.find((p) => p.code === nightCode);
  if (day && night)
    await db
      .prepare(
        "INSERT INTO schedule_patterns (schedule_id,day_pattern_id,night_pattern_id,applied_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(schedule_id) DO UPDATE SET day_pattern_id=excluded.day_pattern_id,night_pattern_id=excluded.night_pattern_id,applied_at=CURRENT_TIMESTAMP",
      )
      .bind(scheduleId, day.id, night.id)
      .run();
  return { ...automatic, dayCode, nightCode, applied: commands.length > 0 };
}

export async function applyWeeklyToSchedule(db:D1Database,date:string,scheduleId:number,guardId?:number) {
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  if(weekday===0||weekday===6)return 0;
  const slots=(await db.prepare("SELECT w.* FROM weekly_slots w JOIN guards g ON g.id=w.guard_id WHERE w.active=1 AND g.active=1 AND (? IS NULL OR w.guard_id=?) AND instr(','||w.weekdays||',',','||?||',')>0 AND (w.vehicle_id IS NULL OR NOT EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=w.vehicle_id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)))").bind(guardId||null,guardId||null,String(weekday),date,date).all<Record<string,unknown>>()).results;
  const statements:D1PreparedStatement[]=[];
  for(const slot of slots){
    const end=String(slot.overtime_end||slot.regular_end);
    statements.push(db.prepare("INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,break_starts_at,break_ends_at,work_kind,status,request_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(scheduleId,slot.guard_id,slot.post_id,slot.vehicle_id,"W",slot.role,`${date}T${slot.starts_at}`,`${date}T${end}`,`${date}T${slot.regular_end}`,slot.break_start?`${date}T${slot.break_start}`:null,slot.break_end?`${date}T${slot.break_end}`:null,"weekly",slot.overtime_end?"overtime":"normal",slot.overtime_end?`HE semanal após ${slot.regular_end}`:null));
  }
  if(statements.length)await db.batch(statements);
  return statements.length;
}

/** Keep an existing day synchronized with the current weekly registry. */
export async function reconcileWeeklySchedule(db:D1Database,date:string,scheduleId:number) {
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  const mismatch=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM assignments a WHERE a.schedule_id=? AND (
      a.work_kind='weekly' AND NOT EXISTS (
        SELECT 1 FROM weekly_slots w JOIN guards g ON g.id=w.guard_id AND g.active=1
        WHERE w.active=1 AND w.guard_id=a.guard_id AND instr(','||w.weekdays||',',','||?||',')>0
          AND COALESCE(w.post_id,0)=COALESCE(a.post_id,0) AND COALESCE(w.vehicle_id,0)=COALESCE(a.vehicle_id,0)
          AND a.starts_at=?||'T'||w.starts_at AND substr(a.regular_ends_at,12,5)=w.regular_end
          AND substr(a.ends_at,12,5)=COALESCE(w.overtime_end,w.regular_end)
      )
      OR COALESCE(a.work_kind,'shift') NOT IN ('weekly','overtime_extension','time_bank_positive') AND EXISTS (
        SELECT 1 FROM weekly_slots w WHERE w.active=1 AND w.guard_id=a.guard_id
      )
    )) +
    (SELECT COUNT(*) FROM weekly_slots w JOIN guards g ON g.id=w.guard_id AND g.active=1
      WHERE w.active=1 AND instr(','||w.weekdays||',',','||?||',')>0 AND NOT EXISTS (
        SELECT 1 FROM assignments a WHERE a.schedule_id=? AND a.guard_id=w.guard_id AND a.work_kind='weekly'
          AND COALESCE(a.post_id,0)=COALESCE(w.post_id,0) AND COALESCE(a.vehicle_id,0)=COALESCE(w.vehicle_id,0)
          AND a.starts_at=?||'T'||w.starts_at AND substr(a.regular_ends_at,12,5)=w.regular_end
          AND substr(a.ends_at,12,5)=COALESCE(w.overtime_end,w.regular_end)
      )) total`).bind(scheduleId,String(weekday),date,String(weekday),scheduleId,date).first<{total:number}>();
  if(Number(mismatch?.total||0)===0)return 0;
  await db.prepare(`DELETE FROM assignments WHERE schedule_id=? AND (
    work_kind='weekly' OR guard_id IN (SELECT guard_id FROM weekly_slots WHERE active=1)
      AND COALESCE(work_kind,'shift') NOT IN ('overtime_extension','time_bank_positive')
  )`).bind(scheduleId).run();
  return applyWeeklyToSchedule(db,date,scheduleId);
}

/** Replace already generated 12x36 blocks with this GM's weekly routine. */
export async function reconcileWeeklyGuardSchedules(db:D1Database,guardId:number) {
  await db.prepare(
    "DELETE FROM assignments WHERE guard_id=? AND COALESCE(work_kind,'shift') NOT IN ('overtime_extension','time_bank_positive')",
  ).bind(guardId).run();
  const result=await db.prepare(`INSERT OR IGNORE INTO assignments
    (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,break_starts_at,break_ends_at,work_kind,status,request_ref)
    SELECT s.id,w.guard_id,w.post_id,w.vehicle_id,'W',w.role,
      s.date||'T'||w.starts_at,
      (CASE WHEN COALESCE(w.overtime_end,w.regular_end)<=w.starts_at THEN date(s.date,'+1 day') ELSE s.date END)||'T'||COALESCE(w.overtime_end,w.regular_end),
      (CASE WHEN w.regular_end<=w.starts_at THEN date(s.date,'+1 day') ELSE s.date END)||'T'||w.regular_end,
      CASE WHEN w.break_start IS NULL THEN NULL ELSE s.date||'T'||w.break_start END,
      CASE WHEN w.break_end IS NULL THEN NULL ELSE s.date||'T'||w.break_end END,
      'weekly',CASE WHEN w.overtime_end IS NOT NULL THEN 'overtime' ELSE 'normal' END,
      CASE WHEN w.overtime_end IS NOT NULL THEN 'HE semanal após '||w.regular_end ELSE NULL END
    FROM schedules s JOIN weekly_slots w ON w.guard_id=? AND w.active=1
    JOIN guards g ON g.id=w.guard_id AND g.active=1
    WHERE instr(','||w.weekdays||',',','||CAST(strftime('%w',s.date) AS TEXT)||',')>0
      AND (w.vehicle_id IS NULL OR NOT EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=w.vehicle_id AND o.active=1 AND o.starts_on<=s.date AND (o.ends_on IS NULL OR o.ends_on>=s.date)))`).bind(guardId).run();
  return { inserted:Number(result.meta.changes||0) };
}

/** Restore a GM removed from the weekly registry to every already generated
 * schedule that uses the GM's recovered 12x36 pattern. Existing day-specific
 * assignments are preserved and prevent a duplicate automatic block. */
export async function restore12x36GuardSchedules(db:D1Database,guardId:number) {
  const slots=(await db.prepare(`SELECT ps.*,p.period FROM pattern_slots ps
    JOIN shift_patterns p ON p.id=ps.pattern_id AND p.active=1
    WHERE ps.guard_id=?`).bind(guardId).all<Record<string,unknown>>()).results;
  if(!slots.length)return {inserted:0};
  const groupRows=(await db.prepare(`SELECT m.pattern_id,m.shift,m.vehicle_id,m.starts_at,m.ends_at
    FROM pattern_operational_group_members m
    WHERE m.resource_kind='guard' AND m.resource_id=?`).bind(guardId).all<Record<string,unknown>>()).results;
  const groupsByPattern=new Map(groupRows.map(row=>[Number(row.pattern_id),row]));
  const statements:D1PreparedStatement[]=[];
  for(const slot of slots){
    const schedules=(await db.prepare(`SELECT s.id,s.date FROM schedules s
      JOIN schedule_patterns sp ON sp.schedule_id=s.id
      WHERE (sp.day_pattern_id=? OR sp.night_pattern_id=?)
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.schedule_id=s.id AND a.guard_id=? AND COALESCE(a.work_kind,'shift') NOT IN ('weekly','overtime_extension','time_bank_positive'))
      ORDER BY s.date`).bind(slot.pattern_id,slot.pattern_id,guardId).all<{id:number;date:string}>()).results;
    const group=groupsByPattern.get(Number(slot.pattern_id));
    for(const schedule of schedules){
      if(group){
        const start=String(group.starts_at||defaultOperationalGroupStart(String(slot.period)));
        const end=String(group.ends_at||timeAfterHours(start,12));
        const interval=operationalGroupInterval(schedule.date,String(slot.period),start,end);
        if(!interval)continue;
        statements.push(db.prepare(`INSERT OR IGNORE INTO assignments
          (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status,work_kind)
          VALUES (?,?,?,?,?,?,?,?,?,'shift')`).bind(schedule.id,guardId,null,group.vehicle_id||null,operationalGroupAnchorShift(start),slot.role,interval.start,interval.end,"normal"));
        continue;
      }
      const shifts=String(slot.period)==="night"?["4","1"]:["2","3"];
      const target=slot.shift&&shifts.includes(String(slot.shift))?[String(slot.shift)]:shifts;
      for(const shift of target){
        const interval=times(schedule.date,shift);
        statements.push(db.prepare(`INSERT OR IGNORE INTO assignments
          (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status,work_kind)
          VALUES (?,?,?,?,?,?,?,?,?,'shift')`).bind(schedule.id,guardId,slot.post_id||null,slot.vehicle_id||null,shift,slot.role,interval.start,interval.end,"normal"));
      }
    }
  }
  if(statements.length)await db.batch(statements);
  return {inserted:statements.length};
}
