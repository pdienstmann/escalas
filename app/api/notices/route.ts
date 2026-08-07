import { env } from "cloudflare:workers";
import { writeAudit } from "../../../lib/audit";

export const dynamic="force-dynamic";
function permitted(request:Request){const host=new URL(request.url).hostname;return host==="localhost"||host==="127.0.0.1"||Boolean(request.headers.get("oai-authenticated-user-id"))}

export async function GET(request:Request){
  if(!permitted(request))return Response.json({error:"Não autorizado"},{status:401});
  const date=new URL(request.url).searchParams.get("date");
  const result=date
    ?await env.DB.prepare("SELECT * FROM operational_notices WHERE effective_date=? ORDER BY status,title").bind(date).all()
    :await env.DB.prepare("SELECT * FROM operational_notices ORDER BY effective_date DESC,created_at DESC LIMIT 100").all();
  return Response.json({items:result.results});
}

export async function POST(request:Request){
  if(!permitted(request))return Response.json({error:"Não autorizado"},{status:401});
  const body=await request.json() as Record<string,string|number>;
  if(body.action==="create"){const created=await env.DB.prepare("INSERT INTO operational_notices (effective_date,title,details) VALUES (?,?,?)").bind(body.effectiveDate,body.title,body.details||null).run();const after=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(created.meta.last_row_id).first();await writeAudit(request,{action:"create",entityType:"notice",entityId:Number(created.meta.last_row_id),summary:`Criou o lembrete ${body.title}`,after:after as Record<string,unknown>,undoable:true})}
  else if(body.action==="acknowledge"||body.action==="reopen"){const before=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(body.id).first<Record<string,unknown>>();if(body.action==="acknowledge")await env.DB.prepare("UPDATE operational_notices SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();else await env.DB.prepare("UPDATE operational_notices SET status='pending',acknowledged_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();const after=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(body.id).first();await writeAudit(request,{action:"update",entityType:"notice",entityId:body.id,summary:`${body.action==="acknowledge"?"Conferiu":"Reabriu"} o lembrete ${before?.title}`,before,after:after as Record<string,unknown>,undoable:true})}
  else if(body.action==="delete"){const before=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(body.id).first<Record<string,unknown>>();await env.DB.prepare("DELETE FROM operational_notices WHERE id=?").bind(body.id).run();await writeAudit(request,{action:"delete",entityType:"notice",entityId:body.id,summary:`Excluiu o lembrete ${before?.title}`,before,undoable:true})}
  else return Response.json({error:"Ação inválida"},{status:400});
  return Response.json({ok:true});
}
