import { env } from "cloudflare:workers";
import {
  applyPatternsToSchedule,
  ensurePatterns,
} from "../../../lib/pattern-engine";

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

function permitted(request: Request) {
  const host = new URL(request.url).hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    Boolean(request.headers.get("oai-authenticated-user-id"))
  );
}

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
  const samples = [
    [
      "F009",
      "technical_reserve",
      "2026-08-12T00:00",
      "2026-08-13T00:00",
      "DEMO-RT-01",
      "Reserva técnica para conferência da escala",
    ],
    [
      "F010",
      "day_off",
      "2026-08-12T00:00",
      "2026-08-13T00:00",
      "DEMO-FOLGA-01",
      "Folga mensal",
    ],
    [
      "F011",
      "vacation",
      "2026-08-10T00:00",
      "2026-08-22T00:00",
      "DEMO-FERIAS-01",
      "Período de férias",
    ],
    [
      "F012",
      "course",
      "2026-08-12T00:00",
      "2026-08-16T00:00",
      "DEMO-CURSO-01",
      "Curso de atualização",
    ],
    [
      "F013",
      "medical_leave",
      "2026-08-11T00:00",
      "2026-08-15T00:00",
      "DEMO-ATESTADO-01",
      "Afastamento médico",
    ],
    [
      "F014",
      "time_bank",
      "2026-08-12T07:00",
      "2026-08-12T13:00",
      "REQ-BH-0826",
      "Compensação de banco de horas",
    ],
    [
      "F015",
      "swap",
      "2026-08-12T13:00",
      "2026-08-12T19:00",
      "TROCA-115/2026",
      "Troca de serviço autorizada",
    ],
  ];
  await env.DB.batch(
    samples.map(([registration, type, startsAt, endsAt, requestRef, notes]) =>
      env.DB.prepare(
        "INSERT INTO movements (guard_id,type,starts_at,ends_at,request_ref,notes,status) SELECT id,?,?,?,?,?,'approved' FROM guards WHERE registration=? AND NOT EXISTS (SELECT 1 FROM movements WHERE request_ref=?)",
      ).bind(
        type,
        startsAt,
        endsAt,
        requestRef,
        notes,
        registration,
        requestRef,
      ),
    ),
  );
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
      "SELECT id FROM guards WHERE active=1 ORDER BY id",
    ).all<{ id: number }>()
  ).results;
  const posts = (
    await env.DB.prepare(
      "SELECT id FROM posts WHERE active=1 ORDER BY sort_order,id",
    ).all<{ id: number }>()
  ).results;
  const vehicles = (
    await env.DB.prepare(
      "SELECT id FROM vehicles WHERE active=1 ORDER BY prefix",
    ).all<{ id: number }>()
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
  await ensureCatalog();
  await ensureDemoMovements();
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
    await seedSchedule(date, schedule.id);
  }
}

export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date") || "2026-08-12";
  await ensureBase(date);
  const schedule = await env.DB.prepare("SELECT * FROM schedules WHERE date=?")
    .bind(date)
    .first<Record<string, unknown>>();
  const [guards, posts, vehicles, assignments, movements, notices] =
    await Promise.all([
      env.DB.prepare(
        "SELECT id,name,registration,platoon FROM guards WHERE active=1 ORDER BY name",
      ).all(),
      env.DB.prepare(
        "SELECT id,name,group_name FROM posts WHERE active=1 ORDER BY sort_order,name",
      ).all(),
      env.DB.prepare(
        "SELECT id,prefix,type,zone FROM vehicles WHERE active=1 ORDER BY prefix",
      ).all(),
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
    ]);
  const blocked = new Set(movements.results.map((m) => Number(m.guard_id))),
    active = assignments.results.filter(
      (a) => !blocked.has(Number(a.guard_id)),
    );
  return Response.json({
    date,
    schedule,
    guards: guards.results,
    posts: posts.results,
    vehicles: vehicles.results,
    assignments: active,
    removed: assignments.results.filter((a) => blocked.has(Number(a.guard_id))),
    movements: movements.results,
    notices: notices.results,
  });
}

export async function POST(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const b = (await request.json()) as Record<string, string | number | null>;
  if (b.action === "delete") {
    await env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(b.id).run();
    return Response.json({ ok: true, deletedId: Number(b.id) });
  }
  const id = Number(b.id || 0),
    guardId = Number(b.guardId),
    scheduleId = Number(b.scheduleId),
    start = String(b.startsAt),
    end = String(b.endsAt);
  const conflict = await env.DB.prepare(
    "SELECT id FROM assignments WHERE schedule_id=? AND guard_id=? AND id!=? AND starts_at<? AND ends_at>? LIMIT 1",
  )
    .bind(scheduleId, guardId, id, end, start)
    .first();
  if (conflict)
    return Response.json(
      { error: "Conflito: este GM já está escalado nesse horário." },
      { status: 409 },
    );
  const movement = await env.DB.prepare(
    "SELECT type FROM movements WHERE guard_id=? AND status='approved' AND starts_at<? AND ends_at>? LIMIT 1",
  )
    .bind(guardId, end, start)
    .first<{ type: string }>();
  if (movement)
    return Response.json(
      { error: `GM indisponível por ${movement.type}.` },
      { status: 409 },
    );
  let assignmentId = id;
  if (id)
    await env.DB.prepare(
      "UPDATE assignments SET guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,status=?,request_ref=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(
        guardId,
        b.postId || null,
        b.vehicleId || null,
        b.shift,
        b.role,
        start,
        end,
        b.status,
        b.requestRef || null,
        id,
      )
      .run();
  else {
    const created = await env.DB.prepare(
      "INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status,request_ref) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        scheduleId,
        guardId,
        b.postId || null,
        b.vehicleId || null,
        b.shift,
        b.role,
        start,
        end,
        b.status,
        b.requestRef || null,
      )
      .run();
    assignmentId = Number(created.meta.last_row_id);
  }
  const assignment = await env.DB.prepare(
    "SELECT a.*,g.name guard_name FROM assignments a JOIN guards g ON g.id=a.guard_id WHERE a.id=?",
  )
    .bind(assignmentId)
    .first();
  return Response.json({ ok: true, assignment });
}
