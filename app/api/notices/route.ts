import { env } from "cloudflare:workers";

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
  if(body.action==="create")await env.DB.prepare("INSERT INTO operational_notices (effective_date,title,details) VALUES (?,?,?)").bind(body.effectiveDate,body.title,body.details||null).run();
  else if(body.action==="acknowledge")await env.DB.prepare("UPDATE operational_notices SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();
  else if(body.action==="reopen")await env.DB.prepare("UPDATE operational_notices SET status='pending',acknowledged_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();
  else if(body.action==="delete")await env.DB.prepare("DELETE FROM operational_notices WHERE id=?").bind(body.id).run();
  else return Response.json({error:"Ação inválida"},{status:400});
  return Response.json({ok:true});
}
