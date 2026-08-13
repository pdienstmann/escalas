import { env } from "cloudflare:workers";
import { writeAudit } from "../../../lib/audit";
import { permitted } from "../../../lib/access";

const shifts = ["2", "3", "4", "1"] as const;

type Row = Record<string, unknown>;
type Issue = {
  id: string;
  severity: "critical" | "warning";
  kind: "coverage" | "role" | "conflict";
  label: string;
  detail: string;
  resourceKind?: "post" | "vehicle";
  resourceId?: number;
  shift?: string;
};

const numberValue = (value: unknown) => Number(value || 0);
const textValue = (value: unknown) => String(value || "");

function overlapping(left: Row, right: Row) {
  return textValue(left.starts_at) < textValue(right.ends_at) && textValue(left.ends_at) > textValue(right.starts_at);
}

function resourceLabel(assignment: Row) {
  if (assignment.vehicle_prefix) return String(assignment.vehicle_prefix);
  if (assignment.post_name) return String(assignment.post_name);
  return "À disposição";
}

async function loadValidationData(scheduleId: number, date: string) {
  const [posts, vehicles, assignments] = await Promise.all([
    env.DB.prepare(`
      SELECT p.id,p.name,p.group_name
      FROM posts p
      WHERE p.active=1
        AND NOT EXISTS (
          SELECT 1 FROM schedule_resource_exclusions e
          WHERE e.schedule_id=? AND e.resource_kind='post' AND e.resource_id=p.id
        )
      ORDER BY p.sort_order,p.name
    `).bind(scheduleId).all<Row>(),
    env.DB.prepare(`
      SELECT v.id,v.prefix,v.type,v.zone
      FROM vehicles v
      WHERE v.active=1
        AND NOT EXISTS (
          SELECT 1 FROM schedule_resource_exclusions e
          WHERE e.schedule_id=? AND e.resource_kind='vehicle' AND e.resource_id=v.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_outages o
          WHERE o.vehicle_id=v.id AND o.active=1 AND o.starts_on<=?
            AND (o.ends_on IS NULL OR o.ends_on>=?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_return_reconciliations r
          WHERE r.schedule_id=? AND r.vehicle_id=v.id AND r.status IN ('pending','kept')
        )
      ORDER BY v.prefix
    `).bind(scheduleId, date, date, scheduleId).all<Row>(),
    env.DB.prepare(`
      SELECT a.*,g.name guard_name,p.name post_name,v.prefix vehicle_prefix
      FROM assignments a
      JOIN guards g ON g.id=a.guard_id
      LEFT JOIN posts p ON p.id=a.post_id
      LEFT JOIN vehicles v ON v.id=a.vehicle_id
      WHERE a.schedule_id=?
        AND NOT EXISTS (
          SELECT 1 FROM movements m
          WHERE m.guard_id=a.guard_id AND m.status='approved'
            AND m.starts_at<? AND m.ends_at>?
        )
        AND NOT EXISTS (
          SELECT 1 FROM service_adjustments sa
          WHERE sa.guard_id=a.guard_id AND sa.status='active'
            AND sa.subtype='negative_full' AND sa.service_date=?
        )
      ORDER BY a.guard_id,a.starts_at,a.id
    `).bind(scheduleId, `${date}T23:59`, `${date}T00:00`, date).all<Row>(),
  ]);
  return {
    posts: posts.results,
    vehicles: vehicles.results,
    assignments: assignments.results,
  };
}

function buildIssues(posts: Row[], vehicles: Row[], assignments: Row[]): Issue[] {
  const issues: Issue[] = [];
  const visiblePostIds = new Set(posts.map((post) => numberValue(post.id)));
  const visibleVehicleIds = new Set(vehicles.map((vehicle) => numberValue(vehicle.id)));
  const visibleAssignments = assignments.filter((assignment) => {
    const postId = numberValue(assignment.post_id);
    const vehicleId = numberValue(assignment.vehicle_id);
    if (!postId && !vehicleId) return false;
    return (postId && visiblePostIds.has(postId)) || (vehicleId && visibleVehicleIds.has(vehicleId));
  });
  const regular = visibleAssignments.filter((assignment) => textValue(assignment.work_kind) !== "overtime_extension");
  const byResource = (kind: "post" | "vehicle", id: number, shift: string) => regular.filter((assignment) =>
    textValue(assignment.shift) === shift && numberValue(kind === "post" ? assignment.post_id : assignment.vehicle_id) === id,
  );

  for (const post of posts) {
    const postId = numberValue(post.id);
    for (const shift of shifts) {
      const members = byResource("post", postId, shift);
      if (members.length < 1) {
        issues.push({
          id: `post-${postId}-${shift}`,
          severity: "critical",
          kind: "coverage",
          label: `${textValue(post.name)} · ${shift}º turno`,
          detail: "Nenhum GM está escalado neste posto e turno.",
          resourceKind: "post",
          resourceId: postId,
          shift,
        });
      }
    }
  }

  for (const vehicle of vehicles) {
    const vehicleId = numberValue(vehicle.id);
    for (const shift of shifts) {
      const members = byResource("vehicle", vehicleId, shift);
      const missingRoles = ["driver", "patrol"].filter((role) => !members.some((member) => textValue(member.role) === role));
      if (members.length < 2 || missingRoles.length > 0) {
        const countText = `${members.length}/2 integrantes`;
        const roleText = missingRoles.length ? `Funções ausentes: ${missingRoles.map((role) => role === "driver" ? "motorista" : "patrulheiro").join(" e ")}.` : "";
        issues.push({
          id: `vehicle-${vehicleId}-${shift}`,
          severity: "critical",
          kind: members.length < 2 ? "coverage" : "role",
          label: `${textValue(vehicle.prefix)} · ${shift}º turno`,
          detail: `${countText}. ${roleText}`.trim(),
          resourceKind: "vehicle",
          resourceId: vehicleId,
          shift,
        });
      }
    }
  }

  const byGuard = new Map<number, Row[]>();
  for (const assignment of visibleAssignments) {
    const guardId = numberValue(assignment.guard_id);
    byGuard.set(guardId, [...(byGuard.get(guardId) || []), assignment]);
  }
  for (const [guardId, guardAssignments] of byGuard) {
    for (let index = 0; index < guardAssignments.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < guardAssignments.length; otherIndex += 1) {
        const left = guardAssignments[index];
        const right = guardAssignments[otherIndex];
        if (!overlapping(left, right)) continue;
        const leftLocation = `${resourceLabel(left)} (${textValue(left.shift)}º)`;
        const rightLocation = `${resourceLabel(right)} (${textValue(right.shift)}º)`;
        issues.push({
          id: `conflict-${guardId}-${numberValue(left.id)}-${numberValue(right.id)}`,
          severity: "critical",
          kind: "conflict",
          label: `${textValue(left.guard_name)} em dois locais`,
          detail: `${leftLocation} conflita com ${rightLocation}. Ajuste um dos quadrantes antes de publicar.`,
        });
      }
    }
  }
  return issues;
}

export async function POST(request: Request) {
  try {
    return await publishSchedule(request);
  } catch (error) {
    console.error("publish_validation_error", error);
    return Response.json({ error: "Não foi possível concluir a validação da escala." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    if (!permitted(request)) return Response.json({ error: "Nao autorizado" }, { status: 401 });
    const scheduleId = Number(new URL(request.url).searchParams.get("scheduleId") || 0);
    if (!Number.isInteger(scheduleId) || scheduleId < 1)
      return Response.json({ error: "Informe uma escala valida." }, { status: 400 });
    const schedule = await env.DB.prepare("SELECT id,date,status FROM schedules WHERE id=?").bind(scheduleId).first<Row>();
    if (!schedule) return Response.json({ error: "Escala nao encontrada." }, { status: 404 });
    const data = await loadValidationData(scheduleId, textValue(schedule.date));
    const issues = buildIssues(data.posts, data.vehicles, data.assignments);
    return Response.json({ schedule, issues, summary: {
      critical: issues.filter((issue) => issue.severity === "critical").length,
      warning: issues.filter((issue) => issue.severity === "warning").length,
    } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("publish_preview_error", error);
    return Response.json({ error: "Não foi possível conferir as pendências da escala." }, { status: 500 });
  }
}

async function publishSchedule(request: Request) {
  if (!permitted(request)) return Response.json({ error: "Nao autorizado" }, { status: 401 });
  const body = await request.json() as { scheduleId?: number | string };
  const scheduleId = Number(body.scheduleId || 0);
  if (!Number.isInteger(scheduleId) || scheduleId < 1) {
    return Response.json({ error: "Informe uma escala valida." }, { status: 400 });
  }
  const schedule = await env.DB.prepare("SELECT * FROM schedules WHERE id=?").bind(scheduleId).first<Row>();
  if (!schedule) return Response.json({ error: "Escala nao encontrada." }, { status: 404 });

  const data = await loadValidationData(scheduleId, textValue(schedule.date));
  const issues = buildIssues(data.posts, data.vehicles, data.assignments);
  if (issues.length) {
    return Response.json({
      error: "Existem pendencias que precisam ser conferidas antes da publicacao.",
      issues,
      summary: {
        critical: issues.filter((issue) => issue.severity === "critical").length,
        warning: issues.filter((issue) => issue.severity === "warning").length,
      },
    }, { status: 409 });
  }

  const before = schedule;
  await env.DB.prepare("UPDATE schedules SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(scheduleId)
    .run();
  const after = await env.DB.prepare("SELECT * FROM schedules WHERE id=?").bind(scheduleId).first<Row>();
  await writeAudit(request, {
    action: "publish",
    entityType: "schedule",
    entityId: scheduleId,
    summary: `Publicou a escala de ${textValue(after?.date)}`,
    before,
    after,
  });
  return Response.json({ ok: true, status: "published", date: after?.date, issues: [] });
}
