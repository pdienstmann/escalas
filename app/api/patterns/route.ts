import { env } from "cloudflare:workers";
import {
  applyPatternsToSchedule,
  ensurePatterns,
  resolvePatternCodes,
} from "../../../lib/pattern-engine";
import { writeAudit } from "../../../lib/audit";
export const dynamic = "force-dynamic";
function permitted(r: Request) {
  const h = new URL(r.url).hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    Boolean(r.headers.get("oai-authenticated-user-id"))
  );
}
function destination(body: Record<string, string | number | boolean | null>) {
  const [type, id] = String(body.destination || "").split(":");
  return {
    postId: type === "post" ? Number(id) : null,
    vehicleId: type === "vehicle" ? Number(id) : null,
  };
}
export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  await ensurePatterns(env.DB);
  const previewDate =
    new URL(request.url).searchParams.get("date") ||
    new Date().toISOString().slice(0, 10);
  const [patterns, slots, guards, posts, vehicles, preview] = await Promise.all(
    [
      env.DB.prepare(
        "SELECT p.*,COUNT(s.id) member_count FROM shift_patterns p LEFT JOIN pattern_slots s ON s.pattern_id=p.id WHERE p.active=1 GROUP BY p.id ORDER BY p.period,p.parity",
      ).all(),
      env.DB.prepare(
        "SELECT s.*,g.name guard_name,g.registration,p.name post_name,p.group_name,v.prefix,v.zone FROM pattern_slots s JOIN guards g ON g.id=s.guard_id LEFT JOIN posts p ON p.id=s.post_id LEFT JOIN vehicles v ON v.id=s.vehicle_id ORDER BY s.pattern_id,p.group_name,p.name,v.prefix,s.role",
      ).all(),
      env.DB.prepare(
        "SELECT id,name,registration,platoon FROM guards WHERE active=1 ORDER BY name",
      ).all(),
      env.DB.prepare(
        "SELECT id,name,group_name FROM posts WHERE active=1 ORDER BY sort_order,name",
      ).all(),
      env.DB.prepare(
        "SELECT id,prefix,zone FROM vehicles WHERE active=1 ORDER BY prefix",
      ).all(),
      resolvePatternCodes(env.DB, previewDate),
    ],
  );
  return Response.json({
    patterns: patterns.results,
    slots: slots.results,
    guards: guards.results,
    posts: posts.results,
    vehicles: vehicles.results,
    ...preview,
  });
}
export async function POST(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const body = (await request.json()) as Record<
    string,
    string | number | boolean | null
  >;
  await ensurePatterns(env.DB);
  try {
    if (body.action === "anchor") {
      const before = await env.DB.prepare("SELECT anchor_date FROM shift_patterns WHERE active=1 LIMIT 1").first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE shift_patterns SET anchor_date=?,updated_at=CURRENT_TIMESTAMP WHERE active=1",
      )
        .bind(body.anchorDate)
        .run();
      await writeAudit(request,{action:"update",entityType:"pattern_config",entityId:"anchor",summary:`Alterou a data-base dos padrões para ${body.anchorDate}`,before,after:{anchor_date:body.anchorDate},undoable:true});
      return Response.json({ ok: true, message: "Data-base atualizada." });
    }
    if (body.action === "update_slot") {
      const d = destination(body);
      const before = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE pattern_slots SET guard_id=?,post_id=?,vehicle_id=?,role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(body.guardId, d.postId, d.vehicleId, body.role, body.id)
        .run();
      const after = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(body.id).first();
      await writeAudit(request,{action:"update",entityType:"pattern_slot",entityId:Number(body.id),summary:"Alterou uma posição do padrão 12x36",before,after:after as Record<string,unknown>,undoable:true});
      return Response.json({ ok: true });
    }
    if (body.action === "add_slot") {
      const d = destination(body);
      const created = await env.DB.prepare(
        "INSERT INTO pattern_slots (pattern_id,guard_id,post_id,vehicle_id,role) VALUES (?,?,?,?,?)",
      )
        .bind(body.patternId, body.guardId, d.postId, d.vehicleId, body.role)
        .run();
      const after = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request,{action:"create",entityType:"pattern_slot",entityId:Number(created.meta.last_row_id),summary:"Adicionou uma posição ao padrão 12x36",after:after as Record<string,unknown>,undoable:true});
      return Response.json({ ok: true });
    }
    if (body.action === "delete_slot") {
      const before = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare("DELETE FROM pattern_slots WHERE id=?")
        .bind(body.id)
        .run();
      await writeAudit(request,{action:"delete",entityType:"pattern_slot",entityId:Number(body.id),summary:"Removeu uma posição do padrão 12x36",before,undoable:true});
      return Response.json({ ok: true });
    }
    if (body.action === "apply") {
      if (!body.confirm)
        return Response.json(
          { error: "Confirmação necessária." },
          { status: 400 },
        );
      const date = String(body.date);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO schedules (date,status) VALUES (?,'draft')",
      )
        .bind(date)
        .run();
      const schedule = await env.DB.prepare(
        "SELECT id FROM schedules WHERE date=?",
      )
        .bind(date)
        .first<{ id: number }>();
      if (!schedule)
        return Response.json(
          { error: "Não foi possível criar a escala." },
          { status: 500 },
        );
      const result = await applyPatternsToSchedule(env.DB, date, schedule.id, {
        replace: true,
        dayCode: body.dayCode ? String(body.dayCode) : undefined,
        nightCode: body.nightCode ? String(body.nightCode) : undefined,
      });
      await writeAudit(request,{action:"apply",entityType:"schedule_pattern",entityId:schedule.id,summary:`Aplicou os padrões ${body.dayCode} e ${body.nightCode} na escala de ${date}`,after:{date,dayCode:body.dayCode,nightCode:body.nightCode}});
      return Response.json({ ok: true, ...result, date });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o padrão.",
      },
      { status: 400 },
    );
  }
}
