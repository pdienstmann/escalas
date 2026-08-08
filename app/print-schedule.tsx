"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { Fragment, useEffect, useState } from "react";
import { ModuleLoading } from "./module-loading";
import { useScheduleDate } from "./use-schedule-date";
import { formatScheduleDate, withScheduleDate } from "../lib/schedule-date";
import { orderScheduleResources } from "../lib/schedule-sections";
type Rec = Record<string, string | number | null>;
type State = {
  date: string;
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  movements: Rec[];
  sections?: Rec[];
  patternLabel?: string;
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
    setData(null);
    fetch(`/api/schedule?date=${date}&_=${Date.now()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
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
    </main>
  );
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
  const resources = orderScheduleResources(
    data.vehicles,
    data.posts,
    data.sections || [],
  );
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
                          : a.post_id === r.id) && belongsToShift(a,s.id),
                    ),
                    required = kind === "vehicle" ? 2 : 1;
                  return (
                    <td key={s.id}>
                      {list.map((a) => (
                        <div className={`print-person ${a.status}`} key={a.id}>
                          {kind === "vehicle" && (
                            <span>{a.role === "driver" ? "M" : "P"}</span>
                          )}
                          <b>{a.guard_name}</b>
                          {a.status !== "normal" && (
                            <em>{String(a.work_kind)==="weekly"&&String(a.regular_ends_at||"")!==String(a.ends_at)?weeklyHeShort(a):status(String(a.status))}</em>
                          )}
                          {Number(a.is_reassigned)===1&&<em className="print-rem">REM</em>}
                          <small>
                            {weeklyDisplay(a)}
                          </small>
                        </div>
                      ))}
                      {list.length < required && (
                        <strong className="print-hole">
                          FURO · {required - list.length} vaga(s)
                        </strong>
                      )}
                    </td>
                  );
                })}
              </tr>
            </Fragment>
          ))}

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
                    </small>
                  </p>
                ))}
                {!list.length && <p>—</p>}
              </section>
            );
          })}
        </div>
      </footer>
      <div className="print-page-number">
        {period === "day" ? "FRENTE · DIURNO" : "VERSO · NOTURNO"}
      </div>
    </section>
  );
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
    types: ["medical_leave"],
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
  if (m.type === "medical_leave") return `até ${date(end)}`;
  if (m.type === "vacation" || m.type === "course")
    return `${date(start)} a ${date(end)}`;
  if (m.type === "day_off" || m.type === "technical_reserve")
    return date(start);
  return `${date(start)} ${time(start)}–${time(end)}`;
}
const status = (s: string) =>
  s === "overtime" ? "HE" : s === "time_bank" ? "BH" : "TROCA";
const vehicleIcon=(type:string)=>type==="moto"?"🏍️":type==="pickup"?"🛻":type==="van"?"🚐":type==="suv"?"🚙":"🚓";
function weeklyDisplay(a:Rec){const start=String(a.starts_at).slice(11,16),regular=String(a.regular_ends_at||"").slice(11,16),end=String(a.ends_at).slice(11,16),breakStart=String(a.break_starts_at||"").slice(11,16),breakEnd=String(a.break_ends_at||"").slice(11,16);if(String(a.work_kind)!=="weekly")return `${start}–${end}`;const base=breakStart&&breakEnd?`${start}–${breakStart}/${breakEnd}–${regular}`:`${start}–${regular}`;return end!==regular?`${base} + HE ${regular}–${end}`:base}
function weeklyHeShort(a:Rec){const regular=String(a.regular_ends_at).slice(11,16),end=String(a.ends_at).slice(11,16);const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3,5));return `HE semanal ${Math.max(0,(minutes(end)-minutes(regular))/60)}h`}
function belongsToShift(a:Rec,shift:string){if(String(a.shift)===shift)return true;if(String(a.shift)!=="W")return false;const start=String(a.starts_at).slice(11,16),end=String(a.ends_at).slice(11,16);if(shift==="2")return start<"13:00"&&end>"07:00";if(shift==="3")return start<"19:00"&&end>"13:00";return false}

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
