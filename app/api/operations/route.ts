import { env } from "cloudflare:workers";
import { permitted } from "../../../lib/access";
import { writeAudit } from "../../../lib/audit";
import { isScheduleDate } from "../../../lib/schedule-date";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type OperationBody = {
  action?: string;
  date?: string;
  title?: string;
  startsAt?: string;
  endsAt?: string;
  location?: string;
  commander?: string;
  reference?: string;
  notes?: string;
  requestedGuards?: number;
  vehicleIds?: number[];
  operationId?: number;
  slotId?: number;
  guardId?: number;
};

async function loadOperations(date:string){
  const schedule=await env.DB.prepare("SELECT id FROM schedules WHERE date=?").bind(date).first<{id:number}>();
  if(!schedule)return [];
  const [operations,vehicles,slots]=await Promise.all([
    env.DB.prepare("SELECT * FROM operations WHERE schedule_id=? AND status!='cancelled' ORDER BY starts_at,title").bind(schedule.id).all<Row>(),
    env.DB.prepare(`SELECT ov.*,v.prefix,v.type,v.zone FROM operation_vehicles ov JOIN vehicles v ON v.id=ov.vehicle_id JOIN operations o ON o.id=ov.operation_id WHERE o.schedule_id=? AND o.status!='cancelled' ORDER BY ov.operation_id,ov.sort_order,v.prefix`).bind(schedule.id).all<Row>(),
    env.DB.prepare(`SELECT os.*,g.name guard_name,g.registration,g.platoon,ov.vehicle_id,v.prefix vehicle_prefix,COALESCE(p.name,v0.prefix,'À disposição') origin_label
      FROM operation_slots os
      JOIN operations o ON o.id=os.operation_id
      LEFT JOIN guards g ON g.id=os.guard_id
      LEFT JOIN operation_vehicles ov ON ov.id=os.operation_vehicle_id
      LEFT JOIN vehicles v ON v.id=ov.vehicle_id
      LEFT JOIN assignments a ON a.id=os.origin_assignment_id
      LEFT JOIN operation_slot_origins oso ON oso.id=(SELECT MIN(origin.id) FROM operation_slot_origins origin WHERE origin.slot_id=os.id)
      LEFT JOIN posts p ON p.id=COALESCE(oso.post_id,a.post_id)
      LEFT JOIN vehicles v0 ON v0.id=COALESCE(oso.vehicle_id,a.vehicle_id)
      WHERE o.schedule_id=? AND o.status!='cancelled'
      ORDER BY os.operation_id,COALESCE(os.operation_vehicle_id,999999),os.position`).bind(schedule.id).all<Row>(),
  ]);
  return operations.results.map(operation=>({
    ...operation,
    vehicles:vehicles.results.filter(vehicle=>Number(vehicle.operation_id)===Number(operation.id)).map(vehicle=>({
      ...vehicle,
      slots:slots.results.filter(slot=>Number(slot.operation_vehicle_id)===Number(vehicle.id)),
    })),
    generalSlots:slots.results.filter(slot=>Number(slot.operation_id)===Number(operation.id)&&!slot.operation_vehicle_id),
    filled:slots.results.filter(slot=>Number(slot.operation_id)===Number(operation.id)&&slot.guard_id).length,
    totalSlots:slots.results.filter(slot=>Number(slot.operation_id)===Number(operation.id)).length,
  }));
}
async function loadVehicleCatalog(date:string){
  return (await env.DB.prepare(`SELECT v.id,v.prefix,v.type,v.zone,
    CASE WHEN EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=v.id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?)) THEN 1 ELSE 0 END unavailable
    FROM vehicles v WHERE v.active=1 ORDER BY v.prefix`).bind(date,date).all<Row>()).results;
}

async function slotOrigins(slotId:number){
  return (await env.DB.prepare("SELECT * FROM operation_slot_origins WHERE slot_id=? ORDER BY id").bind(slotId).all<Row>()).results;
}
async function restoreSlot(slotId:number){
  const origins=await slotOrigins(slotId);
  const statements=origins.map(origin=>env.DB.prepare("UPDATE assignments SET post_id=?,vehicle_id=?,role=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(origin.post_id||null,origin.vehicle_id||null,origin.role,Number(origin.was_reassigned||0),origin.reassignment_note||null,origin.assignment_id));
  statements.push(env.DB.prepare("DELETE FROM operation_slot_origins WHERE slot_id=?").bind(slotId));
  statements.push(env.DB.prepare("UPDATE operation_slots SET guard_id=NULL,source_type='pending',origin_assignment_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(slotId));
  await env.DB.batch(statements);
}
async function restoreOperation(operationId:number){
  const origins=(await env.DB.prepare("SELECT oso.* FROM operation_slot_origins oso JOIN operation_slots os ON os.id=oso.slot_id WHERE os.operation_id=? ORDER BY oso.id").bind(operationId).all<Row>()).results;
  const statements=origins.map(origin=>env.DB.prepare("UPDATE assignments SET post_id=?,vehicle_id=?,role=?,is_reassigned=?,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(origin.post_id||null,origin.vehicle_id||null,origin.role,Number(origin.was_reassigned||0),origin.reassignment_note||null,origin.assignment_id));
  statements.push(env.DB.prepare("DELETE FROM operation_slot_origins WHERE slot_id IN (SELECT id FROM operation_slots WHERE operation_id=?)").bind(operationId));
  statements.push(env.DB.prepare("UPDATE operations SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(operationId));
  await env.DB.batch(statements);
}

async function getSuggestions(operationId:number,slotId:number){
  const slot=await env.DB.prepare(`SELECT os.*,o.schedule_id,o.title operation_title,o.starts_at operation_starts_at,o.ends_at operation_ends_at,o.status operation_status,s.date
    FROM operation_slots os JOIN operations o ON o.id=os.operation_id JOIN schedules s ON s.id=o.schedule_id
    WHERE os.id=? AND os.operation_id=? AND o.status='draft'`).bind(slotId,operationId).first<Row>();
  if(!slot)return null;
  const start=String(slot.operation_starts_at),end=String(slot.operation_ends_at),date=String(slot.date);
  const monthStart=`${date.slice(0,7)}-01`;
  const [guards,movements,assignments,operationGuards,he]=await Promise.all([
    env.DB.prepare("SELECT id,name,registration,platoon,base_shift,work_regime,overtime_eligible FROM guards WHERE active=1 ORDER BY name").all<Row>(),
    env.DB.prepare("SELECT guard_id FROM movements WHERE status='approved' AND starts_at<? AND ends_at>?").bind(end,start).all<Row>(),
    env.DB.prepare(`SELECT a.*,COALESCE(oso.post_id,a.post_id) effective_post_id,COALESCE(oso.vehicle_id,a.vehicle_id) effective_vehicle_id,COALESCE(p.name,v.prefix,'À disposição') origin_label,
      CASE WHEN oso.id IS NOT NULL THEN 0 WHEN (a.post_id IS NULL AND a.vehicle_id IS NULL)
        OR EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=a.schedule_id AND e.resource_kind='post' AND e.resource_id=a.post_id)
        OR EXISTS (SELECT 1 FROM schedule_resource_exclusions e WHERE e.schedule_id=a.schedule_id AND e.resource_kind='vehicle' AND e.resource_id=a.vehicle_id)
        OR EXISTS (SELECT 1 FROM vehicle_outages o WHERE o.vehicle_id=a.vehicle_id AND o.active=1 AND o.starts_on<=? AND (o.ends_on IS NULL OR o.ends_on>=?))
        THEN 1 ELSE 0 END awaiting_redeploy
      FROM assignments a
      LEFT JOIN operation_slot_origins oso ON oso.assignment_id=a.id AND oso.slot_id=?
      LEFT JOIN posts p ON p.id=COALESCE(oso.post_id,a.post_id)
      LEFT JOIN vehicles v ON v.id=COALESCE(oso.vehicle_id,a.vehicle_id)
      WHERE a.schedule_id=?`).bind(date,date,slotId,slot.schedule_id).all<Row>(),
    env.DB.prepare(`SELECT os.guard_id FROM operation_slots os JOIN operations o ON o.id=os.operation_id
      WHERE os.guard_id IS NOT NULL AND os.id!=? AND o.status!='cancelled' AND o.starts_at<? AND o.ends_at>?`).bind(slotId,end,start).all<Row>(),
    env.DB.prepare(`SELECT guard_id,MAX(starts_at) last_he,SUM(CASE WHEN status IN ('confirmed','partial') THEN COALESCE(confirmed_minutes,0) WHEN status='pending' THEN planned_minutes ELSE 0 END) minutes
      FROM overtime_entries WHERE service_date>=? AND service_date<=? GROUP BY guard_id`).bind(monthStart,date).all<Row>(),
  ]);
  const blocked=new Set(movements.results.map(item=>Number(item.guard_id)));
  const reserved=new Set(operationGuards.results.map(item=>Number(item.guard_id)));
  const heByGuard=new Map(he.results.map(item=>[Number(item.guard_id),item]));
  const items=guards.results.flatMap(guard=>{
    const guardId=Number(guard.id);
    if(blocked.has(guardId)||reserved.has(guardId))return [];
    const duty=assignments.results.filter(item=>Number(item.guard_id)===guardId);
    const overlapping=duty.filter(item=>String(item.starts_at)<end&&String(item.ends_at)>start);
    const awaiting=overlapping.filter(item=>Number(item.awaiting_redeploy)===1);
    let sourceType:"available"|"redeployment"|"extension"|"overtime";
    let origin:Row|undefined;
    if(overlapping.length&&awaiting.length===overlapping.length){sourceType="available";origin=awaiting[0]}
    else if(overlapping.length){
      const fullyCovered=overlapping.every(item=>start<=String(item.starts_at)&&end>=String(item.ends_at));
      if(!fullyCovered||awaiting.length)return [];
      sourceType="redeployment";origin=overlapping[0];
    }
    else {
      origin=duty.find(item=>String(item.ends_at)===start||String(item.starts_at)===end);
      sourceType=origin?"extension":"overtime";
      if(Number(guard.overtime_eligible)===0)return [];
    }
    const stats=heByGuard.get(guardId);
    const operationHours=Math.max(0,(Date.parse(end)-Date.parse(start))/3600000);
    return [{
      guardId,name:guard.name,registration:guard.registration,platoon:guard.platoon,
      sourceType,originAssignmentId:origin?Number(origin.id):null,originLabel:origin?String(origin.origin_label):null,
      originAssignmentIds:sourceType==="redeployment"?overlapping.map(item=>Number(item.id)):[],
      currentHeHours:Number(stats?.minutes||0)/60,lastOvertime:stats?.last_he||null,
      operationHours:sourceType==="available"||sourceType==="redeployment"?0:operationHours,
    }];
  }).sort((a,b)=>{
    const priority={available:0,redeployment:1,extension:2,overtime:3};
    return priority[a.sourceType]-priority[b.sourceType]||a.currentHeHours-b.currentHeHours||String(a.name).localeCompare(String(b.name),"pt-BR");
  });
  return {slot,suggestions:items};
}

export async function GET(request:Request){
  if(!permitted(request))return Response.json({error:"Não autorizado"},{status:401});
  const url=new URL(request.url),date=String(url.searchParams.get("date")||"");
  if(url.searchParams.get("suggest")==="1"){
    const result=await getSuggestions(Number(url.searchParams.get("operationId")),Number(url.searchParams.get("slotId")));
    return result?Response.json(result,{headers:{"cache-control":"no-store"}}):Response.json({error:"Vaga ou operação não encontrada."},{status:404});
  }
  if(!isScheduleDate(date))return Response.json({error:"Data inválida."},{status:400});
  const [operations,vehicles]=await Promise.all([loadOperations(date),loadVehicleCatalog(date)]);
  return Response.json({date,operations,vehicles},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  if(!permitted(request))return Response.json({error:"Não autorizado"},{status:401});
  const body=await request.json() as OperationBody;
  if(body.action==="assign_slot"){
    const operationId=Number(body.operationId),slotId=Number(body.slotId),guardId=Number(body.guardId);
    const current=await env.DB.prepare("SELECT os.guard_id FROM operation_slots os JOIN operations o ON o.id=os.operation_id WHERE os.id=? AND os.operation_id=? AND o.status='draft'").bind(slotId,operationId).first<{guard_id:number|null}>();
    if(!current)return Response.json({error:"Esta operação não está mais disponível para edição."},{status:409});
    if(current?.guard_id)await restoreSlot(slotId);
    const result=await getSuggestions(operationId,slotId);
    const candidate=result?.suggestions.find(item=>Number(item.guardId)===guardId);
    if(!result||!candidate)return Response.json({error:"Este GM não está mais disponível para a operação. Atualize as sugestões."},{status:409});
    const before=await env.DB.prepare("SELECT * FROM operation_slots WHERE id=?").bind(slotId).first<Row>();
    if(candidate.sourceType==="redeployment"){
      const ids=candidate.originAssignmentIds||[];
      if(!ids.length)return Response.json({error:"Não foi possível identificar os horários de origem."},{status:409});
      const placeholders=ids.map(()=>"?").join(","),origins=(await env.DB.prepare(`SELECT * FROM assignments WHERE id IN (${placeholders}) AND schedule_id=? AND guard_id=?`).bind(...ids,result.slot.schedule_id,guardId).all<Row>()).results;
      if(origins.length!==ids.length||origins.some(item=>(!item.post_id&&!item.vehicle_id)||String(item.starts_at)<String(result.slot.operation_starts_at)||String(item.ends_at)>String(result.slot.operation_ends_at)))
        return Response.json({error:"A origem deste GM mudou. Atualize as sugestões antes de remanejar."},{status:409});
      const note=`AVISAR REMANEJAMENTO: ${candidate.originLabel||"posto/VTR de origem"} → operação ${result.slot.operation_title}`;
      await env.DB.batch([
        ...origins.map(item=>env.DB.prepare("INSERT INTO operation_slot_origins (slot_id,assignment_id,post_id,vehicle_id,role,was_reassigned,reassignment_note) VALUES (?,?,?,?,?,?,?)").bind(slotId,item.id,item.post_id||null,item.vehicle_id||null,item.role,Number(item.is_reassigned||0),item.reassignment_note||null)),
        ...origins.map(item=>env.DB.prepare("UPDATE assignments SET post_id=NULL,vehicle_id=NULL,is_reassigned=1,reassignment_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(note,item.id)),
        env.DB.prepare("UPDATE operation_slots SET guard_id=?,source_type='redeployment',origin_assignment_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND operation_id=?").bind(guardId,ids[0],slotId,operationId),
      ]);
    }else await env.DB.prepare("UPDATE operation_slots SET guard_id=?,source_type=?,origin_assignment_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND operation_id=?")
      .bind(guardId,candidate.sourceType,candidate.originAssignmentId||null,slotId,operationId).run();
    const after=await env.DB.prepare("SELECT * FROM operation_slots WHERE id=?").bind(slotId).first<Row>();
    await writeAudit(request,{action:"update",entityType:"operation_slot",entityId:slotId,summary:`Incluiu ${candidate.name} na operação`,before,after,undoable:false});
    const date=String(result.slot.date);
    return Response.json({ok:true,message:`${candidate.name} incluído na operação.`,operations:await loadOperations(date)});
  }
  if(body.action==="clear_slot"){
    const slotId=Number(body.slotId),operationId=Number(body.operationId);
    const slot=await env.DB.prepare("SELECT os.id FROM operation_slots os JOIN operations o ON o.id=os.operation_id WHERE os.id=? AND os.operation_id=? AND o.status='draft'").bind(slotId,operationId).first();
    if(!slot)return Response.json({error:"Reabra a operação antes de alterar suas vagas."},{status:409});
    await restoreSlot(slotId);
    const operation=await env.DB.prepare("SELECT s.date FROM operations o JOIN schedules s ON s.id=o.schedule_id WHERE o.id=?").bind(operationId).first<{date:string}>();
    return Response.json({ok:true,message:"Vaga liberada.",operations:await loadOperations(String(operation?.date))});
  }
  if(body.action==="confirm"){
    const operationId=Number(body.operationId);
    const vacant=await env.DB.prepare("SELECT COUNT(*) total FROM operation_slots WHERE operation_id=? AND guard_id IS NULL").bind(operationId).first<{total:number}>();
    if(Number(vacant?.total||0)>0)return Response.json({error:`Preencha ${vacant?.total} vaga(s) antes de confirmar.`},{status:409});
    await env.DB.prepare("UPDATE operations SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'").bind(operationId).run();
    const operation=await env.DB.prepare("SELECT o.*,s.date FROM operations o JOIN schedules s ON s.id=o.schedule_id WHERE o.id=?").bind(operationId).first<Row>();
    await writeAudit(request,{action:"confirm",entityType:"operation",entityId:operationId,summary:`Confirmou a operação ${operation?.title}`,after:operation,undoable:false});
    return Response.json({ok:true,message:"Operação confirmada.",operations:await loadOperations(String(operation?.date))});
  }
  if(body.action==="reopen"){
    const operationId=Number(body.operationId);
    const before=await env.DB.prepare("SELECT o.*,s.date FROM operations o JOIN schedules s ON s.id=o.schedule_id WHERE o.id=? AND o.status='confirmed'").bind(operationId).first<Row>();
    if(!before)return Response.json({error:"A operação não está confirmada ou já foi reaberta."},{status:409});
    await env.DB.prepare("UPDATE operations SET status='draft',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='confirmed'").bind(operationId).run();
    const after=await env.DB.prepare("SELECT * FROM operations WHERE id=?").bind(operationId).first<Row>();
    await writeAudit(request,{action:"reopen",entityType:"operation",entityId:operationId,summary:`Reabriu a operação ${before.title} para edição`,before,after,undoable:false});
    return Response.json({ok:true,message:"Operação reaberta. Ajuste as vagas e confirme novamente.",operations:await loadOperations(String(before.date))});
  }
  if(body.action==="cancel"){
    const operationId=Number(body.operationId);
    const before=await env.DB.prepare("SELECT o.*,s.date FROM operations o JOIN schedules s ON s.id=o.schedule_id WHERE o.id=?").bind(operationId).first<Row>();
    if(!before)return Response.json({error:"Operação não encontrada."},{status:404});
    await restoreOperation(operationId);
    await writeAudit(request,{action:"cancel",entityType:"operation",entityId:operationId,summary:`Cancelou a operação ${before.title}`,before,undoable:false});
    return Response.json({ok:true,message:"Operação cancelada.",operations:await loadOperations(String(before.date))});
  }

  const date=String(body.date||String(body.startsAt||"").slice(0,10));
  const start=String(body.startsAt||""),end=String(body.endsAt||""),vehicleIds=[...new Set((body.vehicleIds||[]).map(Number).filter(Boolean))];
  const requested=Math.max(0,Number(body.requestedGuards||0));
  if(!isScheduleDate(date)||!body.title?.trim()||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))
    return Response.json({error:"Informe nome, data e intervalo válidos."},{status:400});
  if(requested<Math.max(1,vehicleIds.length*2))return Response.json({error:`Informe ao menos ${Math.max(1,vehicleIds.length*2)} GM(s) para esta composição.`},{status:400});
  await env.DB.prepare("INSERT OR IGNORE INTO schedules (date,status) VALUES (?,'draft')").bind(date).run();
  const schedule=await env.DB.prepare("SELECT id FROM schedules WHERE date=?").bind(date).first<{id:number}>();
  for(const vehicleId of vehicleIds){
    const vehicle=await env.DB.prepare(`SELECT v.id,v.prefix FROM vehicles v WHERE v.id=? AND v.active=1
      AND NOT EXISTS (SELECT 1 FROM vehicle_outages x WHERE x.vehicle_id=v.id AND x.active=1 AND x.starts_on<=? AND (x.ends_on IS NULL OR x.ends_on>=?))
      AND NOT EXISTS (SELECT 1 FROM operation_vehicles ov JOIN operations o ON o.id=ov.operation_id WHERE ov.vehicle_id=v.id AND o.status!='cancelled' AND o.starts_at<? AND o.ends_at>?)`).bind(vehicleId,date,date,end,start).first<Row>();
    if(!vehicle)return Response.json({error:"Uma das viaturas ficou indisponível ou já foi reservada por outra operação."},{status:409});
  }
  const created=await env.DB.prepare("INSERT INTO operations (schedule_id,title,starts_at,ends_at,location,commander,reference,notes,requested_guards,status) VALUES (?,?,?,?,?,?,?,?,?,'draft')")
    .bind(schedule?.id,body.title.trim(),start,end,body.location||null,body.commander||null,body.reference||null,body.notes||null,requested).run();
  const operationId=Number(created.meta.last_row_id);
  let position=0;
  try{
    for(const vehicleId of vehicleIds){
      const vehicleCreated=await env.DB.prepare("INSERT INTO operation_vehicles (operation_id,vehicle_id,sort_order) VALUES (?,?,?)").bind(operationId,vehicleId,position++).run();
      const operationVehicleId=Number(vehicleCreated.meta.last_row_id);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO operation_slots (operation_id,operation_vehicle_id,role,position) VALUES (?,?,?,?)").bind(operationId,operationVehicleId,"driver",0),
        env.DB.prepare("INSERT INTO operation_slots (operation_id,operation_vehicle_id,role,position) VALUES (?,?,?,?)").bind(operationId,operationVehicleId,"patrol",1),
      ]);
    }
    const extras=requested-vehicleIds.length*2;
    if(extras>0)await env.DB.batch(Array.from({length:extras},(_,index)=>env.DB.prepare("INSERT INTO operation_slots (operation_id,operation_vehicle_id,role,position) VALUES (?,NULL,'guard',?)").bind(operationId,index)));
  }catch(error){await env.DB.prepare("DELETE FROM operations WHERE id=?").bind(operationId).run();throw error}
  const operation=await env.DB.prepare("SELECT * FROM operations WHERE id=?").bind(operationId).first<Row>();
  await writeAudit(request,{action:"create",entityType:"operation",entityId:operationId,summary:`Criou a operação ${body.title}`,after:operation,undoable:false});
  return Response.json({ok:true,message:"Operação criada como rascunho.",operations:await loadOperations(date)},{status:201});
}
