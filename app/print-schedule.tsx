"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from "react";
type Rec = Record<string, string | number | null>;
type State = {
  date: string;
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  movements: Rec[];
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
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const date =
      new URLSearchParams(location.search).get("date") || "2026-08-12";
    fetch(`/api/schedule?date=${date}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError("Não foi possível preparar a impressão."));
  }, []);
  if (error) return <main className="print-error">{error}</main>;
  if (!data) return <main className="print-error">Preparando documento…</main>;
  return (
    <main className="print-document">
      <div className="print-actions">
        <a href="/">← Voltar</a>
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
  const resources = [
    ...data.vehicles.map((r) => ({ kind: "vehicle", r })),
    ...data.posts.map((r) => ({ kind: "post", r })),
  ];
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
          <b>{new Date(data.date + "T12:00:00").toLocaleDateString("pt-BR")}</b>
          <span>Escala 12x36</span>
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
          {resources.map(({ kind, r }) => (
            <tr key={`${kind}-${r.id}`}>
              <td>
                <b>{kind === "vehicle" ? r.prefix : r.name}</b>
                <small>{kind === "vehicle" ? r.zone : r.group_name}</small>
              </td>
              {shifts[period].map((s) => {
                const list = data.assignments.filter(
                    (a) =>
                      (kind === "vehicle"
                        ? a.vehicle_id === r.id
                        : a.post_id === r.id) && a.shift === s.id,
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
                          <em>{status(String(a.status))}</em>
                        )}
                        <small>
                          {String(a.starts_at).slice(11, 16)}–
                          {String(a.ends_at).slice(11, 16)}
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
