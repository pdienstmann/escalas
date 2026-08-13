import { env } from "cloudflare:workers";
import { writeAudit } from "../../../lib/audit";
import { permitted } from "../../../lib/access";

export const dynamic="force-dynamic";



export async function GET(request:Request){
  if(!permitted(request))return Response.json({error:"Não autorizado"},{status:401});
  const searchParams=new URL(request.url).searchParams;
  const date=searchParams.get("date");
  const month=searchParams.get("month");
  if(month&&!/^\d{4}-\d{2}$/.test(month))return Response.json({error:"Mês inválido."},{status:400});
  const result=date
    ?await env.DB.prepare("SELECT * FROM operational_notices WHERE effective_date=? ORDER BY status,title").bind(date).all()
    :month
      ?await env.DB.prepare("SELECT * FROM operational_notices WHERE effective_date>=? AND effective_date<? ORDER BY effective_date,status,title").bind(`${month}-01`,nextMonth(month)).all()
    :await env.DB.prepare("SELECT * FROM operational_notices ORDER BY effective_date DESC,created_at DESC LIMIT 100").all();
  return Response.json({items:result.results});
}

function nextMonth(month:string){
  const [year,value]=month.split("-").map(Number);
  return `${value===12?year+1:year}-${String(value===12?1:value+1).padStart(2,"0")}-01`;
}

export async function POST(request:Request){
  if(!permitted(request))return Response.json({error:"Não autorizado"},{status:401});
  const body=await request.json() as Record<string,string|number>;
  const action=String(body.action||"");
  if(action==="create"||action==="update"){
    const effectiveDate=String(body.effectiveDate||"").trim(),title=String(body.title||"").trim(),details=String(body.details||"").trim()||null;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||!title)return Response.json({error:"Informe uma data e um título para a alteração."},{status:400});
    if(action==="create"){
      const created=await env.DB.prepare("INSERT INTO operational_notices (effective_date,title,details) VALUES (?,?,?)").bind(effectiveDate,title,details).run();
      const after=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request,{action:"create",entityType:"notice",entityId:Number(created.meta.last_row_id),summary:`Criou o lembrete ${title}`,after:after as Record<string,unknown>,undoable:true});
      return Response.json({ok:true,message:"Alteração criada.",item:after});
    }
    const id=Number(body.id||0),before=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(id).first<Record<string,unknown>>();
    if(!before)return Response.json({error:"Alteração não encontrada."},{status:404});
    await env.DB.prepare("UPDATE operational_notices SET effective_date=?,title=?,details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(effectiveDate,title,details,id).run();
    const after=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(id).first();
    await writeAudit(request,{action:"update",entityType:"notice",entityId:id,summary:`Editou o lembrete ${title}`,before,after:after as Record<string,unknown>,undoable:true});
    return Response.json({ok:true,message:"Alteração atualizada.",item:after});
  }
  if(action==="acknowledge"||action==="reopen"){
    const before=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(body.id).first<Record<string,unknown>>();
    if(!before)return Response.json({error:"Alteração não encontrada."},{status:404});
    if(action==="acknowledge")await env.DB.prepare("UPDATE operational_notices SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();
    else await env.DB.prepare("UPDATE operational_notices SET status='pending',acknowledged_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();
    const after=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(body.id).first();
    await writeAudit(request,{action:"update",entityType:"notice",entityId:body.id,summary:`${action==="acknowledge"?"Conferiu":"Reabriu"} o lembrete ${before.title}`,before,after:after as Record<string,unknown>,undoable:true});
    return Response.json({ok:true,message:action==="acknowledge"?"Alteração marcada como conferida.":"Alteração reaberta.",item:after});
  }
  if(action==="delete"){
    const before=await env.DB.prepare("SELECT * FROM operational_notices WHERE id=?").bind(body.id).first<Record<string,unknown>>();
    if(!before)return Response.json({error:"Alteração não encontrada."},{status:404});
    await env.DB.prepare("DELETE FROM operational_notices WHERE id=?").bind(body.id).run();
    await writeAudit(request,{action:"delete",entityType:"notice",entityId:body.id,summary:`Excluiu o lembrete ${before.title}`,before,undoable:true});
    return Response.json({ok:true,message:"Alteração excluída."});
  }
  return Response.json({error:"Ação inválida"},{status:400});
}
