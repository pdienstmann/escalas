import { env } from "cloudflare:workers";
import {
  applyPatternsToSchedule,
  reconcileWeeklySchedule,
  ensurePatterns,
  resolvePatternCodes,
} from "../../../lib/pattern-engine";
import { writeAudit } from "../../../lib/audit";
import { permitted } from "../../../lib/access";
import { isScheduleDate, todayScheduleDate } from "../../../lib/schedule-date";
import { fullPeriodShifts, fullPeriodWindow, shiftTimes as periodShiftTimes, operationalShiftWindow, isDayShift, mapAssignmentSegmentToShift, splitExtensionWindow } from "../../../lib/shift-rules";
import { rankGuardSuggestions, describeReasons } from "../../../lib/suggest-gm";
import { hasRequiredVehicleCrew, hasUniqueCrewMembers, isMotorcycleType } from "../../../lib/crew-rules";
import { orderedResourceGuardIds } from "../../../lib/schedule-lanes";
import { copiedBlockStatus } from "../../../lib/copy-rules";
import { ensureOperationalGroups } from "../../../lib/operational-groups-db";

export const dynamic = "force-dynamic";

let dailyGroupContextReady: Promise<void> | null = null;
let scheduleDisplaySettingsReady: Promise<void> | null = null;


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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function ensureCatalog() {
  // Demo catalog removed. Catalog is imported/managed explicitly.
  return;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function ensureDemoMovements() {
  // Demo movements removed. Real adjustments come from the management UI.
  return;
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
  for(const group of groups){
    // The fleet has its own dedicated section; resource rows accidentally
    // classified as VIATURAS E ZONAS must not create a second header.
    if(String(group.group_name)==="VIATURAS E ZONAS")continue;
    commands.push(env.DB.prepare("INSERT OR IGNORE INTO schedule_sections (section_key,label,sort_order) VALUES (?,?,?)").bind(`POST:${group.group_name}`,group.group_name,Number(group.sort_order||0)+10));
  }
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
  // The imported PAR/ÍMPAR patterns are the source of truth.  The former
  // fallback filled empty resources with arbitrary catalog guards, which
  // made a generated day differ from the pattern and hid real holes.
  return;
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
  await ensureDailyGroupContext();
  await ensureScheduleDisplaySettings();
  // An already generated schedule only needs the small, date-specific weekly
  // reconciliation. Re-running every schema/catalog check on each page visit
  // made ordinary date changes take several seconds on D1.
  const existingSchedule = await env.DB.prepare("SELECT id FROM schedules WHERE date=?")
    .bind(date)
    .first<{ id: number }>();
  if (existingSchedule) {
    await reconcileWeeklySchedule(env.DB, date, existingSchedule.id);
    return;
  }
  await ensureServiceAdjustmentsTable();
  // Pattern-scoped operational groups reference shift_patterns.  Ensure the
  // parent catalog exists before creating the group-members table.
  await ensurePatterns(env.DB);
  await ensureOperationalGroups(env.DB);
  await ensureAssignmentLaneOrder();
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
  // Catalog and movements are maintained by the admin/import flows.  Do not
  // recreate the former demo records when a schedule is opened.
  await ensureSections();
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
    await reconcileWeeklySchedule(env.DB,date,schedule.id);
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

async function ensureScheduleDisplaySettings() {
  if (!scheduleDisplaySettingsReady) {
    scheduleDisplaySettingsReady = (async () => {
      const columns = new Set(
        (await env.DB.prepare("PRAGMA table_info(schedules)").all<{ name: string }>()).results.map((column) => column.name),
      );
      if (!columns.has("hide_empty_resources")) {
        try {
          await env.DB.prepare("ALTER TABLE schedules ADD COLUMN hide_empty_resources INTEGER NOT NULL DEFAULT 0").run();
        } catch (error) {
          // Two cold Worker isolates may observe the old schema together. The
          // second ALTER is harmless once the first isolate created the column.
          if (!String(error).toLowerCase().includes("duplicate column")) throw error;
        }
      }
    })().catch((error) => {
      scheduleDisplaySettingsReady = null;
      throw error;
    });
  }
  await scheduleDisplaySettingsReady;
}

async function ensureDailyGroupContext() {
  if (!dailyGroupContextReady) {
    dailyGroupContextReady = env.DB.prepare(`CREATE TABLE IF NOT EXISTS schedule_operational_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES schedules(id),
      group_id INTEGER NOT NULL REFERENCES operational_groups(id),
      team_label TEXT NOT NULL DEFAULT 'EQUIPE GERAL',
      guard_id INTEGER NOT NULL REFERENCES guards(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(schedule_id,group_id,team_label,guard_id)
    )`).run().then(() => undefined).catch((error) => {
      dailyGroupContextReady = null;
      throw error;
    });
  }
  await dailyGroupContextReady;
}

async function ensureAssignmentLaneOrder() {
  const columns = new Set(
    (await env.DB.prepare("PRAGMA table_info(assignments)").all<{ name: string }>()).results.map((column) => column.name),
  );
  if (!columns.has("lane_order")) {
    await env.DB.prepare("ALTER TABLE assignments ADD COLUMN lane_order INTEGER").run();
  }
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_assignments_lane_order ON assignments(schedule_id,post_id,vehicle_id,lane_order)",
  ).run();
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
    hours REAL,
    counterpart_service_date TEXT,
    counterpart_starts_at TEXT,
    counterpart_ends_at TEXT,
    settlement_date TEXT,
    settlement_starts_at TEXT,
    settlement_ends_at TEXT,
    settlement_hours REAL,
    request_ref TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    snapshot_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const columns = new Set(
    (await env.DB.prepare("PRAGMA table_info(service_adjustments)").all<{ name: string }>()).results.map((column) => column.name),
  );
  for (const [name, definition] of [["hours", "REAL"], ["counterpart_service_date", "TEXT"], ["counterpart_starts_at", "TEXT"], ["counterpart_ends_at", "TEXT"], ["settlement_date", "TEXT"], ["settlement_starts_at", "TEXT"], ["settlement_ends_at", "TEXT"], ["settlement_hours", "REAL"]] as const) {
    if (!columns.has(name)) await env.DB.prepare(`ALTER TABLE service_adjustments ADD COLUMN ${name} ${definition}`).run();
  }
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_service_adjustments_date ON service_adjustments(service_date,status)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_service_adjustments_counterpart_date ON service_adjustments(counterpart_service_date,status)",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_service_adjustments_settlement_date ON service_adjustments(settlement_date,status)",
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
  const [guards, posts, vehicles, allVehicles, assignments, movements, notices, outages, sections, operations, serviceAdjustments, operationalGroups, operationalGroupMembers, weeklySlotCount] =
    await Promise.all([
      env.DB.prepare(
        "SELECT id,name,CASE WHEN registration LIKE 'SEM-MATRICULA-%' THEN NULL ELSE registration END AS registration,platoon,base_shift,work_regime,overtime_eligible FROM guards WHERE active=1 ORDER BY name",
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
        `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id
         WHERE a.schedule_id=?
           AND (COALESCE(g.work_regime,'12x36')!='weekly'
             OR COALESCE(a.work_kind,'shift') IN ('weekly','overtime_extension','time_bank_positive'))
         ORDER BY a.shift,a.role,g.name`,
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
        WHERE sa.status='active' AND (sa.service_date=? OR sa.counterpart_service_date=? OR sa.settlement_date=?)
        ORDER BY CASE WHEN sa.service_date=? THEN sa.starts_at WHEN sa.counterpart_service_date=? THEN sa.counterpart_starts_at ELSE sa.settlement_starts_at END,sa.id`).bind(date,date,date,date,date).all(),
      env.DB.prepare("SELECT id,name,short_name,color,sort_order,active FROM operational_groups WHERE active=1 ORDER BY sort_order,name").all(),
      env.DB.prepare(`SELECT m.id,m.group_id,m.resource_kind,m.resource_id,m.team_label,g.name group_name,g.short_name group_short_name,g.color group_color,g.sort_order group_sort_order
        FROM operational_group_members m JOIN operational_groups g ON g.id=m.group_id
        WHERE g.active=1 AND (m.resource_kind!='guard' OR EXISTS (SELECT 1 FROM guards gm WHERE gm.id=m.resource_id AND gm.active=1 AND COALESCE(gm.work_regime,'12x36')!='weekly')) ORDER BY g.sort_order,g.name,m.resource_kind,m.resource_id`).all(),
      env.DB.prepare("SELECT COUNT(*) total FROM weekly_slots WHERE active=1").first<{ total: number }>(),
    ]);
  const operationAssignments=(await env.DB.prepare(`SELECT os.guard_id,o.starts_at,o.ends_at FROM operation_slots os JOIN operations o ON o.id=os.operation_id WHERE o.schedule_id=? AND o.status!='cancelled' AND os.guard_id IS NOT NULL`).bind(schedule?.id).all<{guard_id:number;starts_at:string;ends_at:string}>()).results;
  const blocked = new Set([
      ...movements.results.map((m) => Number(m.guard_id)),
      ...serviceAdjustments.results.filter((item) => String(item.subtype)==="negative_full" && String(item.service_date)===date).map((item) => Number(item.guard_id)),
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
  const patternOperationalGroupMembers = appliedPattern
    ? await env.DB.prepare(`SELECT m.id,m.pattern_id,m.group_id,m.resource_kind,m.resource_id,m.team_label,m.shift,m.vehicle_id,m.starts_at,m.ends_at,p.code pattern_code,p.period pattern_period,g.name group_name,g.short_name group_short_name,g.color group_color,g.sort_order group_sort_order
      FROM pattern_operational_group_members m JOIN shift_patterns p ON p.id=m.pattern_id AND p.active=1 JOIN operational_groups g ON g.id=m.group_id AND g.active=1
      WHERE m.pattern_id IN (SELECT day_pattern_id FROM schedule_patterns WHERE schedule_id=? UNION SELECT night_pattern_id FROM schedule_patterns WHERE schedule_id=?)
        AND (m.resource_kind!='guard' OR EXISTS (SELECT 1 FROM guards gm WHERE gm.id=m.resource_id AND gm.active=1 AND COALESCE(gm.work_regime,'12x36')!='weekly'))
      ORDER BY g.sort_order,g.name,m.resource_kind,m.resource_id`).bind(schedule?.id,schedule?.id).all()
    : { results: [] as Record<string, unknown>[] };
  const dailyOperationalGroupMembers = schedule
    ? await env.DB.prepare(`SELECT MIN(d.id) id,-d.schedule_id pattern_id,d.group_id,'guard' resource_kind,d.guard_id resource_id,d.team_label,
        CASE WHEN MIN(a.starts_at)<s.date||'T19:00' THEN 'day' ELSE 'night' END pattern_period,
        CASE WHEN MIN(a.starts_at)<s.date||'T19:00' THEN '2' ELSE '4' END shift,
        MAX(a.vehicle_id) vehicle_id,substr(MIN(a.starts_at),12,5) starts_at,substr(MAX(a.ends_at),12,5) ends_at,
        g.name group_name,g.short_name group_short_name,g.color group_color,g.sort_order group_sort_order
      FROM schedule_operational_group_members d
      JOIN schedules s ON s.id=d.schedule_id
      JOIN operational_groups g ON g.id=d.group_id AND g.active=1
      JOIN assignments a ON a.schedule_id=d.schedule_id AND a.guard_id=d.guard_id
      WHERE d.schedule_id=?
      GROUP BY d.schedule_id,d.group_id,d.team_label,d.guard_id,g.name,g.short_name,g.color,g.sort_order`).bind(schedule.id).all<Record<string,unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const contextualMembers = [...new Map(
    [...operationalGroupMembers.results, ...patternOperationalGroupMembers.results, ...dailyOperationalGroupMembers.results].map((member) => [
      `${member.group_id}:${member.resource_kind}:${member.resource_id}:${String(member.team_label || "").trim().toUpperCase()}:${member.pattern_period || "global"}`,
      member,
    ]),
  ).values()];
  const suggested=appliedPattern?null:await resolvePatternCodes(env.DB,date);
  const weeklyCount=Number(weeklySlotCount?.total||0);
  const patternDay=String((appliedPattern||suggested)?.day_code||"");
  const patternNight=String((appliedPattern||suggested)?.night_code||"");
  const patternBase=patternDay&&patternNight?`${patternDay} + ${patternNight}`:"Sem padrão aplicado";
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
    operationalGroups: operationalGroups.results,
    operationalGroupMembers: contextualMembers,
    weeklySlotCount: weeklyCount,
    patternLabel: appliedPattern
      ? `${patternBase}${weeklyCount ? " + SEMANAL" : ""}`
      : `${patternBase}${weeklyCount ? " + SEMANAL" : ""} · AJUSTES`,
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
  let normalizedRole = String(b.role || "guard");
  if (b.vehicleId) {
    const vehicle = await env.DB.prepare("SELECT id,type FROM vehicles WHERE id=? AND active=1").bind(Number(b.vehicleId)).first<{ id: number; type: string | null }>();
    if (!vehicle) return { error: "A viatura não foi encontrada ou está desativada.", status: 404 as const };
    if (isMotorcycleType(vehicle.type)) {
      const occupied = await env.DB.prepare(
        "SELECT guard_id FROM assignments WHERE schedule_id=? AND vehicle_id=? AND id!=? AND starts_at<? AND ends_at>? AND COALESCE(work_kind,'shift')!='overtime_extension'",
      ).bind(opts.scheduleId, Number(b.vehicleId), id, opts.end, opts.start).all<{ guard_id: number }>();
      if (occupied.results.some((row) => Number(row.guard_id) !== Number(opts.guardId))) {
        return { error: "Esta moto já possui um GM no mesmo horário. Motos comportam somente um condutor.", status: 409 as const };
      }
      normalizedRole = "driver";
    }
  }
  const blocked = await assertAssignable(opts.scheduleId, opts.guardId, opts.start, opts.end, id);
  if (blocked) return blocked;
  let assignmentId = id;
  if (id)
    await env.DB.prepare(
      "UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,lane_order=CASE WHEN COALESCE(post_id,0)<>COALESCE(?,0) OR COALESCE(vehicle_id,0)<>COALESCE(?,0) THEN NULL ELSE lane_order END,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=?,break_starts_at=COALESCE(?,break_starts_at),break_ends_at=COALESCE(?,break_ends_at),work_kind=COALESCE(?,work_kind),status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(
        opts.guardId,
        b.postId || null,
        b.vehicleId || null,
        b.postId || null,
        b.vehicleId || null,
        opts.shift,
        normalizedRole,
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
        normalizedRole,
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
  await ensureAssignmentLaneOrder();
  await ensureDailyGroupContext();
  await ensureScheduleDisplaySettings();
  const b = (await request.json()) as Record<string, string | number | boolean | null>;
  if (b.action === "set_empty_resource_visibility") {
    const scheduleId = Number(b.scheduleId || 0);
    const hide = Boolean(b.hide);
    const before = await env.DB.prepare("SELECT id,date,hide_empty_resources FROM schedules WHERE id=?").bind(scheduleId).first<Record<string,unknown>>();
    if (!before) return Response.json({ error: "Escala não encontrada." }, { status: 404 });
    await env.DB.prepare("UPDATE schedules SET hide_empty_resources=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hide ? 1 : 0,scheduleId).run();
    const schedule = await env.DB.prepare("SELECT id,date,hide_empty_resources,updated_at FROM schedules WHERE id=?").bind(scheduleId).first<Record<string,unknown>>();
    const auditEventId = await writeAudit(request,{action:"update",entityType:"schedule_display",entityId:scheduleId,summary:hide?"Ocultou locais sem GM na escala e no PDF":"Exibiu todos os locais previstos na escala e no PDF",before,after:schedule,undoable:false});
    return Response.json({ok:true,schedule,auditEventId,message:hide?"Locais sem GM foram recolhidos e também não aparecerão no PDF.":"Todos os locais previstos voltaram a aparecer na escala e no PDF."});
  }
  if (b.action === "create_service_adjustment") {
    await ensureServiceAdjustmentsTable();
    const subtype = String(b.subtype || "");
    const serviceDate = String(b.serviceDate || "");
    const counterpartServiceDate = subtype === "swap" ? String(b.counterpartServiceDate || "") : null;
    const negativeSubtype = ["negative_early", "negative_late", "negative_full"].includes(subtype);
    const settlementEnabled = negativeSubtype && ["1", "true", "on", "yes"].includes(String(b.settlementEnabled || b.payBhp || "").toLowerCase());
    const settlementDate = settlementEnabled ? String(b.settlementDate || "") : null;
    const settlementStartsAt = settlementEnabled ? String(b.settlementStartsAt || "") : null;
    const settlementEndsAt = settlementEnabled ? String(b.settlementEndsAt || "") : null;
    const requestedHoursRaw = String(b.negativeHours || b.hours || "").trim();
    const requestedHours = requestedHoursRaw ? Number(requestedHoursRaw.replace(",", ".")) : NaN;
    const guardId = Number(b.guardId || 0);
    const counterpartGuardId = Number(b.counterpartGuardId || 0) || null;
    const requestRef = String(b.requestRef || "").trim() || null;
    const notes = String(b.notes || "").trim() || null;
    if (settlementEnabled && (!settlementDate || !isScheduleDate(settlementDate) || !settlementStartsAt || !settlementEndsAt))
      return Response.json({ error: "Informe a data e o horario em que o BH- sera pago como BH+." }, { status: 400 });
    if (settlementEnabled && settlementDate! <= serviceDate)
      return Response.json({ error: "O dia do BH+ deve ser posterior ao dia do BH-." }, { status: 400 });
    if (negativeSubtype && requestedHoursRaw && (!Number.isFinite(requestedHours) || requestedHours <= 0 || requestedHours > 24))
      return Response.json({ error: "A quantidade de horas do BH- deve estar entre 0,5 e 24 horas." }, { status: 400 });
    if (!isScheduleDate(serviceDate) || !["negative_early", "negative_late", "negative_full", "positive", "swap"].includes(subtype) || !guardId)
      return Response.json({ error: "Informe o GM, a data e o tipo do lançamento." }, { status: 400 });
    const guard = await env.DB.prepare("SELECT id,name FROM guards WHERE id=? AND active=1").bind(guardId).first<{id:number;name:string}>();
    if (!guard) return Response.json({ error: "GM não encontrado ou inativo." }, { status: 404 });
    if (subtype === "swap" && (!counterpartGuardId || counterpartGuardId === guardId))
      return Response.json({ error: "Selecione dois GMs diferentes para a troca." }, { status: 400 });
    if (subtype === "swap" && (!counterpartServiceDate || !isScheduleDate(counterpartServiceDate) || counterpartServiceDate === serviceDate))
      return Response.json({ error: "Informe dois dias diferentes para a troca de serviço." }, { status: 400 });
    if (counterpartGuardId) {
      const counterpart = await env.DB.prepare("SELECT id FROM guards WHERE id=? AND active=1").bind(counterpartGuardId).first();
      if (!counterpart) return Response.json({ error: "O segundo GM não foi encontrado ou está inativo." }, { status: 404 });
    }
    await ensureBase(serviceDate);
    if (counterpartServiceDate) await ensureBase(counterpartServiceDate);
    if (settlementDate) await ensureBase(settlementDate);
    const schedule = await env.DB.prepare("SELECT id FROM schedules WHERE date=?").bind(serviceDate).first<{id:number}>();
    if (!schedule) return Response.json({ error: "Não foi possível abrir a escala da data." }, { status: 500 });
    const counterpartSchedule = counterpartServiceDate
      ? await env.DB.prepare("SELECT id FROM schedules WHERE date=?").bind(counterpartServiceDate).first<{id:number}>()
      : null;
    if (subtype === "swap" && !counterpartSchedule)
      return Response.json({ error: "Não foi possível abrir a escala do segundo dia." }, { status: 500 });
    const settlementSchedule = settlementDate
      ? await env.DB.prepare("SELECT id FROM schedules WHERE date=?").bind(settlementDate).first<{id:number}>()
      : null;
    if (settlementEnabled && !settlementSchedule)
      return Response.json({ error: "Nao foi possivel abrir a escala do dia do BH+." }, { status: 500 });
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
    const counterpartStartsAt = subtype === "swap" ? String(b.counterpartStartsAt || "") : null;
    const counterpartEndsAt = subtype === "swap" ? String(b.counterpartEndsAt || "") : null;
    const startMs = Date.parse(startsAt), endMs = Date.parse(endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
      return Response.json({ error: "Informe um intervalo válido para o lançamento." }, { status: 400 });
    const counterpartStartMs = counterpartStartsAt ? Date.parse(counterpartStartsAt) : NaN;
    const counterpartEndMs = counterpartEndsAt ? Date.parse(counterpartEndsAt) : NaN;
    if (subtype === "swap" && (!Number.isFinite(counterpartStartMs) || !Number.isFinite(counterpartEndMs) || counterpartEndMs <= counterpartStartMs))
      return Response.json({ error: "Informe um intervalo válido para o segundo dia da troca." }, { status: 400 });
    if (subtype === "swap" && (!startsAt.startsWith(`${serviceDate}T`) || !counterpartStartsAt?.startsWith(`${counterpartServiceDate}T`)))
      return Response.json({ error: "As datas dos horários precisam corresponder aos respectivos dias da troca." }, { status: 400 });
    const settlementStartMs = settlementStartsAt ? Date.parse(settlementStartsAt) : NaN;
    const settlementEndMs = settlementEndsAt ? Date.parse(settlementEndsAt) : NaN;
    if (settlementEnabled && (!Number.isFinite(settlementStartMs) || !Number.isFinite(settlementEndMs) || settlementEndMs <= settlementStartMs))
      return Response.json({ error: "Informe um intervalo valido para o BH+." }, { status: 400 });
    if (settlementEnabled && !settlementStartsAt!.startsWith(`${settlementDate}T`))
      return Response.json({ error: "A data do horario do BH+ precisa corresponder ao dia selecionado." }, { status: 400 });
    const intervalHours = (start:number, end:number) => Math.round(((end - start) / 3600000) * 100) / 100;
    const loadGuardAssignments = async (scheduleId:number, id:number, rangeStart:string, rangeEnd:string) => (await env.DB.prepare(
      "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.schedule_id=? AND a.guard_id=? AND a.starts_at<? AND a.ends_at>? ORDER BY a.starts_at,a.id",
    ).bind(scheduleId,id,rangeEnd,rangeStart).all<Record<string,unknown>>()).results;
    const base = {
      kind: subtype === "swap" ? "swap" : "time_bank",
      subtype, guardId, counterpartGuardId, serviceDate, startsAt, endsAt,
      counterpartServiceDate, counterpartStartsAt, counterpartEndsAt, requestRef, notes,
      settlementDate, settlementStartsAt, settlementEndsAt,
    };
    const existingAdjustment = subtype === "swap"
      ? await env.DB.prepare(`SELECT id FROM service_adjustments
          WHERE status='active'
            AND (guard_id=? OR counterpart_guard_id=? OR guard_id=? OR counterpart_guard_id=?)
            AND ((service_date=? AND starts_at<? AND ends_at>?) OR
                 (counterpart_service_date=? AND counterpart_starts_at<? AND counterpart_ends_at>?)) LIMIT 1`)
        .bind(guardId, guardId, counterpartGuardId || -1, counterpartGuardId || -1, serviceDate, endsAt, startsAt, counterpartServiceDate, counterpartEndsAt, counterpartStartsAt)
        .first()
      : await env.DB.prepare(`SELECT id FROM service_adjustments
          WHERE status='active' AND (guard_id=? OR counterpart_guard_id=?)
            AND ((service_date=? AND starts_at<? AND ends_at>?) OR
                 (settlement_date=? AND settlement_starts_at<? AND settlement_ends_at>?)) LIMIT 1`)
        .bind(guardId, guardId, serviceDate, endsAt, startsAt, settlementDate || "", settlementEndsAt || "", settlementStartsAt || "")
        .first();
    if (existingAdjustment)
      return Response.json({ error: "Já existe um banco ou troca ativa para este GM nesse intervalo." }, { status: 409 });
    if (subtype === "positive") {
      const existing = await loadGuardAssignments(schedule.id, guardId, startsAt, endsAt);
      if (existing.length) return Response.json({ error: `${guard.name} já possui uma designação neste intervalo.` }, { status: 409 });
      const conflictingMovement = await env.DB.prepare("SELECT type FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1").bind(guardId,endsAt,startsAt).first<{type:string}>();
      if (conflictingMovement) return Response.json({ error: `${guard.name} possui uma movimentação neste intervalo.` }, { status: 409 });
      const hour = Number(startsAt.slice(11, 13));
      const shift = hour < 7 ? "1" : hour < 13 ? "2" : hour < 19 ? "3" : "4";
      const positiveHours = Number.isFinite(requestedHours) && requestedHours > 0 ? requestedHours : intervalHours(startMs, endMs);
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO service_adjustments (kind,subtype,guard_id,service_date,starts_at,ends_at,hours,request_ref,notes,status,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,'active',?)").bind(base.kind,subtype,guardId,serviceDate,startsAt,endsAt,positiveHours,requestRef,notes,"{}"),
        env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(schedule.id,guardId,null,null,shift,"guard",startsAt,endsAt,"time_bank_positive","time_bank",requestRef,0,notes||"BH+ aguardando remanejamento"),
      ]);
      const adjustmentId = Number(results[0].meta.last_row_id), assignmentId = Number(results[1].meta.last_row_id);
      await env.DB.prepare("UPDATE service_adjustments SET snapshot_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({createdAssignmentId:assignmentId}),adjustmentId).run();
      const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id WHERE sa.id=?").bind(adjustmentId).first();
      const auditEventId = await writeAudit(request,{action:"create",entityType:"service_adjustment",entityId:adjustmentId,summary:`Registrou BH+ de ${guard.name} em ${serviceDate}`,after:adjustment as Record<string,unknown>,undoable:false});
      return Response.json({ok:true,adjustment,auditEventId,message:`BH+ de ${guard.name} criado e colocado à disposição para ${serviceDate}.`});
    }
    if (subtype === "swap") {
      const firstService = await loadGuardAssignments(schedule.id, counterpartGuardId!, startsAt, endsAt);
      const secondService = await loadGuardAssignments(counterpartSchedule!.id, guardId, counterpartStartsAt!, counterpartEndsAt!);
      if (!firstService.length || !secondService.length)
        return Response.json({ error: "A troca precisa encontrar o GM correspondente escalado nos dois dias e horários informados." }, { status: 409 });
      for (const item of firstService) {
        const conflict = await assertAssignable(schedule.id, guardId, String(item.starts_at), String(item.ends_at), 0);
        if (conflict) return Response.json({ error: `Não foi possível colocar ${guard.name} no primeiro dia: ${conflict.error}` }, { status: conflict.status });
      }
      for (const item of secondService) {
        const conflict = await assertAssignable(counterpartSchedule!.id, counterpartGuardId!, String(item.starts_at), String(item.ends_at), 0);
        if (conflict) return Response.json({ error: `Não foi possível colocar o segundo GM no segundo dia: ${conflict.error}` }, { status: conflict.status });
      }
      const snapshot = JSON.stringify({assignments:[...firstService,...secondService]});
      const updates = firstService.map((item) =>
        env.DB.prepare("UPDATE assignments SET guard_id=?,status='swap',request_ref=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(guardId,requestRef,`Troca de serviço com ${guard.name} · dia ${serviceDate}`,item.id),
      ).concat(secondService.map((item) =>
        env.DB.prepare("UPDATE assignments SET guard_id=?,status='swap',request_ref=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(counterpartGuardId,requestRef,`Troca de serviço com ${guard.name} · dia ${counterpartServiceDate}`,item.id),
      ));
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO service_adjustments (kind,subtype,guard_id,counterpart_guard_id,service_date,starts_at,ends_at,counterpart_service_date,counterpart_starts_at,counterpart_ends_at,request_ref,notes,status,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?)").bind(base.kind,subtype,guardId,counterpartGuardId,serviceDate,startsAt,endsAt,counterpartServiceDate,counterpartStartsAt,counterpartEndsAt,requestRef,notes,snapshot),
        ...updates,
      ]);
      const adjustmentId = Number(results[0].meta.last_row_id);
      const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name,c.name counterpart_guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id LEFT JOIN guards c ON c.id=sa.counterpart_guard_id WHERE sa.id=?").bind(adjustmentId).first();
      const auditEventId = await writeAudit(request,{action:"create",entityType:"service_adjustment",entityId:adjustmentId,summary:`Registrou troca entre ${guard.name} e ${adjustment?.counterpart_guard_name}`,after:adjustment as Record<string,unknown>,undoable:false});
      return Response.json({ok:true,adjustment,auditEventId,message:`Troca aplicada: ${guard.name} assume ${serviceDate} e ${adjustment?.counterpart_guard_name} assume ${counterpartServiceDate}.`});
    }
    const assignments = await loadGuardAssignments(schedule.id, guardId, startsAt, endsAt);
    const affectedAssignments = subtype === "negative_full"
      ? assignments
      : assignments.filter((item) => Date.parse(String(item.ends_at)) > endMs);
    if (!affectedAssignments.length)
      return Response.json({ error: `${guard.name} não possui uma designação compatível com o intervalo informado.` }, { status: 409 });
    if (subtype === "negative_late" || subtype === "negative_early") {
      for (const item of affectedAssignments) {
        const itemStart = Date.parse(String(item.starts_at));
        const itemEnd = Date.parse(String(item.ends_at));
        if (subtype === "negative_late" && (endMs <= itemStart || endMs >= itemEnd))
          return Response.json({ error: "Para BH- de entrada tardia, o novo início deve ficar entre o início e o fim do horário original." }, { status: 400 });
        if (subtype === "negative_early" && (endMs <= itemStart || endMs >= itemEnd))
          return Response.json({ error: "Para BH- de saída antecipada, o novo fim deve ficar entre o início e o fim do horário original." }, { status: 400 });
      }
    }
    const calculatedHours = affectedAssignments.reduce((total, item) => {
      const itemStart = Date.parse(String(item.starts_at));
      const itemEnd = Date.parse(String(item.ends_at));
      const lost = subtype === "negative_full"
        ? intervalHours(itemStart, itemEnd)
        : subtype === "negative_late"
          ? intervalHours(itemStart, endMs)
          : intervalHours(endMs, itemEnd);
      return total + Math.max(0, lost);
    }, 0);
    const adjustmentHours = negativeSubtype
      ? (Number.isFinite(requestedHours) && requestedHours > 0 ? requestedHours : calculatedHours)
      : intervalHours(startMs, endMs);
    if (negativeSubtype && (!Number.isFinite(adjustmentHours) || adjustmentHours <= 0))
      return Response.json({ error: "Nao foi possivel calcular a quantidade de horas do BH-." }, { status: 400 });
    if (settlementEnabled && Math.abs(intervalHours(settlementStartMs, settlementEndMs) - adjustmentHours) > 0.01)
      return Response.json({ error: `O intervalo do BH+ precisa ter exatamente ${adjustmentHours}h.` }, { status: 400 });
    const settlementHours = settlementEnabled ? adjustmentHours : null;
    const snapshotData:Record<string,unknown> = { assignments: affectedAssignments };
    if (settlementEnabled) {
      const existingSettlement = await loadGuardAssignments(settlementSchedule!.id, guardId, settlementStartsAt!, settlementEndsAt!);
      if (existingSettlement.length)
        return Response.json({ error: `${guard.name} ja possui uma designacao no horario escolhido para o BH+.` }, { status: 409 });
      const conflictingMovement = await env.DB.prepare("SELECT type FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1").bind(guardId,settlementEndsAt,settlementStartsAt).first<{type:string}>();
      if (conflictingMovement)
        return Response.json({ error: `${guard.name} possui uma movimentaÃ§Ã£o no dia escolhido para o BH+.` }, { status: 409 });
    }
    const updates = affectedAssignments.map((item) => subtype === "negative_full"
      ? env.DB.prepare("UPDATE assignments SET post_id=NULL,vehicle_id=NULL,status='time_bank',request_ref=?,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(requestRef,notes||`BH- de ${guard.name}`,item.id)
      : subtype === "negative_late"
        ? env.DB.prepare("UPDATE assignments SET starts_at=?,status='time_bank',request_ref=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(endsAt,requestRef,notes||`BH- de ${guard.name}`,item.id)
        : env.DB.prepare("UPDATE assignments SET ends_at=?,regular_ends_at=CASE WHEN regular_ends_at IS NOT NULL AND regular_ends_at>? THEN ? ELSE regular_ends_at END,status='time_bank',request_ref=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(endsAt,endsAt,endsAt,requestRef,notes||`BH- de ${guard.name}`,item.id));
    const settlementHour = settlementStartsAt ? Number(settlementStartsAt.slice(11, 13)) : 0;
    const settlementShift = settlementHour < 7 ? "1" : settlementHour < 13 ? "2" : settlementHour < 19 ? "3" : "4";
    const settlementAssignment = settlementEnabled
      ? env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(settlementSchedule!.id,guardId,null,null,settlementShift,"guard",settlementStartsAt,settlementEndsAt,"time_bank_positive","time_bank",requestRef,0,notes||"BH+ criado pelo pagamento de BH-")
      : null;
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO service_adjustments (kind,subtype,guard_id,service_date,starts_at,ends_at,hours,settlement_date,settlement_starts_at,settlement_ends_at,settlement_hours,request_ref,notes,status,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)").bind(base.kind,subtype,guardId,serviceDate,startsAt,endsAt,adjustmentHours,settlementDate,settlementStartsAt,settlementEndsAt,settlementHours,requestRef,notes,JSON.stringify(snapshotData)),
      ...updates,
      ...(settlementAssignment ? [settlementAssignment] : []),
    ]);
    const adjustmentId = Number(results[0].meta.last_row_id);
    if (settlementEnabled) {
      snapshotData.createdSettlementAssignmentId = Number(results[1 + updates.length].meta.last_row_id);
      await env.DB.prepare("UPDATE service_adjustments SET snapshot_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(snapshotData),adjustmentId).run();
    }
    const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id WHERE sa.id=?").bind(adjustmentId).first();
    const paymentMessage = settlementEnabled ? ` BH+ de ${adjustmentHours}h criado para ${settlementDate}.` : "";
    const auditEventId = await writeAudit(request,{action:"create",entityType:"service_adjustment",entityId:adjustmentId,summary:`Registrou ${subtype==='negative_full'?'BH- integral':subtype==='negative_late'?'BH- com entrada tardia':'BH- com saída antecipada'} de ${guard.name}`,after:adjustment as Record<string,unknown>,undoable:false});
    return Response.json({ok:true,adjustment,auditEventId,message:`Banco de horas negativo de ${adjustmentHours}h aplicado para ${guard.name} em ${serviceDate}.${paymentMessage}`});
  }
  if (b.action === "cancel_service_adjustment") {
    await ensureServiceAdjustmentsTable();
    const id = Number(b.id || 0);
    const adjustment = await env.DB.prepare("SELECT sa.*,g.name guard_name FROM service_adjustments sa JOIN guards g ON g.id=sa.guard_id WHERE sa.id=? AND sa.status='active'").bind(id).first<Record<string,unknown>>();
    if (!adjustment) return Response.json({ error: "Lançamento não encontrado ou já cancelado." }, { status: 404 });
    let snapshot:Record<string,unknown> = {};
    try { snapshot = JSON.parse(String(adjustment.snapshot_json || "{}")) as Record<string,unknown>; } catch { return Response.json({ error: "O histórico deste lançamento está inválido." }, { status: 409 }); }
    const statements:D1PreparedStatement[] = [];
    const createdAssignmentIds = [Number(snapshot.createdAssignmentId || 0), Number(snapshot.createdSettlementAssignmentId || 0)].filter((value, index, values) => value > 0 && values.indexOf(value) === index);
    for (const assignmentId of createdAssignmentIds) {
      const current = await env.DB.prepare("SELECT post_id,vehicle_id FROM assignments WHERE id=?").bind(assignmentId).first<{post_id:number|null;vehicle_id:number|null}>();
      if (current?.post_id || current?.vehicle_id) statements.push(env.DB.prepare("UPDATE assignments SET status='normal',work_kind='shift',request_ref=NULL,reassignment_note=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(assignmentId));
      else statements.push(env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(assignmentId));
    }
    if (String(adjustment.subtype) !== "positive") {
      const originals = Array.isArray(snapshot.assignments) ? snapshot.assignments as Array<Record<string,unknown>> : [];
      for (const row of originals) statements.push(env.DB.prepare("UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=?,break_starts_at=?,break_ends_at=?,work_kind=?,status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.guard_id,row.post_id||null,row.vehicle_id||null,row.shift,row.role,row.starts_at,row.ends_at,row.regular_ends_at||null,row.break_starts_at||null,row.break_ends_at||null,row.work_kind||"shift",row.status||"normal",row.request_ref||null,row.is_reassigned||0,row.reassignment_note||null,row.id));
    }
    statements.push(env.DB.prepare("UPDATE service_adjustments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id));
    await env.DB.batch(statements);
    const auditEventId = await writeAudit(request,{action:"cancel",entityType:"service_adjustment",entityId:id,summary:`Cancelou lançamento de ${adjustment.guard_name}`,before:adjustment,undoable:false});
    return Response.json({ok:true,auditEventId,message:`Lançamento de ${adjustment.guard_name} cancelado e escala restaurada.`});
  }
  if (b.action === "reorder_resource_assignments") {
    const scheduleId = Number(b.scheduleId || 0);
    const resourceKind = String(b.resourceKind || "");
    const resourceId = Number(b.resourceId || 0);
    const assignmentId = Number(b.assignmentId || 0);
    const beforeAssignmentId = Number(b.beforeAssignmentId || 0) || null;
    const targetPosition = Number(b.targetPosition);
    if (!scheduleId || !["post", "vehicle"].includes(resourceKind) || !resourceId || !assignmentId)
      return Response.json({ error: "Informe o recurso e o GM para reordenar." }, { status: 400 });
    const column = resourceKind === "post" ? "post_id" : "vehicle_id";
    const current = await env.DB.prepare(
      `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id
       WHERE a.id=? AND a.schedule_id=? AND a.${column}=? AND a.work_kind!='overtime_extension'`,
    ).bind(assignmentId, scheduleId, resourceId).first<Record<string, unknown>>();
    if (!current) return Response.json({ error: "Este quadradinho não pertence mais a este posto/viatura." }, { status: 404 });
    if (isStaleVersion((b as Record<string, unknown>).expectedUpdatedAt, current.updated_at))
      return staleVersionResponse(current);
    const rows = (
      await env.DB.prepare(
        `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id
         WHERE a.schedule_id=? AND a.${column}=? AND a.work_kind!='overtime_extension'
         ORDER BY a.starts_at,a.id`,
      ).bind(scheduleId, resourceId).all<Record<string, unknown>>()
    ).results;
    const groups = new Map<number, Record<string, unknown>[]>();
    for (const row of rows) {
      const guardId = Number(row.guard_id);
      const group = groups.get(guardId) || [];
      group.push(row);
      groups.set(guardId, group);
    }
    const movingGuardId = Number(current.guard_id);
    const laneIds = orderedResourceGuardIds(rows, resourceKind as "post" | "vehicle").filter((id) => id !== movingGuardId);
    const targetAssignment = beforeAssignmentId
      ? rows.find((row) => Number(row.id) === beforeAssignmentId && Number(row.guard_id) !== movingGuardId)
      : undefined;
    const targetGuardId = targetAssignment ? Number(targetAssignment.guard_id) : null;
    const insertAt = targetGuardId
      ? Math.max(0, laneIds.indexOf(targetGuardId))
      : Number.isFinite(targetPosition)
        ? Math.max(0, Math.min(laneIds.length, Math.trunc(targetPosition)))
        : laneIds.length;
    laneIds.splice(insertAt, 0, movingGuardId);
    const statements = laneIds.flatMap((guardId, index) =>
      (groups.get(guardId) || []).map((row) =>
        env.DB.prepare("UPDATE assignments SET lane_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND schedule_id=?")
          .bind(index, row.id, scheduleId),
      ),
    );
    if (statements.length) await env.DB.batch(statements);
    const changedAssignments = (
      await env.DB.prepare(
        `SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id
         WHERE a.schedule_id=? AND a.${column}=? ORDER BY a.lane_order,a.starts_at,a.id`,
      ).bind(scheduleId, resourceId).all<Record<string, unknown>>()
    ).results;
    const auditEventId = await writeAudit(request, {
      action: "update",
      entityType: "assignment_lane",
      entityId: `${resourceKind}:${resourceId}`,
      summary: `Reordenou GMs no ${resourceKind === "vehicle" ? "viatura" : "posto"}`,
      before: { assignments: rows },
      after: { assignments: changedAssignments },
      undoable: true,
    });
    return Response.json({ ok: true, assignments: changedAssignments, auditEventId, message: "Posição dos GMs alinhada neste local." });
  }
  if (b.action === "move_assignment_to_cell") {
    const id=Number(b.id||0),scheduleId=Number(b.scheduleId||0),sourceShift=String(b.sourceShift||""),targetShift=String(b.shift||"");
    if(!id||!scheduleId||!["1","2","3","4"].includes(sourceShift)||!["1","2","3","4"].includes(targetShift))
      return Response.json({error:"Informe o quadradinho de origem e o turno de destino."},{status:400});
    const schedule=await env.DB.prepare("SELECT id,date FROM schedules WHERE id=?").bind(scheduleId).first<{id:number;date:string}>();
    const before=await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=? AND a.schedule_id=?").bind(id,scheduleId).first<Record<string,unknown>>();
    if(!schedule||!before)return Response.json({error:"O quadradinho não foi encontrado nesta escala."},{status:404});
    if(isStaleVersion((b as Record<string,unknown>).expectedUpdatedAt,before.updated_at))return staleVersionResponse(before);
    const mapped=mapAssignmentSegmentToShift(schedule.date,sourceShift,targetShift,String(before.starts_at),String(before.ends_at));
    if(!mapped)return Response.json({error:"O horário de origem não corresponde ao quadradinho selecionado."},{status:409});
    if(mapped.remainders.some(piece=>piece.start<mapped.target.end&&piece.end>mapped.target.start))return Response.json({error:"Este GM já ocupa o horário de destino dentro da mesma jornada."},{status:409});
    const postId=Number(b.postId||0)||null,vehicleId=Number(b.vehicleId||0)||null;
    if((postId?1:0)+(vehicleId?1:0)!==1)return Response.json({error:"Escolha um único posto ou viatura de destino."},{status:400});
    if(postId&&!await env.DB.prepare("SELECT id FROM posts WHERE id=? AND active=1").bind(postId).first())return Response.json({error:"O posto de destino não está disponível."},{status:404});
    const excluded=await env.DB.prepare("SELECT id FROM schedule_resource_exclusions WHERE schedule_id=? AND resource_kind=? AND resource_id=? LIMIT 1").bind(scheduleId,postId?"post":"vehicle",postId||vehicleId).first();
    if(excluded)return Response.json({error:"Este local foi retirado da escala do dia."},{status:409});
    let role=postId?"guard":String(before.role||"third");
    if(vehicleId){
      const vehicle=await env.DB.prepare("SELECT id,type FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<{id:number;type:string|null}>();
      if(!vehicle)return Response.json({error:"A viatura de destino não está disponível."},{status:404});
      const outage=await env.DB.prepare("SELECT id FROM vehicle_outages WHERE vehicle_id=? AND active=1 AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?) LIMIT 1").bind(vehicleId,schedule.date,schedule.date).first();
      if(outage)return Response.json({error:"A viatura está em FA nesta data."},{status:409});
      const occupied=(await env.DB.prepare("SELECT role,guard_id FROM assignments WHERE schedule_id=? AND vehicle_id=? AND id<>? AND starts_at<? AND ends_at>?").bind(scheduleId,vehicleId,id,mapped.target.end,mapped.target.start).all<{role:string;guard_id:number}>()).results;
      if(isMotorcycleType(vehicle.type)&&occupied.some(item=>Number(item.guard_id)!==Number(before.guard_id)))return Response.json({error:"Esta moto já possui um GM no horário de destino."},{status:409});
      const roles=new Set(occupied.map(item=>String(item.role)));
      role=isMotorcycleType(vehicle.type)?"driver":!roles.has("driver")?"driver":!roles.has("patrol")?"patrol":"third";
    }
    const conflict=await assertAssignable(scheduleId,Number(before.guard_id),mapped.target.start,mapped.target.end,id);
    if(conflict)return Response.json({error:conflict.error},{status:conflict.status});
    const movedStatus=String(before.status||"normal");
    const movedWorkKind=String(before.work_kind||"shift")==="overtime_extension"?"overtime_extension":"shift";
    const statements=[];
    if(mapped.remainders.length){
      const first=mapped.remainders[0];
      statements.push(env.DB.prepare("UPDATE assignments SET starts_at=?,ends_at=?,regular_ends_at=NULL,break_starts_at=NULL,break_ends_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND schedule_id=?").bind(first.start,first.end,id,scheduleId));
      if(mapped.remainders.length>1){
        const second=mapped.remainders[1];
        statements.push(env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(scheduleId,before.guard_id,before.post_id||null,before.vehicle_id||null,before.shift,before.role,second.start,second.end,before.work_kind||"shift",before.status||"normal",before.request_ref||null,before.is_reassigned||0,before.reassignment_note||null));
      }
      statements.push(env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note,lane_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)").bind(scheduleId,before.guard_id,postId,vehicleId,targetShift,role,mapped.target.start,mapped.target.end,movedWorkKind,movedStatus,before.request_ref||null,1,before.reassignment_note||`Remanejado do ${sourceShift}º para o ${targetShift}º turno`));
    }else{
      statements.push(env.DB.prepare("UPDATE assignments SET post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=NULL,break_starts_at=NULL,break_ends_at=NULL,work_kind=?,status=?,is_reassigned=1,reassignment_note=?,lane_order=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND schedule_id=?").bind(postId,vehicleId,targetShift,role,mapped.target.start,mapped.target.end,movedWorkKind,movedStatus,before.reassignment_note||`Remanejado do ${sourceShift}º para o ${targetShift}º turno`,id,scheduleId));
    }
    await env.DB.batch(statements);
    const assignments=(await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.schedule_id=? AND a.guard_id=? ORDER BY a.starts_at,a.id").bind(scheduleId,before.guard_id).all<Record<string,unknown>>()).results;
    const auditEventId=await writeAudit(request,{action:"update",entityType:"assignment_move",entityId:id,summary:`Moveu ${before.guard_name} do ${sourceShift}º para o ${targetShift}º turno`,before:{assignment:before,sourceShift},after:{assignments,targetShift,target:mapped.target},undoable:true});
    return Response.json({ok:true,assignments,auditEventId,message:`${before.guard_name} movido para o ${targetShift}º turno · ${mapped.target.start.slice(11,16)}–${mapped.target.end.slice(11,16)}.`});
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
      : await env.DB.prepare("SELECT id,type FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<{ id: number; type: string | null }>();
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
    // A normal/weekly block pasted into another non-overlapping quadrant is
    // additional service. Mark it as HE immediately for manual review.
    const targetStatus=copiedBlockStatus(source);
    const automaticOvertime=targetStatus==="overtime"&&String(source.status||"normal")!=="overtime";
    let role=postId?"guard":String(source.role||"third");
    if(vehicleId){
      const occupied=(await env.DB.prepare("SELECT role FROM assignments WHERE schedule_id=? AND vehicle_id=? AND starts_at<? AND ends_at>?").bind(scheduleId,vehicleId,interval.end,interval.start).all<{role:string}>()).results;
      if (isMotorcycleType((resource as { type?: string | null }).type) && occupied.length) {
        return Response.json({ error: "Esta moto já possui um GM no mesmo horário. Motos comportam somente um condutor." }, { status: 409 });
      }
      const roles=new Set(occupied.map(item=>String(item.role)));
      role=isMotorcycleType((resource as { type?: string | null }).type) ? "driver" : !roles.has("driver")?"driver":!roles.has("patrol")?"patrol":"third";
    }
    const created=await env.DB.prepare(`INSERT INTO assignments
      (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(scheduleId,source.guard_id,postId,vehicleId,targetShift,role,interval.start,interval.end,"shift",targetStatus,source.request_ref||null,source.is_reassigned||0,source.reassignment_note||null).run();
    const assignment=await env.DB.prepare("SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?").bind(created.meta.last_row_id).first<Record<string,unknown>>();
    const auditEventId=await writeAudit(request,{action:"create",entityType:"assignment",entityId:Number(created.meta.last_row_id),summary:`Colou ${source.guard_name} no ${targetShift}º turno`,after:assignment,undoable:true});
    return Response.json({ok:true,assignment,auditEventId,automaticOvertime,message:automaticOvertime
      ? `${source.guard_name} copiado para o ${targetShift}º turno e marcado automaticamente como HE para conferência.`
      : `${source.guard_name} copiado para o ${targetShift}º turno com o horário ajustado.`});
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
    const operationalGroupId = Number(b.operationalGroupId || 0) || null;
    const operationalTeamLabel = String(b.operationalTeamLabel || "EQUIPE GERAL").trim().toUpperCase() || "EQUIPE GERAL";
    const postId = Number(b.postId || 0) || null;
    const vehicleId = Number(b.vehicleId || 0) || null;
    const requestedShift = String(b.shift || "2");
    const members = ((b as unknown as { members?: Array<{ guardId?: number; role?: string; source?: string }> }).members || [])
      .map((member) => ({
        guardId: Number(member.guardId),
        role: String(member.role || "guard"),
        source: (member.source === "redeploy" ? "redeploy" : member.source === "overtime" ? "overtime" : "normal") as "redeploy" | "overtime" | "normal",
      }))
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
    if (operationalGroupId && !await env.DB.prepare("SELECT id FROM operational_groups WHERE id=? AND active=1").bind(operationalGroupId).first())
      return Response.json({ error: "O grupamento selecionado não está mais disponível." }, { status: 404 });
    let vehicleType: string | null = null;
    if (vehicleId) {
      const vehicle = await env.DB.prepare("SELECT id,type FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<{ id: number; type: string | null }>();
      if (!vehicle)
        return Response.json({ error: "Viatura não encontrada ou desativada." }, { status: 404 });
      vehicleType = vehicle.type;
      if (isMotorcycleType(vehicle.type) && members.length > 1)
        return Response.json({ error: "Motos comportam somente um GM condutor. Remova os integrantes extras antes de salvar." }, { status: 400 });
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
    const periodStart = periodShiftTimes(schedule.date, periodShifts[0]).start;
    const periodEnd = periodShiftTimes(schedule.date, periodShifts[periodShifts.length - 1]).end;
    if (vehicleId && isMotorcycleType(vehicleType)) {
      const occupied = await env.DB.prepare(
        "SELECT id FROM assignments WHERE schedule_id=? AND vehicle_id=? AND starts_at<? AND ends_at>? LIMIT 1",
      ).bind(scheduleId,vehicleId,periodEnd,periodStart).first();
      if (occupied)
        return Response.json({ error: "Esta moto já possui condutor no período. Escolha outra viatura disponível." }, { status: 409 });
    }
    const redeploySources = new Map<number, Record<string, unknown>[]>();
    for (const member of members.filter((item) => item.source === "redeploy")) {
      const rows = (
        await env.DB.prepare(
          `SELECT a.* FROM assignments a
           WHERE a.schedule_id=? AND a.guard_id=? AND a.starts_at<? AND a.ends_at>?
             AND COALESCE(a.work_kind,'shift')!='overtime_extension'
             AND ((a.post_id IS NULL AND a.vehicle_id IS NULL)
               OR EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=a.schedule_id AND e.resource_kind='post' AND e.resource_id=a.post_id)
               OR EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=a.schedule_id AND e.resource_kind='vehicle' AND e.resource_id=a.vehicle_id)
               OR EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=a.vehicle_id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)))
           ORDER BY a.starts_at`
        ).bind(scheduleId, member.guardId, periodEnd, periodStart, schedule.date, schedule.date).all<Record<string, unknown>>()
      ).results;
      if (!rows.length) {
        return Response.json({ error: "Este GM deixou de estar À disposição. Atualize as sugestões antes de salvar." }, { status: 409 });
      }
      redeploySources.set(member.guardId, rows);
    }
    for (const member of members) {
      for (const shift of periodShifts) {
        const interval = periodShiftTimes(schedule.date, shift);
        if (member.source === "redeploy") continue;
        const blocked = await assertAssignable(scheduleId, member.guardId, interval.start, interval.end);
        if (blocked) return Response.json({ error: blocked.error }, { status: blocked.status });
      }
    }
    if (vehicleId) {
      for (const shift of periodShifts) {
        const existingRoles = (await env.DB.prepare("SELECT role FROM assignments WHERE schedule_id=? AND vehicle_id=? AND shift=?").bind(scheduleId, vehicleId, shift).all<{ role: string }>()).results.map((item) => item.role);
        if (!hasRequiredVehicleCrew(existingRoles, members.map((member) => member.role), vehicleType))
          return Response.json({ error: "Toda viatura precisa ter motorista e patrulheiro. Selecione as duas funções antes de salvar." }, { status: 400 });
      }
    }
    const statements: D1PreparedStatement[] = [];
    const changedIds: number[] = [];
    for (const member of members.filter((item) => item.source === "redeploy")) {
      for (const assignment of redeploySources.get(member.guardId) || []) {
        const id = Number(assignment.id);
        if (!id) continue;
        changedIds.push(id);
        statements.push(env.DB.prepare(
          "UPDATE assignments SET post_id=?,vehicle_id=?,role=?,status='normal',request_ref=NULL,is_reassigned=1,reassignment_note=?,lane_order=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).bind(postId, vehicleId, vehicleId ? (isMotorcycleType(vehicleType) ? "driver" : member.role) : "guard", `Remanejamento rápido para ${vehicleId ? "viatura" : "posto"}`, id));
      }
    }
    for (const member of members.filter((item) => item.source !== "redeploy")) {
      for (const shift of periodShifts) {
        const interval = periodShiftTimes(schedule.date, shift);
        const isOvertime = member.source === "overtime";
        statements.push(env.DB.prepare("INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,work_kind,status,request_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(scheduleId, member.guardId, postId, vehicleId, shift, vehicleId ? (isMotorcycleType(vehicleType) ? "driver" : member.role) : "guard", interval.start, interval.end, "shift", isOvertime ? "overtime" : "normal", isOvertime ? "Sugestão inteligente · equipe oposta" : null));
      }
    }
    const results = await env.DB.batch(statements);
    if (operationalGroupId) {
      await env.DB.batch(members.map((member) => env.DB.prepare(
        "INSERT OR IGNORE INTO schedule_operational_group_members (schedule_id,group_id,team_label,guard_id) VALUES (?,?,?,?)",
      ).bind(scheduleId,operationalGroupId,operationalTeamLabel,member.guardId)));
    }
    const ids = [...changedIds, ...results.map((result) => Number(result.meta.last_row_id)).filter(Boolean)];
    const placeholders = ids.map(() => "?").join(",");
    const assignments = ids.length
      ? (await env.DB.prepare(`SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id IN (${placeholders}) ORDER BY a.starts_at,a.role`).bind(...ids).all<Record<string, unknown>>()).results
      : [];
    const auditEventId = await writeAudit(request, { action: "create", entityType: "assignment_group", entityId: ids.join(","), summary: `Escalou ${members.length} GM(s) em ${vehicleId ? "viatura" : "posto"}`, after: { assignments }, undoable: true });
    return Response.json({ ok: true, assignments, reload: Boolean(operationalGroupId), auditEventId, message: operationalGroupId ? `${members.length} GM(s) adicionados ao ${operationalTeamLabel}.` : vehicleId ? `Guarnição criada com ${members.length} integrantes.` : `${members.length} GM(s) adicionados ao posto.` });
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
      : await env.DB.prepare("SELECT id,prefix label,type FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<Record<string, unknown>>();
    if (!destination)
      return Response.json({ error: "Destino não encontrado ou desativado." }, { status: 404 });
    if (vehicleId && isMotorcycleType(destination.type)) {
      if (guardIds.size > 1)
        return Response.json({ error: "Motos comportam somente um GM condutor. Mova apenas um quadradinho para esta viatura." }, { status: 409 });
      const targetOccupied = await env.DB.prepare("SELECT id FROM assignments WHERE schedule_id=? AND vehicle_id=? AND id NOT IN (" + assignmentIds.map(() => "?").join(",") + ") LIMIT 1").bind(scheduleId, vehicleId, ...assignmentIds).first();
      if (targetOccupied)
        return Response.json({ error: "Esta moto já possui um GM nesta escala." }, { status: 409 });
    }
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

    const requestedRole = vehicleId && isMotorcycleType(destination.type)
      ? "driver"
      : vehicleId && ["driver", "patrol", "third"].includes(String(b.role))
        ? String(b.role)
      : null;
    const reassignmentNote = String(
      b.reassignmentNote || "Avisar o GM: remanejamento para cobrir furo de escala",
    );
    await env.DB.prepare(
      `UPDATE assignments SET post_id=?,vehicle_id=?,lane_order=NULL,role=CASE WHEN ? IS NOT NULL THEN 'guard' WHEN ? IS NOT NULL THEN ? ELSE role END,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
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
        "UPDATE assignments SET vehicle_id=?,lane_order=CASE WHEN ?!=? THEN NULL ELSE lane_order END,is_reassigned=CASE WHEN ?!=? THEN 1 ELSE is_reassigned END,reassignment_note=CASE WHEN ?!=? THEN ? ELSE reassignment_note END,updated_at=CURRENT_TIMESTAMP WHERE schedule_id=? AND vehicle_id=?",
      ).bind(
        toVehicleId,
        toVehicleId,
        fromVehicleId,
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
      statements.push(env.DB.prepare("UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,lane_order=CASE WHEN COALESCE(post_id,0)<>COALESCE(?,0) OR COALESCE(vehicle_id,0)<>COALESCE(?,0) THEN NULL ELSE lane_order END,shift=?,role=?,starts_at=?,ends_at=?,regular_ends_at=NULL,status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(guardId, regularPostId, regularVehicleId, regularPostId, regularVehicleId, b.shift, b.role, regularStart, regularEnd, regularStatus, b.requestRef || null, b.isReassigned ? 1 : 0, b.reassignmentNote || null, id));
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
    let extensionRole = String(b.role || (vehicleId ? "third" : "guard"));
    if (vehicleId) {
      const vehicle = await env.DB.prepare("SELECT type FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<{ type: string | null }>();
      if (!vehicle) return Response.json({ error: "A viatura não foi encontrada ou está desativada." }, { status: 404 });
      if (isMotorcycleType(vehicle.type)) {
        const occupied = await env.DB.prepare(
          "SELECT id FROM assignments WHERE schedule_id=? AND vehicle_id=? AND starts_at<? AND ends_at>? AND COALESCE(work_kind,'shift')!='overtime_extension' LIMIT 1",
        ).bind(scheduleId, vehicleId, endsAt, startsAt).first();
        if (occupied) return Response.json({ error: "Esta moto já possui uma pessoa no intervalo informado." }, { status: 409 });
        extensionRole = "driver";
      }
    }
    const created=await env.DB.prepare(`INSERT INTO assignments
      (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,regular_ends_at,work_kind,status,request_ref,is_reassigned,reassignment_note)
      VALUES (?,?,?,?,?,?,?,?,?,'overtime_extension','overtime',?,0,?)`)
      .bind(scheduleId,base.guard_id,postId,vehicleId,b.shift||(direction==="before"?"3":"4"),extensionRole,startsAt,endsAt,startsAt,b.requestRef||null,direction==="before"?"Antecipação independente em hora extra":"Extensão independente do expediente").run();
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
        "SELECT id,name,CASE WHEN registration LIKE 'SEM-MATRICULA-%' THEN NULL ELSE registration END AS registration,platoon,base_shift,work_regime,overtime_eligible FROM guards WHERE active=1 ORDER BY name",
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
        `SELECT a.*,g.name guard_name,CASE WHEN g.registration LIKE 'SEM-MATRICULA-%' THEN NULL ELSE g.registration END AS registration,
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

  // Sugestão de HE nunca deve abrir a escala para um GM simplesmente "livre".
  // Quando o padrão ainda não foi gravado na escala, use a paridade automática
  // do dia para identificar D1/D2 e N1/N2 mesmo assim.
  const automaticPattern = appliedPattern ? null : await resolvePatternCodes(env.DB, date);
  const dayCodes = new Set<string>(
    [appliedPattern?.day_code, automaticPattern?.dayCode].filter(Boolean) as string[],
  );
  const nightCodes = new Set<string>(
    [appliedPattern?.night_code, automaticPattern?.nightCode].filter(Boolean) as string[],
  );

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

  // A lista de HE fica restrita à equipe 12x36 oposta. GMs sem escala no dia
  // não são candidatos automáticos e não aparecem como "livres no turno".
  const smartRanked = ranked.filter((candidate) => candidate.oppositeTeam);

  return Response.json({
    date,
    shift,
    period,
    postId,
    vehicleId,
    role,
    suggestions: smartRanked.map((s) => ({
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
