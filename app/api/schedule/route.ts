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
import { fullPeriodShifts, fullPeriodWindow, shiftTimes as periodShiftTimes, operationalShiftWindow, isDayShift, splitExtensionWindow } from "../../../lib/shift-rules";
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
  await ensureServiceAdjustmentsTable();
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

async function ensureServiceAdjustmentsTable() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS service_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    subtype TEXT NOT NULL,
    guard_id INTEGER NOT NULL REFERENCES guards(id),
    counterpart_guard_id INTEGER REFERENCES guards(id),
    service_date TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    request_ref TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    snapshot_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_service_adjustments_date ON service_adjustments(service_date,status)",
  ).run();
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
  const [guards, posts, vehicles, allVehicles, assignments, movements, notices, outages, sections, operations, serviceAdjustments] =
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
      env.DB.prepare(`SELECT o.id,o.title,o.starts_at,o.ends_at,o.location,o.status,o.requested_guards,
        COUNT(os.id) total_slots,SUM(CASE WHEN os.guard_id IS NOT NULL THEN 1 ELSE 0 END) filled
        FROM operations o LEFT JOIN operation_slots os ON os.operation_id=o.id
        WHERE o.schedule_id=? AND o.status!='cancelled' GROUP BY o.id ORDER BY o.starts_at,o.title`).bind(schedule?.id).all(),
      env.DB.prepare(`SELECT sa.*,g.name guard_name,c.name counterpart_guard_name
        FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id
        LEFT JOIN guards c ON c.id=sa.counterpart_guard_id
        WHERE sa.service_date=? AND sa.status='active'
        ORDER BY sa.starts_at,sa.id`).bind(date).all(),
    ]);
  const operationAssignments=(await env.DB.prepare(`SELECT os.guard_id,o.starts_at,o.ends_at FROM operation_slots os JOIN operations o ON o.id=os.operation_id WHERE o.schedule_id=? AND o.status!='cancelled' AND os.guard_id IS NOT NULL`).bind(schedule?.id).all<{guard_id:number;starts_at:string;ends_at:string}>()).results;
  const blocked = new Set([
      ...movements.results.map((m) => Number(m.guard_id)),
      ...serviceAdjustments.results.filter((item) => String(item.subtype)==="negative_full").map((item) => Number(item.guard_id)),
    ]),
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
    availableForRedeployment = assignments.results.filter((a) => awaitingRedeploy(a)&&!operationAssignments.some(operation=>
      Number(operation.guard_id)===Number(a.guard_id)&&String(a.starts_at)<operation.ends_at&&String(a.ends_at)>operation.starts_at,
    ));
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
    operations: operations.results,
    serviceAdjustments: serviceAdjustments.results,
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
  const operationConflict = await env.DB.prepare(
    `SELECT os.id,o.title FROM operation_slots os JOIN operations o ON o.id=os.operation_id
     WHERE os.guard_id=? AND o.schedule_id=? AND o.status!='cancelled' AND o.starts_at<? AND o.ends_at>? LIMIT 1`,
  ).bind(guardId,scheduleId,end,start).first<{id:number;title:string}>();
  if(operationConflict)
    return { error: `Conflito: este GM já participa da operação ${operationConflict.title}.`, status: 409 as const };
  const movement = await env.DB.prepare(
    "SELECT type FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1",
  )
    .bind(guardId, end, start)
    .first<{ type: string }>();
  if (movement)
    return { error: `GM indisponível por ${movement.type}.`, status: 409 as const };
  return null;
}

/**
 * The schedule is edited by more than one escalante.  Every assignment and
 * catalog resource carries an updated_at value, so callers can tell us which
 * version they actually opened.  Keeping this check optional preserves
 * compatibility with older clients while preventing a stale editor from
 * silently overwriting a newer change.
 */
function normalizeVersion(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace("T", " ")
    .replace("Z", "")
    .slice(0, 19);
}

function isStaleVersion(expected: unknown, actual: unknown) {
  const expectedVersion = normalizeVersion(expected);
  return Boolean(expectedVersion) && expectedVersion !== normalizeVersion(actual);
}

function staleVersionResult(current?: Record<string, unknown>) {
  return {
    error: "Esta posição foi alterada por outra pessoa. A escala será recarregada; confira antes de salvar novamente.",
    status: 409 as const,
    conflict: true as const,
    current,
  };
}

function staleVersionResponse(current?: Record<string, unknown>) {
  const result = staleVersionResult(current);
  return Response.json(
    { error: result.error, conflict: true, current: result.current },
    { status: result.status },
  );
}

function staleAssignmentGroup(
  body: Record<string, unknown>,
  before: Record<string, unknown>[],
) {
  const raw = body.expectedUpdatedAts;
  if (!Array.isArray(raw)) return null;
  const versions = new Map<number, unknown>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as { id?: unknown; updatedAt?: unknown; updated_at?: unknown };
    const id = Number(value.id || 0);
    if (id) versions.set(id, value.updatedAt ?? value.updated_at);
  }
  const stale = before.find((item) => {
    const expected = versions.get(Number(item.id));
    return expected !== undefined && isStaleVersion(expected, item.updated_at);
  });
  return stale ? staleVersionResult(stale) : null;
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
  let id = Number(opts.id || 0);
  // The editor normally sends the assignment id.  Keep the operation safe if
  // an older cached client loses that field: an edit of an existing cell must
  // update the row already occupying it, never create a second GM card.
  if (!id) {
    const existing = await env.DB.prepare(
      `SELECT id FROM assignments
       WHERE schedule_id=? AND guard_id=? AND starts_at=?
         AND COALESCE(post_id,0)=COALESCE(?,0)
         AND COALESCE(vehicle_id,0)=COALESCE(?,0)
       ORDER BY id LIMIT 1`,
    )
      .bind(
        opts.scheduleId,
        opts.guardId,
        opts.start,
        b.postId || null,
        b.vehicleId || null,
      )
      .first<{ id: number }>();
    if (existing) id = Number(existing.id);
  }
  const before = id
    ? await env.DB.prepare(
        "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=? AND a.schedule_id=?",
      ).bind(id, opts.scheduleId).first<Record<string, unknown>>()
    : null;
  if (id && !before)
    return { error: "Designação não encontrada nesta escala.", status: 404 as const };
  if (before && isStaleVersion((b as Record<string, unknown>).expectedUpdatedAt, before.updated_at))
    return staleVersionResult(before);
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
  // A legacy client/database can contain an exact duplicate of the same
  // guard/resource/start.  Once this row is saved, keep the canonical id and
  // remove only exact duplicates; different shifts or destinations are kept.
  const duplicateRows = await env.DB.prepare(
    `SELECT id FROM assignments
     WHERE schedule_id=? AND guard_id=? AND starts_at=?
       AND COALESCE(post_id,0)=COALESCE(?,0)
       AND COALESCE(vehicle_id,0)=COALESCE(?,0)
       AND id!=?`,
  )
    .bind(
      opts.scheduleId,
      opts.guardId,
      opts.start,
      b.postId || null,
      b.vehicleId || null,
      assignmentId,
    )
    .all<{ id: number }>();
  if (duplicateRows.results.length) {
    await env.DB.batch(
      duplicateRows.results.map((duplicate) =>
        env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(duplicate.id),
      ),
    );
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
  if (b.action === "create_service_adjustment") {
    await ensureServiceAdjustmentsTable();
    const subtype = String(b.subtype || "");
    const serviceDate = String(b.serviceDate || "");
    const guardId = Number(b.guardId || 0);
    const counterpartGuardId = Number(b.counterpartGuardId || 0) || null;
    const requestRef = String(b.requestRef || "").trim() || null;
    const notes = String(b.notes || "").trim() || null;
    if (!isScheduleDate(serviceDate) || !["negative_early", "negative_full", "positive", "swap"].includes(subtype) || !guardId)
      return Response.json({ error: "Informe o GM, a data e o tipo do lançamento." }, { status: 400 });
    const guard = await env.DB.prepare("SELECT id,name FROM guards WHERE id=? AND active=1").bind(guardId).first<{id:number;name:string}>();
    if (!guard) return Response.json({ error: "GM não encontrado ou inativo." }, { status: 404 });
    if (subtype === "swap" && (!counterpartGuardId || counterpartGuardId === guardId))
      return Response.json({ error: "Selecione dois GMs diferentes para a troca." }, { status: 400 });
    if (counterpartGuardId) {
      const counterpart = await env.DB.prepare("SELECT id FROM guards WHERE id=? AND active=1").bind(counterpartGuardId).first();
      if (!counterpart) return Response.json({ error: "O segundo GM não foi encontrado ou está inativo." }, { status: 404 });
    }
    await ensureBase(serviceDate);
    const schedule = await env.DB.prepare("SELECT id FROM schedules WHERE date=?").bind(serviceDate).first<{id:number}>();
    if (!schedule) return Response.json({ error: "Não foi possível abrir a escala da data." }, { status: 500 });
    const tomorrow = new Date(`${serviceDate}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dayStart = `${serviceDate}T00:00`;
    // A 12x36 operational day includes the 1º turno until 07:00 of the
    // following calendar day.  This also covers legacy rows stored on the
    // service date itself (01:00–07:00).
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    const dayEnd = `${tomorrowDate}T07:00`;
    const startsAt = subtype === "negative_full" ? dayStart : String(b.startsAt || "");
    const endsAt = subtype === "negative_full" ? dayEnd : String(b.endsAt || "");
    const startMs = Date.parse(startsAt), endMs = Date.parse(endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
      return Response.json({ error: "Informe um intervalo válido para o lançamento." }, { status: 400 });
    const loadGuardAssignments = async (id:number) => (await env.DB.prepare(
      "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.schedule_id=? AND a.guard_id=? AND a.starts_at<? AND a.ends_at>? ORDER BY a.starts_at,a.id",
    ).bind(schedule.id,id,endsAt,startsAt).all<Record<string,unknown>>()).results;
    const base = {
      kind: subtype === "swap" ? "swap" : "time_bank",
      subtype, guardId, counterpartGuardId, serviceDate, startsAt, endsAt, requestRef, notes,
    };
    const existingAdjustment = await env.DB.prepare(`SELECT id FROM service_adjustments
      WHERE status='active' AND service_date=?
        AND (guard_id=? OR counterpart_guard_id=? OR guard_id=? OR counterpart_guard_id=?)
        AND starts_at<? AND ends_at>? LIMIT 1`)
      .bind(serviceDate, guardId, guardId, counterpartGuardId || -1, counterpartGuardId || -1, endsAt, startsAt)
      .first();
    if (existingAdjustment)
      return Response.json({ error: "Já existe um banco ou troca ativa para este GM nesse intervalo." }, { status: 409 });
    if (subtype === "positive") {
      const existing = await loadGuardAssignments(guardId);
      if (existing.length) return Response.json({ error: `${guard.name} já possui uma designação neste intervalo.` }, { status: 409 });
      const conflictingMovement = await env.DB.prepare("SELECT type FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1").bind(guardId,endsAt,startsAt).first<{type:string}>();
      if (conflictingMovement) return Response.json({ error: `${guard.name} possui uma movimentação neste intervalo.` }, { status: 409 });
      const hour = Number(startsAt.slice(11, 13));
      const shift = hour < 7 ? "1" : hour < 13 ? "2" : hour < 19 ? "3" : "4";
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO service_adjustments (kind,subtype,guard_id,service_date,starts_at,ends_at,request_ref,notes,status,snapshot_json) VALUES (?,?,?,?,?,?,?,?,'active',?)").bind(base.kind,subtype,guardId,serviceDate,startsAt,endsAt,requestRef,notes,"{}"),
        env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(schedule.id,guardId,null,null,shift,"guard",startsAt,endsAt,"time_bank_positive","time_bank",requestRef,0,notes||"BH+ aguardando remanejamento"),
      ]);
      const adjustmentId = Number(results[0].meta.last_row_id), assignmentId = Number(results[1].meta.last_row_id);
      await env.DB.prepare("UPDATE service_adjustments SET snapshot_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({createdAssignmentId:assignmentId}),adjustmentId).run();
      const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id WHERE sa.id=?").bind(adjustmentId).first();
      const auditEventId = await writeAudit(request,{action:"create",entityType:"service_adjustment",entityId:adjustmentId,summary:`Registrou BH+ de ${guard.name} em ${serviceDate}`,after:adjustment as Record<string,unknown>,undoable:false});
      return Response.json({ok:true,adjustment,auditEventId,message:`BH+ de ${guard.name} criado e colocado à disposição para ${serviceDate}.`});
    }
    if (subtype === "swap") {
      const left = await loadGuardAssignments(guardId);
      const right = await loadGuardAssignments(counterpartGuardId!);
      if (!left.length || !right.length || left.length !== right.length || left.some((item,index)=>String(item.starts_at)!==String(right[index].starts_at)||String(item.ends_at)!==String(right[index].ends_at)))
        return Response.json({ error: "A troca precisa encontrar os dois GMs escalados nos mesmos horários." }, { status: 409 });
      const snapshot = JSON.stringify({assignments:[...left,...right]});
      const updates = left.map((item,index) => {
        const other = right[index];
        return env.DB.prepare("UPDATE assignments SET post_id=?,vehicle_id=?,shift=?,role=?,status='swap',request_ref=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(other.post_id||null,other.vehicle_id||null,other.shift,other.role,requestRef,`Troca de serviço com ${other.guard_name}`,item.id);
      }).concat(right.map((item,index) => {
        const other = left[index];
        return env.DB.prepare("UPDATE assignments SET post_id=?,vehicle_id=?,shift=?,role=?,status='swap',request_ref=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(other.post_id||null,other.vehicle_id||null,other.shift,other.role,requestRef,`Troca de serviço com ${other.guard_name}`,item.id);
      }));
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO service_adjustments (kind,subtype,guard_id,counterpart_guard_id,service_date,starts_at,ends_at,request_ref,notes,status,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,'active',?)").bind(base.kind,subtype,guardId,counterpartGuardId,serviceDate,startsAt,endsAt,requestRef,notes,snapshot),
        ...updates,
      ]);
      const adjustmentId = Number(results[0].meta.last_row_id);
      const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name,c.name counterpart_guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id LEFT JOIN guards c ON c.id=sa.counterpart_guard_id WHERE sa.id=?").bind(adjustmentId).first();
      const auditEventId = await writeAudit(request,{action:"create",entityType:"service_adjustment",entityId:adjustmentId,summary:`Registrou troca entre ${guard.name} e ${adjustment?.counterpart_guard_name}`,after:adjustment as Record<string,unknown>,undoable:false});
      return Response.json({ok:true,adjustment,auditEventId,message:`Troca aplicada entre ${guard.name} e ${adjustment?.counterpart_guard_name}.`});
    }
    const assignments = await loadGuardAssignments(guardId);
    const affectedAssignments = subtype === "negative_full"
      ? assignments
      : assignments.filter((item) => Date.parse(String(item.ends_at)) > endMs);
    const snapshot = JSON.stringify({assignments: affectedAssignments});
    const updates = affectedAssignments.map((item) => subtype === "negative_full"
      ? env.DB.prepare("UPDATE assignments SET post_id=NULL,vehicle_id=NULL,status='time_bank',request_ref=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(requestRef,notes||`BH- de ${guard.name}`,item.id)
      : env.DB.prepare("UPDATE assignments SET ends_at=?,regular_ends_at=CASE WHEN regular_ends_at IS NOT NULL AND regular_ends_at>? THEN ? ELSE regular_ends_at END,status='time_bank',request_ref=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(endsAt,endsAt,endsAt,requestRef,notes||`BH- de ${guard.name}`,item.id));
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO service_adjustments (kind,subtype,guard_id,service_date,starts_at,ends_at,request_ref,notes,status,snapshot_json) VALUES (?,?,?,?,?,?,?,?,'active',?)").bind(base.kind,subtype,guardId,serviceDate,startsAt,endsAt,requestRef,notes,snapshot),
      ...updates,
    ]);
    const adjustmentId = Number(results[0].meta.last_row_id);
    const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id WHERE sa.id=?").bind(adjustmentId).first();
    const auditEventId = await writeAudit(request,{action:"create",entityType:"service_adjustment",entityId:adjustmentId,summary:`Registrou ${subtype==='negative_full'?'BH- integral':'BH- com saída antecipada'} de ${guard.name}`,after:adjustment as Record<string,unknown>,undoable:false});
    return Response.json({ok:true,adjustment,auditEventId,message:`Banco de horas negativo aplicado para ${guard.name} em ${serviceDate}.`});
  }
  if (b.action === "cancel_service_adjustment") {
    await ensureServiceAdjustmentsTable();
    const id = Number(b.id || 0);
    const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id WHERE sa.id=? AND sa.status='active'").bind(id).first<Record<string,unknown>>();
    if (!adjustment) return Response.json({ error: "Lançamento não encontrado ou já cancelado." }, { status: 404 });
    let snapshot:Record<string,unknown> = {};
    try { snapshot = JSON.parse(String(adjustment.snapshot_json || "{}")) as Record<string,unknown>; } catch { return Response.json({ error: "O histórico deste lançamento está inválido." }, { status: 409 }); }
    const statements:D1PreparedStatement[] = [];
    if (String(adjustment.subtype) === "positive") {
      const assignmentId = Number(snapshot.createdAssignmentId || 0);
      const current = assignmentId ? await env.DB.prepare("SELECT post_id,vehicle_id FROM assignments WHERE id=?").bind(assignmentId).first<{post_id:number|null;vehicle_id:number|null}>() : null;
      if (current?.post_id || current?.vehicle_id) statements.push(env.DB.prepare("UPDATE assignments SET status='normal',work_kind='shift',request_ref=NULL,reassignment_note=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(assignmentId));
      else if (assignmentId) statements.push(env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(assignmentId));
    } else {
      const originals = Array.isArray(snapshot.assignments) ? snapshot.assignments as Array<Record<string,unknown>> : [];
      for (const row of originals) statements.push(env.DB.prepare("UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=?,break_starts_at=?,break_ends_at=?,work_kind=?,status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.guard_id,row.post_id||null,row.vehicle_id||null,row.shift,row.role,row.starts_at,row.ends_at,row.regular_ends_at||null,row.break_starts_at||null,row.break_ends_at||null,row.work_kind||"shift",row.status||"normal",row.request_ref||null,row.is_reassigned||0,row.reassignment_note||null,row.id));
    }
    statements.push(env.DB.prepare("UPDATE service_adjustments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id));
    await env.DB.batch(statements);
    const auditEventId = await writeAudit(request,{action:"cancel",entityType:"service_adjustment",entityId:id,summary:`Cancelou lançamento de ${adjustment.guard_name}`,before:adjustment,undoable:false});
    return Response.json({ok:true,auditEventId,message:`Lançamento de ${adjustment.guard_name} cancelado e escala restaurada.`});
  }
  if (b.action === "copy_assignment_to_cell") {
    const sourceId=Number(b.sourceAssignmentId||0),scheduleId=Number(b.scheduleId||0),targetShift=String(b.shift||"");
    const source=await env.DB.prepare("SELECT a.*,g.name guard_name,s.date schedule_date FROM assignments a JOIN guards g ON g.id=a.guard_id JOIN schedules s ON s.id=a.schedule_id WHERE a.id=? AND a.schedule_id=?").bind(sourceId,scheduleId).first<Record<string,unknown>>();
    if(!source)return Response.json({error:"O GM copiado não foi encontrado nesta escala."},{status:404});
    if(!["1","2","3","4"].includes(targetShift))return Response.json({error:"Escolha um quadrante válido para colar."},{status:400});
    const postId=Number(b.postId||0)||null,vehicleId=Number(b.vehicleId||0)||null;
    if((postId?1:0)+(vehicleId?1:0)!==1)return Response.json({error:"Escolha um único destino para colar."},{status:400});
    const resource=postId
      ? await env.DB.prepare("SELECT id FROM posts WHERE id=? AND active=1").bind(postId).first()
      : await env.DB.prepare("SELECT id FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first();
    if(!resource)return Response.json({error:"O destino não existe mais ou foi desativado."},{status:404});
    const excluded=await env.DB.prepare("SELECT id FROM schedule_resource_exclusions WHERE schedule_id=? AND resource_kind=? AND resource_id=? LIMIT 1").bind(scheduleId,postId?"post":"vehicle",postId||vehicleId).first();
    if(excluded)return Response.json({error:"Este local foi retirado da escala e não pode receber o GM."},{status:409});
    if(vehicleId){
      const outage=await env.DB.prepare("SELECT id FROM vehicle_outages WHERE vehicle_id=? AND active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?) LIMIT 1").bind(vehicleId,source.schedule_date,source.schedule_date).first();
      if(outage)return Response.json({error:"A viatura está em FA nesta data."},{status:409});
    }
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
      .bind(scheduleId,source.guard_id,postId,vehicleId,targetShift,role,interval.start,interval.end,"shift",["normal","overtime","time_bank","swap"].includes(String(source.status))?source.status:"normal",source.request_ref||null,source.is_reassigned||0,source.reassignment_note||null).run();
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
      ? await env.DB.prepare("SELECT id,name label,updated_at FROM posts WHERE id=? AND active=1").bind(resourceId).first<Record<string,unknown>>()
      : await env.DB.prepare("SELECT id,prefix label,updated_at FROM vehicles WHERE id=? AND active=1").bind(resourceId).first<Record<string,unknown>>();
    if (!resource) return Response.json({ error: "Local não encontrado ou já desativado." }, { status: 404 });
    if (isStaleVersion((b as Record<string, unknown>).expectedResourceUpdatedAt, resource.updated_at))
      return staleVersionResponse(resource);
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
    const stale = staleAssignmentGroup(b as Record<string, unknown>, before);
    if (stale) return Response.json({ error: stale.error, conflict: true, current: stale.current }, { status: stale.status });
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
    const stale = staleAssignmentGroup(b as Record<string, unknown>, before);
    if (stale) return Response.json({ error: stale.error, conflict: true, current: stale.current }, { status: stale.status });
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
    if (isStaleVersion((b as Record<string, unknown>).expectedVehicleUpdatedAt, source.updated_at))
      return staleVersionResponse(source);
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
    const before = id
      ? await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=? AND a.schedule_id=?").bind(id, scheduleId).first<Record<string, unknown>>()
      : null;
    if (id && !before)
      return Response.json({ error: "Designação não encontrada nesta escala." }, { status: 404 });
    if (before && isStaleVersion((b as Record<string, unknown>).expectedUpdatedAt, before.updated_at))
      return staleVersionResponse(before);
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
    if (isStaleVersion((b as Record<string, unknown>).expectedUpdatedAt, base.updated_at))
      return staleVersionResponse(base);
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
  if (b.action === "delete_shift_segment") {
    const id = Number(b.id || 0);
    const scheduleId = Number(b.scheduleId || 0);
    const shift = String(b.shift || "");
    if (!id || !scheduleId || !["1", "2", "3", "4"].includes(shift))
      return Response.json({ error: "Informe o horário que será removido." }, { status: 400 });
    const schedule = await env.DB.prepare("SELECT id,date FROM schedules WHERE id=?").bind(scheduleId).first<{ id:number; date:string }>();
    const before = await env.DB.prepare(
      "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=? AND a.schedule_id=?",
    ).bind(id, scheduleId).first<Record<string, unknown>>();
    if (!schedule || !before)
      return Response.json({ error: "Designação não encontrada nesta escala." }, { status: 404 });
    if (isStaleVersion((b as Record<string, unknown>).expectedUpdatedAt, before.updated_at))
      return staleVersionResponse(before);

    // Prefer the real next-day window for 1º turno, but keep compatibility
    // with older rows stored as date 01:00–07:00.
    const operationalWindow = operationalShiftWindow(schedule.date, shift);
    const legacyWindow = periodShiftTimes(schedule.date, shift);
    const beforeStart = String(before.starts_at || "");
    const beforeEnd = String(before.ends_at || "");
    const overlaps = (window: { start:string; end:string }) =>
      Date.parse(beforeStart) < Date.parse(window.end) && Date.parse(beforeEnd) > Date.parse(window.start);
    const window = shift === "1" && !overlaps(operationalWindow) && overlaps(legacyWindow)
      ? legacyWindow
      : operationalWindow;
    const segmentStart = Date.parse(window.start);
    const segmentEnd = Date.parse(window.end);
    const assignmentStart = Date.parse(beforeStart);
    const assignmentEnd = Date.parse(beforeEnd);
    if (![segmentStart, segmentEnd, assignmentStart, assignmentEnd].every(Number.isFinite) || assignmentEnd <= assignmentStart || assignmentEnd <= segmentStart || assignmentStart >= segmentEnd)
      return Response.json({ error: "O horário selecionado não está dentro desta designação." }, { status: 409 });

    const pieces = [
      assignmentStart < segmentStart ? { start: beforeStart, end: window.start } : null,
      assignmentEnd > segmentEnd ? { start: window.end, end: beforeEnd } : null,
    ].filter(Boolean) as Array<{ start:string; end:string }>;
    const pieceFields = (piece: { start:string; end:string }) => {
      const regular = String(before.regular_ends_at || "");
      const regularMs = Date.parse(regular);
      const pieceStart = Date.parse(piece.start);
      const pieceEnd = Date.parse(piece.end);
      let regularEnd: string | null = null;
      if (regular && Number.isFinite(regularMs) && regularMs > pieceStart) {
        regularEnd = regularMs <= pieceEnd ? regular : piece.end;
      }
      const breakStart = String(before.break_starts_at || "");
      const breakEnd = String(before.break_ends_at || "");
      const breakStartMs = Date.parse(breakStart);
      const breakEndMs = Date.parse(breakEnd);
      const hasBreak = breakStart && breakEnd && Number.isFinite(breakStartMs) && Number.isFinite(breakEndMs)
        && breakStartMs >= pieceStart && breakEndMs <= pieceEnd;
      return {
        regularEnd,
        breakStart: hasBreak ? breakStart : null,
        breakEnd: hasBreak ? breakEnd : null,
      };
    };
    const beforePieces = pieces.map((piece) => ({ ...piece, ...pieceFields(piece) }));
    let insertedId = 0;
    if (!beforePieces.length) {
      await env.DB.prepare("DELETE FROM assignments WHERE id=? AND schedule_id=?").bind(id, scheduleId).run();
    } else {
      const first = beforePieces[0];
      await env.DB.prepare(
        "UPDATE assignments SET starts_at=?,ends_at=?,regular_ends_at=?,break_starts_at=?,break_ends_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND schedule_id=?",
      ).bind(first.start, first.end, first.regularEnd, first.breakStart, first.breakEnd, id, scheduleId).run();
      if (beforePieces.length > 1) {
        const second = beforePieces[1];
        const created = await env.DB.prepare(
          "INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,break_starts_at,break_ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          scheduleId,
          before.guard_id,
          before.post_id || null,
          before.vehicle_id || null,
          before.shift,
          before.role,
          second.start,
          second.end,
          second.regularEnd,
          second.breakStart,
          second.breakEnd,
          before.work_kind || "shift",
          before.status || "normal",
          before.request_ref || null,
          before.is_reassigned || 0,
          before.reassignment_note || null,
        ).run();
        insertedId = Number(created.meta.last_row_id);
      }
    }
    const changedIds = beforePieces.length ? [id, insertedId].filter(Boolean) : [];
    const assignments = changedIds.length
      ? (await env.DB.prepare(`SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${changedIds.map(() => "?").join(",")}) ORDER BY a.starts_at`).bind(...changedIds).all<Record<string, unknown>>()).results
      : [];
    const auditEventId = await writeAudit(request, {
      action: beforePieces.length ? "update" : "delete",
      entityType: "assignment_segment",
      entityId: id,
      summary: `Removeu ${before.guard_name} somente de ${shift}º turno`,
      before: { assignment: before, shift, window },
      after: beforePieces.length ? { assignments } : undefined,
      undoable: true,
    });
    return Response.json({
      ok: true,
      assignments,
      deletedId: beforePieces.length ? undefined : id,
      auditEventId,
      message: beforePieces.length
        ? `Horário de ${before.guard_name} removido. Os demais períodos foram preservados.`
        : `${before.guard_name} removido somente deste horário.`,
    });
  }
  if (b.action === "delete") {
    const before = await env.DB.prepare(
      "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?",
    ).bind(b.id).first<Record<string,unknown>>();
    if (!before)
      return Response.json({ error: "Designação não encontrada." }, { status: 404 });
    if (isStaleVersion((b as Record<string, unknown>).expectedUpdatedAt, before.updated_at))
      return staleVersionResponse(before);
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
        return Response.json({ error: result.error, conflict: "conflict" in result ? result.conflict : false }, { status: result.status });
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
    return Response.json({ error: result.error, conflict: "conflict" in result ? result.conflict : false }, { status: result.status });
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
    // Remanejamento rápido é exclusivo da bandeja "À disposição". Quem ainda
    // ocupa posto ou VTR não deve aparecer como candidato nesta categoria.
    if (Number(assignment.awaiting_redeploy) !== 1) continue;
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
        availableForRedeployment: true,
      };
    })
    .sort((a, b) =>
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
