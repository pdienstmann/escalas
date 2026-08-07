import { env } from "cloudflare:workers";
import { actorFromRequest, writeAudit } from "../../../lib/audit";

export const dynamic = "force-dynamic";

function permitted(request: Request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || Boolean(request.headers.get("oai-authenticated-user-id"));
}

export async function GET(request: Request) {
  if (!permitted(request)) return Response.json({error:"Não autorizado"},{status:401});
  const url = new URL(request.url);
  const entity = url.searchParams.get("entity") || "";
  const query = url.searchParams.get("q") || "";
  const clauses = ["1=1"];
  const values: string[] = [];
  if (entity) { clauses.push("entity_type=?"); values.push(entity); }
  if (query) {
    clauses.push("(summary LIKE ? OR actor_name LIKE ? OR actor_email LIKE ?)");
    values.push(`%${query}%`,`%${query}%`,`%${query}%`);
  }
  const items = await env.DB.prepare(`SELECT * FROM audit_events WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT 150`).bind(...values).all();
  return Response.json({items:items.results,actor:actorFromRequest(request)},{headers:{"cache-control":"no-store"}});
}

type Row = Record<string, unknown>;

export async function POST(request: Request) {
  if (!permitted(request)) return Response.json({error:"Não autorizado"},{status:401});
  const body = await request.json() as {action?:string;id?:number};
  if (body.action !== "undo" || !body.id) return Response.json({error:"Ação inválida."},{status:400});
  const event = await env.DB.prepare("SELECT * FROM audit_events WHERE id=?").bind(body.id).first<Row>();
  if (!event) return Response.json({error:"Registro de histórico não encontrado."},{status:404});
  if (!Number(event.undoable)) return Response.json({error:"Esta alteração é apenas informativa e não pode ser desfeita."},{status:409});
  if (event.undone_at) return Response.json({error:"Esta alteração já foi desfeita."},{status:409});
  const newer = await env.DB.prepare("SELECT id FROM audit_events WHERE entity_type=? AND entity_id=? AND id>? AND undone_at IS NULL LIMIT 1").bind(event.entity_type,event.entity_id,event.id).first();
  if (newer) return Response.json({error:"Existe uma alteração posterior neste registro. Desfaça primeiro a alteração mais recente."},{status:409});
  const before = event.before_json ? JSON.parse(String(event.before_json)) as Row : null;
  const after = event.after_json ? JSON.parse(String(event.after_json)) as Row : null;
  const statements: D1PreparedStatement[] = [];
  const type = String(event.entity_type), action = String(event.action), rawEntityId = String(event.entity_id), id = Number(rawEntityId);

  if (type === "assignment") {
    if (action === "create") statements.push(env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(id));
    else if (action === "update" && before) statements.push(assignmentUpdate(before,id));
    else if (action === "delete" && before) statements.push(assignmentInsert(before,id));
    else return Response.json({error:"Não foi possível reconstruir esta designação."},{status:409});
  } else if (type === "movement") {
    if (action === "create") statements.push(env.DB.prepare("DELETE FROM movements WHERE id=?").bind(id));
    else if (action === "update" && before) statements.push(movementUpdate(before,id));
    else if (action === "delete" && before) statements.push(movementInsert(before,id));
    else return Response.json({error:"Não foi possível reconstruir esta movimentação."},{status:409});
  } else if (["guard","post","vehicle"].includes(type) && before) {
    statements.push(catalogRestore(type,before,id));
  } else if (type === "leave_choice" && action === "create") {
    statements.push(env.DB.prepare("DELETE FROM movements WHERE request_ref=?").bind(`FOLGA-${id}`));
    statements.push(env.DB.prepare("DELETE FROM leave_choices WHERE id=?").bind(id));
  } else if (type === "pattern_slot") {
    if (action === "create") statements.push(env.DB.prepare("DELETE FROM pattern_slots WHERE id=?").bind(id));
    else if (action === "update" && before) statements.push(patternSlotUpdate(before,id));
    else if (action === "delete" && before) statements.push(patternSlotInsert(before,id));
    else return Response.json({error:"Não foi possível reconstruir esta posição do padrão."},{status:409});
  } else if (type === "pattern_config" && before) {
    statements.push(env.DB.prepare("UPDATE shift_patterns SET anchor_date=?,updated_at=CURRENT_TIMESTAMP WHERE active=1").bind(before.anchor_date));
  } else if (type === "notice") {
    if (action === "create") statements.push(env.DB.prepare("DELETE FROM operational_notices WHERE id=?").bind(id));
    else if (action === "update" && before) statements.push(noticeUpdate(before,id));
    else if (action === "delete" && before) statements.push(noticeInsert(before,id));
    else return Response.json({error:"Não foi possível reconstruir este lembrete."},{status:409});
  } else if (type === "section" && before && Array.isArray(before.orders)) {
    for (const row of before.orders as Array<{id:number;sort_order:number}>) statements.push(env.DB.prepare("UPDATE posts SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.sort_order,row.id));
  } else if(type==="vehicle_outage") {
    if(action==="create")statements.push(env.DB.prepare("DELETE FROM vehicle_outages WHERE id=?").bind(id));
    else if(action==="delete"&&before)statements.push(env.DB.prepare("INSERT INTO vehicle_outages (id,vehicle_id,starts_on,ends_on,reason,active) VALUES (?,?,?,?,?,?)").bind(id,before.vehicle_id,before.starts_on,before.ends_on,before.reason,before.active));
    else return Response.json({error:"Não foi possível reconstruir este FA."},{status:409});
  } else {
    return Response.json({error:"O desfazer seguro ainda não está disponível para este tipo de alteração."},{status:409});
  }

  const actor = actorFromRequest(request);
  statements.push(env.DB.prepare("UPDATE audit_events SET undone_at=CURRENT_TIMESTAMP,undone_by_id=?,undone_by_email=? WHERE id=?").bind(actor.id,actor.email,event.id));
  await env.DB.batch(statements);
  await writeAudit(request,{action:"undo",entityType:type,entityId:event.entity_id as string,summary:`Desfez: ${event.summary}`,before:after,after:before,undoable:false});
  return Response.json({ok:true,message:"Alteração desfeita com sucesso."});
}

function assignmentUpdate(row: Row, id: number) {
  return env.DB.prepare("UPDATE assignments SET schedule_id=?,guard_id=?,post_id=?,vehicle_id=?,shift=?,role=?,starts_at=?,ends_at=?,status=?,request_ref=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.schedule_id,row.guard_id,row.post_id,row.vehicle_id,row.shift,row.role,row.starts_at,row.ends_at,row.status,row.request_ref,row.is_reassigned||0,row.reassignment_note||null,id);
}
function assignmentInsert(row: Row, id: number) {
  return env.DB.prepare("INSERT INTO assignments (id,schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status,request_ref,is_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,row.schedule_id,row.guard_id,row.post_id,row.vehicle_id,row.shift,row.role,row.starts_at,row.ends_at,row.status,row.request_ref,row.is_reassigned||0,row.reassignment_note||null);
}
function movementUpdate(row:Row,id:number){return env.DB.prepare("UPDATE movements SET guard_id=?,type=?,starts_at=?,ends_at=?,request_ref=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.guard_id,row.type,row.starts_at,row.ends_at,row.request_ref,row.notes,row.status,id)}
function movementInsert(row:Row,id:number){return env.DB.prepare("INSERT INTO movements (id,guard_id,type,starts_at,ends_at,request_ref,notes,status) VALUES (?,?,?,?,?,?,?,?)").bind(id,row.guard_id,row.type,row.starts_at,row.ends_at,row.request_ref,row.notes,row.status)}
function catalogRestore(type:string,row:Row,id:number) {
  if(type==="guard") return env.DB.prepare("UPDATE guards SET registration=?,name=?,platoon=?,base_shift=?,work_regime=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.registration,row.name,row.platoon,row.base_shift,row.work_regime||"12x36",row.active,id);
  if(type==="post") return env.DB.prepare("UPDATE posts SET name=?,group_name=?,sort_order=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.name,row.group_name,row.sort_order,row.active,id);
  return env.DB.prepare("UPDATE vehicles SET prefix=?,type=?,zone=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.prefix,row.type,row.zone,row.active,id);
}
function patternSlotUpdate(row:Row,id:number){return env.DB.prepare("UPDATE pattern_slots SET pattern_id=?,guard_id=?,post_id=?,vehicle_id=?,role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.pattern_id,row.guard_id,row.post_id,row.vehicle_id,row.role,id)}
function patternSlotInsert(row:Row,id:number){return env.DB.prepare("INSERT INTO pattern_slots (id,pattern_id,guard_id,post_id,vehicle_id,role) VALUES (?,?,?,?,?,?)").bind(id,row.pattern_id,row.guard_id,row.post_id,row.vehicle_id,row.role)}
function noticeUpdate(row:Row,id:number){return env.DB.prepare("UPDATE operational_notices SET effective_date=?,title=?,details=?,status=?,acknowledged_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.effective_date,row.title,row.details,row.status,row.acknowledged_at,id)}
function noticeInsert(row:Row,id:number){return env.DB.prepare("INSERT INTO operational_notices (id,effective_date,title,details,status,acknowledged_at) VALUES (?,?,?,?,?,?)").bind(id,row.effective_date,row.title,row.details,row.status,row.acknowledged_at)}
