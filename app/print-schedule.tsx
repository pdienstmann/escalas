"use client";
import { Fragment, useEffect, useState } from "react";
import { ModuleLoading } from "./module-loading";
import { useScheduleDate } from "./use-schedule-date";
import { formatScheduleDate, withScheduleDate } from "../lib/schedule-date";
import { orderScheduleResources } from "../lib/schedule-sections";
import { compactRequestReference } from "../lib/request-reference";
import { assignmentOverlapsShift, operationalShiftWindow, SHIFT_DEFS } from "../lib/shift-rules";
import { isMotorcycleType } from "../lib/crew-rules";
import { operationalGroupMemberCoversShift } from "../lib/operational-group-schedule";
type Rec = Record<string, string | number | null>;
type OperationSlot = Rec & { id:number; role:string; guard_name?:string|null; source_type?:string|null };
type OperationVehicle = Rec & { id:number; prefix:string; type:string; zone?:string|null; slots:OperationSlot[] };
type PrintOperation = Rec & { id:number; title:string; starts_at:string; ends_at:string; vehicles:OperationVehicle[]; generalSlots:OperationSlot[] };
type State = {
  date: string;
  schedule?: Rec;
  guards?: Rec[];
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  movements: Rec[];
  serviceAdjustments?: Rec[];
  sections?: Rec[];
  patternLabel?: string;
  operations?: PrintOperation[];
  operationalGroups?: Rec[];
  operationalGroupMembers?: Rec[];
};
const shifts = {
  day: [
    { id: "2", label: "2º TURNO", time: "07:00–13:00" },
    { id: "3", label: "3º TURNO", time: "13:00–19:00" },
  ],
  night: [
    { id: "4", label: "4º TURNO", time: "19:00–01:00" },
    { id: "1", label: "1º TURNO", time: "01:00–07:00" },
  ],
};
export function PrintSchedule() {
  const { date } = useScheduleDate();
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const volumeTest = new URLSearchParams(location.search).get("teste") === "200";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    Promise.all([
      fetch(`/api/schedule?date=${date}&_=${Date.now()}`, { cache: "no-store" }),
      fetch(`/api/operations?date=${date}&_=${Date.now()}`, { cache: "no-store" }),
    ])
      .then(async ([scheduleResponse,operationsResponse]) => {
        if (!scheduleResponse.ok || !operationsResponse.ok) throw new Error();
        const [scheduleData,operationsData]=await Promise.all([scheduleResponse.json(),operationsResponse.json()]);
        return {...scheduleData,operations:operationsData.operations||[]};
      })
      .then((value) => setData(volumeTest ? makeVolumeData(value) : value))
      .catch(() => setError("Não foi possível preparar a impressão."));
  }, [date]);
  if (error) return <main className="print-error">{error}</main>;
  if (!data) return <ModuleLoading area="documento de impressão" detail={`Montando PDF da escala de ${formatScheduleDate(date)}…`} />;
  return (
    <main className={`print-document ${data.assignments.length >= 180 ? "print-dense" : ""}`}>
      <div className="print-actions">
        <a href={withScheduleDate("/", date)}>← Voltar</a>
        {data.assignments.length >= 180 && <span className="print-volume-badge">Compactação automática · {data.assignments.length} designações</span>}
        <button onClick={() => window.print()}>Imprimir / salvar PDF</button>
      </div>
      <PrintPage data={data} period="day" title="ESCALA DIURNA" />
      <PrintPage data={data} period="night" title="ESCALA NOTURNA" />
      {Boolean(data.operations?.length)&&<PrintOperationsPage data={data}/>}
    </main>
  );
}
function PrintOperationsPage({data}:{data:State}){
  return <section className="print-page print-operations-page"><header><div className="print-mark">GMNH</div><div><b>PREFEITURA MUNICIPAL DE NOVO HAMBURGO</b><span>SECRETARIA DE SEGURANÇA · DIRETORIA DA GUARDA MUNICIPAL</span><strong>OPERAÇÕES DO DIA</strong></div><aside><b>{formatScheduleDate(data.date)}</b><span>{data.operations?.length} operação(ões)</span></aside></header><div className="print-operation-list">{data.operations?.map(operation=><article key={operation.id}><header><div><h2>{operation.title}</h2><p>{String(operation.starts_at).slice(11,16)}–{String(operation.ends_at).slice(11,16)} · {String(operation.location||"Local não informado")}</p></div><aside><b>{String(operation.commander||"Responsável a definir")}</b><small>{String(operation.reference||"")}</small></aside></header><table><thead><tr><th>VTR / EQUIPE</th><th>MOTORISTA</th><th>PATRULHEIRO</th><th>REFORÇOS</th></tr></thead><tbody>{operation.vehicles.map(vehicle=>{const driver=vehicle.slots.find(slot=>slot.role==="driver"),patrol=vehicle.slots.find(slot=>slot.role==="patrol"),extras=vehicle.slots.filter(slot=>!["driver","patrol"].includes(slot.role)),motorcycle=isMotorcycleType(vehicle.type);return <tr key={vehicle.id}><td><b><span className="print-vehicle-icon">{vehicleIcon(String(vehicle.type))}</span>{vehicle.prefix}</b><small>{String(vehicle.zone||"Sem área")}</small></td><OperationSlotCell slot={driver}/>{motorcycle?<td>—</td>:<OperationSlotCell slot={patrol}/>}<td>{extras.length?extras.map(slot=><PrintOperationGuard key={slot.id} slot={slot}/>):"—"}</td></tr>})}{operation.generalSlots.length>0&&<tr><td><b>EFETIVO ADICIONAL</b><small>Sem VTR vinculada</small></td><td colSpan={3}>{operation.generalSlots.map(slot=><PrintOperationGuard key={slot.id} slot={slot}/>)}</td></tr>}</tbody></table>{operation.notes&&<p className="print-operation-notes"><b>Observações:</b> {String(operation.notes)}</p>}</article>)}</div><div className="print-page-number">ANEXO · OPERAÇÕES</div></section>
}
function OperationSlotCell({slot}:{slot?:OperationSlot}){return <td>{slot?<PrintOperationGuard slot={slot}/>:<strong className="print-hole">VAGA</strong>}</td>}
function PrintOperationGuard({slot}:{slot:OperationSlot}){return <span className="print-operation-guard"><b>{slot.guard_name||"VAGA"}</b>{slot.guard_name&&<em>{operationSource(String(slot.source_type||"pending"))}</em>}</span>}
const operationSource=(source:string)=>source==="available"?"DISP.":source==="extension"?"EXT. HE":source==="overtime"?"HE":source==="redeployment"?"REM.":"—";
function groupMemberForShift(data: State, guardId: number, shift: string) {
  return (data.operationalGroupMembers || []).find((member) => String(member.resource_kind) === "guard" && Number(member.resource_id) === guardId && member.pattern_id != null && operationalGroupMemberCoversShift(member, data.date, shift));
}

function isGroupOwnedAssignment(data: State, assignment: Rec, shift: string) {
  return Boolean(groupMemberForShift(data, Number(assignment.guard_id), shift));
}

function PrintPage({
  data,
  period,
  title,
}: {
  data: State;
  period: "day" | "night";
  title: string;
}) {
  const orderedResources = orderScheduleResources(
    data.vehicles,
    data.posts,
    data.sections || [],
  );
  const resources = Number(data.schedule?.hide_empty_resources || 0) === 1
    ? orderedResources.filter(({kind,r}) => data.assignments.some((assignment) =>
        (kind === "vehicle" ? Number(assignment.vehicle_id) === Number(r.id) : Number(assignment.post_id) === Number(r.id)) &&
        SHIFT_DEFS.some((shift) => assignmentOverlapsShift(assignment,data.date,shift.id) && !isGroupOwnedAssignment(data,assignment,shift.id)),
      ))
    : orderedResources;
  return (
    <section className="print-page">
      <header>
        <div className="print-mark">GMNH</div>
        <div>
          <b>PREFEITURA MUNICIPAL DE NOVO HAMBURGO</b>
          <span>SECRETARIA DE SEGURANÇA · DIRETORIA DA GUARDA MUNICIPAL</span>
          <strong>{title}</strong>
        </div>
        <aside>
          <b>{formatScheduleDate(data.date)}</b>
          <span>{data.patternLabel||"Escala operacional"}</span>
        </aside>
      </header>
      <table>
        <thead>
          <tr>
            <th>POSTO / RECURSO</th>
            {shifts[period].map((s) => (
              <th key={s.id}>
                {s.label}
                <small>{s.time}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map(({ kind, r, section }, index) => (
            <Fragment key={`${kind}-${r.id}`}>
              {(index === 0 || resources[index - 1].section !== section) && (
                <tr className="print-section">
                  <td colSpan={1 + shifts[period].length}><b>{section}</b></td>
                </tr>
              )}
              <tr>
                <td>
                  <b>{kind === "vehicle" ? <><span className="print-vehicle-icon">{vehicleIcon(String(r.type))}</span>{r.prefix}</> : r.name}</b>
                  <small>{kind === "vehicle" ? r.zone : r.group_name}</small>
                </td>
                {shifts[period].map((s) => {
                  const list = data.assignments.filter(
                      (a) =>
                        (kind === "vehicle"
                          ? a.vehicle_id === r.id
                          : a.post_id === r.id) && assignmentOverlapsShift(a,data.date,s.id) && !isGroupOwnedAssignment(data,a,s.id),
                    ),
                    missingRoles = kind === "vehicle"
                      ? isMotorcycleType(r.type)
                        ? (list.some((assignment) => !isOvertimeExtensionCell(assignment,data.date,s.id)) ? [] : ["driver"])
                        : ["driver", "patrol"].filter((role) => !list.some((assignment) => String(assignment.role) === role && !isOvertimeExtensionCell(assignment,data.date,s.id)))
                      : list.length ? [] : ["guard"];
                  return (
                    <td key={s.id}>
                      {list.map((a) => {const visualStatus=statusInShift(a,data.date,s.id);return (
                        <div className={`print-person ${visualStatus}`} key={a.id}>
                          {kind === "vehicle" && (
                             <span>{isOvertimeExtensionCell(a,data.date,s.id)?"R":isMotorcycleType(r.type)?"M":a.role === "driver" ? "M" : a.role === "patrol" ? "P" : "R"}</span>
                          )}
                          <b>{a.guard_name}</b>
                          {visualStatus !== "normal" && (
                            <em>{visualStatus==="overtime"&&a.regular_ends_at?`HE após ${String(a.regular_ends_at).slice(11,16)}`:status(visualStatus)}</em>
                          )}
                          {Number(a.is_reassigned)===1&&<em className="print-rem">AVISAR REM.</em>}
                          <small>
                            {assignmentDisplayInShift(a,data.date,s.id)}
                          </small>
                          {a.request_ref && (
                            <span
                              className="request-reference"
                              title={`Requerimento: ${String(a.request_ref)}`}
                            >
                              Req. {compactRequestReference(a.request_ref)}
                            </span>
                          )}
                        </div>
                      )})}
                      {missingRoles.length > 0 && (
                        <strong className="print-hole">
                          FURO · {missingRoles.map((role)=>role==="driver"?"motorista":role==="patrol"?"patrulheiro":"GM").join(" + ")}
                        </strong>
                      )}
                    </td>
                  );
                })}
              </tr>
            </Fragment>
          ))}
          <PrintOperationalGroupRows data={data} period={period} />
        </tbody>
      </table>
      <footer>
        <h2>EFETIVO FORA DA ESCALA / ALTERAÇÕES DO DIA</h2>
        <div>
          {groups.map((g) => {
            const list = data.movements.filter((m) =>
              g.types.includes(String(m.type)),
            );
            return (
              <section key={g.key}>
                <b>{g.label}</b>
                {list.map((m) => (
                  <p key={m.id}>
                    {m.guard_name}
                    <small>
                      {movementDetail(m)}
                      {m.request_ref ? ` · Req. ${m.request_ref}` : ""}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </small>
                  </p>
                ))}
                {!list.length && <p>—</p>}
              </section>
            );
          })}
          {data.serviceAdjustments?.length ? (
            <section className="print-service-adjustments">
              <b>Banco de horas / trocas</b>
              {data.serviceAdjustments.map((item) => (
                <p key={String(item.id)} className={`print-adjustment-${String(item.settlement_date||"")===data.date?"settlement":String(item.subtype)}`}>
                  <span className="print-adjustment-kind">{printServiceAdjustmentCode(String(item.subtype),item,data.date)}</span>
                  <b>{String(item.guard_name)}{item.counterpart_guard_name ? ` ⇄ ${String(item.counterpart_guard_name)}` : ""}</b>
                  <small>{printServiceAdjustmentRange(item, data.date)}{item.request_ref ? ` · Req. ${String(item.request_ref)}` : " · Sem requerimento"}</small>
                </p>
              ))}
            </section>
          ) : null}
        </div>
      </footer>
      <div className="print-page-number">
        {period === "day" ? "FRENTE · DIURNO" : "VERSO · NOTURNO"}
      </div>
    </section>
  );
}
function PrintOperationalGroupRows({ data, period }: { data: State; period: "day" | "night" }) {
  const periodShifts = shifts[period];
  const groups = data.operationalGroups || [];
  const members = data.operationalGroupMembers || [];
  const guards = new Map((data.guards || []).map((guard) => [Number(guard.id), String(guard.name || `GM ${guard.id}`)]));
  const relevant = members.filter((member) => {
    if (String(member.resource_kind) !== "guard" || member.pattern_id == null) return false;
    return periodShifts.some((shift) => operationalGroupMemberCoversShift(member, data.date, shift.id));
  });
  if (!relevant.length) return null;
  return <>
    <tr className="print-section print-operational-group-section"><td colSpan={1 + periodShifts.length}><b>GRUPAMENTOS E EQUIPES</b></td></tr>
    {groups.map((group) => {
      const groupMembers = relevant.filter((member) => Number(member.group_id) === Number(group.id));
      if (!groupMembers.length) return null;
      const teams = [...new Set(groupMembers.map((member) => String(member.team_label || "EQUIPE GERAL").trim().toUpperCase() || "EQUIPE GERAL"))];
      return <Fragment key={`print-group-${group.id}`}>
        <tr className="print-operational-group-title"><td colSpan={1 + periodShifts.length}><b>{String(group.short_name || group.name)}</b><small>{String(group.name || "Grupamento")}</small></td></tr>
        {teams.map((team) => {
          const teamMembers = groupMembers.filter((member) => String(member.team_label || "EQUIPE GERAL").trim().toUpperCase() === team);
          return <tr className="print-operational-group-team" key={`print-team-${group.id}-${team}`}>
            <td><b>{team}</b><small>{teamMembers.length} GM(s)</small></td>
            {periodShifts.map((shift) => <td key={shift.id}>{teamMembers.filter((member) => operationalGroupMemberCoversShift(member, data.date, shift.id)).map((member) => {
              const assignment = data.assignments.find((item) => Number(item.guard_id) === Number(member.resource_id) && String(item.work_kind || "shift") !== "overtime_extension" && assignmentOverlapsShift(item, data.date, shift.id) && (member.vehicle_id == null || Number(item.vehicle_id) === Number(member.vehicle_id)));
              const vehicle = member.vehicle_id ? data.vehicles.find((item) => Number(item.id) === Number(member.vehicle_id)) : assignment?.vehicle_id ? data.vehicles.find((item) => Number(item.id) === Number(assignment.vehicle_id)) : null;
              const destination = vehicle ? `${vehicleIcon(String(vehicle.type))} ${String(vehicle.prefix)}` : assignment?.post_id ? String(data.posts.find((post) => Number(post.id) === Number(assignment.post_id))?.name || "Posto") : "À disposição";
              const time = member.starts_at && member.ends_at ? `${String(member.starts_at).slice(0, 5)}–${String(member.ends_at).slice(0, 5)} · 12h` : String(member.pattern_period) === "night" ? "19:00–07:00 · 12h" : "07:00–19:00 · 12h";
              const movement = data.movements.find((item) => Number(item.guard_id) === Number(member.resource_id) && String(item.starts_at || "") < `${data.date}T23:59` && String(item.ends_at || "") > `${data.date}T00:00`);
              const visualStatus = assignment ? statusInShift(assignment, data.date, shift.id) : movement ? "away" : "normal";
              const role = vehicle && isMotorcycleType(vehicle.type) ? "M" : assignment?.role === "driver" ? "M" : assignment?.role === "patrol" ? "P" : "GM";
              const statusLabel = visualStatus === "overtime" ? "HE" : visualStatus === "time_bank" ? "BH" : visualStatus === "swap" ? "TROCA" : visualStatus === "away" ? String(movement?.type || "AFASTADO").toUpperCase() : "";
              return <span className={`print-person print-group-person ${assignment ? visualStatus : "print-group-unassigned"}`} key={`${member.id}-${shift.id}`}><b><i className="print-group-role">{role}</i>{guards.get(Number(member.resource_id)) || `GM ${member.resource_id}`}{statusLabel && <em className={`print-group-status ${visualStatus}`}>{statusLabel}</em>}</b><small>{destination} · {time}</small>{assignment?.request_ref && <em>Req. {compactRequestReference(assignment.request_ref)}</em>}</span>;
            })}</td>)}
          </tr>;
        })}
      </Fragment>;
    })}
  </>;
}

const groups = [
  {
    key: "technical_reserve",
    types: ["technical_reserve"],
    label: "Reserva técnica",
  },
  { key: "day_off", types: ["day_off"], label: "Folgas" },
  { key: "vacation", types: ["vacation"], label: "Férias" },
  { key: "course", types: ["course"], label: "Cursos" },
  {
    key: "medical_leave",
    types: ["medical_leave", "other_leave"],
    label: "Atestados / licenças",
  },
  { key: "adjustments", types: ["time_bank", "swap"], label: "BH / trocas" },
];
function movementDetail(m: Rec) {
  const start = new Date(String(m.starts_at));
  const end = new Date(String(m.ends_at));
  const date = (value: Date) => value.toLocaleDateString("pt-BR");
  const time = (value: Date) =>
    value.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const displayedEnd = /T00:00(?:$|:00)/.test(String(m.ends_at || "")) ? new Date(end.getTime() - 86400000) : end;
  if (m.type === "medical_leave" || m.type === "other_leave") return `até ${date(displayedEnd)}`;
  if (m.type === "vacation" || m.type === "course")
    return `${date(start)} a ${date(displayedEnd)}`;
  if (m.type === "day_off" || m.type === "technical_reserve")
    return date(start);
  return `${date(start)} ${time(start)}–${time(end)}`;
}
function printServiceAdjustmentLabel(subtype:string){return ({negative_early:"BH- · saída antecipada",negative_late:"BH- · entrada tardia",negative_full:"BH- · retirada integral",positive:"BH+ · dia extra",swap:"Troca de serviço"} as Record<string,string>)[subtype]||subtype}
function printServiceAdjustmentCode(subtype:string,item?:Rec,date?:string){if(item&&date&&String(item.settlement_date||"")===date)return "BH+";return ({negative_early:"BH-",negative_late:"BH-",negative_full:"BH-",positive:"BH+",swap:"TROCA"} as Record<string,string>)[subtype]||"AJUSTE"}
function printAdjustmentHoursLabel(value:unknown){
  const hours=Number(value);
  if(!Number.isFinite(hours)||hours<=0)return "";
  const rounded=Math.round(hours*100)/100;
  return `${Number.isInteger(rounded)?rounded:rounded.toFixed(2).replace(/0+$/, "").replace(".", ",")}h`;
}
function printServiceAdjustmentRange(item:Rec,date:string){
  if(!item.hours&&!item.settlement_date)return printLegacyServiceAdjustmentRange(item,date);
  const hours=printAdjustmentHoursLabel(item.hours);
  const isSettlement=String(item.settlement_date||"")===date;
  if(isSettlement){
    const paidHours=printAdjustmentHoursLabel(item.settlement_hours||item.hours);
    return `BH+${paidHours?` ${paidHours}`:""} · pagamento do BH- · ${String(item.settlement_starts_at||"").slice(11,16)}–${String(item.settlement_ends_at||"").slice(11,16)}`;
  }
  const isSecond=String(item.service_date)!==date&&String(item.counterpart_service_date||"")===date;
  const start=String(isSecond?item.counterpart_starts_at:item.starts_at||"").slice(11,16),end=String(isSecond?item.counterpart_ends_at:item.ends_at||"").slice(11,16);
  const label=printServiceAdjustmentLabel(String(item.subtype));
  if(!isSecond&&String(item.subtype)==="negative_full")return `${label}${hours?` · ${hours}`:""} · ${String(item.service_date)} · dia inteiro${item.settlement_date?` · BH+ em ${String(item.settlement_date)}`:""}`;
  if(String(item.subtype)!=="swap")return `${label}${hours?` · ${hours}`:""} · ${start}–${end}${item.settlement_date?` · BH+ em ${String(item.settlement_date)}`:""}`;
  const otherDate=isSecond?String(item.service_date):String(item.counterpart_service_date||"");
  return `${label} · ${start}–${end} · troca com ${otherDate}`;
}
function printLegacyServiceAdjustmentRange(item:Rec,date:string){
  const isSecond=String(item.service_date)!==date&&String(item.counterpart_service_date||"")===date;
  const start=String(isSecond?item.counterpart_starts_at:item.starts_at||"").slice(11,16),end=String(isSecond?item.counterpart_ends_at:item.ends_at||"").slice(11,16);
  const label=printServiceAdjustmentLabel(String(item.subtype));
  if(String(item.subtype)!=="swap")return `${label} · ${start}–${end}`;
  const otherDate=isSecond?String(item.service_date):String(item.counterpart_service_date||"");
  return `${label} · ${start}–${end} · troca com ${otherDate}`;
}
const status = (s: string) =>
  s === "overtime" ? "HE" : s === "time_bank" ? "BH" : "TROCA";
const vehicleIcon=(type:string)=>type==="moto"?"🏍️":type==="pickup"?"🛻":type==="van"?"🚐":type==="suv"?"🚙":"🚓";
function statusInShift(a:Rec,date:string,shift:string){const value=String(a.status||"normal"),regular=String(a.regular_ends_at||"");if(value!=="overtime"||!regular)return value;return operationalShiftWindow(date,shift).end<=regular?"normal":value}
function isOvertimeExtensionCell(a:Rec,date:string,shift:string){const regular=String(a.regular_ends_at||"");return Boolean(regular)&&String(a.status)==="overtime"&&operationalShiftWindow(date,shift).start>=regular}
function assignmentDisplayInShift(a:Rec,date:string,shift:string){if(String(a.work_kind)==="weekly")return weeklyDisplayInShift(a,date,shift);const window=operationalShiftWindow(date,shift),start=String(a.starts_at),end=String(a.ends_at),segmentStart=start>window.start?start:window.start,segmentEnd=end<window.end?end:window.end,range=`${segmentStart.slice(11,16)}–${segmentEnd.slice(11,16)}`;return statusInShift(a,date,shift)==="overtime"&&a.regular_ends_at?`Extensão HE ${range}`:range}
function weeklyDisplayInShift(a:Rec,date:string,shift:string){const window=operationalShiftWindow(date,shift),start=String(a.starts_at),end=String(a.ends_at),regular=String(a.regular_ends_at||a.ends_at),segmentStart=start>window.start?start:window.start,segmentEnd=end<window.end?end:window.end,regularEnd=regular<segmentEnd?regular:segmentEnd,parts:string[]=[];if(segmentStart<regularEnd){const breakStart=String(a.break_starts_at||""),breakEnd=String(a.break_ends_at||"");if(breakStart&&breakEnd&&breakStart<regularEnd&&breakEnd>segmentStart){if(segmentStart<breakStart)parts.push(`${segmentStart.slice(11,16)}–${breakStart.slice(11,16)}`);if(breakEnd<regularEnd)parts.push(`${breakEnd.slice(11,16)}–${regularEnd.slice(11,16)}`)}else parts.push(`${segmentStart.slice(11,16)}–${regularEnd.slice(11,16)}`)}if(segmentEnd>regular){const overtimeStart=regular>segmentStart?regular:segmentStart,hours=Math.max(0,(Date.parse(segmentEnd)-Date.parse(overtimeStart))/3600000);parts.push(`+${Number(hours.toFixed(1))}HE ${overtimeStart.slice(11,16)}–${segmentEnd.slice(11,16)}`)}return parts.join(" / ")||`${segmentStart.slice(11,16)}–${segmentEnd.slice(11,16)}`}

function makeVolumeData(data: State): State {
  const vehicles = data.vehicles.slice(0, 4);
  const posts: Rec[] = Array.from({ length: 42 }, (_, index) => ({
    id: 9000 + index,
    name: `POSTO OPERACIONAL ${String(index + 1).padStart(2, "0")}`,
    group_name: index < 8 ? "SEDE DA GM" : index < 24 ? "POSTOS FIXOS" : "POSTOS DIVERSOS",
  }));
  const assignments: Rec[] = [];
  let guardNumber = 1;
  for (const shift of ["2", "3", "4", "1"]) {
    const start = shift === "2" ? "07:00" : shift === "3" ? "13:00" : shift === "4" ? "19:00" : "01:00";
    const end = shift === "2" ? "13:00" : shift === "3" ? "19:00" : shift === "4" ? "01:00" : "07:00";
    for (const vehicle of vehicles) {
      for (const role of ["driver", "patrol"]) assignments.push({id:100000+guardNumber,vehicle_id:vehicle.id,post_id:null,shift,role,status:guardNumber%17===0?"overtime":"normal",guard_name:`GM TESTE ${String(guardNumber++).padStart(3,"0")}`,starts_at:`${data.date}T${start}`,ends_at:`${data.date}T${end}`});
    }
    for (const post of posts) assignments.push({id:100000+guardNumber,vehicle_id:null,post_id:post.id,shift,role:"guard",status:guardNumber%23===0?"time_bank":"normal",guard_name:`GM TESTE ${String(guardNumber++).padStart(3,"0")}`,starts_at:`${data.date}T${start}`,ends_at:`${data.date}T${end}`});
  }
  return {...data,posts,vehicles,assignments};
}
