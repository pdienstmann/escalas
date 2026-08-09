import { env } from "cloudflare:workers";
import { permitted } from "../../../lib/access";
import { writeAudit } from "../../../lib/audit";
import { syncScheduleOvertime } from "../../../lib/overtime-ledger";

export const dynamic = "force-dynamic";

type Row = Record<string, string | number | null>;
const reviewedStatuses = new Set([
  "pending",
  "confirmed",
  "partial",
  "not_performed",
  "cancelled",
]);

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

async function joinedEntry(id: number) {
  return env.DB.prepare(
    `SELECT e.*,g.name guard_name,g.registration,g.platoon
     FROM overtime_entries e JOIN guards g ON g.id=e.guard_id WHERE e.id=?`,
  )
    .bind(id)
    .first<Row>();
}

export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  await syncScheduleOvertime();
  const month =
    new URL(request.url).searchParams.get("month") ||
    new Date().toISOString().slice(0, 7);
  const period = bounds(month);
  const [guards, entries] = await Promise.all([
    env.DB.prepare(
      "SELECT id,name,registration,platoon,overtime_eligible,overtime_note FROM guards WHERE active=1 ORDER BY name",
    ).all<Row>(),
    env.DB.prepare(
      `SELECT e.*,g.name guard_name,g.registration,g.platoon
       FROM overtime_entries e JOIN guards g ON g.id=e.guard_id
       WHERE e.service_date>=? AND e.service_date<? ORDER BY e.service_date DESC,e.starts_at DESC`,
    )
      .bind(period.previous, period.end)
      .all<Row>(),
  ]);

  const ranking = guards.results
    .map((guard) => {
      const own = entries.results.filter(
        (entry) => Number(entry.guard_id) === Number(guard.id),
      );
      const confirmed = (from: string, to: string) =>
        own
          .filter(
            (entry) =>
              String(entry.service_date) >= from &&
              String(entry.service_date) < to &&
              (entry.status === "confirmed" || entry.status === "partial"),
          )
          .reduce((sum, entry) => sum + Number(entry.confirmed_minutes || 0), 0);
      const pending = own
        .filter(
          (entry) =>
            String(entry.service_date) >= period.start &&
            String(entry.service_date) < period.end &&
            entry.status === "pending",
        )
        .reduce((sum, entry) => sum + Number(entry.planned_minutes || 0), 0);
      const completed = own.filter(
        (entry) => entry.status === "confirmed" || entry.status === "partial",
      );
      return {
        ...guard,
        currentHours: Math.round((confirmed(period.start, period.end) / 60) * 10) / 10,
        pendingHours: Math.round((pending / 60) * 10) / 10,
        previousHours: Math.round((confirmed(period.previous, period.start) / 60) * 10) / 10,
        lastOvertime: completed[0]?.starts_at || null,
        totalEntries: completed.filter(
          (entry) => String(entry.service_date) >= period.start,
        ).length,
      };
    })
    .sort(
      (a, b) =>
        Number(b.overtime_eligible) - Number(a.overtime_eligible) ||
        Number(a.currentHours) + Number(a.pendingHours) -
          (Number(b.currentHours) + Number(b.pendingHours)) ||
        String(a.lastOvertime || "").localeCompare(String(b.lastOvertime || "")),
    );
  return Response.json({
    month,
    ranking,
    entries: entries.results.filter(
      (entry) =>
        String(entry.service_date) >= period.start &&
        String(entry.service_date) < period.end,
    ),
  });
}

export async function POST(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;

  if (body.action === "guard_settings") {
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

  if (body.action === "entry_review") {
    const id = Number(body.id);
    const status = String(body.status || "pending");
    if (!reviewedStatuses.has(status))
      return Response.json({ error: "Situação inválida." }, { status: 400 });
    const before = await joinedEntry(id);
    if (!before)
      return Response.json({ error: "Lançamento não encontrado." }, { status: 404 });
    const informedMinutes = Math.max(
      0,
      Math.round(Number(body.confirmedHours || 0) * 60),
    );
    const confirmedMinutes =
      status === "pending"
        ? null
        : status === "not_performed" || status === "cancelled"
          ? 0
          : status === "confirmed" && !body.confirmedHours
            ? Number(before.planned_minutes)
            : informedMinutes;
    await env.DB.prepare(
      `UPDATE overtime_entries SET status=?,confirmed_minutes=?,request_ref=?,notes=?,
       confirmed_at=CASE WHEN ?='pending' THEN NULL ELSE CURRENT_TIMESTAMP END,
       updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
      .bind(
        status,
        confirmedMinutes,
        String(body.requestRef || "").trim() || null,
        String(body.notes || "").trim() || null,
        status,
        id,
      )
      .run();
    const entry = await joinedEntry(id);
    await writeAudit(request, {
      action: "update",
      entityType: "overtime_entry",
      entityId: id,
      summary: `Conferiu HE de ${before.guard_name}: ${status}`,
      before,
      after: entry as Record<string, unknown>,
      undoable: false,
    });
    return Response.json({ ok: true, entry, message: "Conferência de HE salva." });
  }

  if (body.action === "manual_create") {
    const guardId = Number(body.guardId);
    const startsAt = String(body.startsAt || "");
    const endsAt = String(body.endsAt || "");
    const start = new Date(startsAt).getTime();
    const end = new Date(endsAt).getTime();
    if (!guardId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return Response.json({ error: "Informe GM e horários válidos." }, { status: 400 });
    const plannedMinutes = Math.round((end - start) / 60000);
    const status = body.confirmNow ? "confirmed" : "pending";
    const created = await env.DB.prepare(
      `INSERT INTO overtime_entries
       (guard_id,service_date,starts_at,ends_at,planned_minutes,confirmed_minutes,status,source,location,request_ref,notes,confirmed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    )
      .bind(
        guardId,
        startsAt.slice(0, 10),
        startsAt,
        endsAt,
        plannedMinutes,
        status === "confirmed" ? plannedMinutes : null,
        status,
        "manual",
        String(body.location || "").trim() || "Lançamento manual",
        String(body.requestRef || "").trim() || null,
        String(body.notes || "").trim() || null,
        status,
      )
      .run();
    const id = Number(created.meta.last_row_id);
    const entry = await joinedEntry(id);
    await writeAudit(request, {
      action: "create",
      entityType: "overtime_entry",
      entityId: id,
      summary: `Lançou HE manual para ${entry?.guard_name}`,
      after: entry as Record<string, unknown>,
      undoable: false,
    });
    return Response.json({ ok: true, entry, message: "HE manual lançada." });
  }

  return Response.json({ error: "Ação inválida" }, { status: 400 });
}
