import { env } from "cloudflare:workers";
import { writeAudit } from "../../../lib/audit";
import { permitted } from "../../../lib/access";
import { todayScheduleDate } from "../../../lib/schedule-date";

export const dynamic = "force-dynamic";


async function seed() {
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM guards",
  ).first<{ total: number }>();
  if ((count?.total ?? 0) === 0)
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)",
      ).bind("1001", "MARQUES", "B", "12x36 dia"),
      env.DB.prepare(
        "INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)",
      ).bind("1002", "ROMANA", "B", "12x36 dia"),
      env.DB.prepare(
        "INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)",
      ).bind("1003", "C. ALEXANDRE", "B", "12x36 dia"),
      env.DB.prepare(
        "INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?)",
      ).bind("1004", "RIVERO", "A", "12x36 noite"),
      env.DB.prepare(
        "INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)",
      ).bind("Sala de Operações", "Comando e Operações", 1),
      env.DB.prepare(
        "INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)",
      ).bind("Praça da Juventude", "Praças e Parques", 20),
      env.DB.prepare(
        "INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      ).bind("VTR 1337", "sedan", "Zona B3 Dia"),
      env.DB.prepare(
        "INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      ).bind("VTR 1302", "pickup", "Lomba Grande"),
    ]);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO leave_campaigns (month,title,status,access_code) VALUES (?,?,?,?)",
  )
    .bind("2026-08", "Folgas de agosto de 2026", "open", "AGO26")
    .run();
  const campaign = await env.DB.prepare(
    "SELECT id FROM leave_campaigns WHERE month = ?",
  )
    .bind("2026-08")
    .first<{ id: number }>();
  const existingLimits = campaign
    ? await env.DB.prepare(
        "SELECT COUNT(*) total FROM leave_day_limits WHERE campaign_id=?",
      )
        .bind(campaign.id)
        .first<{ total: number }>()
    : null;
  if (campaign && Number(existingLimits?.total || 0) === 0) {
    const dates = [
      "2026-08-03",
      "2026-08-08",
      "2026-08-10",
      "2026-08-15",
      "2026-08-17",
      "2026-08-22",
      "2026-08-24",
      "2026-08-29",
    ];
    await env.DB.batch(
      dates.map((date) =>
        env.DB.prepare(
          "INSERT INTO leave_day_limits (campaign_id,date,capacity) VALUES (?,?,?)",
        ).bind(campaign.id, date, 3),
      ),
    );
  }
}

async function syncConfirmedLeaves(choiceId?: number) {
  const where = choiceId ? "AND c.id=?" : "";
  const statement = env.DB
    .prepare(`INSERT INTO movements (guard_id,type,starts_at,ends_at,request_ref,notes,status)
    SELECT c.guard_id,'day_off',c.date||'T00:00',date(c.date,'+1 day')||'T00:00','FOLGA-'||c.id,'Folga mensal aprovada','approved'
    FROM leave_choices c WHERE c.status='confirmed' ${where}
    AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.request_ref='FOLGA-'||c.id)`);
  await (choiceId ? statement.bind(choiceId) : statement).run();
}
async function ensureSections(){
  const groups=(await env.DB.prepare("SELECT group_name,MIN(sort_order) sort_order FROM posts WHERE active=1 GROUP BY group_name").all<{group_name:string;sort_order:number}>()).results;
  const commands=[env.DB.prepare("INSERT OR IGNORE INTO schedule_sections (section_key,label,sort_order) VALUES ('VEHICLES','VIATURAS E ZONAS',0)")];
  for(const group of groups)commands.push(env.DB.prepare("INSERT OR IGNORE INTO schedule_sections (section_key,label,sort_order) VALUES (?,?,?)").bind(`POST:${group.group_name}`,group.group_name,Number(group.sort_order||0)+10));
  await env.DB.batch(commands);
}

async function ensureFleetReturnTables(){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS vehicle_return_reconciliations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outage_id INTEGER NOT NULL REFERENCES vehicle_outages(id),
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    schedule_id INTEGER NOT NULL REFERENCES schedules(id),
    return_on TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    linked_assignments INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(outage_id,schedule_id)
  )`).run();
}

async function vehicleReturnImpact(outageId:number,returnOn:string){
  const outage=await env.DB.prepare("SELECT o.*,v.prefix FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.id=? AND o.active=1").bind(outageId).first<Record<string,unknown>>();
  if(!outage)return{outage:null,impacts:[] as Record<string,unknown>[]};
  const impacts=(await env.DB.prepare(`SELECT s.id schedule_id,s.date,s.status,
      (SELECT COUNT(*) FROM assignments a WHERE a.schedule_id=s.id AND a.vehicle_id=?) linked_assignments,
      EXISTS(SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=s.id AND e.resource_kind='vehicle' AND e.resource_id=?) explicitly_removed
    FROM schedules s
    WHERE s.date>=? AND (
      EXISTS(SELECT 1 FROM assignments a WHERE a.schedule_id=s.id AND a.vehicle_id=?)
      OR EXISTS(SELECT 1 FROM schedule_patterns sp JOIN pattern_slots ps ON ps.pattern_id IN (sp.day_pattern_id,sp.night_pattern_id) WHERE sp.schedule_id=s.id AND ps.vehicle_id=?)
      OR EXISTS(SELECT 1 FROM weekly_slots w WHERE w.vehicle_id=? AND w.active=1 AND instr(','||w.weekdays||',',','||CAST(strftime('%w',s.date) AS TEXT)||',')>0)
    ) ORDER BY s.date`).bind(outage.vehicle_id,outage.vehicle_id,returnOn,outage.vehicle_id,outage.vehicle_id,outage.vehicle_id).all<Record<string,unknown>>()).results;
  return{outage,impacts:impacts.map(item=>({...item,automatic:item.status==="draft"&&Number(item.linked_assignments)>0&&Number(item.explicitly_removed)===0}))};
}

function previousDate(date:string){const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()-1);return value.toISOString().slice(0,10)}

function assignmentTimes(date:string,shift:string){
  const values:Record<string,[string,string]>={"2":["07:00","13:00"],"3":["13:00","19:00"],"4":["19:00","01:00"],"1":["01:00","07:00"]};
  const [start,end]=values[shift];const next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
  return{start:`${date}T${start}`,end:`${shift==="4"?next.toISOString().slice(0,10):date}T${end}`};
}

async function restoreVehiclePatternCrew(scheduleId:number,date:string,vehicleId:number){
  const slots=(await env.DB.prepare(`SELECT ps.guard_id,ps.role,p.period FROM schedule_patterns sp
    JOIN shift_patterns p ON p.id IN (sp.day_pattern_id,sp.night_pattern_id)
    JOIN pattern_slots ps ON ps.pattern_id=p.id
    WHERE sp.schedule_id=? AND ps.vehicle_id=?`).bind(scheduleId,vehicleId).all<Record<string,unknown>>()).results;
  const statements:D1PreparedStatement[]=[];
  for(const slot of slots)for(const shift of String(slot.period)==="day"?["2","3"]:["4","1"]){
    const interval=assignmentTimes(date,shift);
    statements.push(env.DB.prepare(`INSERT INTO assignments (schedule_id,guard_id,post_id,vehicle_id,shift,role,starts_at,ends_at,status,is_reassigned,reassignment_note)
      VALUES (?,?,NULL,?,?,?,?,?,'normal',0,NULL)
      ON CONFLICT(schedule_id,guard_id,starts_at) DO UPDATE SET post_id=NULL,vehicle_id=excluded.vehicle_id,shift=excluded.shift,role=excluded.role,ends_at=excluded.ends_at,is_reassigned=0,reassignment_note=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(scheduleId,slot.guard_id,vehicleId,shift,slot.role,interval.start,interval.end));
  }
  if(statements.length)await env.DB.batch(statements);
  return statements.length;
}

export async function GET(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  await seed();
  await syncConfirmedLeaves();
  await ensureSections();
  await ensureFleetReturnTables();
  const requestedDate = new URL(request.url).searchParams.get("date") || todayScheduleDate();
  const [guards, posts, vehicles, movements, campaign, days, choices, vehicleOutages, sections, vehicleCrews, vehicleReturnImpacts] =
    await Promise.all([
      env.DB.prepare(
        "SELECT * FROM guards WHERE active = 1 ORDER BY name",
      ).all(),
      env.DB.prepare(
        "SELECT * FROM posts WHERE active = 1 ORDER BY sort_order,name",
      ).all(),
      env.DB.prepare(
        "SELECT * FROM vehicles WHERE active = 1 ORDER BY prefix",
      ).all(),
      env.DB.prepare(
        "SELECT m.*, g.name AS guard_name FROM movements m JOIN guards g ON g.id=m.guard_id ORDER BY m.starts_at DESC LIMIT 30",
      ).all(),
      env.DB.prepare(
        "SELECT * FROM leave_campaigns WHERE status='open' ORDER BY month DESC LIMIT 1",
      ).first(),
      env.DB.prepare(
        "SELECT l.*, (SELECT COUNT(*) FROM leave_choices c WHERE c.campaign_id=l.campaign_id AND c.date=l.date AND c.status='confirmed') AS used FROM leave_day_limits l ORDER BY l.date",
      ).all(),
      env.DB.prepare(
        "SELECT c.*,g.name AS guard_name FROM leave_choices c JOIN guards g ON g.id=c.guard_id WHERE c.status!='cancelled' ORDER BY c.date",
      ).all(),
      env.DB.prepare("SELECT o.*,v.prefix,v.type FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.active=1 ORDER BY o.starts_on DESC").all(),
      env.DB.prepare("SELECT section_key,label,sort_order FROM schedule_sections ORDER BY sort_order,label").all(),
      env.DB.prepare(
        `SELECT a.vehicle_id,GROUP_CONCAT(DISTINCT g.name) crew_names,COUNT(DISTINCT a.guard_id) crew_count
         FROM assignments a
         JOIN schedules s ON s.id=a.schedule_id
         JOIN guards g ON g.id=a.guard_id
         WHERE s.date=? AND a.vehicle_id IS NOT NULL
         GROUP BY a.vehicle_id`,
      ).bind(requestedDate).all(),
      env.DB.prepare(`SELECT r.*,s.date schedule_date,s.status schedule_status,v.prefix
        FROM vehicle_return_reconciliations r JOIN schedules s ON s.id=r.schedule_id JOIN vehicles v ON v.id=r.vehicle_id
        WHERE r.status='pending' ORDER BY s.date,v.prefix`).all(),
    ]);
  return Response.json({
    guards: guards.results,
    posts: posts.results,
    vehicles: vehicles.results,
    movements: movements.results,
    campaign,
    days: days.results,
    choices: choices.results,
    vehicleOutages: vehicleOutages.results,
    vehicleCrews: vehicleCrews.results,
    sections: sections.results,
    vehicleReturnImpacts: vehicleReturnImpacts.results,
  });
}

export async function POST(request: Request) {
  if (!permitted(request))
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const body = (await request.json()) as Record<string, string | number>;
  await ensureFleetReturnTables();
  try {
    if (body.action === "guard_import") {
      const rows = ((body as unknown as {rows?:Array<{registration?:string;name?:string;platoon?:string;baseShift?:string}>}).rows || []).slice(0,500).filter(row=>row.registration?.trim()&&row.name?.trim());
      if (!rows.length) return Response.json({error:"Nenhuma linha válida para importar."},{status:400});
      await env.DB.batch(rows.map(row=>env.DB.prepare("INSERT INTO guards (registration,name,platoon,base_shift) VALUES (?,?,?,?) ON CONFLICT(registration) DO UPDATE SET name=excluded.name,platoon=excluded.platoon,base_shift=excluded.base_shift,active=1,updated_at=CURRENT_TIMESTAMP").bind(row.registration!.trim(),row.name!.trim(),row.platoon?.trim()||null,row.baseShift?.trim()||"12x36 dia")));
      await writeAudit(request,{action:"import",entityType:"guard_import",entityId:String(Date.now()),summary:`Importou ou atualizou ${rows.length} GMs`,after:{count:rows.length}});
      return Response.json({ok:true,count:rows.length});
    } else if (body.action === "guard") {
      const created = await env.DB.prepare(
        "INSERT INTO guards (registration,name,platoon,base_shift,work_regime) VALUES (?,?,?,?,?)",
      )
        .bind(body.registration, body.name, body.platoon, body.baseShift, body.workRegime || "12x36")
        .run();
      const after = await env.DB.prepare("SELECT * FROM guards WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request,{action:"create",entityType:"guard",entityId:Number(created.meta.last_row_id),summary:`Cadastrou o GM ${body.name}`,after:after as Record<string,unknown>});
      return Response.json({ok:true,entity:after,message:`GM ${body.name} cadastrado e disponível para escalar.`});
    } else if (body.action === "post") {
      const created = await env.DB.prepare(
        "INSERT INTO posts (name,group_name,sort_order) VALUES (?,?,?)",
      )
        .bind(body.name, body.groupName, body.sortOrder || 99)
        .run();
      const after = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(created.meta.last_row_id).first();
      await env.DB.prepare("INSERT OR IGNORE INTO schedule_sections (section_key,label,sort_order) VALUES (?,?,?)")
        .bind(`POST:${body.groupName}`,body.groupName,Number(body.sortOrder||99)).run();
      await writeAudit(request,{action:"create",entityType:"post",entityId:Number(created.meta.last_row_id),summary:`Cadastrou o posto ${body.name}`,after:after as Record<string,unknown>});
      return Response.json({ok:true,entity:after,message:`Posto ${body.name} adicionado à escala.`});
    } else if (body.action === "vehicle") {
      const prefix=String(body.prefix||"").trim().toUpperCase();
      if(!prefix)return Response.json({error:"Informe o prefixo da viatura."},{status:400});
      const duplicate=await env.DB.prepare("SELECT id FROM vehicles WHERE UPPER(TRIM(prefix))=? LIMIT 1").bind(prefix).first();
      if(duplicate)return Response.json({error:`A viatura ${prefix} já está cadastrada. Selecione a existente na escala.`},{status:409});
      const created = await env.DB.prepare(
        "INSERT INTO vehicles (prefix,type,zone) VALUES (?,?,?)",
      )
        .bind(prefix, body.type, body.zone)
        .run();
      const after = await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request,{action:"create",entityType:"vehicle",entityId:Number(created.meta.last_row_id),summary:`Cadastrou a viatura ${prefix}`,after:after as Record<string,unknown>});
      return Response.json({ok:true,entity:after,message:`Viatura ${prefix} adicionada à escala.`});
    } else if (body.action === "section_create") {
      const label=String(body.label||"").trim();
      if(!label)return Response.json({error:"Informe o nome da seção."},{status:400});
      const sectionKey=`POST:${label}`;
      const maximum=await env.DB.prepare("SELECT COALESCE(MAX(sort_order),0) maximum FROM schedule_sections").first<{maximum:number}>();
      await env.DB.prepare("INSERT INTO schedule_sections (section_key,label,sort_order) VALUES (?,?,?)")
        .bind(sectionKey,label,Number(maximum?.maximum||0)+10).run();
      const after=await env.DB.prepare("SELECT section_key,label,sort_order FROM schedule_sections WHERE section_key=?").bind(sectionKey).first();
      await writeAudit(request,{action:"create",entityType:"section_config",entityId:sectionKey,summary:`Criou a seção ${label}`,after:after as Record<string,unknown>});
      return Response.json({ok:true,entity:after,message:`Seção ${label} criada. Agora adicione postos nela.`});
    } else if (body.action === "vehicle_outage") {
      const vehicleId = Number(body.vehicleId);
      const startsOn = body.startsOn ? String(body.startsOn) : todayScheduleDate();
      const endsOn = body.endsOn ? String(body.endsOn) : null;
      if(endsOn&&endsOn<startsOn)return Response.json({error:"O retorno previsto não pode ser anterior ao início do FA."},{status:400});
      const existingOutage=await env.DB.prepare("SELECT id FROM vehicle_outages WHERE vehicle_id=? AND active=1 AND (ends_on IS NULL OR ends_on>=?) LIMIT 1").bind(vehicleId,startsOn).first();
      if(existingOutage)return Response.json({error:"Esta viatura já possui um registro de FA ativo."},{status:409});
      const created=await env.DB.prepare("INSERT INTO vehicle_outages (vehicle_id,starts_on,ends_on,reason) VALUES (?,?,?,?)").bind(vehicleId,startsOn,endsOn,body.reason||null).run();
      const after=await env.DB.prepare("SELECT o.*,v.prefix FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.id=?").bind(created.meta.last_row_id).first();
      // Keep GMs visible: mark affected assignments as awaiting redeployment without deleting them.
      await env.DB.prepare(
        `UPDATE assignments
         SET is_reassigned=1,
             reassignment_note=COALESCE(reassignment_note,'VTR em FA — aguardando remanejamento'),
             updated_at=CURRENT_TIMESTAMP
         WHERE vehicle_id=?
           AND date(starts_at)<=?
           AND date(ends_at)>=?
           AND EXISTS (
             SELECT 1 FROM schedules s
             WHERE s.id=assignments.schedule_id
               AND s.date>=?
               AND (? IS NULL OR s.date<=?)
           )`,
      ).bind(vehicleId, endsOn || "9999-12-31", startsOn, startsOn, endsOn, endsOn || "9999-12-31").run();
      await writeAudit(request,{action:"create",entityType:"vehicle_outage",entityId:Number(created.meta.last_row_id),summary:`Registrou ${after?.prefix} em FA`,after:after as Record<string,unknown>,undoable:true});
      return Response.json({ok:true,message:`${after?.prefix} em FA. GMs mantidos à disposição para remanejamento.`});
    } else if (body.action === "vehicle_outage_return_preview") {
      const outageId=Number(body.id),returnOn=String(body.returnOn||"");
      if(!outageId||!/^\d{4}-\d{2}-\d{2}$/.test(returnOn))return Response.json({error:"Informe a data de retorno."},{status:400});
      const result=await vehicleReturnImpact(outageId,returnOn);
      if(!result.outage)return Response.json({error:"Registro de FA não encontrado."},{status:404});
      if(returnOn<String(result.outage.starts_on))return Response.json({error:"O retorno não pode ser anterior ao início do FA."},{status:400});
      return Response.json({ok:true,...result});
    } else if (body.action === "vehicle_outage_return") {
      const outageId=Number(body.id),returnOn=String(body.returnOn||"");
      if(!outageId||!/^\d{4}-\d{2}-\d{2}$/.test(returnOn))return Response.json({error:"Informe a data de retorno."},{status:400});
      const {outage,impacts}=await vehicleReturnImpact(outageId,returnOn);
      if(!outage)return Response.json({error:"Registro de FA não encontrado."},{status:404});
      if(returnOn<String(outage.starts_on))return Response.json({error:"O retorno não pode ser anterior ao início do FA."},{status:400});
      const before={...outage};
      await env.DB.prepare("UPDATE vehicle_outages SET ends_on=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(previousDate(returnOn),outageId).run();
      const statements:D1PreparedStatement[]=[];
      let automatic=0,pending=0;
      for(const impact of impacts){
        const safe=Boolean(impact.automatic),status=safe?"restored":"pending";
        if(safe)automatic++;else pending++;
        statements.push(env.DB.prepare(`INSERT INTO vehicle_return_reconciliations (outage_id,vehicle_id,schedule_id,return_on,status,linked_assignments)
          VALUES (?,?,?,?,?,?) ON CONFLICT(outage_id,schedule_id) DO UPDATE SET return_on=excluded.return_on,status=excluded.status,linked_assignments=excluded.linked_assignments,updated_at=CURRENT_TIMESTAMP`)
          .bind(outageId,outage.vehicle_id,impact.schedule_id,returnOn,status,impact.linked_assignments));
        if(safe)statements.push(env.DB.prepare(`UPDATE assignments SET is_reassigned=CASE WHEN reassignment_note LIKE 'VTR em FA%' THEN 0 ELSE is_reassigned END,
          reassignment_note=CASE WHEN reassignment_note LIKE 'VTR em FA%' THEN NULL ELSE reassignment_note END,updated_at=CURRENT_TIMESTAMP
          WHERE schedule_id=? AND vehicle_id=?`).bind(impact.schedule_id,outage.vehicle_id));
      }
      if(statements.length)await env.DB.batch(statements);
      const after=await env.DB.prepare("SELECT o.*,v.prefix FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.id=?").bind(outageId).first<Record<string,unknown>>();
      await writeAudit(request,{action:"update",entityType:"vehicle_outage",entityId:outageId,summary:`Registrou retorno de ${outage.prefix} em ${returnOn}`,before,after:after as Record<string,unknown>,undoable:false});
      return Response.json({ok:true,message:`Retorno de ${outage.prefix} registrado. ${automatic} rascunho(s) restaurado(s) e ${pending} escala(s) aguardando decisão.`,automatic,pending});
    } else if (body.action === "vehicle_return_reconcile") {
      const id=Number(body.id),decision=String(body.decision||"");
      if(!["keep","show","restore"].includes(decision))return Response.json({error:"Decisão inválida."},{status:400});
      const item=await env.DB.prepare(`SELECT r.*,s.date,s.status schedule_status,v.prefix FROM vehicle_return_reconciliations r
        JOIN schedules s ON s.id=r.schedule_id JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=?`).bind(id).first<Record<string,unknown>>();
      if(!item)return Response.json({error:"Revisão não encontrada."},{status:404});
      let restored=0;
      if(decision==="restore")restored=await restoreVehiclePatternCrew(Number(item.schedule_id),String(item.date),Number(item.vehicle_id));
      if(decision==="show"||decision==="restore"){
        await env.DB.prepare(`UPDATE assignments SET is_reassigned=CASE WHEN reassignment_note LIKE 'VTR em FA%' THEN 0 ELSE is_reassigned END,
          reassignment_note=CASE WHEN reassignment_note LIKE 'VTR em FA%' THEN NULL ELSE reassignment_note END,updated_at=CURRENT_TIMESTAMP
          WHERE schedule_id=? AND vehicle_id=?`).bind(item.schedule_id,item.vehicle_id).run();
        if(item.schedule_status==="published")await env.DB.prepare("UPDATE schedules SET status='draft',published_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.schedule_id).run();
      }
      const status=decision==="keep"?"kept":decision==="show"?"shown":"restored";
      await env.DB.prepare("UPDATE vehicle_return_reconciliations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,id).run();
      await writeAudit(request,{action:"update",entityType:"vehicle_return_reconciliation",entityId:id,summary:`Reconciliou ${item.prefix} na escala de ${item.date}: ${status}`,before:item,after:{status,restored},undoable:false});
      return Response.json({ok:true,message:decision==="keep"?`${item.prefix} permanecerá fora da escala de ${item.date}.`:decision==="show"?`${item.prefix} foi reexibida sem desfazer remanejamentos.`:`Guarnição do padrão restaurada (${restored} horários). A escala voltou para rascunho se estava publicada.`});
    } else if (body.action === "vehicle_outage_delete") {
      const before=await env.DB.prepare("SELECT o.*,v.prefix FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare("DELETE FROM vehicle_outages WHERE id=?").bind(body.id).run();
      if (before?.vehicle_id) {
        await env.DB.prepare(
          `UPDATE assignments
           SET is_reassigned=CASE
             WHEN reassignment_note LIKE 'VTR em FA%' THEN 0
             ELSE is_reassigned
           END,
           reassignment_note=CASE
             WHEN reassignment_note LIKE 'VTR em FA%' THEN NULL
             ELSE reassignment_note
           END,
           updated_at=CURRENT_TIMESTAMP
           WHERE vehicle_id=?`,
        ).bind(before.vehicle_id).run();
      }
      await writeAudit(request,{action:"delete",entityType:"vehicle_outage",entityId:body.id,summary:`Removeu FA de ${before?.prefix}`,before,undoable:true});
      return Response.json({ok:true,message:`${before?.prefix} disponível novamente. Equipe pode retornar à VTR.`});
    } else if (body.action === "catalog_update" && body.entity === "guard") {
      const before = await env.DB.prepare("SELECT * FROM guards WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE guards SET registration=?,name=?,platoon=?,base_shift=?,work_regime=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(
          body.registration,
          body.name,
          body.platoon,
          body.baseShift,
          body.workRegime || "12x36",
          body.id,
        )
        .run();
      const after = await env.DB.prepare("SELECT * FROM guards WHERE id=?").bind(body.id).first();
      await writeAudit(request,{action:"update",entityType:"guard",entityId:body.id,summary:`Alterou o cadastro de ${body.name}`,before,after:after as Record<string,unknown>,undoable:true});
    } else if (body.action === "catalog_update" && body.entity === "post") {
      const before = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE posts SET name=?,group_name=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(body.name, body.groupName, body.sortOrder || 99, body.id)
        .run();
      const after = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(body.id).first();
      await writeAudit(request,{action:"update",entityType:"post",entityId:body.id,summary:`Alterou o posto ${body.name}`,before,after:after as Record<string,unknown>,undoable:true});
    } else if (body.action === "catalog_update" && body.entity === "vehicle") {
      const before = await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE vehicles SET prefix=?,type=?,zone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(body.prefix, body.type, body.zone, body.id)
        .run();
      const after = await env.DB.prepare("SELECT * FROM vehicles WHERE id=?").bind(body.id).first();
      await writeAudit(request,{action:"update",entityType:"vehicle",entityId:body.id,summary:`Alterou a viatura ${body.prefix}`,before,after:after as Record<string,unknown>,undoable:true});
    } else if (body.action === "post_reorder") {
      const before = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.prepare(
        "UPDATE posts SET sort_order=MAX(0,sort_order+?),updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(body.direction === "up" ? -1 : 1, body.id)
        .run();
      const after = await env.DB.prepare("SELECT * FROM posts WHERE id=?").bind(body.id).first();
      await writeAudit(request,{action:"reorder",entityType:"post",entityId:body.id,summary:`Reordenou o posto ${before?.name}`,before,after:after as Record<string,unknown>,undoable:true});
    } else if (body.action === "section_reorder") {
      await ensureSections();
      const groups=(await env.DB.prepare("SELECT section_key,label,sort_order FROM schedule_sections ORDER BY sort_order,label").all<{section_key:string;label:string;sort_order:number}>()).results;
      const index = groups.findIndex(group=>group.section_key===String(body.sectionKey));
      const targetIndex = index + (body.direction === "up" ? -1 : 1);
      if(index<0||targetIndex<0||targetIndex>=groups.length) return Response.json({error:"A seção já está no limite da lista."},{status:409});
      const current=groups[index],target=groups[targetIndex];
      const before={current,target};
      await env.DB.batch([
        env.DB.prepare("UPDATE schedule_sections SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE section_key=?").bind(target.sort_order,current.section_key),
        env.DB.prepare("UPDATE schedule_sections SET sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE section_key=?").bind(current.sort_order,target.section_key),
      ]);
      await writeAudit(request,{action:"reorder",entityType:"section_config",entityId:current.section_key,summary:`Moveu a seção ${current.label} para ${body.direction==="up"?"cima":"baixo"}`,before,after:{current:{...current,sort_order:target.sort_order},target:{...target,sort_order:current.sort_order}},undoable:false});
    } else if (body.action === "section_update") {
      const before=await env.DB.prepare("SELECT * FROM schedule_sections WHERE section_key=?").bind(body.sectionKey).first<Record<string,unknown>>();
      await env.DB.prepare("UPDATE schedule_sections SET label=?,updated_at=CURRENT_TIMESTAMP WHERE section_key=?").bind(body.label,body.sectionKey).run();
      await writeAudit(request,{action:"update",entityType:"section_config",entityId:String(body.sectionKey),summary:`Renomeou a seção para ${body.label}`,before,after:{label:body.label},undoable:false});
    } else if (body.action === "catalog_deactivate") {
      const table =
        body.entity === "guard"
          ? "guards"
          : body.entity === "post"
            ? "posts"
            : body.entity === "vehicle"
              ? "vehicles"
              : null;
      const foreign =
        body.entity === "guard"
          ? "guard_id"
          : body.entity === "post"
            ? "post_id"
            : body.entity === "vehicle"
              ? "vehicle_id"
              : null;
      if (!table || !foreign)
        return Response.json({ error: "Cadastro inválido." }, { status: 400 });
      const before = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(body.id).first<Record<string,unknown>>();
      if (!before)
        return Response.json({ error: "Cadastro não encontrado." }, { status: 404 });

      if (body.entity === "vehicle") {
        // Keep crew visible in redeployment pool instead of blocking deactivation.
        await env.DB.prepare(
          `UPDATE assignments
           SET is_reassigned=1,
               reassignment_note=COALESCE(reassignment_note,'VTR desativada — aguardando remanejamento'),
               updated_at=CURRENT_TIMESTAMP
           WHERE vehicle_id=?`,
        ).bind(body.id).run();
      } else if (body.entity === "post") {
        await env.DB.prepare(
          `UPDATE assignments
           SET post_id=NULL,
               is_reassigned=1,
               reassignment_note=COALESCE(reassignment_note,'Posto desativado — aguardando remanejamento'),
               updated_at=CURRENT_TIMESTAMP
           WHERE post_id=?`,
        ).bind(body.id).run();
      } else {
        const used = await env.DB.prepare(
          `SELECT COUNT(*) total FROM assignments WHERE ${foreign}=?`,
        )
          .bind(body.id)
          .first<{ total: number }>();
        if (Number(used?.total || 0) > 0)
          return Response.json(
            {
              error:
                "Este GM ainda possui escalas vinculadas. Remova ou mova essas designações antes de desativá-lo.",
            },
            { status: 409 },
          );
      }

      await env.DB.prepare(
        `UPDATE ${table} SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
        .bind(body.id)
        .run();
      const after = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(body.id).first();
      await writeAudit(request,{action:"deactivate",entityType:String(body.entity),entityId:body.id,summary:`Desativou ${before?.name||before?.prefix}`,before,after:after as Record<string,unknown>,undoable:true});
      return Response.json({
        ok: true,
        message:
          body.entity === "vehicle" || body.entity === "post"
            ? "Cadastro desativado. Efetivo mantido à disposição para remanejamento."
            : "Cadastro desativado.",
      });
    } else if (body.action === "movement") {
      const created = await env.DB.prepare(
        "INSERT INTO movements (guard_id,type,starts_at,ends_at,request_ref,notes) VALUES (?,?,?,?,?,?)",
      )
        .bind(
          body.guardId,
          body.type,
          body.startsAt,
          body.endsAt,
          body.requestRef || null,
          body.notes || null,
        )
        .run();
      const movement = await env.DB.prepare(
        "SELECT m.*,g.name guard_name FROM movements m JOIN guards g ON g.id=m.guard_id WHERE m.id=?",
      ).bind(created.meta.last_row_id).first();
      await writeAudit(request,{action:"create",entityType:"movement",entityId:Number(created.meta.last_row_id),summary:`Registrou ${body.type} para ${movement?.guard_name}`,after:movement as Record<string,unknown>,undoable:true});
      return Response.json({ ok: true, movement });
    } else if (body.action === "movement_update") {
      const before = await env.DB.prepare("SELECT m.*,g.name guard_name FROM movements m JOIN guards g ON g.id=m.guard_id WHERE m.id=?").bind(body.id).first<Record<string,unknown>>();
      if (!before) return Response.json({error:"Movimentação não encontrada."},{status:404});
      await env.DB.prepare("UPDATE movements SET guard_id=?,type=?,starts_at=?,ends_at=?,request_ref=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(body.guardId,body.type,body.startsAt,body.endsAt,body.requestRef||null,body.notes||null,body.id).run();
      const after = await env.DB.prepare("SELECT m.*,g.name guard_name FROM movements m JOIN guards g ON g.id=m.guard_id WHERE m.id=?").bind(body.id).first();
      await writeAudit(request,{action:"update",entityType:"movement",entityId:body.id,summary:`Alterou ${body.type} de ${after?.guard_name}`,before,after:after as Record<string,unknown>,undoable:true});
      return Response.json({ok:true,movement:after});
    } else if (body.action === "movement_delete") {
      const before = await env.DB.prepare("SELECT m.*,g.name guard_name FROM movements m JOIN guards g ON g.id=m.guard_id WHERE m.id=?").bind(body.id).first<Record<string,unknown>>();
      if (!before) return Response.json({error:"Movimentação não encontrada."},{status:404});
      await env.DB.prepare("DELETE FROM movements WHERE id=?").bind(body.id).run();
      await writeAudit(request,{action:"delete",entityType:"movement",entityId:body.id,summary:`Removeu ${before.type} de ${before.guard_name}`,before,undoable:true});
      return Response.json({ok:true});
    } else if (body.action === "leave") {
      const date = String(body.date),
        category = String(body.category),
        guardId = Number(body.guardId),
        campaignId = Number(body.campaignId);
      const day = new Date(`${date}T12:00:00Z`).getUTCDay();
      if ((day === 0 || day === 6 ? "weekend" : "weekday") !== category)
        return Response.json(
          { error: "A data não corresponde à categoria escolhida." },
          { status: 400 },
        );
      const limit = await env.DB.prepare(
        "SELECT capacity,(SELECT COUNT(*) FROM leave_choices WHERE campaign_id=? AND date=? AND status='confirmed') AS used FROM leave_day_limits WHERE campaign_id=? AND date=?",
      )
        .bind(campaignId, date, campaignId, date)
        .first<{ capacity: number; used: number }>();
      if (!limit)
        return Response.json(
          { error: "Data indisponível nesta campanha." },
          { status: 400 },
        );
      const status = limit.used < limit.capacity ? "confirmed" : "waitlist";
      const created = await env.DB.prepare(
        "INSERT INTO leave_choices (campaign_id,guard_id,date,category,status,position) VALUES (?,?,?,?,?,?)",
      )
        .bind(
          campaignId,
          guardId,
          date,
          category,
          status,
          status === "waitlist" ? limit.used - limit.capacity + 1 : null,
        )
        .run();
      if (status === "confirmed")
        await syncConfirmedLeaves(Number(created.meta.last_row_id));
      const choice = await env.DB.prepare("SELECT c.*,g.name guard_name FROM leave_choices c JOIN guards g ON g.id=c.guard_id WHERE c.id=?").bind(created.meta.last_row_id).first();
      await writeAudit(request,{action:"create",entityType:"leave_choice",entityId:Number(created.meta.last_row_id),summary:`Registrou folga de ${choice?.guard_name} em ${date}`,after:choice as Record<string,unknown>,undoable:true});
      return Response.json({
        ok: true,
        status,
        choiceId: Number(created.meta.last_row_id),
      });
    } else if (body.action === "leave_approve") {
      const choice = await env.DB.prepare(
        "SELECT * FROM leave_choices WHERE id=?",
      )
        .bind(body.id)
        .first<{ id: number; campaign_id: number; date: string }>();
      if (!choice)
        return Response.json(
          { error: "Solicitação não encontrada." },
          { status: 404 },
        );
      const limit = await env.DB.prepare(
        "SELECT capacity,(SELECT COUNT(*) FROM leave_choices WHERE campaign_id=? AND date=? AND status='confirmed') used FROM leave_day_limits WHERE campaign_id=? AND date=?",
      )
        .bind(choice.campaign_id, choice.date, choice.campaign_id, choice.date)
        .first<{ capacity: number; used: number }>();
      if (!limit || Number(limit.used) >= Number(limit.capacity))
        return Response.json(
          { error: "O limite deste dia já foi atingido." },
          { status: 409 },
        );
      await env.DB.prepare(
        "UPDATE leave_choices SET status='confirmed',position=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(choice.id)
        .run();
      await syncConfirmedLeaves(choice.id);
      const after = await env.DB.prepare("SELECT c.*,g.name guard_name FROM leave_choices c JOIN guards g ON g.id=c.guard_id WHERE c.id=?").bind(choice.id).first();
      await writeAudit(request,{action:"approve",entityType:"leave_choice",entityId:choice.id,summary:`Aprovou a folga de ${after?.guard_name} em ${choice.date}`,before:choice as unknown as Record<string,unknown>,after:after as Record<string,unknown>});
      return Response.json({ ok: true });
    } else if (body.action === "leave_cancel") {
      const before = await env.DB.prepare("SELECT c.*,g.name guard_name FROM leave_choices c JOIN guards g ON g.id=c.guard_id WHERE c.id=?").bind(body.id).first<Record<string,unknown>>();
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE leave_choices SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).bind(body.id),
        env.DB.prepare("DELETE FROM movements WHERE request_ref=?").bind(
          `FOLGA-${body.id}`,
        ),
      ]);
      const after = await env.DB.prepare("SELECT * FROM leave_choices WHERE id=?").bind(body.id).first();
      await writeAudit(request,{action:"cancel",entityType:"leave_choice",entityId:body.id,summary:`Cancelou a folga de ${before?.guard_name}`,before,after:after as Record<string,unknown>});
      return Response.json({ ok: true });
    } else return Response.json({ error: "Ação inválida" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Não foi possível salvar.",
      },
      { status: 400 },
    );
  }
}
