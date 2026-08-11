import { env } from "cloudflare:workers";
import { permitted } from "../../../lib/access";
import { writeAudit } from "../../../lib/audit";

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
  const month =
    new URL(request.url).searchParams.get("month") ||
    new Date().toISOString().slice(0, 7);
  if (!validMonth(month))
    return Response.json({ error: "Mês inválido." }, { status: 400 });
  const period = bounds(month);
  const [guards, entries, closure, suggestions] = await Promise.all([
    env.DB.prepare(
      `SELECT g.id,g.name,g.registration,g.platoon,g.work_regime,g.overtime_eligible,g.overtime_note,
        COALESCE((SELECT group_concat(p.code) FROM pattern_slots ps JOIN shift_patterns p ON p.id=ps.pattern_id AND p.active=1 WHERE ps.guard_id=g.id),'') pattern_codes
       FROM guards g WHERE g.active=1 ORDER BY g.name`,
    ).all<Row>(),
    env.DB.prepare(
      `SELECT e.*,g.name guard_name,g.registration,g.platoon
       FROM overtime_entries e JOIN guards g ON g.id=e.guard_id
       WHERE e.service_date>=? AND e.service_date<?
         AND NOT (e.source='schedule' AND e.status='pending')
       ORDER BY e.service_date DESC,e.starts_at DESC`,
    )
      .bind(period.previous, period.end)
      .all<Row>(),
    monthClosure(month),
    env.DB.prepare(
      `SELECT a.id assignment_id,a.guard_id,g.name guard_name,g.registration,g.platoon,
        date(a.starts_at) service_date,COALESCE(a.regular_ends_at,a.starts_at) starts_at,a.ends_at,
        CAST(ROUND((julianday(a.ends_at)-julianday(COALESCE(a.regular_ends_at,a.starts_at)))*1440) AS INTEGER) planned_minutes,
        COALESCE(p.name,v.prefix,'Sem local') location,a.request_ref
       FROM assignments a
       JOIN guards g ON g.id=a.guard_id
       LEFT JOIN posts p ON p.id=a.post_id
       LEFT JOIN vehicles v ON v.id=a.vehicle_id
       WHERE a.status='overtime' AND date(a.starts_at)>=? AND date(a.starts_at)<?
         AND COALESCE(g.overtime_eligible,1)<>0
         AND NOT EXISTS (
           SELECT 1 FROM overtime_entries e
           JOIN assignments ea ON ea.id=e.assignment_id
            WHERE e.status IN ('confirmed','partial','not_performed','cancelled')
             AND ea.guard_id=a.guard_id AND date(ea.starts_at)=date(a.starts_at)
             AND COALESCE(ea.post_id,0)=COALESCE(a.post_id,0)
             AND COALESCE(ea.vehicle_id,0)=COALESCE(a.vehicle_id,0)
             AND (CASE WHEN CAST(substr(ea.starts_at,12,2) AS INTEGER)>=7 AND CAST(substr(ea.starts_at,12,2) AS INTEGER)<19 THEN 'day' ELSE 'night' END)
               =(CASE WHEN CAST(substr(a.starts_at,12,2) AS INTEGER)>=7 AND CAST(substr(a.starts_at,12,2) AS INTEGER)<19 THEN 'day' ELSE 'night' END)
         )
       ORDER BY date(a.starts_at) DESC,g.name`,
    ).bind(period.start,period.end).all<Row>(),
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
  const groupedSuggestions = new Map<string, Row>();
  for (const item of suggestions.results) {
    const hour = Number(String(item.starts_at).slice(11, 13));
    const periodKey = hour >= 7 && hour < 19 ? "day" : "night";
    const key = `${item.guard_id}|${item.service_date}|${item.location}|${periodKey}`;
    const current = groupedSuggestions.get(key);
    if (current) current.planned_minutes = Number(current.planned_minutes) + Number(item.planned_minutes);
    else groupedSuggestions.set(key, { ...item, period_key: periodKey });
  }
  return Response.json({
    month,
    ranking,
    entries: entries.results.filter(
      (entry) =>
        String(entry.service_date) >= period.start &&
        String(entry.service_date) < period.end,
    ),
    closure,
    suggestions: [...groupedSuggestions.values()].filter((item)=>Number(item.planned_minutes)>0),
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

  if (body.action === "suggestion_dismiss") {
    const assignmentId = Number(body.assignmentId);
    if (!assignmentId)
      return Response.json({ error: "Sugestão de HE inválida." }, { status: 400 });

    const suggestion = await env.DB.prepare(
      `SELECT a.id assignment_id,a.guard_id,g.name guard_name,g.registration,g.platoon,
         date(a.starts_at) service_date,COALESCE(a.regular_ends_at,a.starts_at) starts_at,a.ends_at,
         CAST(ROUND((julianday(a.ends_at)-julianday(COALESCE(a.regular_ends_at,a.starts_at)))*1440) AS INTEGER) planned_minutes,
         COALESCE(p.name,v.prefix,'Sem local') location,a.request_ref
       FROM assignments a
       JOIN guards g ON g.id=a.guard_id
       LEFT JOIN posts p ON p.id=a.post_id
       LEFT JOIN vehicles v ON v.id=a.vehicle_id
       WHERE a.id=? AND a.status='overtime'`,
    )
      .bind(assignmentId)
      .first<Row>();
    if (!suggestion)
      return Response.json({ error: "Sugestão de HE não encontrada ou já removida." }, { status: 404 });

    const serviceDate = String(suggestion.service_date || "");
    if (!(await ensureMonthOpen(serviceDate.slice(0, 7))))
      return Response.json(
        { error: "Este mês de HE está fechado. Reabra-o antes de dispensar sugestões." },
        { status: 409 },
      );

    const minutes = Math.max(0, Number(suggestion.planned_minutes || 0));
    if (!minutes)
      return Response.json({ error: "A sugestão não possui horas válidas para dispensar." }, { status: 409 });

    const note = String(body.notes || "Sugestão dispensada no controle de HE.").trim();
    const existing = await env.DB.prepare(
      "SELECT id,status FROM overtime_entries WHERE assignment_id=?",
    )
      .bind(assignmentId)
      .first<Row>();
    let entryId: number;
    if (existing) {
      if (["confirmed", "partial"].includes(String(existing.status)))
        return Response.json({ error: "Esta sugestão já foi lançada no saldo." }, { status: 409 });
      entryId = Number(existing.id);
      await env.DB.prepare(
        `UPDATE overtime_entries SET service_date=?,starts_at=?,ends_at=?,planned_minutes=?,confirmed_minutes=0,
         status='not_performed',source='schedule',location=?,request_ref=?,notes=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
        .bind(
          serviceDate,
          suggestion.starts_at,
          suggestion.ends_at,
          minutes,
          suggestion.location,
          suggestion.request_ref || null,
          note,
          entryId,
        )
        .run();
    } else {
      const created = await env.DB.prepare(
        `INSERT INTO overtime_entries
         (assignment_id,guard_id,service_date,starts_at,ends_at,planned_minutes,confirmed_minutes,status,source,location,request_ref,notes,confirmed_at)
         VALUES (?,?,?,?,?,?,0,'not_performed','schedule',?,?,?,CURRENT_TIMESTAMP)`,
      )
        .bind(
          assignmentId,
          suggestion.guard_id,
          serviceDate,
          suggestion.starts_at,
          suggestion.ends_at,
          minutes,
          suggestion.location,
          suggestion.request_ref || null,
          note,
        )
        .run();
      entryId = Number(created.meta.last_row_id);
    }

    const entry = await joinedEntry(entryId);
    await writeAudit(request, {
      action: "update",
      entityType: "overtime_entry",
      entityId: entryId,
      summary: `Dispensou sugestão de HE de ${suggestion.guard_name}`,
      after: entry as Record<string, unknown>,
      undoable: false,
    });
    return Response.json({ ok: true, entry, message: "Sugestão de HE dispensada." });
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
      summary: `Editou lançamento de HE de ${before.guard_name}`,
      before,
      after: entry as Record<string, unknown>,
      undoable: false,
    });
    return Response.json({ ok: true, entry, message: "Lançamento de HE atualizado." });
  }

  if (body.action === "manual_create") {
    const guardId = Number(body.guardId);
    const assignmentId = Number(body.assignmentId) || null;
    const serviceDate = String(body.serviceDate || "");
    const informedHours = Number(body.hours || 0);
    if (!guardId || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !Number.isFinite(informedHours) || informedHours <= 0 || informedHours > 24)
      return Response.json({ error: "Informe GM, data e uma quantidade de horas entre 0 e 24." }, { status: 400 });
    const entryMonth = serviceDate.slice(0, 7);
    if (!validMonth(entryMonth))
      return Response.json({ error: "Mês do lançamento inválido." }, { status: 400 });
    if (!(await ensureMonthOpen(entryMonth)))
      return Response.json(
        { error: "Este mês de HE está fechado. Reabra-o antes de lançar novas horas." },
        { status: 409 },
      );
    const plannedMinutes = Math.round(informedHours * 60);
    const startsAt = `${serviceDate}T00:00`;
    const endDate = new Date(`${serviceDate}T00:00:00Z`);
    endDate.setUTCMinutes(endDate.getUTCMinutes()+plannedMinutes);
    const endsAt = endDate.toISOString().slice(0,16);
    const status = "confirmed";
    const location = String(body.location || "").trim() || "HE informada manualmente";
    const requestRef = String(body.requestRef || "").trim() || null;
    const notes = String(body.notes || "").trim() || null;
    const existing = assignmentId
      ? await env.DB.prepare("SELECT id,guard_id FROM overtime_entries WHERE assignment_id=?").bind(assignmentId).first<Row>()
      : null;
    if (existing && Number(existing.guard_id) !== guardId)
      return Response.json({ error: "A sugestão de HE não pertence ao GM informado." }, { status: 409 });
    let id: number;
    if (existing && Number(existing.guard_id) === guardId) {
      id = Number(existing.id);
      await env.DB.prepare(
        `UPDATE overtime_entries SET service_date=?,starts_at=?,ends_at=?,planned_minutes=?,confirmed_minutes=?,
         status='confirmed',source='manual',location=?,request_ref=?,notes=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      ).bind(serviceDate,startsAt,endsAt,plannedMinutes,plannedMinutes,location,requestRef,notes,id).run();
    } else {
      const created = await env.DB.prepare(
        `INSERT INTO overtime_entries
         (assignment_id,guard_id,service_date,starts_at,ends_at,planned_minutes,confirmed_minutes,status,source,location,request_ref,notes,confirmed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      ).bind(assignmentId,guardId,serviceDate,startsAt,endsAt,plannedMinutes,plannedMinutes,status,"manual",location,requestRef,notes,status).run();
      id = Number(created.meta.last_row_id);
    }
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

  if (body.action === "balance_set") {
    const guardId=Number(body.guardId),month=String(body.month||""),targetHours=Number(body.targetHours);
    if(!guardId||!validMonth(month)||!Number.isFinite(targetHours)||targetHours<0||targetHours>500)
      return Response.json({error:"Informe um total mensal válido."},{status:400});
    if(!(await ensureMonthOpen(month)))return Response.json({error:"Este mês de HE está fechado."},{status:409});
    const period=bounds(month);
    const current=await env.DB.prepare(
      `SELECT COALESCE(SUM(confirmed_minutes),0) total FROM overtime_entries
       WHERE guard_id=? AND service_date>=? AND service_date<? AND status IN ('confirmed','partial')`,
    ).bind(guardId,period.start,period.end).first<Row>();
    const targetMinutes=Math.round(targetHours*60),delta=targetMinutes-Number(current?.total||0);
    if(!delta)return Response.json({error:"O total informado já é o saldo atual."},{status:409});
    const reason=String(body.notes||"").trim();
    if(!reason)return Response.json({error:"Informe o motivo do ajuste."},{status:400});
    const created=await env.DB.prepare(
      `INSERT INTO overtime_entries
       (guard_id,service_date,starts_at,ends_at,planned_minutes,confirmed_minutes,status,source,location,notes,confirmed_at)
       VALUES (?,?,?,?,?,?,'confirmed','adjustment','Ajuste manual de saldo',?,CURRENT_TIMESTAMP)`,
    ).bind(guardId,period.start,`${period.start}T00:00`,`${period.start}T00:00`,delta,delta,reason).run();
    const id=Number(created.meta.last_row_id),entry=await joinedEntry(id);
    await writeAudit(request,{action:"create",entityType:"overtime_entry",entityId:id,summary:`Ajustou o saldo de HE de ${entry?.guard_name} para ${targetHours}h`,after:entry as Record<string,unknown>,undoable:false});
    return Response.json({ok:true,entry,message:`Saldo mensal ajustado para ${targetHours}h.`});
  }

  if (body.action === "month_close") {
    const month = String(body.month || "");
    if (!validMonth(month))
      return Response.json({ error: "Mês inválido." }, { status: 400 });
    const period = bounds(month);
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) total FROM overtime_entries WHERE service_date>=? AND service_date<? AND status='pending' AND source<>'schedule'",
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
