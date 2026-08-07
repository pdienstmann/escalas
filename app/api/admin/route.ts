import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

function permitted(request: Request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || Boolean(request.headers.get("oai-authenticated-user-id"));
}

async function seed() {
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM guards").first<{ total:number }>();
  if ((count?.total ?? 0) > 0) return;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)").bind("1001","MARQUES","B","12x36 dia"),
    env.DB.prepare("INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)").bind("1002","ROMANA","B","12x36 dia"),
    env.DB.prepare("INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)").bind("1003","C. ALEXANDRE","B","12x36 dia"),
    env.DB.prepare("INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)").bind("1004","RIVERO","A","12x36 noite"),
    env.DB.prepare("INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)").bind("Sala de Operações","Comando e Operações",1),
    env.DB.prepare("INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)").bind("Praça da Juventude","Praças e Parques",20),
    env.DB.prepare("INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)").bind("VTR 1337","sedan","Zona B3 Dia"),
    env.DB.prepare("INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)").bind("VTR 1302","pickup","Lomba Grande"),
    env.DB.prepare("INSERT INTO leave_campaigns (month,title,status,access_code) VALUES (?,?,?,?)").bind("2026-08","Folgas de agosto de 2026","open","AGO26"),
  ]);
  const campaign = await env.DB.prepare("SELECT id FROM leave_campaigns WHERE month = ?").bind("2026-08").first<{id:number}>();
  if (campaign) {
    const dates = ["2026-08-03","2026-08-08","2026-08-10","2026-08-15","2026-08-17","2026-08-22","2026-08-24","2026-08-29"];
    await env.DB.batch(dates.map(date=>env.DB.prepare("INSERT INTO leave_day_limits (campaign_id,date,capacity) VALUES (?,?,?)").bind(campaign.id,date,3)));
  }
}

export async function GET(request: Request) {
  if (!permitted(request)) return Response.json({error:"Não autorizado"},{status:401});
  await seed();
  const [guards,posts,vehicles,movements,campaign,days,choices] = await Promise.all([
    env.DB.prepare("SELECT * FROM guards WHERE active = 1 ORDER BY name").all(),
    env.DB.prepare("SELECT * FROM posts WHERE active = 1 ORDER BY sort_order,name").all(),
    env.DB.prepare("SELECT * FROM vehicles WHERE active = 1 ORDER BY prefix").all(),
    env.DB.prepare("SELECT m.*, g.name AS guard_name FROM movements m JOIN guards g ON g.id=m.guard_id ORDER BY m.starts_at DESC LIMIT 30").all(),
    env.DB.prepare("SELECT * FROM leave_campaigns WHERE status='open' ORDER BY month DESC LIMIT 1").first(),
    env.DB.prepare("SELECT l.*, (SELECT COUNT(*) FROM leave_choices c WHERE c.campaign_id=l.campaign_id AND c.date=l.date AND c.status='confirmed') AS used FROM leave_day_limits l ORDER BY l.date").all(),
    env.DB.prepare("SELECT c.*,g.name AS guard_name FROM leave_choices c JOIN guards g ON g.id=c.guard_id WHERE c.status!='cancelled' ORDER BY c.date").all(),
  ]);
  return Response.json({guards:guards.results,posts:posts.results,vehicles:vehicles.results,movements:movements.results,campaign,days:days.results,choices:choices.results});
}

export async function POST(request: Request) {
  if (!permitted(request)) return Response.json({error:"Não autorizado"},{status:401});
  const body = await request.json() as Record<string, string|number>;
  try {
    if (body.action === "guard") await env.DB.prepare("INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)").bind(body.registration,body.name,body.platoon,body.baseShift).run();
    else if (body.action === "post") await env.DB.prepare("INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)").bind(body.name,body.groupName,body.sortOrder||99).run();
    else if (body.action === "vehicle") await env.DB.prepare("INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)").bind(body.prefix,body.type,body.zone).run();
    else if (body.action === "movement") await env.DB.prepare("INSERT INTO movements (guard_id,type,starts_at,ends_at,request_ref,notes) VALUES (?,?,?,?,?,?)").bind(body.guardId,body.type,body.startsAt,body.endsAt,body.requestRef||null,body.notes||null).run();
    else if (body.action === "leave") {
      const date=String(body.date), category=String(body.category), guardId=Number(body.guardId), campaignId=Number(body.campaignId);
      const day=new Date(`${date}T12:00:00Z`).getUTCDay();
      if ((day===0||day===6?"weekend":"weekday")!==category) return Response.json({error:"A data não corresponde à categoria escolhida."},{status:400});
      const limit=await env.DB.prepare("SELECT capacity,(SELECT COUNT(*) FROM leave_choices WHERE campaign_id=? AND date=? AND status='confirmed') AS used FROM leave_day_limits WHERE campaign_id=? AND date=?").bind(campaignId,date,campaignId,date).first<{capacity:number,used:number}>();
      if(!limit) return Response.json({error:"Data indisponível nesta campanha."},{status:400});
      const status=limit.used<limit.capacity?"confirmed":"waitlist";
      await env.DB.prepare("INSERT INTO leave_choices (campaign_id,guard_id,date,category,status,position) VALUES (?,?,?,?,?,?)").bind(campaignId,guardId,date,category,status,status==="waitlist"?limit.used-limit.capacity+1:null).run();
      return Response.json({ok:true,status});
    } else return Response.json({error:"Ação inválida"},{status:400});
    return Response.json({ok:true});
  } catch (error) { return Response.json({error:error instanceof Error?error.message:"Não foi possível salvar."},{status:400}); }
}
