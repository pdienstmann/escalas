import { env } from "cloudflare:workers";

export type AuditRecord = Record<string, unknown> | null;

export function actorFromRequest(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id") || "local-user";
  const email = request.headers.get("oai-authenticated-user-email") || "ambiente-local";
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  let name = email;
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(encodedName); } catch { name = email; }
  }
  return { id, email, name };
}

export async function writeAudit(request: Request, event: {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  before?: AuditRecord;
  after?: AuditRecord;
  undoable?: boolean;
}) {
  const actor = actorFromRequest(request);
  const created = await env.DB.prepare(
    "INSERT INTO audit_events (action,entity_type,entity_id,summary,before_json,after_json,actor_id,actor_email,actor_name,undoable) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    event.action,
    event.entityType,
    event.entityId == null ? null : String(event.entityId),
    event.summary,
    event.before ? JSON.stringify(event.before) : null,
    event.after ? JSON.stringify(event.after) : null,
    actor.id,
    actor.email,
    actor.name,
    event.undoable ? 1 : 0,
  ).run();
  return Number(created.meta.last_row_id);
}
