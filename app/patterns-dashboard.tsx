"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FullPageLink as Link } from "./full-page-link";
type Rec = Record<string, string | number | null>;
type Data = {
  patterns: Rec[];
  slots: Rec[];
  guards: Rec[];
  posts: Rec[];
  vehicles: Rec[];
  weeklySlots: Rec[];
  anchorDate: string;
  dayCode: string;
  nightCode: string;
};
export function PatternsDashboard() {
  const [data, setData] = useState<Data | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [date, setDate] = useState("2026-08-12"),
    [dayCode, setDayCode] = useState("D1"),
    [nightCode, setNightCode] = useState("N1"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/patterns?date=${date}&_=${Date.now()}`, {
        cache: "no-store",
      }),
      j = await r.json();
    setData(j);
    setSelected((current) => current || Number(j.patterns?.[0]?.id || 0));
    setDayCode(j.dayCode || "D1");
    setNightCode(j.nightCode || "N1");
  }, [date]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/patterns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        j = await r.json();
      setMessage(
        r.ok ? j.message || "Padrão atualizado com sucesso." : j.error,
      );
      if (r.ok) await load();
      return r.ok;
    } finally {
      setBusy(false);
    }
  }
  async function saveSlot(e: FormEvent<HTMLFormElement>, id: number) {
    e.preventDefault();
    await action({
      ...Object.fromEntries(new FormData(e.currentTarget)),
      action: "update_slot",
      id,
    });
  }
  async function addSlot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = e.currentTarget;
    if (
      await action({
        ...Object.fromEntries(new FormData(form)),
        action: "add_slot",
        patternId: selected,
      })
    )
      form.reset();
  }
  async function saveWeekly(e:FormEvent<HTMLFormElement>,id?:number){e.preventDefault();const form=e.currentTarget;if(await action({...Object.fromEntries(new FormData(form)),action:"weekly_save",id:id||null}))if(!id)form.reset()}
  async function apply() {
    if (
      !confirm(
        `Substituir a escala de ${new Date(date + "T12:00:00").toLocaleDateString("pt-BR")} pelos padrões ${dayCode}/${nightCode}?`,
      )
    )
      return;
    await action({ action: "apply", date, dayCode, nightCode, confirm: true });
  }
  const current = useMemo(
      () => data?.patterns.find((p) => Number(p.id) === selected),
      [data, selected],
    ),
    members = useMemo(
      () => data?.slots.filter((s) => Number(s.pattern_id) === selected) || [],
      [data, selected],
    );
  if (!data)
    return <main className="patterns-page">Carregando padrões 12x36…</main>;
  return (
    <main className="patterns-page">
      <header>
        <Link href="/">← Voltar à escala</Link>
        <div>
          <span>BASE CONFIGURÁVEL DA ESCALA 12x36</span>
          <h1>Editor dos padrões</h1>
          <p>
            Defina a composição fixa e escolha qual padrão deve gerar cada data.
          </p>
        </div>
      </header>
      <section className="pattern-config">
        <div>
          <label>
            Data-base do Padrão 1
            <input
              id="anchor-date"
              type="date"
              defaultValue={data.anchorDate}
            />
          </label>
          <small>Nesta data trabalham D1 e N1; no dia seguinte, D2 e N2.</small>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            action({
              action: "anchor",
              anchorDate: (
                document.getElementById("anchor-date") as HTMLInputElement
              ).value,
            })
          }
        >
          Salvar data-base
        </button>
      </section>
      <section className="pattern-apply">
        <div>
          <label>
            Data da escala
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <p>
            Sugestão automática:{" "}
            <b>
              {data.dayCode} + {data.nightCode}
            </b>
          </p>
        </div>
        <label>
          Diurno
          <select value={dayCode} onChange={(e) => setDayCode(e.target.value)}>
            {data.patterns
              .filter((p) => p.period === "day")
              .map((p) => (
                <option key={p.id} value={String(p.code)}>
                  {p.code} · {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Noturno
          <select
            value={nightCode}
            onChange={(e) => setNightCode(e.target.value)}
          >
            {data.patterns
              .filter((p) => p.period === "night")
              .map((p) => (
                <option key={p.id} value={String(p.code)}>
                  {p.code} · {p.name}
                </option>
              ))}
          </select>
        </label>
        <button disabled={busy} onClick={apply}>
          Gerar escala desta data
        </button>
      </section>
      {message && (
        <p className="pattern-message" role="status">
          {message} <Link href={`/?date=${date}`}>Abrir escala →</Link>
        </p>
      )}
      <section className="pattern-tabs" aria-label="Equipes-base">
        {data.patterns.map((p) => (
          <button
            className={selected === Number(p.id) ? "active" : ""}
            key={p.id}
            onClick={() => setSelected(Number(p.id))}
          >
            <span className={`pattern-code ${p.period}`}>{p.code}</span>
            <b>{p.name}</b>
            <small>{p.member_count} posições</small>
          </button>
        ))}
      </section>
      <section className="pattern-editor">
        <header>
          <div>
            <span>{current?.code}</span>
            <h2>Composição de {current?.name}</h2>
            <p>
              Altere GM, destino e função. O padrão original permanece separado
              das escalas diárias já ajustadas.
            </p>
          </div>
          <b>{members.length} integrantes</b>
        </header>
        <div className="pattern-members">
          {members.map((member) => (
            <form
              key={member.id}
              onSubmit={(e) => saveSlot(e, Number(member.id))}
            >
              <select
                name="guardId"
                defaultValue={String(member.guard_id)}
                aria-label="GM"
              >
                {data.guards.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name} · {g.platoon}
                  </option>
                ))}
              </select>
              <select
                name="destination"
                defaultValue={
                  member.vehicle_id
                    ? `vehicle:${member.vehicle_id}`
                    : `post:${member.post_id}`
                }
                aria-label="Destino"
              >
                {data.posts.map((p) => (
                  <option key={`p${p.id}`} value={`post:${p.id}`}>
                    {p.group_name} · {p.name}
                  </option>
                ))}
                {data.vehicles.map((v) => (
                  <option key={`v${v.id}`} value={`vehicle:${v.id}`}>
                    {v.prefix} · {v.zone}
                  </option>
                ))}
              </select>
              <select
                name="role"
                defaultValue={String(member.role)}
                aria-label="Função"
              >
                <option value="guard">GM do posto</option>
                <option value="driver">Motorista</option>
                <option value="patrol">Patrulheiro</option>
                <option value="third">3º integrante</option>
              </select>
              <button disabled={busy}>Salvar</button>
              <button
                type="button"
                className="remove-slot"
                disabled={busy}
                onClick={() =>
                  confirm(`Remover ${member.guard_name} deste padrão?`) &&
                  action({ action: "delete_slot", id: member.id })
                }
              >
                Remover
              </button>
            </form>
          ))}
        </div>
        <form className="pattern-add" onSubmit={addSlot}>
          <b>Adicionar integrante</b>
          <select name="guardId" required defaultValue="">
            <option value="">Selecione o GM</option>
            {data.guards.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name} · {g.platoon}
              </option>
            ))}
          </select>
          <select name="destination" required defaultValue="">
            <option value="">Selecione o destino</option>
            {data.posts.map((p) => (
              <option key={`p${p.id}`} value={`post:${p.id}`}>
                {p.group_name} · {p.name}
              </option>
            ))}
            {data.vehicles.map((v) => (
              <option key={`v${v.id}`} value={`vehicle:${v.id}`}>
                {v.prefix} · {v.zone}
              </option>
            ))}
          </select>
          <select name="role" defaultValue="guard">
            <option value="guard">GM do posto</option>
            <option value="driver">Motorista</option>
            <option value="patrol">Patrulheiro</option>
            <option value="third">3º integrante</option>
          </select>
          <button className="save" disabled={busy}>
            Adicionar
          </button>
        </form>
      </section>
      <section className="weekly-patterns">
        <header><div><span>SEGUNDA A SEXTA</span><h2>Padrões semanais</h2><p>Horários contínuos ou com intervalo, incluindo extensão diária de hora extra.</p></div><b>{data.weeklySlots.length} integrantes</b></header>
        <div className="weekly-grid weekly-head"><span>GM e destino</span><span>Dias</span><span>Jornada</span><span>Intervalo / HE</span><span>Ações</span></div>
        {data.weeklySlots.map(slot=><form className="weekly-grid" key={String(slot.id)} onSubmit={e=>saveWeekly(e,Number(slot.id))}>
          <div><select name="guardId" defaultValue={String(slot.guard_id)} aria-label="GM semanal">{data.guards.map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)}</option>)}</select><select name="destination" defaultValue={slot.vehicle_id?`vehicle:${slot.vehicle_id}`:`post:${slot.post_id}`} aria-label="Destino semanal">{data.posts.map(p=><option key={`wp${p.id}`} value={`post:${p.id}`}>{String(p.group_name)} · {String(p.name)}</option>)}{data.vehicles.map(v=><option key={`wv${v.id}`} value={`vehicle:${v.id}`}>{String(v.prefix)} · {String(v.zone)}</option>)}</select></div>
          <input name="weekdays" defaultValue={String(slot.weekdays)} aria-label="Dias da semana" title="1=segunda, 5=sexta"/>
          <div className="weekly-times"><input name="startsAt" type="time" defaultValue={String(slot.starts_at)}/><input name="regularEnd" type="time" defaultValue={String(slot.regular_end)}/></div>
          <div className="weekly-times"><input name="breakStart" type="time" defaultValue={String(slot.break_start||"")}/><input name="breakEnd" type="time" defaultValue={String(slot.break_end||"")}/><input name="overtimeEnd" type="time" defaultValue={String(slot.overtime_end||"")} aria-label="Fim com HE"/></div>
          <div><select name="role" defaultValue={String(slot.role)}><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option></select><button disabled={busy}>Salvar</button><button type="button" className="remove-slot" onClick={()=>confirm(`Remover escala semanal de ${slot.guard_name}?`)&&action({action:"weekly_delete",id:slot.id})}>Remover</button></div>
        </form>)}
        <form className="weekly-add" onSubmit={e=>saveWeekly(e)}><b>Adicionar escala semanal</b><select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{data.guards.filter(g=>!data.weeklySlots.some(s=>Number(s.guard_id)===Number(g.id))).map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)} · {String(g.platoon)}</option>)}</select><select name="destination" required defaultValue=""><option value="">Selecione posto ou VTR</option>{data.posts.map(p=><option key={`ap${p.id}`} value={`post:${p.id}`}>{String(p.group_name)} · {String(p.name)}</option>)}{data.vehicles.map(v=><option key={`av${v.id}`} value={`vehicle:${v.id}`}>{String(v.prefix)} · {String(v.zone)}</option>)}</select><input name="weekdays" defaultValue="1,2,3,4,5" aria-label="Dias úteis"/><input name="startsAt" type="time" defaultValue="08:00"/><input name="regularEnd" type="time" defaultValue="17:00"/><input name="breakStart" type="time" defaultValue="12:00"/><input name="breakEnd" type="time" defaultValue="13:00"/><input name="overtimeEnd" type="time" aria-label="Fim com HE opcional"/><select name="role"><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option></select><button className="save" disabled={busy}>Adicionar semanal</button></form>
      </section>
    </main>
  );
}
