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

export async function ensurePatterns(db: D1Database) {
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
      .prepare("SELECT id FROM vehicles WHERE active=1 ORDER BY prefix")
      .all<{ id: number }>()
  ).results;
  const available = [
    ...posts.map((p) => ({ postId: p.id, vehicleId: null, role: "guard" })),
    ...vehicles.flatMap((v) => [
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
  const groupAssignments = new Map<string, Record<string, unknown>>();
  for (const pattern of patterns) {
    const rows = (
      await db.prepare("SELECT resource_id,shift,vehicle_id,starts_at,ends_at FROM pattern_operational_group_members WHERE pattern_id=? AND resource_kind='guard'")
        .bind(pattern.id)
        .all<Record<string, unknown>>()
    ).results;
    for (const row of rows) groupAssignments.set(`${pattern.id}:${row.resource_id}`, row);
  }
  const commands: D1PreparedStatement[] = [];
  for (const pattern of patterns) {
    const slots = (
        await db
          .prepare("SELECT * FROM pattern_slots WHERE pattern_id=?")
          .bind(pattern.id)
          .all<Record<string, unknown>>()
      ).results,
      shifts = pattern.period === "day" ? ["2", "3"] : ["4", "1"];
    for (const slot of slots) {
      const groupAssignment = groupAssignments.get(`${pattern.id}:${slot.guard_id}`);
      // A null shift means the position repeats in both turns of the period.
      // Imported pattern sheets can override it with a single turn (for
      // example, Rodoviária has a different GM in the 2º and 3º turns).
      const groupShift = String(groupAssignment?.shift || "");
      const targetShifts = groupShift && shifts.includes(groupShift)
        ? [groupShift]
        : slot.shift && shifts.includes(String(slot.shift))
        ? [String(slot.shift)]
        : shifts;
      for (const shift of targetShifts) {
        const t = times(date, shift);
        const customStart = String(groupAssignment?.starts_at || "").trim();
        const customEnd = String(groupAssignment?.ends_at || "").trim();
        const startsAt = customStart ? `${date}T${customStart}` : t.start;
        const endsAt = customEnd ? `${shift === "4" && customEnd < customStart ? new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) : date}T${customEnd}` : t.end;
        // Group-owned guards live only in the group section of the daily
        // scale.  Even when the group member has not received a VTR yet,
        // do not leave the conventional pattern assignment behind (that
        // would render the same GM twice).  The unassigned record remains in
        // the redeployment pool until a destination is chosen.
        const groupOwnsGuard = Boolean(groupAssignment);
        const assignedVehicleId = groupOwnsGuard
          ? (groupAssignment?.vehicle_id != null ? Number(groupAssignment.vehicle_id) : null)
          : slot.vehicle_id;
        const assignedPostId = groupOwnsGuard ? null : slot.post_id;
        commands.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              scheduleId,
              slot.guard_id,
              assignedPostId,
              assignedVehicleId,
              shift,
              slot.role,
              startsAt,
              endsAt,
              "normal",
            ),
        );
      }
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

export async function applyWeeklyToSchedule(db:D1Database,date:string,scheduleId:number) {
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  if(weekday===0||weekday===6)return 0;
  const slots=(await db.prepare("SELECT w.* FROM weekly_slots w JOIN guards g ON g.id=w.guard_id WHERE w.active=1 AND g.active=1 AND instr(','||w.weekdays||',',','||?||',')>0 AND (w.vehicle_id IS NULL OR NOT EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=w.vehicle_id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)))").bind(String(weekday),date,date).all<Record<string,unknown>>()).results;
  const statements:D1PreparedStatement[]=[];
  for(const slot of slots){
    const end=String(slot.overtime_end||slot.regular_end);
    statements.push(db.prepare("INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,break_starts_at,break_ends_at,work_kind,status,request_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(scheduleId,slot.guard_id,slot.post_id,slot.vehicle_id,"W",slot.role,`${date}T${slot.starts_at}`,`${date}T${end}`,`${date}T${slot.regular_end}`,slot.break_start?`${date}T${slot.break_start}`:null,slot.break_end?`${date}T${slot.break_end}`:null,"weekly",slot.overtime_end?"overtime":"normal",slot.overtime_end?`HE semanal após ${slot.regular_end}`:null));
  }
  if(statements.length)await db.batch(statements);
  return statements.length;
}
