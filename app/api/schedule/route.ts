import { env } from "cloudflare:workers";
import {
  applyPatternsToSchedule,
  applyWeeklyToSchedule,
  ensurePatterns,
  resolvePatternCodes,
} from "../../../lib/pattern-engine";
import { writeAudit } from "../../../lib/audit";
import { permitted } from "../../../lib/access";
import { isScheduleDate, todayScheduleDate } from "../../../lib/schedule-date";
import { fullPeriodShifts, fullPeriodWindow, shiftTimes as periodShiftTimes, isDayShift, splitExtensionWindow } from "../../../lib/shift-rules";
import { rankGuardSuggestions, describeReasons } from "../../../lib/suggest-gm";
import { hasRequiredVehicleCrew, hasUniqueCrewMembers } from "../../../lib/crew-rules";

export const dynamic = "force-dynamic";


const demoGuards = [
  "ALMEIDA",
  "ANDRADE",
  "AZAMBUJA",
  "BATISTA",
  "BERNARDI",
  "BITTENCOURT",
  "BORGES",
  "BRUNO",
  "CAMARGO",
  "CARLOS",
  "CAVALHEIRO",
  "CIECHORSKI",
  "EDERSON",
  "EDINEI",
  "EVERTON",
  "FIUZA",
  "FONTOURA",
  "GABRIEL",
  "GARCIA",
  "GUILHERME",
  "JAIR",
  "JONATAS",
  "MARIEL",
  "MATHEUS",
  "MOISES",
  "NATAN",
  "PASQUALI",
  "RANIEL",
  "SANTOS",
  "SCHUQUEL",
  "SOBUCKI",
  "WILLYAM",
  "XAVIER",
  "VILSON",
  "VIEIRA",
  "VIGANON",
  "ULISSES",
  "ROCKEMBACH",
  "ROBERTO",
  "POHLMANN",
  "PEDROSA",
  "MIRANDA",
  "MARQUES",
  "MARINES",
  "MAIQUEL",
  "LUIZ",
  "KIRSCH",
  "JOHANN",
  "GRENDELE",
  "EDUARDO",
  "DOUGLAS",
  "DE ALMEIDA",
];

async function ensureCatalog() {
  const [guardCount, vehicleCount, postRows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) total FROM guards").first<{
      total: number;
    }>(),
    env.DB.prepare("SELECT COUNT(*) total FROM vehicles").first<{
      total: number;
    }>(),
    env.DB.prepare("SELECT name FROM posts").all<{ name: string }>(),
  ]);
  if (Number(guardCount?.total || 0) < demoGuards.length)
    await env.DB.batch(
      demoGuards.map((name, index) => {
        const team = ["D1", "D2", "N1", "N2"][
          Math.min(3, Math.floor(index / 13))
        ];
        return env.DB.prepare(
          "INSERT OR IGNORE INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)",
        ).bind(
          `F${String(index + 1).padStart(3, "0")}`,
          name,
          team,
          team.startsWith("D") ? "12x36 dia" : "12x36 noite",
        );
      }),
    );
  const postNames = new Set(postRows.results.map((p) => p.name));
  const newPosts = [
    ["Sala de Operações", "SEDE DA GM", 1],
    ["Reserva de Armamento", "SEDE DA GM", 2],
    ["Departamento de Trânsito", "SEDE DA GM", 3],
    ["DALSeg", "SEDE DA GM", 4],
    ["DEGESP", "SEDE DA GM", 5],
    ["Acesso principal", "SEDE DA GM", 6],
    ["Centro Administrativo", "POSTOS FIXOS", 10],
    ["Praça da Juventude", "PRAÇAS E PARQUES", 20],
    ["Rodoviária", "POSTOS DIVERSOS", 30],
  ].filter((p) => !postNames.has(String(p[0])));
  if (newPosts.length)
    await env.DB.batch(
      newPosts.map((p) =>
        env.DB.prepare(
          "INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)",
        ).bind(...p),
      ),
    );
  if (Number(vehicleCount?.total || 0) < 4)
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      ).bind("VTR 1337", "sedan", "Zona B3 Dia"),
      env.DB.prepare(
        "INSERT OR IGNORE INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      ).bind("VTR 1302", "pickup", "Lomba Grande"),
      env.DB.prepare(
        "INSERT OR IGNORE INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      ).bind("VTR 522", "van", "Pontos Base"),
      env.DB.prepare(
        "INSERT OR IGNORE INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      ).bind("VTR 1273", "suv", "Escola Mais Segura"),
    ]);
}

async function ensureDemoMovements() {
  const existing=await env.DB.prepare("SELECT COUNT(*) total FROM movements WHERE request_ref IN ('DEMO-RT-01','DEMO-FOLGA-01','DEMO-FERIAS-01','DEMO-CURSO-01','DEMO-ATESTADO-01','REQ-BH-0826','TROCA-115/2026')").first<{total:number}>();
  if(Number(existing?.total||0)>=7)return;
  const samples = [
    [
      "CAMARGO",
      "technical_reserve",
      "2026-08-12T00:00",
      "2026-08-13T00:00",
      "DEMO-RT-01",
      "Reserva técnica para conferência da escala",
    ],
    [
      "CARLOS",
      "day_off",
      "2026-08-12T00:00",
      "2026-08-13T00:00",
      "DEMO-FOLGA-01",
      "Folga mensal",
    ],
    [
      "CAVALHEIRO",
      "vacation",
      "2026-08-10T00:00",
      "2026-08-22T00:00",
      "DEMO-FERIAS-01",
      "Período de férias",
    ],
    [
      "CIECHORSKI",
      "course",
      "2026-08-12T00:00",
      "2026-08-16T00:00",
      "DEMO-CURSO-01",
      "Curso de atualização",
    ],
    [
      "EDERSON",
      "medical_leave",
      "2026-08-11T00:00",
      "2026-08-15T00:00",
      "DEMO-ATESTADO-01",
      "Afastamento médico",
    ],
    [
      "EDINEI",
      "time_bank",
      "2026-08-12T07:00",
      "2026-08-12T13:00",
      "REQ-BH-0826",
      "Compensação de banco de horas",
    ],
    [
      "EVERTON",
      "swap",
      "2026-08-12T13:00",
      "2026-08-12T19:00",
      "TROCA-115/2026",
      "Troca de serviço autorizada",
    ],
  ];
  await env.DB.batch(
    samples.map(([guardName, type, startsAt, endsAt, requestRef, notes]) =>
      env.DB.prepare(
        "INSERT INTO movements (guard_id,type,starts_at,ends_at,request_ref,notes,status) SELECT id,?,?,?,?,?,'approved' FROM guards WHERE name=? AND NOT EXISTS (SELECT 1 FROM movements WHERE request_ref=?) LIMIT 1",
      ).bind(
        type,
        startsAt,
        endsAt,
        requestRef,
        notes,
        guardName,
        requestRef,
      ),
    ),
  );
}

async function ensureSections(){
  const groups=(await env.DB.prepare("SELECT group_name,MIN(sort_order) sort_order FROM posts WHERE active=1 GROUP BY group_name").all<{group_name:string;sort_order:number}>()).results;
  const commands=[env.DB.prepare("INSERT OR IGNORE INTO schedule_sections (section_key,label,sort_order) VALUES ('VEHICLES','VIATURAS E ZONAS',0)")];
  for(const group of groups)commands.push(env.DB.prepare("INSERT OR IGNORE INTO schedule_sections (section_key,label,sort_order) VALUES (?,?,?)").bind(`POST:${group.group_name}`,group.group_name,Number(group.sort_order||0)+10));
  await env.DB.batch(commands);
}

function shiftTimes(date: string, shift: string) {
  const values: Record<string, [string, string]> = {
    "2": ["07:00", "13:00"],
    "3": ["13:00", "19:00"],
    "4": ["19:00", "01:00"],
    "1": ["01:00", "07:00"],
  };
  const tomorrow = new Date(`${date}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const [start, end] = values[shift];
  return {
    start: `${date}T${start}`,
    end: `${shift === "4" ? tomorrow.toISOString().slice(0, 10) : date}T${end}`,
  };
}

async function seedSchedule(date: string, scheduleId: number) {
  const existing = (
    await env.DB.prepare(
      "SELECT guard_id,post_id,vehicle_id,shift,role FROM assignments WHERE schedule_id=?",
    )
      .bind(scheduleId)
      .all<Record<string, unknown>>()
  ).results;
  if (existing.length >= 20) return;
  const guards = (
    await env.DB.prepare(
      "SELECT id FROM guards WHERE active=1 AND COALESCE(work_regime,'12x36')='12x36' ORDER BY id",
    ).all<{ id: number }>()
  ).results;
  const posts = (
    await env.DB.prepare(
      "SELECT id FROM posts WHERE active=1 ORDER BY sort_order,id",
    ).all<{ id: number }>()
  ).results;
  const vehicles = (
    await env.DB.prepare(
      "SELECT id FROM vehicles WHERE active=1 AND NOT EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=vehicles.id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)) ORDER BY prefix",
    ).bind(date,date).all<{ id: number }>()
  ).results;
  const slots = [
    ...posts.map((p) => ({ postId: p.id, vehicleId: null, role: "guard" })),
    ...vehicles.flatMap((v) => [
      { postId: null, vehicleId: v.id, role: "driver" },
      { postId: null, vehicleId: v.id, role: "patrol" },
    ]),
  ];
  const commands: D1PreparedStatement[] = [];
  for (const period of [
    ["2", "3"],
    ["4", "1"],
  ]) {
    const used = new Set(
      existing
        .filter((a) => period.includes(String(a.shift)))
        .map((a) => Number(a.guard_id)),
    );
    for (const slot of slots) {
      const missing = period.filter(
        (shift) =>
          !existing.some(
            (a) =>
              String(a.shift) === shift &&
              Number(a.post_id || 0) === Number(slot.postId || 0) &&
              Number(a.vehicle_id || 0) === Number(slot.vehicleId || 0) &&
              String(a.role) === slot.role,
          ),
      );
      if (!missing.length) continue;
      const guard = guards.find((g) => !used.has(g.id));
      if (!guard) break;
      used.add(guard.id);
      for (const shift of missing) {
        const time = shiftTimes(date, shift);
        commands.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,?,?,?)",
          ).bind(
            scheduleId,
            guard.id,
            slot.postId,
            slot.vehicleId,
            shift,
            slot.role,
            time.start,
            time.end,
            "normal",
          ),
        );
      }
    }
  }
  if (commands.length) await env.DB.batch(commands);
}

async function ensureBase(date: string) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS schedule_resource_exclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES schedules(id),
      resource_kind TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(schedule_id,resource_kind,resource_id)
    )`,
  ).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS vehicle_return_reconciliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outage_id INTEGER NOT NULL REFERENCES vehicle_outages(id),vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    schedule_id INTEGER NOT NULL REFERENCES schedules(id),return_on TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    linked_assignments INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(outage_id,schedule_id)
  )`).run();
  await ensureCatalog();
  await ensureDemoMovements();
  await ensureSections();
  await ensurePatterns(env.DB);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO schedules (date,status) VALUES (?,'draft')",
  )
    .bind(date)
    .run();
  const schedule = await env.DB.prepare("SELECT id FROM schedules WHERE date=?")
    .bind(date)
    .first<{ id: number }>();
  if (schedule) {
    await applyPatternsToSchedule(env.DB, date, schedule.id);
    await applyWeeklyToSchedule(env.DB,date,schedule.id);
    await seedSchedule(date, schedule.id);
    const exclusions = (await env.DB.prepare(
      "SELECT resource_kind,resource_id FROM schedule_resource_exclusions WHERE schedule_id=?",
    ).bind(schedule.id).all<{resource_kind:string;resource_id:number}>()).results;
    if (exclusions.length) {
      await env.DB.batch(exclusions.map((item) => env.DB.prepare(
        `UPDATE assignments SET post_id=NULL,vehicle_id=NULL,is_reassigned=1,reassignment_note=COALESCE(reassignment_note,?),updated_at=CURRENT_TIMESTAMP WHERE schedule_id=? AND ${item.resource_kind === "post" ? "post_id" : "vehicle_id"}=?`,
      ).bind("Local retirado desta escala — aguardando remanejamento", schedule.id, item.resource_id)));
    }
  }
}

export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("date");
  const date = isScheduleDate(requested) ? requested : todayScheduleDate();
  const wantSuggestions = new URL(request.url).searchParams.get("suggest") === "1";
  if (wantSuggestions) {
    return await buildSuggestions(request, date);
  }
  await ensureBase(date);
  const schedule = await env.DB.prepare("SELECT * FROM schedules WHERE date=?")
    .bind(date)
    .first<Record<string, unknown>>();
  const [guards, posts, vehicles, allVehicles, assignments, movements, notices, outages, sections] =
    await Promise.all([
      env.DB.prepare(
        "SELECT id,name,registration,platoon,base_shift,work_regime,overtime_eligible FROM guards WHERE active=1 ORDER BY name",
      ).all(),
      env.DB.prepare(
        "SELECT id,name,group_name FROM posts WHERE active=1 AND NOT EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=? AND e.resource_kind='post' AND e.resource_id=posts.id) ORDER BY sort_order,name",
      ).bind(schedule?.id).all(),
      env.DB.prepare(
        "SELECT id,prefix,type,zone FROM vehicles v WHERE active=1 AND NOT EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=v.id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)) AND NOT EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=? AND e.resource_kind='vehicle' AND e.resource_id=v.id) AND NOT EXISTS (SELECT 1 FROM vehicle_return_reconciliations r WHERE r.schedule_id=? AND r.vehicle_id=v.id AND r.status IN ('pending','kept')) ORDER BY prefix",
      ).bind(date,date,schedule?.id,schedule?.id).all(),
      env.DB.prepare(
        "SELECT id,prefix,type,zone FROM vehicles v WHERE active=1 AND NOT EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=? AND e.resource_kind='vehicle' AND e.resource_id=v.id) AND NOT EXISTS (SELECT 1 FROM vehicle_return_reconciliations r WHERE r.schedule_id=? AND r.vehicle_id=v.id AND r.status IN ('pending','kept')) ORDER BY prefix",
      ).bind(schedule?.id,schedule?.id).all(),
      env.DB.prepare(
        "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.schedule_id=? ORDER BY a.shift,a.role,g.name",
      )
        .bind(schedule?.id)
        .all(),
      env.DB.prepare(
        "SELECT m.*,g.name guard_name FROM movements m JOIN guards g ON g.id=m.guard_id WHERE m.status='approved' AND m.starts_at<? AND m.ends_at>?",
      )
        .bind(`${date}T23:59`, `${date}T00:00`)
        .all(),
      env.DB.prepare(
        "SELECT * FROM operational_notices WHERE effective_date=? ORDER BY status,title",
      )
        .bind(date)
        .all(),
      env.DB.prepare("SELECT o.*,v.prefix,v.type,v.zone FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)").bind(date,date).all(),
      env.DB.prepare("SELECT section_key,label,sort_order FROM schedule_sections ORDER BY sort_order,label").all(),
    ]);
  const blocked = new Set(movements.results.map((m) => Number(m.guard_id))),
    visibleVehicleIds=new Set(vehicles.results.map((v)=>Number(v.id))),
    visiblePostIds=new Set(posts.results.map((p)=>Number(p.id))),
    awaitingRedeploy = (a: Record<string, unknown>) => {
      if (blocked.has(Number(a.guard_id))) return false;
      const hasVehicle = Boolean(a.vehicle_id);
      const hasPost = Boolean(a.post_id);
      if (!hasVehicle && !hasPost) return true;
      if (hasVehicle && !visibleVehicleIds.has(Number(a.vehicle_id))) return true;
      if (hasPost && !visiblePostIds.has(Number(a.post_id))) return true;
      return false;
    },
    active = assignments.results.filter(
      (a) => !blocked.has(Number(a.guard_id)) && !awaitingRedeploy(a),
    ),
    availableForRedeployment = assignments.results.filter((a) => awaitingRedeploy(a));
  const appliedPattern=await env.DB.prepare("SELECT dp.code day_code,np.code night_code FROM schedule_patterns sp JOIN shift_patterns dp ON dp.id=sp.day_pattern_id JOIN shift_patterns np ON np.id=sp.night_pattern_id WHERE sp.schedule_id=?").bind(schedule?.id).first<Record<string,unknown>>();
  const suggested=appliedPattern?null:await resolvePatternCodes(env.DB,date);
  return Response.json({
    date,
    schedule,
    guards: guards.results,
    posts: posts.results,
    vehicles: vehicles.results,
    allVehicles: allVehicles.results,
    assignments: active,
    availableForRedeployment,
    removed: assignments.results.filter((a) => blocked.has(Number(a.guard_id))),
    movements: movements.results,
    notices: notices.results,
    outages: outages.results,
    sections: sections.results,
    patternLabel: appliedPattern?`${appliedPattern.day_code} + ${appliedPattern.night_code} + SEMANAL`:`${suggested?.dayCode} + ${suggested?.nightCode} + SEMANAL · AJUSTES`,
  });
}

async function assertAssignable(
  scheduleId: number,
  guardId: number,
  start: string,
  end: string,
  ignoreId = 0,
) {
  const conflict = await env.DB.prepare(
    "SELECT id FROM assignments WHERE schedule_id=? AND guard_id=? AND id!=? AND starts_at<? AND ends_at>? LIMIT 1",
  )
    .bind(scheduleId, guardId, ignoreId, end, start)
    .first();
  if (conflict)
    return { error: "Conflito: este GM já está escalado nesse horário.", status: 409 as const };
  const movement = await env.DB.prepare(
    "SELECT type FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1",
  )
    .bind(guardId, end, start)
    .first<{ type: string }>();
  if (movement)
    return { error: `GM indisponível por ${movement.type}.`, status: 409 as const };
  return null;
}

async function upsertAssignment(
  request: Request,
  b: Record<string, string | number | boolean | null>,
  opts: {
    id?: number;
    scheduleId: number;
    guardId: number;
    shift: string;
    start: string;
    end: string;
  },
) {
  const id = Number(opts.id || 0);
  const startMs = Date.parse(opts.start), endMs = Date.parse(opts.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
    return { error: "Informe um intervalo válido; a saída deve ocorrer depois da entrada.", status: 400 as const };
  const regularEnd = String(b.regularEndsAt || "");
  if (regularEnd) {
    const regularMs = Date.parse(regularEnd);
    if (!Number.isFinite(regularMs) || regularMs < startMs || regularMs > endMs)
      return { error: "O fim do horário normal deve ficar entre a entrada e a saída.", status: 400 as const };
  }
  const blocked = await assertAssignable(opts.scheduleId, opts.guardId, opts.start, opts.end, id);
  if (blocked) return blocked;
  const before = id
    ? await env.DB.prepare(
        "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?",
      ).bind(id).first<Record<string, unknown>>()
    : null;
  let assignmentId = id;
  if (id)
    await env.DB.prepare(
      "UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=?,break_starts_at=COALESCE(?,break_starts_at),break_ends_at=COALESCE(?,break_ends_at),work_kind=COALESCE(?,work_kind),status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(
        opts.guardId,
        b.postId || null,
        b.vehicleId || null,
        opts.shift,
        b.role,
        opts.start,
        opts.end,
        b.regularEndsAt || null,
        b.breakStartsAt || null,
        b.breakEndsAt || null,
        b.workKind || null,
        b.status,
        b.requestRef || null,
        b.isReassigned ? 1 : 0,
        b.reassignmentNote || null,
        id,
      )
      .run();
  else {
    const created = await env.DB.prepare(
      "INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,break_starts_at,break_ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        opts.scheduleId,
        opts.guardId,
        b.postId || null,
        b.vehicleId || null,
        opts.shift,
        b.role,
        opts.start,
        opts.end,
        b.regularEndsAt || null,
        b.breakStartsAt || null,
        b.breakEndsAt || null,
        b.workKind || "shift",
        b.status,
        b.requestRef || null,
        b.isReassigned ? 1 : 0,
        b.reassignmentNote || null,
      )
      .run();
    assignmentId = Number(created.meta.last_row_id);
  }
  const assignment = await env.DB.prepare(
    "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?",
  )
    .bind(assignmentId)
    .first();
  const auditEventId = await writeAudit(request, {
    action: id ? "update" : "create",
    entityType: "assignment",
    entityId: assignmentId,
    summary: id
      ? `Alterou a escala de ${assignment?.guard_name}`
      : `Escalou ${assignment?.guard_name} no ${assignment?.shift}º turno`,
    before,
    after: assignment as Record<string, unknown>,
    undoable: true,
  });
  return { ok: true as const, assignment, auditEventId };
}

export async function POST(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const b = (await request.json()) as Record<string, string | number | boolean | null>;
  if (b.action === "copy_assignment_to_cell") {
    const sourceId=Number(b.sourceAssignmentId||0),scheduleId=Number(b.scheduleId||0),targetShift=String(b.shift||"");
    const source=await env.DB.prepare("SELECT a.*,g.name guard_name,s.date schedule_date FROM assignments a JOIN guards g ON g.id=a.guard_id JOIN schedules s ON s.id=a.schedule_id WHERE a.id=? AND a.schedule_id=?").bind(sourceId,scheduleId).first<Record<string,unknown>>();
    if(!source)return Response.json({error:"O GM copiado não foi encontrado nesta escala."},{status:404});
    if(!["1","2","3","4"].includes(targetShift))return Response.json({error:"Escolha um quadrante válido para colar."},{status:400});
    const postId=Number(b.postId||0)||null,vehicleId=Number(b.vehicleId||0)||null;
    if((postId?1:0)+(vehicleId?1:0)!==1)return Response.json({error:"Escolha um único destino para colar."},{status:400});
    const interval=periodShiftTimes(String(source.schedule_date),targetShift);
    const blocked=await assertAssignable(scheduleId,Number(source.guard_id),interval.start,interval.end,0);
    if(blocked)return Response.json({error:blocked.error},{status:blocked.status});
    let role=postId?"guard":String(source.role||"third");
    if(vehicleId){
      const occupied=(await env.DB.prepare("SELECT role FROM assignments WHERE schedule_id=? AND vehicle_id=? AND starts_at<? AND ends_at>?").bind(scheduleId,vehicleId,interval.end,interval.start).all<{role:string}>()).results;
      const roles=new Set(occupied.map(item=>String(item.role)));
      role=!roles.has("driver")?"driver":!roles.has("patrol")?"patrol":"third";
    }
    const created=await env.DB.prepare(`INSERT INTO assignments
      (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(scheduleId,source.guard_id,postId,vehicleId,targetShift,role,interval.start,interval.end,"shift",String(source.status)==="time_bank"?"time_bank":"normal",source.request_ref||null,source.is_reassigned||0,source.reassignment_note||null).run();
    const assignment=await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?").bind(created.meta.last_row_id).first<Record<string,unknown>>();
    const auditEventId=await writeAudit(request,{action:"create",entityType:"assignment",entityId:Number(created.meta.last_row_id),summary:`Colou ${source.guard_name} no ${targetShift}º turno`,after:assignment,undoable:true});
    return Response.json({ok:true,assignment,auditEventId,message:`${source.guard_name} copiado para o ${targetShift}º turno com o horário ajustado.`});
  }
  if (b.action === "remove_resource_from_day") {
    const scheduleId = Number(b.scheduleId);
    const resourceId = Number(b.resourceId);
    const resourceKind = b.resourceKind === "vehicle" ? "vehicle" : b.resourceKind === "post" ? "post" : null;
    if (!scheduleId || !resourceId || !resourceKind)
      return Response.json({ error: "Local inválido." }, { status: 400 });
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS schedule_resource_exclusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER NOT NULL REFERENCES schedules(id),
        resource_kind TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(schedule_id,resource_kind,resource_id)
      )`,
    ).run();
    const schedule = await env.DB.prepare("SELECT date FROM schedules WHERE id=?").bind(scheduleId).first<{date:string}>();
    if (!schedule) return Response.json({ error: "Escala não encontrada." }, { status: 404 });
    const resource = resourceKind === "post"
      ? await env.DB.prepare("SELECT id,name label FROM posts WHERE id=? AND active=1").bind(resourceId).first<Record<string,unknown>>()
      : await env.DB.prepare("SELECT id,prefix label FROM vehicles WHERE id=? AND active=1").bind(resourceId).first<Record<string,unknown>>();
    if (!resource) return Response.json({ error: "Local não encontrado ou já desativado." }, { status: 404 });
    const column = resourceKind === "post" ? "post_id" : "vehicle_id";
    const beforeAssignments = (await env.DB.prepare(
      `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.schedule_id=? AND a.${column}=?`,
    ).bind(scheduleId,resourceId).all<Record<string,unknown>>()).results;
    const note = `${resource.label} retirado da escala de ${schedule.date} — aguardando remanejamento`;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO schedule_resource_exclusions (schedule_id,resource_kind,resource_id,reason) VALUES (?,?,?,?)").bind(scheduleId,resourceKind,resourceId,note),
      env.DB.prepare(`UPDATE assignments SET post_id=NULL,vehicle_id=NULL,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE schedule_id=? AND ${column}=?`).bind(note,scheduleId,resourceId),
    ]);
    const assignmentIds = beforeAssignments.map((item)=>Number(item.id)).filter(Boolean);
    const assignments = assignmentIds.length
      ? (await env.DB.prepare(`SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${assignmentIds.map(()=>"?").join(",")})`).bind(...assignmentIds).all<Record<string,unknown>>()).results
      : [];
    const entityId = `${scheduleId}:${resourceKind}:${resourceId}`;
    const auditEventId = await writeAudit(request,{
      action:"create",
      entityType:"schedule_resource_exclusion",
      entityId,
      summary:`Retirou ${resource.label} da escala de ${schedule.date}`,
      before:{resourceKind,resourceId,assignments:beforeAssignments},
      after:{resourceKind,resourceId,assignments},
      undoable:true,
    });
    const guardCount = new Set(beforeAssignments.map((item)=>Number(item.guard_id))).size;
    return Response.json({
      ok:true,
      assignments,
      removedResource:{kind:resourceKind,id:resourceId},
      auditEventId,
      message:`${resource.label} retirado desta escala. ${guardCount} GM(s) estão à disposição para remanejamento.`,
    });
  }
  if (b.action === "replace_guard_group") {
    const assignmentIds=[...new Set((((b as unknown as {assignmentIds?:unknown[]}).assignmentIds)||[]).map(Number).filter(id=>Number.isInteger(id)&&id>0))].slice(0,4);
    const guardId=Number(b.guardId);
    if(!assignmentIds.length||!guardId)return Response.json({error:"Selecione o GM e o período que será substituído."},{status:400});
    const placeholders=assignmentIds.map(()=>"?").join(",");
    const before=(await env.DB.prepare(`SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${placeholders}) ORDER BY a.starts_at`).bind(...assignmentIds).all<Record<string,unknown>>()).results;
    if(before.length!==assignmentIds.length)return Response.json({error:"Um dos horários selecionados não foi encontrado."},{status:404});
    const scheduleIds=new Set(before.map(item=>Number(item.schedule_id))),oldGuardIds=new Set(before.map(item=>Number(item.guard_id)));
    if(scheduleIds.size!==1||oldGuardIds.size!==1)return Response.json({error:"A troca deve envolver somente um GM e uma escala."},{status:409});
    if(oldGuardIds.has(guardId))return Response.json({error:"Selecione um GM diferente do atual."},{status:400});
    const guard=await env.DB.prepare("SELECT id,name FROM guards WHERE id=? AND active=1").bind(guardId).first<Record<string,unknown>>();
    if(!guard)return Response.json({error:"GM não encontrado ou desativado."},{status:404});
    for(const item of before){
      const blocked=await assertAssignable(Number(item.schedule_id),guardId,String(item.starts_at),String(item.ends_at));
      if(blocked)return Response.json({error:blocked.error},{status:blocked.status});
      const movement=await env.DB.prepare("SELECT id FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1").bind(guardId,item.ends_at,item.starts_at).first();
      if(movement)return Response.json({error:`${guard.name} possui afastamento ou movimentação neste horário.`},{status:409});
    }
    await env.DB.batch(before.map(item=>env.DB.prepare("UPDATE assignments SET guard_id=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(guardId,`Troca rápida: ${item.guard_name} → ${guard.name}`,item.id)));
    const assignments=(await env.DB.prepare(`SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${placeholders}) ORDER BY a.starts_at`).bind(...assignmentIds).all<Record<string,unknown>>()).results;
    const auditEventId=await writeAudit(request,{action:"replace",entityType:"assignment_group",entityId:assignmentIds.join(","),summary:`Trocou ${before[0].guard_name} por ${guard.name} em ${assignmentIds.length} horário(s)`,before:{assignments:before},after:{assignments},undoable:true});
    return Response.json({ok:true,assignments,auditEventId,message:`${before[0].guard_name} → ${guard.name}. Troca aplicada e sinalizada para aviso.`});
  }
  if (b.action === "assign_resource_group") {
    const scheduleId = Number(b.scheduleId);
    const postId = Number(b.postId || 0) || null;
    const vehicleId = Number(b.vehicleId || 0) || null;
    const requestedShift = String(b.shift || "2");
    const members = ((b as unknown as { members?: Array<{ guardId?: number; role?: string }> }).members || [])
      .map((member) => ({ guardId: Number(member.guardId), role: String(member.role || "guard") }))
      .filter((member) => member.guardId > 0)
      .slice(0, 8);
    if ((postId ? 1 : 0) + (vehicleId ? 1 : 0) !== 1)
      return Response.json({ error: "Escolha uma viatura ou posto." }, { status: 400 });
    if (!members.length)
      return Response.json({ error: "Adicione pelo menos um GM." }, { status: 400 });
    if (!hasUniqueCrewMembers(members))
      return Response.json({ error: "O mesmo GM foi selecionado mais de uma vez." }, { status: 400 });
    const schedule = await env.DB.prepare("SELECT date FROM schedules WHERE id=?").bind(scheduleId).first<{ date: string }>();
    if (!schedule)
      return Response.json({ error: "Escala não encontrada." }, { status: 404 });
    if (vehicleId) {
      const vehicle = await env.DB.prepare("SELECT id FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first();
      if (!vehicle)
        return Response.json({ error: "Viatura não encontrada ou desativada." }, { status: 404 });
      const outage = await env.DB.prepare(
        "SELECT id FROM vehicle_outages WHERE vehicle_id=? AND active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?) LIMIT 1",
      ).bind(vehicleId, schedule.date, schedule.date).first();
      if (outage)
        return Response.json({ error: "Esta viatura está em FA na data da escala e não pode receber uma guarnição." }, { status: 409 });
    }
    if (postId) {
      const post = await env.DB.prepare("SELECT id FROM posts WHERE id=? AND active=1").bind(postId).first();
      if (!post)
        return Response.json({ error: "Posto não encontrado ou desativado." }, { status: 404 });
    }
    const excluded = await env.DB.prepare(
      "SELECT id FROM schedule_resource_exclusions WHERE schedule_id=? AND resource_kind=? AND resource_id=? LIMIT 1",
    ).bind(scheduleId, vehicleId ? "vehicle" : "post", vehicleId || postId).first();
    if (excluded)
      return Response.json({ error: "Este recurso foi retirado desta escala. Recoloque-o antes de adicionar uma equipe." }, { status: 409 });
    const periodShifts = fullPeriodShifts(requestedShift);
    for (const member of members) {
      for (const shift of periodShifts) {
        const interval = periodShiftTimes(schedule.date, shift);
        const blocked = await assertAssignable(scheduleId, member.guardId, interval.start, interval.end);
        if (blocked) return Response.json({ error: blocked.error }, { status: blocked.status });
      }
    }
    if (vehicleId) {
      for (const shift of periodShifts) {
        const existingRoles = (await env.DB.prepare("SELECT role FROM assignments WHERE schedule_id=? AND vehicle_id=? AND shift=?").bind(scheduleId, vehicleId, shift).all<{ role: string }>()).results.map((item) => item.role);
        if (!hasRequiredVehicleCrew(existingRoles, members.map((member) => member.role)))
          return Response.json({ error: "Toda viatura precisa ter motorista e patrulheiro. Selecione as duas funções antes de salvar." }, { status: 400 });
      }
    }
    const statements = periodShifts.flatMap((shift) => {
      const interval = periodShiftTimes(schedule.date, shift);
      return members.map((member) => env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(scheduleId, member.guardId, postId, vehicleId, shift, vehicleId ? member.role : "guard", interval.start, interval.end, "shift", "normal"));
    });
    const results = await env.DB.batch(statements);
    const ids = results.map((result) => Number(result.meta.last_row_id)).filter(Boolean);
    const placeholders = ids.map(() => "?").join(",");
    const assignments = ids.length
      ? (await env.DB.prepare(`SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${placeholders}) ORDER BY a.starts_at,a.role`).bind(...ids).all<Record<string, unknown>>()).results
      : [];
    const auditEventId = await writeAudit(request, { action: "create", entityType: "assignment_group", entityId: ids.join(","), summary: `Escalou ${members.length} GM(s) em ${vehicleId ? "viatura" : "posto"}`, after: { assignments }, undoable: true });
    return Response.json({ ok: true, assignments, auditEventId, message: vehicleId ? `Guarnição criada com ${members.length} integrantes.` : `${members.length} GM(s) adicionados ao posto.` });
  }
  if (b.action === "redeploy_group") {
    const assignmentIds = [
      ...new Set(
        (((b as unknown as { assignmentIds?: unknown[] }).assignmentIds || [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0)),
      ),
    ].slice(0, 4);
    if (!assignmentIds.length)
      return Response.json({ error: "Nenhuma designação selecionada." }, { status: 400 });
    const placeholders = assignmentIds.map(() => "?").join(",");
    const before = (
      await env.DB.prepare(
        `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${placeholders}) ORDER BY a.shift`,
      )
        .bind(...assignmentIds)
        .all<Record<string, unknown>>()
    ).results;
    if (before.length !== assignmentIds.length)
      return Response.json({ error: "Uma das designações não foi encontrada." }, { status: 404 });
    const scheduleIds = new Set(before.map((item) => Number(item.schedule_id)));
    const guardIds = new Set(before.map((item) => Number(item.guard_id)));
    if (scheduleIds.size !== 1 || guardIds.size !== 1)
      return Response.json({ error: "Selecione somente os horários do mesmo GM e período." }, { status: 409 });

    const scheduleId = Number(before[0].schedule_id);
    const postId = Number(b.postId || 0) || null;
    const vehicleId = Number(b.vehicleId || 0) || null;
    if ((postId ? 1 : 0) + (vehicleId ? 1 : 0) !== 1)
      return Response.json({ error: "Escolha um único destino." }, { status: 400 });
    const schedule = await env.DB.prepare("SELECT date FROM schedules WHERE id=?")
      .bind(scheduleId)
      .first<{ date: string }>();
    if (!schedule)
      return Response.json({ error: "Escala não encontrada." }, { status: 404 });
    const destination = postId
      ? await env.DB.prepare("SELECT id,name label FROM posts WHERE id=? AND active=1").bind(postId).first<Record<string, unknown>>()
      : await env.DB.prepare("SELECT id,prefix label FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<Record<string, unknown>>();
    if (!destination)
      return Response.json({ error: "Destino não encontrado ou desativado." }, { status: 404 });
    if (vehicleId) {
      const outage = await env.DB.prepare(
        "SELECT id FROM vehicle_outages WHERE vehicle_id=? AND active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?) LIMIT 1",
      )
        .bind(vehicleId, schedule?.date, schedule?.date)
        .first();
      if (outage)
        return Response.json({ error: "A viatura selecionada está em FA nesta data." }, { status: 409 });
    }

    // Postos podem receber reforços e viaturas podem operar com terceiro ou mais
    // integrantes. A validação relevante aqui é a disponibilidade do próprio GM,
    // não uma capacidade fixa do destino.

    const requestedRole = vehicleId && ["driver", "patrol", "third"].includes(String(b.role))
      ? String(b.role)
      : null;
    const reassignmentNote = String(
      b.reassignmentNote || "Avisar o GM: remanejamento para cobrir furo de escala",
    );
    await env.DB.prepare(
      `UPDATE assignments SET post_id=?,vehicle_id=?,role=CASE WHEN ? IS NOT NULL THEN 'guard' WHEN ? IS NOT NULL THEN ? ELSE role END,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
    )
      .bind(postId, vehicleId, postId, requestedRole, requestedRole, reassignmentNote, ...assignmentIds)
      .run();
    const assignments = (
      await env.DB.prepare(
        `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${placeholders}) ORDER BY a.starts_at`,
      )
        .bind(...assignmentIds)
        .all<Record<string, unknown>>()
    ).results;
    const auditEventId = await writeAudit(request, {
      action: "update",
      entityType: "assignment_group",
      entityId: assignmentIds.join(","),
      summary: `Remanejou ${before[0].guard_name} com ${assignmentIds.length} horários para ${destination.label}`,
      before: { assignments: before },
      after: { assignments },
      undoable: true,
    });
    return Response.json({
      ok: true,
      assignments,
      auditEventId,
      message: `${before[0].guard_name} remanejado com todos os horários do período.`,
    });
  }
  if (b.action === "vehicle_quick_update") {
    const scheduleId = Number(b.scheduleId);
    const fromVehicleId = Number(b.fromVehicleId);
    const toVehicleId = Number(b.toVehicleId || fromVehicleId);
    const zone = String(b.zone || "").trim();
    const schedule = await env.DB.prepare("SELECT date FROM schedules WHERE id=?")
      .bind(scheduleId)
      .first<{ date: string }>();
    if (!schedule)
      return Response.json({ error: "Escala não encontrada." }, { status: 404 });
    const [source, target] = await Promise.all([
      env.DB.prepare("SELECT * FROM vehicles WHERE id=? AND active=1").bind(fromVehicleId).first<Record<string, unknown>>(),
      env.DB.prepare("SELECT * FROM vehicles WHERE id=? AND active=1").bind(toVehicleId).first<Record<string, unknown>>(),
    ]);
    if (!source || !target)
      return Response.json({ error: "Viatura não encontrada ou desativada." }, { status: 404 });
    if (toVehicleId !== fromVehicleId) {
      const outage = await env.DB.prepare(
        "SELECT id FROM vehicle_outages WHERE vehicle_id=? AND active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?) LIMIT 1",
      ).bind(toVehicleId, schedule.date, schedule.date).first();
      if (outage)
        return Response.json({ error: "A viatura selecionada está em FA nesta data." }, { status: 409 });
      const occupied = await env.DB.prepare(
        "SELECT id FROM assignments WHERE schedule_id=? AND vehicle_id=? LIMIT 1",
      ).bind(scheduleId, toVehicleId).first();
      if (occupied)
        return Response.json({ error: "A viatura selecionada já possui uma guarnição nesta escala." }, { status: 409 });
    }
    const beforeAssignments = (
      await env.DB.prepare("SELECT * FROM assignments WHERE schedule_id=? AND vehicle_id=?")
        .bind(scheduleId, fromVehicleId)
        .all<Record<string, unknown>>()
    ).results;
    await env.DB.batch([
      env.DB.prepare("UPDATE vehicles SET zone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(zone, toVehicleId),
      env.DB.prepare(
        "UPDATE assignments SET vehicle_id=?,is_reassigned=CASE WHEN ?!=? THEN 1 ELSE is_reassigned END,reassignment_note=CASE WHEN ?!=? THEN ? ELSE reassignment_note END,updated_at=CURRENT_TIMESTAMP WHERE schedule_id=? AND vehicle_id=?",
      ).bind(
        toVehicleId,
        toVehicleId,
        fromVehicleId,
        toVehicleId,
        fromVehicleId,
        `Troca de ${source.prefix} para ${target.prefix}`,
        scheduleId,
        fromVehicleId,
      ),
    ]);
    const assignments = (
      await env.DB.prepare(
        "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.schedule_id=? AND a.vehicle_id=? ORDER BY a.shift,a.role,g.name",
      ).bind(scheduleId, toVehicleId).all<Record<string, unknown>>()
    ).results;
    const vehicle = await env.DB.prepare("SELECT id,prefix,type,zone FROM vehicles WHERE id=?")
      .bind(toVehicleId)
      .first();
    await writeAudit(request, {
      action: toVehicleId === fromVehicleId ? "update" : "replace",
      entityType: "schedule_vehicle",
      entityId: toVehicleId,
      summary: toVehicleId === fromVehicleId
        ? `Alterou a zona da ${target.prefix}`
        : `Trocou ${source.prefix} por ${target.prefix} na escala de ${schedule.date}`,
      before: { vehicle: source, assignments: beforeAssignments },
      after: { vehicle, assignments },
      undoable: true,
    });
    return Response.json({
      ok: true,
      assignments,
      vehicle,
      fromVehicleId,
      message: toVehicleId === fromVehicleId
        ? "Zona da viatura atualizada."
        : `Guarnição transferida para ${target.prefix}.`,
    });
  }
  if (b.action === "save_with_extension") {
    const id = Number(b.id || 0);
    const scheduleId = Number(b.scheduleId);
    const guardId = Number(b.guardId);
    const regularStart = String(b.startsAt || "");
    const regularEnd = String(b.endsAt || "");
    const extensionStart = String(b.extensionStartsAt || "");
    const extensionEnd = String(b.extensionEndsAt || "");
    if (!splitExtensionWindow(regularStart, regularEnd, extensionStart, extensionEnd))
      return Response.json({ error: "Revise os horários: a extensão deve começar no fim ou depois do expediente normal." }, { status: 400 });
    const regularPostId = Number(b.postId || 0) || null;
    const regularVehicleId = Number(b.vehicleId || 0) || null;
    const extensionPostId = Number(b.extensionPostId || 0) || null;
    const extensionVehicleId = Number(b.extensionVehicleId || 0) || null;
    if ((regularPostId ? 1 : 0) + (regularVehicleId ? 1 : 0) !== 1 || (extensionPostId ? 1 : 0) + (extensionVehicleId ? 1 : 0) !== 1)
      return Response.json({ error: "Escolha um destino para o expediente e outro para a extensão." }, { status: 400 });
    const regularConflict = await assertAssignable(scheduleId, guardId, regularStart, regularEnd, id);
    if (regularConflict) return Response.json({ error: regularConflict.error }, { status: regularConflict.status });
    const extensionConflict = await assertAssignable(scheduleId, guardId, extensionStart, extensionEnd, id);
    if (extensionConflict) return Response.json({ error: extensionConflict.error }, { status: extensionConflict.status });
    const before = id
      ? await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?").bind(id).first<Record<string, unknown>>()
      : null;
    const statements = [];
    const regularStatus = String(b.status || "normal") === "overtime" ? "normal" : String(b.status || "normal");
    if (id) {
      statements.push(env.DB.prepare("UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=NULL,status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(guardId, regularPostId, regularVehicleId, b.shift, b.role, regularStart, regularEnd, regularStatus, b.requestRef || null, b.isReassigned ? 1 : 0, b.reassignmentNote || null, id));
    } else {
      statements.push(env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(scheduleId, guardId, regularPostId, regularVehicleId, b.shift, b.role, regularStart, regularEnd, b.workKind || "shift", regularStatus, b.requestRef || null, b.isReassigned ? 1 : 0, b.reassignmentNote || null));
    }
    statements.push(env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(scheduleId, guardId, extensionPostId, extensionVehicleId, b.extensionShift || "4", b.extensionRole || (extensionVehicleId ? "third" : "guard"), extensionStart, extensionEnd, "overtime_extension", "overtime", b.requestRef || null, b.isReassigned ? 1 : 0, b.reassignmentNote || "Extensão independente do expediente"));
    const results = await env.DB.batch(statements);
    const regularId = id || Number(results[0].meta.last_row_id);
    const extensionId = Number(results[1].meta.last_row_id);
    const assignments = (await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (?,?) ORDER BY a.starts_at").bind(regularId, extensionId).all<Record<string, unknown>>()).results;
    const auditEventId = await writeAudit(request, { action: id ? "update" : "create", entityType: "assignment_group", entityId: `${regularId},${extensionId}`, summary: `Separou expediente e extensão de ${assignments[0]?.guard_name || "GM"}`, before: before ? { assignments: [before] } : undefined, after: { assignments }, undoable: true });
    return Response.json({ ok: true, assignments, auditEventId, message: "Expediente e extensão salvos separadamente. Cada bloco agora pode ser movido sozinho." });
  }
  if (b.action === "create_overtime_extension") {
    const baseId=Number(b.baseAssignmentId||0),scheduleId=Number(b.scheduleId||0);
    const base=await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=? AND a.schedule_id=?").bind(baseId,scheduleId).first<Record<string,unknown>>();
    if(!base)return Response.json({error:"Expediente de origem não encontrado."},{status:404});
    const startsAt=String(b.startsAt||""),endsAt=String(b.endsAt||"");
    const startMs=Date.parse(startsAt),endMs=Date.parse(endsAt);
    if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)
      return Response.json({error:"Informe um intervalo válido para a hora extra."},{status:400});
    const direction=String(b.direction||"after")==="before"?"before":"after";
    const normalStart=String(base.starts_at),normalEnd=String(base.regular_ends_at||base.ends_at);
    if(direction==="after"&&startsAt<normalEnd)
      return Response.json({error:`A hora extra deve começar às ${normalEnd.slice(11,16)} ou depois.`},{status:400});
    if(direction==="before"&&endsAt>normalStart)
      return Response.json({error:`A hora extra antecipada deve terminar às ${normalStart.slice(11,16)} ou antes.`},{status:400});
    const postId=Number(b.postId||0)||null,vehicleId=Number(b.vehicleId||0)||null;
    if((postId?1:0)+(vehicleId?1:0)!==1)
      return Response.json({error:"Escolha o local da extensão."},{status:400});
    const conflict=await assertAssignable(scheduleId,Number(base.guard_id),startsAt,endsAt,0);
    if(conflict)return Response.json({error:conflict.error},{status:conflict.status});
    const created=await env.DB.prepare(`INSERT INTO assignments
      (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note)
      VALUES (?,?,?,?,?,?,?,?,?,'overtime_extension','overtime',?,0,?)`)
      .bind(scheduleId,base.guard_id,postId,vehicleId,b.shift||(direction==="before"?"3":"4"),b.role||(vehicleId?"third":"guard"),startsAt,endsAt,startsAt,b.requestRef||null,direction==="before"?"Antecipação independente em hora extra":"Extensão independente do expediente").run();
    const assignment=await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?").bind(created.meta.last_row_id).first<Record<string,unknown>>();
    const auditEventId=await writeAudit(request,{action:"create",entityType:"assignment",entityId:Number(created.meta.last_row_id),summary:direction==="before"?`Antecipou ${base.guard_name} em HE desde ${startsAt.slice(11,16)}`:`Estendeu ${base.guard_name} em HE até ${endsAt.slice(11,16)}`,after:assignment,undoable:true});
    return Response.json({ok:true,assignment,auditEventId,message:`HE de ${base.guard_name} adicionada como bloco independente.`});
  }
  if (b.action === "delete") {
    const before = await env.DB.prepare(
      "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?",
    ).bind(b.id).first<Record<string,unknown>>();
    if (!before)
      return Response.json({ error: "Designação não encontrada." }, { status: 404 });
    await env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(b.id).run();
    const auditEventId = await writeAudit(request, {
      action: "delete",
      entityType: "assignment",
      entityId: Number(b.id),
      summary: `Removeu ${before.guard_name} do ${before.shift}º turno`,
      before,
      undoable: true,
    });
    return Response.json({ ok: true, deletedId: Number(b.id), auditEventId, message: "GM removido da escala." });
  }

  const id = Number(b.id || 0);
  const guardId = Number(b.guardId);
  const scheduleId = Number(b.scheduleId);
  const schedule = await env.DB.prepare("SELECT date FROM schedules WHERE id=?")
    .bind(scheduleId)
    .first<{ date: string }>();
  const date = String(schedule?.date || String(b.startsAt || "").slice(0, 10));
  const fillFullPeriod = Boolean(b.fillFullPeriod) && !id;
  const requestedShift = String(b.shift || "2");

  if (fillFullPeriod) {
    const periodShifts = fullPeriodShifts(requestedShift);
    const created: Record<string, unknown>[] = [];
    for (const shift of periodShifts) {
      const t = periodShiftTimes(date, shift);
      // Skip if this resource/shift/role already has the same guard covering it.
      const existing = await env.DB.prepare(
        `SELECT id FROM assignments
         WHERE schedule_id=? AND guard_id=? AND shift=?
           AND COALESCE(post_id,0)=COALESCE(?,0)
           AND COALESCE(vehicle_id,0)=COALESCE(?,0)
         LIMIT 1`,
      )
        .bind(scheduleId, guardId, shift, b.postId || null, b.vehicleId || null)
        .first<{ id: number }>();
      const result = await upsertAssignment(request, b, {
        id: existing?.id,
        scheduleId,
        guardId,
        shift,
        start: t.start,
        end: t.end,
      });
      if ("error" in result)
        return Response.json({ error: result.error }, { status: result.status });
      if (result.assignment) created.push(result.assignment);
    }
    const label =
      periodShifts[0] === "2"
        ? "turno inteiro diurno (07:00–19:00)"
        : "turno inteiro noturno (19:00–07:00)";
    return Response.json({
      ok: true,
      assignment: created[0] || null,
      assignments: created,
      message: `GM escalado no ${label}.`,
    });
  }

  const start = String(b.startsAt);
  const end = String(b.endsAt);
  const result = await upsertAssignment(request, b, {
    id,
    scheduleId,
    guardId,
    shift: requestedShift,
    start,
    end,
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, assignment: result.assignment, auditEventId: result.auditEventId });
}

async function buildSuggestions(request: Request, date: string) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const url = new URL(request.url);
  const shift = String(url.searchParams.get("shift") || "2");
  const postId = Number(url.searchParams.get("postId") || 0) || null;
  const vehicleId = Number(url.searchParams.get("vehicleId") || 0) || null;
  const role = url.searchParams.get("role") || null;
  const period = isDayShift(shift) ? "day" : "night";
  const periodShiftIds = period === "day" ? ["2", "3"] : ["4", "1"];
  const periodWindow = fullPeriodWindow(date, shift);

  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = (() => {
    const [y, m] = date.slice(0, 7).split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 1));
    return end.toISOString().slice(0, 10);
  })();

  await ensureBase(date);
  const schedule = await env.DB.prepare("SELECT id FROM schedules WHERE date=?")
    .bind(date)
    .first<{ id: number }>();
  const scheduleId = Number(schedule?.id || 0);

  const [
    guards,
    movementsActive,
    todayAssignments,
    heEntries,
    guardHistory,
    appliedPattern,
  ] = await Promise.all([
    env.DB
      .prepare(
        "SELECT id,name,registration,platoon,base_shift,work_regime,overtime_eligible FROM guards WHERE active=1 ORDER BY name",
      )
      .all<{
        id: number;
        name: string;
        registration: string;
        platoon: string | null;
        base_shift: string | null;
        work_regime: string | null;
        overtime_eligible: number;
      }>(),
    env.DB
      .prepare(
        "SELECT guard_id FROM movements WHERE status='approved' AND starts_at<? AND ends_at>?",
      )
      .bind(`${date}T23:59`, `${date}T00:00`)
      .all<{ guard_id: number }>(),
    env.DB
      .prepare(
        `SELECT a.*,g.name guard_name,g.registration,
                COALESCE(p.name,v.prefix,'Sem destino') origin_label,
                CASE WHEN a.post_id IS NOT NULL THEN 'post' WHEN a.vehicle_id IS NOT NULL THEN 'vehicle' ELSE 'pending' END origin_kind,
                CASE WHEN (a.post_id IS NULL AND a.vehicle_id IS NULL)
                  OR EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=a.schedule_id AND e.resource_kind='post' AND e.resource_id=a.post_id)
                  OR EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=a.schedule_id AND e.resource_kind='vehicle' AND e.resource_id=a.vehicle_id)
                  OR EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=a.vehicle_id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?))
                  THEN 1 ELSE 0 END awaiting_redeploy
         FROM assignments a
         JOIN guards g ON g.id=a.guard_id
         LEFT JOIN posts p ON p.id=a.post_id
         LEFT JOIN vehicles v ON v.id=a.vehicle_id
         WHERE a.schedule_id=?
           AND a.starts_at<? AND a.ends_at>?
           AND COALESCE(a.work_kind,'shift')!='overtime_extension'
         ORDER BY g.name,a.starts_at`,
      )
      .bind(date, date, scheduleId, periodWindow.end, periodWindow.start)
      .all<Record<string, unknown>>(),
    env.DB
      .prepare(
        `SELECT guard_id,starts_at,
          CASE WHEN status IN ('confirmed','partial') THEN COALESCE(confirmed_minutes,0)
               WHEN status='pending' THEN planned_minutes ELSE 0 END effective_minutes
         FROM overtime_entries WHERE service_date>=? AND service_date<?`,
      )
      .bind(monthStart, monthEnd)
      .all<{ guard_id: number; starts_at: string; effective_minutes: number }>(),
    env.DB
      .prepare(
        `SELECT guard_id, post_id, vehicle_id, role FROM assignments
         WHERE post_id IS NOT NULL OR vehicle_id IS NOT NULL
         GROUP BY guard_id, post_id, vehicle_id, role`,
      )
      .all<{
        guard_id: number;
        post_id: number | null;
        vehicle_id: number | null;
        role: string | null;
      }>(),
    env.DB
      .prepare(
        `SELECT dp.code day_code, np.code night_code
         FROM schedule_patterns sp
         JOIN shift_patterns dp ON dp.id=sp.day_pattern_id
         JOIN shift_patterns np ON np.id=sp.night_pattern_id
         WHERE sp.schedule_id=?`,
      )
      .bind(scheduleId)
      .first<{ day_code: string; night_code: string }>(),
  ]);

  const blocked = new Set(movementsActive.results.map((m) => Number(m.guard_id)));
  const scheduledToday = new Set(todayAssignments.results.map((a) => Number(a.guard_id)));

  const sameDayGroups = new Map<number, Record<string, unknown>[]>();
  for (const assignment of todayAssignments.results) {
    const guardId = Number(assignment.guard_id);
    if (blocked.has(guardId)) continue;
    const atTarget = postId
      ? Number(assignment.post_id) === postId
      : Number(assignment.vehicle_id) === vehicleId;
    if (atTarget) continue;
    const list = sameDayGroups.get(guardId) || [];
    list.push(assignment);
    sameDayGroups.set(guardId, list);
  }
  const sameDayCandidates = [...sameDayGroups.entries()]
    .map(([guardId, assignments]) => {
      const first = assignments[0];
      const compatibleRole = !vehicleId || !role || assignments.some((item) => String(item.role) === role);
      const coversFullPeriod = periodShiftIds.every((shiftId) =>
        assignments.some((item) => String(item.shift) === shiftId),
      );
      const periodWindow = coversFullPeriod ? fullPeriodWindow(date, shift) : null;
      return {
        guardId,
        name: String(first.guard_name),
        registration: String(first.registration || ""),
        assignmentIds: assignments.map((item) => Number(item.id)),
        origins: [...new Set(assignments.map((item) => String(item.origin_label)))],
        roles: [...new Set(assignments.map((item) => String(item.role || "guard")))],
        startsAt: periodWindow?.start || String(assignments[0].starts_at),
        endsAt: periodWindow?.end || String(assignments[assignments.length - 1].ends_at),
        compatibleRole,
        availableForRedeployment: assignments.some((item) => Number(item.awaiting_redeploy) === 1),
      };
    })
    .sort((a, b) =>
      Number(b.availableForRedeployment) - Number(a.availableForRedeployment) ||
      Number(b.compatibleRole) - Number(a.compatibleRole) ||
      a.name.localeCompare(b.name, "pt-BR"),
    );

  const guardHeHours = new Map<number, number>();
  const guardLastHe = new Map<number, string | null>();
  for (const entry of heEntries.results) {
    const hours = Number(entry.effective_minutes || 0) / 60;
    guardHeHours.set(
      Number(entry.guard_id),
      Number(guardHeHours.get(Number(entry.guard_id)) ?? 0) + hours,
    );
    const current = guardLastHe.get(Number(entry.guard_id));
    if (!current || String(entry.starts_at) > String(current)) {
      guardLastHe.set(Number(entry.guard_id), String(entry.starts_at));
    }
  }

  const guardHistoryByGuard = new Map<
    number,
    { post_id: number | null; vehicle_id: number | null; role: string | null }[]
  >();
  for (const h of guardHistory.results) {
    const list = guardHistoryByGuard.get(Number(h.guard_id)) || [];
    list.push({
      post_id: h.post_id ?? null,
      vehicle_id: h.vehicle_id ?? null,
      role: h.role ?? null,
    });
    guardHistoryByGuard.set(Number(h.guard_id), list);
  }

  const dayCodes = new Set<string>(appliedPattern?.day_code ? [appliedPattern.day_code] : []);
  const nightCodes = new Set<string>(appliedPattern?.night_code ? [appliedPattern.night_code] : []);

  const ranked = rankGuardSuggestions(
    guards.results.filter((g) => Number(g.overtime_eligible) !== 0).map((g) => ({
      id: Number(g.id),
      name: String(g.name),
      registration: String(g.registration),
      platoon: g.platoon,
      base_shift: g.base_shift,
      work_regime: g.work_regime,
    })),
    { date, shift, postId, vehicleId, role },
    {
      blockedGuardIds: blocked,
      scheduledGuardIds: scheduledToday,
      guardHeHours,
      guardLastHe,
      guardAssignmentsByGuard: guardHistoryByGuard,
      appliedDayCodes: dayCodes,
      appliedNightCodes: nightCodes,
    },
  );

  return Response.json({
    date,
    shift,
    period,
    postId,
    vehicleId,
    role,
    suggestions: ranked.map((s) => ({
      ...s,
      reasons: describeReasons(s.reasons, s),
    })),
    sameDayCandidates,
    summary: {
      blocked: blocked.size,
      scheduledToday: scheduledToday.size,
      totalGuards: guards.results.length,
      excludedNoHe: guards.results.filter((g) => Number(g.overtime_eligible) === 0).length,
    },
  });
}
