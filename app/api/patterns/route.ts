import { env } from "cloudflare:workers";
import {
  applyPatternsToSchedule,
  applyWeeklyToSchedule,
  ensurePatterns,
  reconcileWeeklyGuardSchedules,
  resolvePatternCodes,
} from "../../../lib/pattern-engine";
import { writeAudit } from "../../../lib/audit";
import { permitted } from "../../../lib/access";
import { ensureOperationalGroups } from "../../../lib/operational-groups-db";
import { operationalGroupAnchorShift, operationalGroupDurationHours } from "../../../lib/operational-group-schedule";
import { isMotorcycleType } from "../../../lib/crew-rules";
export const dynamic = "force-dynamic";

function destination(body: Record<string, string | number | boolean | null>) {
  const [type, id] = String(body.destination || "").split(":");
  return {
    postId: type === "post" ? Number(id) : null,
    vehicleId: type === "vehicle" ? Number(id) : null,
  };
}

async function guardUsesRegime(guardId: number, regime: "12x36" | "weekly") {
  if (!Number.isInteger(guardId) || guardId <= 0) return false;
  const guard = await env.DB.prepare(
    "SELECT id FROM guards WHERE id=? AND active=1 AND COALESCE(work_regime,'12x36')=?",
  ).bind(guardId, regime).first();
  return Boolean(guard);
}

async function patternVehicleError(patternId: number, vehicleId: number, ignoreSlotId = 0) {
  const vehicle = await env.DB.prepare("SELECT id,type FROM vehicles WHERE id=? AND active=1").bind(vehicleId).first<{ id: number; type: string | null }>();
  if (!vehicle) return "A viatura não foi encontrada ou está inativa.";
  if (String(vehicle.type || "").toLowerCase() !== "moto") return null;
  const occupied = await env.DB.prepare("SELECT id FROM pattern_slots WHERE pattern_id=? AND vehicle_id=? AND id!=? LIMIT 1").bind(patternId, vehicleId, ignoreSlotId).first();
  return occupied ? "Motos comportam somente um GM condutor no padrão." : null;
}
export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  await ensurePatterns(env.DB);
  await ensureOperationalGroups(env.DB);
  const previewDate =
    new URL(request.url).searchParams.get("date") ||
    new Date().toISOString().slice(0, 10);
  const [patterns, slots, guards, posts, vehicles, preview, weeklySlots, operationalGroups, operationalGroupMembers, patternOperationalGroupMembers] = await Promise.all(
    [
      env.DB.prepare(
        "SELECT p.*,(SELECT COUNT(*) FROM pattern_slots s JOIN guards g ON g.id=s.guard_id AND COALESCE(g.work_regime,'12x36')='12x36' WHERE s.pattern_id=p.id) member_count FROM shift_patterns p WHERE p.active=1 ORDER BY p.period,p.parity",
      ).all(),
      env.DB.prepare(
        "SELECT s.*,g.name guard_name,g.registration,p.name post_name,p.group_name,v.prefix,v.zone FROM pattern_slots s JOIN guards g ON g.id=s.guard_id AND COALESCE(g.work_regime,'12x36')='12x36' LEFT JOIN posts p ON p.id=s.post_id LEFT JOIN vehicles v ON v.id=s.vehicle_id ORDER BY s.pattern_id,p.group_name,p.name,v.prefix,s.role",
      ).all(),
      env.DB.prepare(
        "SELECT id,name,registration,platoon,base_shift,work_regime FROM guards WHERE active=1 ORDER BY name",
      ).all(),
      env.DB.prepare(
        "SELECT id,name,group_name FROM posts WHERE active=1 ORDER BY sort_order,name",
      ).all(),
      env.DB.prepare(
        "SELECT id,prefix,type,zone FROM vehicles WHERE active=1 ORDER BY prefix",
      ).all(),
      resolvePatternCodes(env.DB, previewDate),
      env.DB.prepare("SELECT w.*,g.name guard_name,g.platoon,p.name post_name,p.group_name,v.prefix,v.zone FROM weekly_slots w JOIN guards g ON g.id=w.guard_id LEFT JOIN posts p ON p.id=w.post_id LEFT JOIN vehicles v ON v.id=w.vehicle_id WHERE w.active=1 ORDER BY p.group_name,p.name,v.prefix,g.name").all(),
      env.DB.prepare("SELECT id,name,short_name,color,sort_order,active FROM operational_groups WHERE active=1 ORDER BY sort_order,name").all(),
      env.DB.prepare(`SELECT m.id,m.group_id,m.resource_kind,m.resource_id,m.team_label,g.name group_name,g.short_name group_short_name,g.color group_color,g.sort_order group_sort_order
        FROM operational_group_members m JOIN operational_groups g ON g.id=m.group_id
        WHERE g.active=1 ORDER BY g.sort_order,g.name,m.resource_kind,m.resource_id`).all(),
      env.DB.prepare(`SELECT m.id,m.pattern_id,m.group_id,m.resource_kind,m.resource_id,m.team_label,m.shift,m.vehicle_id,m.starts_at,m.ends_at,p.code pattern_code,p.name pattern_name,p.period pattern_period,g.name group_name,g.short_name group_short_name,g.color group_color,g.sort_order group_sort_order
        FROM pattern_operational_group_members m
        JOIN shift_patterns p ON p.id=m.pattern_id AND p.active=1
        JOIN operational_groups g ON g.id=m.group_id AND g.active=1
        WHERE m.resource_kind!='guard' OR EXISTS (SELECT 1 FROM guards gm WHERE gm.id=m.resource_id AND gm.active=1 AND COALESCE(gm.work_regime,'12x36')='12x36')
        ORDER BY p.period,p.parity,g.sort_order,g.name,m.resource_kind,m.resource_id`).all(),
    ],
  );
  const currentScheduleRow = await env.DB.prepare("SELECT id,status FROM schedules WHERE date=? LIMIT 1").bind(previewDate).first<{ id: number; status: string }>();
  let currentSchedule: { exists: boolean; id?: number; status?: string | null; assignmentCount: number; protectedCount: number; appliedDayCode?: string | null; appliedNightCode?: string | null; protectedAssignments?: Record<string, unknown>[] } = { exists: false, assignmentCount: 0, protectedCount: 0, protectedAssignments: [] };
  if (currentScheduleRow) {
    const [assignmentCounts, applied, protectedAssignments] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) assignment_count,
        SUM(CASE WHEN COALESCE(status,'normal')!='normal' OR COALESCE(work_kind,'shift')!='shift' OR request_ref IS NOT NULL OR COALESCE(is_reassigned,0)=1 THEN 1 ELSE 0 END) protected_count
        FROM assignments WHERE schedule_id=?`).bind(currentScheduleRow.id).first<{ assignment_count: number | string; protected_count: number | string }>(),
      env.DB.prepare(`SELECT dp.code day_code,np.code night_code FROM schedule_patterns sp JOIN shift_patterns dp ON dp.id=sp.day_pattern_id JOIN shift_patterns np ON np.id=sp.night_pattern_id WHERE sp.schedule_id=?`).bind(currentScheduleRow.id).first<{ day_code: string; night_code: string }>(),
      env.DB.prepare(`SELECT a.id,a.shift,a.starts_at,a.ends_at,a.status,a.work_kind,a.request_ref,g.name guard_name,p.name post_name,v.prefix vehicle_prefix
        FROM assignments a JOIN guards g ON g.id=a.guard_id LEFT JOIN posts p ON p.id=a.post_id LEFT JOIN vehicles v ON v.id=a.vehicle_id
        WHERE a.schedule_id=? AND (COALESCE(a.status,'normal')!='normal' OR COALESCE(a.work_kind,'shift')!='shift' OR a.request_ref IS NOT NULL OR COALESCE(a.is_reassigned,0)=1)
        ORDER BY a.shift,a.starts_at,g.name LIMIT 80`).bind(currentScheduleRow.id).all<Record<string, unknown>>(),
    ]);
    currentSchedule = { exists: true, id: currentScheduleRow.id, status: currentScheduleRow.status, assignmentCount: Number(assignmentCounts?.assignment_count || 0), protectedCount: Number(assignmentCounts?.protected_count || 0), appliedDayCode: applied?.day_code || null, appliedNightCode: applied?.night_code || null, protectedAssignments: protectedAssignments.results };
  }
  return Response.json({
    patterns: patterns.results,
    slots: slots.results,
    guards: guards.results,
    posts: posts.results,
    vehicles: vehicles.results,
    weeklySlots: weeklySlots.results,
    ...preview,
    operationalGroups: operationalGroups.results,
    operationalGroupMembers: operationalGroupMembers.results,
    patternOperationalGroupMembers: patternOperationalGroupMembers.results,
    currentSchedule,
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
  await ensureOperationalGroups(env.DB);
  try {
    if (body.action === "anchor") {
      const before = await env.DB.prepare("SELECT anchor_date FROM shift_patterns WHERE active=1 LIMIT 1").first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE shift_patterns SET anchor_date=?,updated_at=CURRENT_TIMESTAMP WHERE active=1",
      )
        .bind(body.anchorDate)
        .run();
      const auditId = await writeAudit(request,{action:"update",entityType:"pattern_config",entityId:"anchor",summary:`Alterou a data-base dos padrões para ${body.anchorDate}`,before,after:{anchor_date:body.anchorDate},undoable:true});
      return Response.json({ ok: true, message: "Data-base atualizada.", auditId, undoable: true });
    }
    if (body.action === "operational_group_create") {
      const name = String(body.name || "").trim().replace(/\s+/g, " ");
      if (!name) return Response.json({ error: "Informe o nome do grupamento." }, { status: 400 });
      const duplicate = await env.DB.prepare("SELECT id FROM operational_groups WHERE UPPER(name)=UPPER(?) LIMIT 1").bind(name).first();
      if (duplicate) return Response.json({ error: "Já existe um grupamento com este nome." }, { status: 409 });
      const created = await env.DB.prepare("INSERT INTO operational_groups (name,short_name,color,sort_order) VALUES (?,?,?,?)")
        .bind(name, String(body.shortName || name).trim() || name, String(body.color || "#1769aa"), Number(body.sortOrder || 99)).run();
      const after = await env.DB.prepare("SELECT id,name,short_name,color,sort_order,active FROM operational_groups WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request, { action: "create", entityType: "operational_group", entityId: Number(created.meta.last_row_id), summary: `Criou o grupamento ${name}`, after: after as Record<string, unknown> });
      return Response.json({ ok: true, message: `Grupamento ${name} criado.`, entity: after });
    }
    if (body.action === "operational_group_update") {
      const id = Number(body.id), name = String(body.name || "").trim().replace(/\s+/g, " ");
      if (!id || !name) return Response.json({ error: "Informe o grupamento e o nome exibido." }, { status: 400 });
      const before = await env.DB.prepare("SELECT * FROM operational_groups WHERE id=?").bind(id).first<Record<string, unknown>>();
      if (!before) return Response.json({ error: "Grupamento não encontrado." }, { status: 404 });
      const duplicate = await env.DB.prepare("SELECT id FROM operational_groups WHERE UPPER(name)=UPPER(?) AND id<>? LIMIT 1").bind(name, id).first();
      if (duplicate) return Response.json({ error: "Já existe outro grupamento com este nome." }, { status: 409 });
      await env.DB.prepare("UPDATE operational_groups SET name=?,short_name=?,color=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(name, String(body.shortName || name).trim() || name, String(body.color || "#1769aa"), Number(body.sortOrder || 99), id).run();
      const after = await env.DB.prepare("SELECT id,name,short_name,color,sort_order,active FROM operational_groups WHERE id=?").bind(id).first();
      await writeAudit(request, { action: "update", entityType: "operational_group", entityId: id, summary: `Editou o grupamento ${name}`, before, after: after as Record<string, unknown> });
      return Response.json({ ok: true, message: `Grupamento ${name} atualizado.`, entity: after });
    }
    if (body.action === "operational_group_delete") {
      const id = Number(body.id);
      const before = await env.DB.prepare("SELECT * FROM operational_groups WHERE id=?").bind(id).first<Record<string, unknown>>();
      if (!before) return Response.json({ error: "Grupamento não encontrado." }, { status: 404 });
      await env.DB.batch([
        env.DB.prepare("DELETE FROM operational_group_members WHERE group_id=?").bind(id),
        env.DB.prepare("DELETE FROM pattern_operational_group_members WHERE group_id=?").bind(id),
        env.DB.prepare("DELETE FROM operational_groups WHERE id=?").bind(id),
      ]);
      await writeAudit(request, { action: "delete", entityType: "operational_group", entityId: id, summary: `Removeu o grupamento ${before.name}`, before, undoable: true });
      return Response.json({ ok: true, message: `Grupamento ${before.name} removido. Os cadastros continuam disponíveis.` });
    }
    if (body.action === "operational_group_member_set" || body.action === "pattern_operational_group_member_set") {
      const patternId = body.action === "pattern_operational_group_member_set" ? Number(body.patternId) : 0;
      const groupId = Number(body.groupId), resourceId = Number(body.resourceId), resourceKind = String(body.resourceKind || "");
      if (body.action === "pattern_operational_group_member_set" && !patternId) return Response.json({ error: "Selecione o padrão (D1, D2, N1 ou N2)." }, { status: 400 });
      if (!groupId || !resourceId || !["guard", "post", "vehicle"].includes(resourceKind)) return Response.json({ error: "Selecione grupamento e recurso válidos." }, { status: 400 });
      const group = await env.DB.prepare("SELECT id,name FROM operational_groups WHERE id=? AND active=1").bind(groupId).first<{ id: number; name: string }>();
      if (!group) return Response.json({ error: "Grupamento não encontrado ou inativo." }, { status: 404 });
      const table = resourceKind === "guard" ? "guards" : resourceKind === "post" ? "posts" : "vehicles";
      const resource = await env.DB.prepare(`SELECT id FROM ${table} WHERE id=? AND active=1`).bind(resourceId).first<{ id: number }>();
      if (!resource) return Response.json({ error: "Recurso não encontrado ou inativo." }, { status: 404 });
      const teamLabel = String(body.teamLabel || "").trim() || null;
      const requestedShift = String(body.shift || "").trim();
      let shift = resourceKind === "guard" && ["1", "2", "3", "4"].includes(requestedShift) ? requestedShift : null;
      const requestedVehicleId = resourceKind === "guard" && body.vehicleId != null && String(body.vehicleId).trim() !== ""
        ? Number(body.vehicleId)
        : 0;
      let vehicleId: number | null = null;
      if (requestedVehicleId) {
        const vehicle = await env.DB.prepare("SELECT id,type FROM vehicles WHERE id=? AND active=1").bind(requestedVehicleId).first<{ id: number; type: string | null }>();
        if (!vehicle) return Response.json({ error: "A viatura escolhida não está disponível no cadastro." }, { status: 400 });
        if (resourceKind !== "guard" || !patternId) return Response.json({ error: "A viatura do grupamento só pode ser definida para um GM dentro de um padrão." }, { status: 400 });
        if (isMotorcycleType(vehicle.type)) {
          const occupied = await env.DB.prepare("SELECT id FROM pattern_operational_group_members WHERE pattern_id=? AND vehicle_id=? AND NOT (resource_kind='guard' AND resource_id=?) LIMIT 1").bind(patternId, requestedVehicleId, resourceId).first();
          if (occupied) return Response.json({ error: "Esta moto já possui um condutor neste grupamento e padrão." }, { status: 409 });
        }
        vehicleId = vehicle.id;
      }
      const startsAtValue = String(body.startsAt || "").trim();
      const endsAtValue = String(body.endsAt || "").trim();
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      const startsAt = startsAtValue && timePattern.test(startsAtValue) ? startsAtValue : null;
      const endsAt = endsAtValue && timePattern.test(endsAtValue) ? endsAtValue : null;
      if ((startsAtValue && !startsAt) || (endsAtValue && !endsAt) || Boolean(startsAt) !== Boolean(endsAt)) {
        return Response.json({ error: "Informe o horário no formato HH:MM, com início e fim." }, { status: 400 });
      }
      if ((startsAt || endsAt) && !patternId) {
        return Response.json({ error: "O horário do grupamento só pode ser definido dentro de um padrão." }, { status: 400 });
      }
      if (startsAt && endsAt) {
        const duration = operationalGroupDurationHours(startsAt, endsAt);
        if (duration !== 12) {
          return Response.json({ error: "A jornada do grupamento deve ter 12 horas contínuas." }, { status: 400 });
        }
        shift = operationalGroupAnchorShift(startsAt);
      }
      if (patternId) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM pattern_operational_group_members WHERE pattern_id=? AND resource_kind=? AND resource_id=?").bind(patternId, resourceKind, resourceId),
          env.DB.prepare("INSERT INTO pattern_operational_group_members (pattern_id,group_id,resource_kind,resource_id,team_label,shift,vehicle_id,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(patternId, groupId, resourceKind, resourceId, teamLabel, shift, vehicleId, startsAt, endsAt),
        ]);
        const member = await env.DB.prepare(`SELECT m.id,m.pattern_id,m.group_id,m.resource_kind,m.resource_id,m.team_label,m.shift,m.vehicle_id,m.starts_at,m.ends_at,p.code pattern_code,g.name group_name,g.short_name group_short_name,g.color group_color
          FROM pattern_operational_group_members m JOIN shift_patterns p ON p.id=m.pattern_id JOIN operational_groups g ON g.id=m.group_id
          WHERE m.pattern_id=? AND m.resource_kind=? AND m.resource_id=?`).bind(patternId, resourceKind, resourceId).first();
        await writeAudit(request, { action: "update", entityType: "pattern_operational_group_member", entityId: Number(member?.id || 0), summary: `Vinculou ${resourceKind} ${resourceId} ao grupamento ${group.name} no padrão`, after: member as Record<string, unknown> });
        return Response.json({ ok: true, member, message: `${resourceKind === "guard" ? "GM" : resourceKind === "post" ? "Posto" : "Viatura"} vinculado a ${group.name} neste padrão.` });
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM operational_group_members WHERE resource_kind=? AND resource_id=?").bind(resourceKind, resourceId),
        env.DB.prepare("INSERT INTO operational_group_members (group_id,resource_kind,resource_id,team_label) VALUES (?,?,?,?)").bind(groupId, resourceKind, resourceId, teamLabel),
      ]);
      const member = await env.DB.prepare(`SELECT m.id,m.group_id,m.resource_kind,m.resource_id,m.team_label,g.name group_name,g.short_name group_short_name,g.color group_color
        FROM operational_group_members m JOIN operational_groups g ON g.id=m.group_id WHERE m.group_id=? AND m.resource_kind=? AND m.resource_id=?`).bind(groupId, resourceKind, resourceId).first();
      await writeAudit(request, { action: "update", entityType: "operational_group_member", entityId: Number(member?.id || 0), summary: `Vinculou ${resourceKind} ${resourceId} ao grupamento ${group.name}`, after: member as Record<string, unknown> });
      return Response.json({ ok: true, member, message: `Vínculo global com ${group.name} salvo.` });
    }
    if (body.action === "pattern_operational_group_member_remove") {
      const id = Number(body.id);
      if (!id) return Response.json({ error: "Vínculo de padrão inválido." }, { status: 400 });
      const before = await env.DB.prepare("SELECT * FROM pattern_operational_group_members WHERE id=?").bind(id).first<Record<string, unknown>>();
      await env.DB.prepare("DELETE FROM pattern_operational_group_members WHERE id=?").bind(id).run();
      if (before) await writeAudit(request, { action: "delete", entityType: "pattern_operational_group_member", entityId: id, summary: "Removeu vínculo de grupamento do padrão", before, undoable: true });
      return Response.json({ ok: true, message: "Vínculo removido deste padrão." });
    }
    if (body.action === "operational_group_member_remove") {
      const resourceKind = String(body.resourceKind || ""), resourceId = Number(body.resourceId);
      if (!resourceId || !["guard", "post", "vehicle"].includes(resourceKind)) return Response.json({ error: "Recurso inválido." }, { status: 400 });
      const before = await env.DB.prepare("SELECT * FROM operational_group_members WHERE resource_kind=? AND resource_id=?").bind(resourceKind, resourceId).first<Record<string, unknown>>();
      await env.DB.prepare("DELETE FROM operational_group_members WHERE resource_kind=? AND resource_id=?").bind(resourceKind, resourceId).run();
      if (before) await writeAudit(request, { action: "delete", entityType: "operational_group_member", entityId: Number(before.id), summary: `Desvinculou ${resourceKind} ${resourceId} do grupamento`, before, undoable: true });
      return Response.json({ ok: true, message: "Vínculo global removido." });
    }
    if (body.action === "update_slot") {
      const d = destination(body);
      const guardId = Number(body.guardId);
      if (d.vehicleId) {
        const vehicleError = await patternVehicleError(Number(body.patternId || 0), d.vehicleId, Number(body.id || 0));
        if (vehicleError) return Response.json({ error: vehicleError }, { status: 409 });
      }
      if (!(await guardUsesRegime(guardId, "12x36")))
        return Response.json({ error: "Este GM não pertence ao efetivo 12x36. Ajuste o regime em Cadastros antes de incluí-lo no padrão." }, { status: 409 });
      const before = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE pattern_slots SET pattern_id=COALESCE(?,pattern_id),guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(body.patternId || null, guardId, d.postId, d.vehicleId, body.shift || null, body.role, body.id)
        .run();
      const after = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(body.id).first();
      const auditId = await writeAudit(request,{action:"update",entityType:"pattern_slot",entityId:Number(body.id),summary:"Alterou uma posição do padrão 12x36",before,after:after as Record<string,unknown>,undoable:true});
      return Response.json({ ok: true, auditId, undoable: true });
    }
    if (body.action === "add_slot") {
      const d = destination(body);
      const guardId = Number(body.guardId);
      if (d.vehicleId) {
        const vehicleError = await patternVehicleError(Number(body.patternId || 0), d.vehicleId);
        if (vehicleError) return Response.json({ error: vehicleError }, { status: 409 });
      }
      if (!(await guardUsesRegime(guardId, "12x36")))
        return Response.json({ error: "Este GM não pertence ao efetivo 12x36. Ajuste o regime em Cadastros antes de incluí-lo no padrão." }, { status: 409 });
      const created = await env.DB.prepare(
        "INSERT INTO pattern_slots (pattern_id,guard_id,post_id,vehicle_id,shift,role) VALUES (?,?,?,?,?,?)",
      )
        .bind(body.patternId, guardId, d.postId, d.vehicleId, body.shift || null, body.role)
        .run();
      const after = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(created.meta.last_row_id).first();
      const auditId = await writeAudit(request,{action:"create",entityType:"pattern_slot",entityId:Number(created.meta.last_row_id),summary:"Adicionou uma posição ao padrão 12x36",after:after as Record<string,unknown>,undoable:true});
      return Response.json({ ok: true, auditId, undoable: true });
    }
    if (body.action === "add_post") {
      const name = String(body.name || "").trim();
      const groupName = String(body.groupName || "POSTOS DIVERSOS").trim() || "POSTOS DIVERSOS";
      const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.max(0, Number(body.sortOrder)) : 99;
      if (!name) return Response.json({ error: "Informe o nome do posto." }, { status: 400 });
      const duplicate = await env.DB.prepare("SELECT id FROM posts WHERE active=1 AND lower(name)=lower(?) LIMIT 1").bind(name).first();
      if (duplicate) return Response.json({ error: "Já existe um posto ativo com esse nome." }, { status: 409 });
      const created = await env.DB.prepare("INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)")
        .bind(name, groupName, sortOrder)
        .run();
      const after = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request, { action: "create", entityType: "post", entityId: Number(created.meta.last_row_id), summary: `Adicionou o posto ${name} a partir dos padrões`, after: after as Record<string, unknown>, undoable: true });
      return Response.json({ ok: true, message: `Posto ${name} adicionado.`, resource: after });
    }
    if (body.action === "add_vehicle") {
      const prefix = String(body.prefix || "").trim();
      const type = String(body.type || "sedan").trim();
      const zone = String(body.zone || "").trim() || null;
      const allowedTypes = new Set(["sedan", "pickup", "van", "moto", "suv", "other"]);
      if (!prefix) return Response.json({ error: "Informe o prefixo da viatura." }, { status: 400 });
      if (!allowedTypes.has(type)) return Response.json({ error: "Tipo de viatura inválido." }, { status: 400 });
      const existing = await env.DB.prepare("SELECT id,active FROM vehicles WHERE lower(prefix)=lower(?) LIMIT 1").bind(prefix).first<{ id: number; active: number }>();
      const duplicate = existing?.active ? existing : null;
      if (duplicate) return Response.json({ error: "Já existe uma viatura ativa com esse prefixo." }, { status: 409 });
      if (existing) {
        const before = await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(existing.id).first<Record<string, unknown>>();
        await env.DB.prepare("UPDATE vehicles SET type=?,zone=?,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(type, zone, existing.id)
          .run();
        const after = await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(existing.id).first();
        await writeAudit(request, { action: "update", entityType: "vehicle", entityId: existing.id, summary: `Reativou a viatura ${prefix} a partir dos padrÃµes`, before, after: after as Record<string, unknown>, undoable: true });
        return Response.json({ ok: true, message: `${prefix} reativada e atualizada.`, resource: after });
      }
      const created = await env.DB.prepare("INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)")
        .bind(prefix, type, zone)
        .run();
      const after = await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request, { action: "create", entityType: "vehicle", entityId: Number(created.meta.last_row_id), summary: `Adicionou a viatura ${prefix} a partir dos padrões`, after: after as Record<string, unknown>, undoable: true });
      return Response.json({ ok: true, message: `${prefix} adicionada.`, resource: after });
    }
    if (body.action === "delete_slot") {
      const before = await env.DB.prepare("SELECT * FROM pattern_slots WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare("DELETE FROM pattern_slots WHERE id=?")
        .bind(body.id)
        .run();
      const auditId = await writeAudit(request,{action:"delete",entityType:"pattern_slot",entityId:Number(body.id),summary:"Removeu uma posição do padrão 12x36",before,undoable:true});
      return Response.json({ ok: true, auditId, undoable: true });
    }
    if (body.action === "delete_resource_slots") {
      const patternId = Number(body.patternId), resourceId = Number(body.resourceId), resourceKind = String(body.resourceKind || "");
      if (!patternId || !resourceId || !["post", "vehicle"].includes(resourceKind)) {
        return Response.json({ error: "Destino do padrão inválido." }, { status: 400 });
      }
      const column = resourceKind === "vehicle" ? "vehicle_id" : "post_id";
      const before = (await env.DB.prepare(`SELECT * FROM pattern_slots WHERE pattern_id=? AND ${column}=? ORDER BY id`).bind(patternId, resourceId).all<Record<string, unknown>>()).results;
      if (!before.length) return Response.json({ error: "Este recurso já não possui GMs neste padrão." }, { status: 404 });
      await env.DB.prepare(`DELETE FROM pattern_slots WHERE pattern_id=? AND ${column}=?`).bind(patternId, resourceId).run();
      const auditId = await writeAudit(request, {
        action: "delete",
        entityType: "pattern_resource_slots",
        entityId: `${patternId}:${resourceKind}:${resourceId}`,
        summary: `Removeu ${resourceKind === "vehicle" ? "uma viatura" : "um posto"} e sua composição do padrão 12x36`,
        before: { slots: before },
        undoable: true,
      });
      return Response.json({ ok: true, auditId, undoable: true, message: "Viatura removida somente deste padrão. Os GMs e o cadastro da viatura foram preservados." });
    }
    if(body.action==="weekly_save") {
      const d=destination(body),id=Number(body.id||0),guardId=Number(body.guardId);
      if ((d.postId ? 1 : 0) + (d.vehicleId ? 1 : 0) !== 1) return Response.json({ error: "Selecione um posto ou viatura para o GM semanal." }, { status: 400 });
      const activeGuard=await env.DB.prepare("SELECT id FROM guards WHERE id=? AND active=1").bind(guardId).first();
      if (!activeGuard) return Response.json({ error: "Selecione um GM ativo para a escala semanal." }, { status: 409 });
      const duplicateWeekly=await env.DB.prepare("SELECT id FROM weekly_slots WHERE guard_id=? AND active=1 AND id<>? LIMIT 1").bind(guardId,id).first();
      if (duplicateWeekly) return Response.json({ error: "Este GM já possui um cadastro na escala semanal." }, { status: 409 });
      const before=id?await env.DB.prepare("SELECT * FROM weekly_slots WHERE id=?").bind(id).first<Record<string,unknown>>():null;
      let weeklyId=id;
      if(id)await env.DB.prepare("UPDATE weekly_slots SET guard_id=?,weekdays=?,post_id=?,vehicle_id=?,role=?,starts_at=?,break_start=?,break_end=?,regular_end=?,overtime_end=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(guardId,body.weekdays||"1,2,3,4,5",d.postId,d.vehicleId,body.role,body.startsAt,body.breakStart||null,body.breakEnd||null,body.regularEnd,body.overtimeEnd||null,id).run();
      else {const created=await env.DB.prepare(`INSERT INTO weekly_slots (guard_id,weekdays,post_id,vehicle_id,role,starts_at,break_start,break_end,regular_end,overtime_end,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(guard_id) DO UPDATE SET weekdays=excluded.weekdays,post_id=excluded.post_id,vehicle_id=excluded.vehicle_id,role=excluded.role,starts_at=excluded.starts_at,break_start=excluded.break_start,break_end=excluded.break_end,regular_end=excluded.regular_end,overtime_end=excluded.overtime_end,active=1,updated_at=CURRENT_TIMESTAMP`).bind(guardId,body.weekdays||"1,2,3,4,5",d.postId,d.vehicleId,body.role,body.startsAt,body.breakStart||null,body.breakEnd||null,body.regularEnd,body.overtimeEnd||null).run();weeklyId=Number(created.meta.last_row_id)||Number((await env.DB.prepare("SELECT id FROM weekly_slots WHERE guard_id=?").bind(guardId).first<{id:number}>())?.id||0)}
      await env.DB.prepare("UPDATE guards SET work_regime='weekly',base_shift='Semanal' WHERE id=?").bind(guardId).run();
      await env.DB.prepare("DELETE FROM pattern_slots WHERE guard_id=?").bind(guardId).run();
      await env.DB.prepare("DELETE FROM pattern_operational_group_members WHERE resource_kind='guard' AND resource_id=?").bind(guardId).run();
      await reconcileWeeklyGuardSchedules(env.DB,guardId);
      if(before&&Number(before.guard_id)!==guardId)await env.DB.batch([
        env.DB.prepare("UPDATE guards SET work_regime='12x36',base_shift=CASE WHEN upper(COALESCE(platoon,'')) LIKE 'N%' THEN '12x36 noite' ELSE '12x36 dia' END WHERE id=?").bind(before.guard_id),
        env.DB.prepare("DELETE FROM assignments WHERE guard_id=? AND work_kind='weekly'").bind(before.guard_id),
      ]);
      const after=await env.DB.prepare("SELECT * FROM weekly_slots WHERE id=?").bind(weeklyId).first();
      await writeAudit(request,{action:id?"update":"create",entityType:"weekly_slot",entityId:weeklyId,summary:`${id?"Alterou":"Criou"} escala semanal`,before,after:after as Record<string,unknown>});
      return Response.json({ok:true,message:"Escala semanal salva e integrada aos dias úteis."});
    }
    if(body.action==="weekly_delete") {
      const before=await env.DB.prepare("SELECT * FROM weekly_slots WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare("DELETE FROM weekly_slots WHERE id=?").bind(body.id).run();
      if(before)await env.DB.batch([
        env.DB.prepare("UPDATE guards SET work_regime='12x36',base_shift=CASE WHEN upper(COALESCE(platoon,'')) LIKE 'N%' THEN '12x36 noite' ELSE '12x36 dia' END WHERE id=?").bind(before.guard_id),
        env.DB.prepare("DELETE FROM assignments WHERE guard_id=? AND work_kind='weekly'").bind(before.guard_id),
      ]);
      await writeAudit(request,{action:"delete",entityType:"weekly_slot",entityId:Number(body.id),summary:"Removeu escala semanal",before});
      return Response.json({ok:true});
    }
    if (body.action === "apply") {
      if (!body.confirm)
        return Response.json(
          { error: "Confirmação necessária." },
          { status: 400 },
        );
      const date = String(body.date);
      const existingSchedule = await env.DB.prepare("SELECT id,status FROM schedules WHERE date=? LIMIT 1").bind(date).first<{ id: number; status: string }>();
      if (existingSchedule) {
        const existingCount = await env.DB.prepare("SELECT COUNT(*) total FROM assignments WHERE schedule_id=?").bind(existingSchedule.id).first<{ total: number | string }>();
        if (Number(existingCount?.total || 0) > 0 && body.acknowledgeManual !== true) {
          return Response.json({ error: "Esta data já possui uma escala. Revise a prévia e confirme explicitamente a substituição.", requiresReview: true, scheduleId: existingSchedule.id, status: existingSchedule.status, assignmentCount: Number(existingCount?.total || 0) }, { status: 409 });
        }
      }
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
      await applyWeeklyToSchedule(env.DB,date,schedule.id);
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
