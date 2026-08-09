import { env } from "cloudflare:workers";
import { permitted } from "../../../lib/access";
import { writeAudit } from "../../../lib/audit";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | null>;

function bounds(month: string) {
  const [year, value] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, value - 1, 1));
  const end = new Date(Date.UTC(year, value, 1));
  const previous = new Date(Date.UTC(year, value - 2, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    previous: previous.toISOString().slice(0, 10),
  };
}

function duration(entry: Row) {
  return (
    (new Date(String(entry.ends_at)).getTime() -
      new Date(String(entry.starts_at)).getTime()) /
    3600000
  );
}

export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const month =
    new URL(request.url).searchParams.get("month") ||
    new Date().toISOString().slice(0, 7);
  const period = bounds(month);
  const [guards, entries] = await Promise.all([
    env.DB.prepare(
      "SELECT id,name,registration,platoon,overtime_eligible,overtime_note FROM guards WHERE active=1 ORDER BY name",
    ).all<Row>(),
    env.DB.prepare(
      `SELECT a.id,a.guard_id,a.starts_at,a.ends_at,a.request_ref,g.name guard_name,
        COALESCE(p.name,v.prefix,'Sem posto') location
       FROM assignments a
       JOIN guards g ON g.id=a.guard_id
       LEFT JOIN posts p ON p.id=a.post_id
       LEFT JOIN vehicles v ON v.id=a.vehicle_id
       WHERE a.status='overtime' AND a.starts_at>=? AND a.starts_at<?
       ORDER BY a.starts_at DESC`,
    )
      .bind(`${period.previous}T00:00`, `${period.end}T00:00`)
      .all<Row>(),
  ]);

  const ranking = guards.results
    .map((guard) => {
      const own = entries.results.filter(
        (entry) => Number(entry.guard_id) === Number(guard.id),
      );
      const hours = (from: string, to: string) =>
        own
          .filter(
            (entry) =>
              String(entry.starts_at) >= `${from}T00:00` &&
              String(entry.starts_at) < `${to}T00:00`,
          )
          .reduce((sum, entry) => sum + duration(entry), 0);
      const current = hours(period.start, period.end);
      const previous = hours(period.previous, period.start);
      return {
        ...guard,
        currentHours: Math.round(current * 10) / 10,
        previousHours: Math.round(previous * 10) / 10,
        lastOvertime: own[0]?.starts_at || null,
        totalEntries: own.filter(
          (entry) => String(entry.starts_at) >= `${period.start}T00:00`,
        ).length,
      };
    })
    .sort(
      (a, b) =>
        Number(b.overtime_eligible) - Number(a.overtime_eligible) ||
        Number(a.currentHours) - Number(b.currentHours) ||
        String(a.lastOvertime || "").localeCompare(String(b.lastOvertime || "")),
    );
  const currentEntries = entries.results
    .filter((entry) => String(entry.starts_at) >= `${period.start}T00:00`)
    .map((entry) => ({
      ...entry,
      hours: Math.round(duration(entry) * 10) / 10,
    }));

  return Response.json({ month, ranking, entries: currentEntries });
}

export async function POST(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  if (body.action !== "guard_settings")
    return Response.json({ error: "Ação inválida" }, { status: 400 });
  const id = Number(body.guardId);
  const before = await env.DB.prepare(
    "SELECT id,name,overtime_eligible,overtime_note FROM guards WHERE id=?",
  )
    .bind(id)
    .first<Row>();
  if (!before)
    return Response.json({ error: "GM não encontrado" }, { status: 404 });
  await env.DB.prepare(
    "UPDATE guards SET overtime_eligible=?,overtime_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(body.eligible ? 1 : 0, String(body.note || "").trim() || null, id)
    .run();
  const guard = await env.DB.prepare(
    "SELECT id,name,registration,platoon,overtime_eligible,overtime_note FROM guards WHERE id=?",
  )
    .bind(id)
    .first<Row>();
  await writeAudit(request, {
    action: "update",
    entityType: "guard_overtime_settings",
    entityId: id,
    summary: `Alterou a participação de ${before.name} nas horas extras`,
    before,
    after: guard as Record<string, unknown>,
    undoable: false,
  });
  return Response.json({ ok: true, guard, message: "Preferências de HE salvas." });
}
