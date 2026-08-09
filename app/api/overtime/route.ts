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
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function validMonth(month: string) {
  return monthPattern.test(month);
}

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

async function monthClosure(month: string) {
  return (
    (await env.DB.prepare(
      "SELECT month,status,closed_at,closure_note,reopened_at,reopen_reason,updated_at FROM overtime_month_closures WHERE month=?",
    )
      .bind(month)
      .first<Row>()) || { month, status: "open" }
  );
}

async function ensureMonthOpen(month: string) {
  return (await monthClosure(month)).status !== "closed";
}

export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  await syncScheduleOvertime();
  const month =
    new URL(request.url).searchParams.get("month") ||
    new Date().toISOString().slice(0, 7);
  if (!validMonth(month))
    return Response.json({ error: "Mês inválido." }, { status: 400 });
  const period = bounds(month);
  const [guards, entries, closure] = await Promise.all([
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
    monthClosure(month),
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
    closure,
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
    if (!(await ensureMonthOpen(String(before.service_date).slice(0, 7))))
      return Response.json(
        { error: "Este mês de HE está fechado. Reabra-o antes de editar lançamentos." },
        { status: 409 },
      );
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
    const entryMonth = startsAt.slice(0, 7);
    if (!validMonth(entryMonth))
      return Response.json({ error: "Mês do lançamento inválido." }, { status: 400 });
    if (!(await ensureMonthOpen(entryMonth)))
      return Response.json(
        { error: "Este mês de HE está fechado. Reabra-o antes de lançar novas horas." },
        { status: 409 },
      );
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

  if (body.action === "month_close") {
    const month = String(body.month || "");
    if (!validMonth(month))
      return Response.json({ error: "Mês inválido." }, { status: 400 });
    await syncScheduleOvertime();
    const period = bounds(month);
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) total FROM overtime_entries WHERE service_date>=? AND service_date<? AND status='pending'",
    ).bind(period.start, period.end).first<Row>();
    const pendingCount = Number(pending?.total || 0);
    if (pendingCount)
      return Response.json({ error: `Ainda existem ${pendingCount} lançamentos pendentes. Confira todos antes de fechar o mês.` }, { status: 409 });
    const before = await monthClosure(month);
    await env.DB.prepare(
      `INSERT INTO overtime_month_closures (month,status,closed_at,closure_note,reopened_at,reopen_reason,updated_at)
       VALUES (?,'closed',CURRENT_TIMESTAMP,?,NULL,NULL,CURRENT_TIMESTAMP)
       ON CONFLICT(month) DO UPDATE SET status='closed',closed_at=CURRENT_TIMESTAMP,closure_note=excluded.closure_note,
       reopened_at=NULL,reopen_reason=NULL,updated_at=CURRENT_TIMESTAMP`,
    ).bind(month, String(body.note || "").trim() || null).run();
    const closure = await monthClosure(month);
    await writeAudit(request, { action: "close", entityType: "overtime_month", entityId: month,
      summary: `Fechou o livro de horas extras de ${month}`, before,
      after: closure as Record<string, unknown>, undoable: false });
    return Response.json({ ok: true, closure, message: "Mês de horas extras fechado." });
  }

  if (body.action === "month_reopen") {
    const month = String(body.month || "");
    const reason = String(body.reason || "").trim();
    if (!validMonth(month))
      return Response.json({ error: "Mês inválido." }, { status: 400 });
    if (!reason)
      return Response.json({ error: "Informe a justificativa da reabertura." }, { status: 400 });
    const before = await monthClosure(month);
    if (before.status !== "closed")
      return Response.json({ error: "Este mês já está aberto." }, { status: 409 });
    await env.DB.prepare(
      "UPDATE overtime_month_closures SET status='open',reopened_at=CURRENT_TIMESTAMP,reopen_reason=?,updated_at=CURRENT_TIMESTAMP WHERE month=?",
    ).bind(reason, month).run();
    const closure = await monthClosure(month);
    await writeAudit(request, { action: "reopen", entityType: "overtime_month", entityId: month,
      summary: `Reabriu o livro de horas extras de ${month}: ${reason}`, before,
      after: closure as Record<string, unknown>, undoable: false });
    return Response.json({ ok: true, closure, message: "Mês de horas extras reaberto." });
  }

  return Response.json({ error: "Ação inválida" }, { status: 400 });
}
