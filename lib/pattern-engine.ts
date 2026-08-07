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
              "INSERT INTO pattern_slots (pattern_id,guard_id,post_id,vehicle_id,role) VALUES (?,?,?,?,?)",
            )
            .bind(
              pattern.id,
              guards[index].id,
              slot.postId,
              slot.vehicleId,
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
  const commands: D1PreparedStatement[] = [];
  for (const pattern of patterns) {
    const slots = (
        await db
          .prepare("SELECT * FROM pattern_slots WHERE pattern_id=?")
          .bind(pattern.id)
          .all<Record<string, unknown>>()
      ).results,
      shifts = pattern.period === "day" ? ["2", "3"] : ["4", "1"];
    for (const slot of slots)
      for (const shift of shifts) {
        const t = times(date, shift);
        commands.push(
          db
            .prepare(
              "INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,?)",
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
    statements.push(db.prepare("INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status,request_ref) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(scheduleId,slot.guard_id,slot.post_id,slot.vehicle_id,"W",slot.role,`${date}T${slot.starts_at}`,`${date}T${end}`,slot.overtime_end?"overtime":"normal",slot.overtime_end?`HE semanal após ${slot.regular_end}`:null));
  }
  if(statements.length)await db.batch(statements);
  return statements.length;
}
