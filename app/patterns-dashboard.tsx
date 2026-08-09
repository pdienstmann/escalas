"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { BackToSchedule } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";
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
  const { date, setDate, hrefFor } = useScheduleDate();
  const [data, setData] = useState<Data | null>(null),
    [selected, setSelected] = useState<number | null>(null),
    [dayCode, setDayCode] = useState("D1"),
    [nightCode, setNightCode] = useState("N1"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [workspace, setWorkspace] = useState<"shift" | "weekly">("shift"),
    [memberEditing, setMemberEditing] = useState<number | null>(null),
    [addDestination, setAddDestination] = useState<string | null>(null),
    [patternSearch, setPatternSearch] = useState(""),
    [showEmpty, setShowEmpty] = useState(false);
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/patterns?date=${date}&_=${Date.now()}`, {
          cache: "no-store",
        }),
        j = await r.json();
      setData(j);
      setSelected((current) => current || Number(j.patterns?.[0]?.id || 0));
      setDayCode(j.dayCode || "D1");
      setNightCode(j.nightCode || "N1");
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function action(body: Record<string, unknown>) {
    if (busy) return;
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
      if (r.ok) await load(true);
      return r.ok;
    } finally {
      setBusy(false);
    }
  }
  async function saveSlot(e: FormEvent<HTMLFormElement>, id: number) {
    e.preventDefault();
    if (await action({
      ...Object.fromEntries(new FormData(e.currentTarget)),
      action: "update_slot",
      id,
    })) setMemberEditing(null);
  }
  async function addSlot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = e.currentTarget;
    if (await action({
        ...Object.fromEntries(new FormData(form)),
        action: "add_slot",
        patternId: selected,
      })) {
      form.reset();
      setAddDestination(null);
    }
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
  const current = data?.patterns.find((pattern) => Number(pattern.id) === selected);
  const members = data?.slots.filter((slot) => Number(slot.pattern_id) === selected) || [];
  const assignedGuardIds = new Set([...(data?.slots || []), ...(data?.weeklySlots || [])].map((slot) => Number(slot.guard_id)));
  const unassignedGuards = data?.guards.filter((guard) => !assignedGuardIds.has(Number(guard.id))) || [];
  const value = patternSearch.trim().toLowerCase();
  const resources = data ? [
        ...data.posts.map((post) => ({
          key: `post:${post.id}`,
          kind: "post",
          section: String(post.group_name || "POSTOS"),
          label: String(post.name),
          detail: "Posto",
          members: members.filter((member) => Number(member.post_id) === Number(post.id)),
        })),
        ...data.vehicles.map((vehicle) => ({
          key: `vehicle:${vehicle.id}`,
          kind: "vehicle",
          section: "VIATURAS E ZONAS",
          label: String(vehicle.prefix),
          detail: String(vehicle.zone || "Zona não definida"),
          members: members.filter((member) => Number(member.vehicle_id) === Number(vehicle.id)),
        })),
      ].filter((resource) =>
        (showEmpty || resource.members.length > 0) &&
        (!value || `${resource.section} ${resource.label} ${resource.detail} ${resource.members.map((member) => member.guard_name).join(" ")}`.toLowerCase().includes(value)),
      ) : [];
  if (!data || loading)
    return <ModuleLoading area="padrões 12x36" detail="Carregando equipes-base e composição…" />;
  return (
    <main className="patterns-page">
      <header>
        <BackToSchedule date={date} />

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
          {message} <Link href={hrefFor("/")}>Abrir escala →</Link>
        </p>
      )}
      <nav className="pattern-workspaces" aria-label="Tipo de padrão">
        <button className={workspace === "shift" ? "active" : ""} onClick={() => setWorkspace("shift")}><b>Padrões 12x36</b><small>Equipes D1, D2, N1 e N2</small></button>
        <button className={workspace === "weekly" ? "active" : ""} onClick={() => setWorkspace("weekly")}><b>Escala semanal</b><small>Expediente de segunda a sexta</small></button>
      </nav>
      {workspace === "shift" && <>
      <section className="pattern-tabs" aria-label="Equipes-base">
        {data.patterns.map((p) => (
          <button
            className={selected === Number(p.id) ? "active" : ""}
            key={p.id}
            onClick={() => {setSelected(Number(p.id));setMemberEditing(null);setAddDestination(null)}}
          >
            <span className={`pattern-code ${p.period}`}>{p.code}</span>
            <b>{p.name}</b>
            <small>{p.member_count} posições</small>
          </button>
        ))}
      </section>
      <section className="pattern-editor pattern-ideal-editor">
        <header>
          <div>
            <span>{current?.code}</span>
            <h2>Escala ideal — {current?.name}</h2>
            <p>
              Esta é a equipe completa antes de folgas, férias, afastamentos e alterações do dia.
            </p>
          </div>
          <b>{members.length} GMs posicionados</b>
        </header>
        <div className="pattern-map-toolbar">
          <label><span>Buscar na composição</span><input value={patternSearch} onChange={(event)=>setPatternSearch(event.target.value)} placeholder="GM, posto, VTR ou zona…"/></label>
          <label className="pattern-empty-toggle"><input type="checkbox" checked={showEmpty} onChange={(event)=>setShowEmpty(event.target.checked)}/><span>Mostrar postos e VTRs vazios</span></label>
        </div>
        {unassignedGuards.length>0&&<aside className="pattern-unassigned"><div><b>GMs sem posição em nenhum padrão</b><small>Continuam visíveis para não desaparecerem durante a montagem.</small></div><span>{unassignedGuards.length}</span><div>{unassignedGuards.slice(0,12).map((guard)=><small key={String(guard.id)}>{guard.name}</small>)}{unassignedGuards.length>12&&<small>+ {unassignedGuards.length-12} outros</small>}</div></aside>}
        <div className="pattern-map">
          {Array.from(new Set(resources.map((resource)=>resource.section))).map((section)=><section className="pattern-map-section" key={section}><header><b>{section}</b><span>{resources.filter((resource)=>resource.section===section).reduce((sum,resource)=>sum+resource.members.length,0)} GMs</span></header><div className="pattern-resource-grid">{resources.filter((resource)=>resource.section===section).map((resource)=><article className={`pattern-resource ${resource.kind}`} key={resource.key}><header><span aria-hidden="true">{resource.kind==="vehicle"?"🚓":"●"}</span><div><b>{resource.label}</b><small>{resource.detail}</small></div><strong>{resource.members.length}</strong></header><div className="pattern-resource-members">{resource.members.map((member)=>memberEditing===Number(member.id)?<form className="pattern-member-edit" key={String(member.id)} onSubmit={(event)=>saveSlot(event,Number(member.id))}><select name="guardId" defaultValue={String(member.guard_id)} aria-label="GM">{data.guards.map((guard)=><option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select><select name="destination" defaultValue={resource.key} aria-label="Destino">{data.posts.map((post)=><option key={`ep${post.id}`} value={`post:${post.id}`}>{post.group_name} · {post.name}</option>)}{data.vehicles.map((vehicle)=><option key={`ev${vehicle.id}`} value={`vehicle:${vehicle.id}`}>{vehicle.prefix} · {vehicle.zone}</option>)}</select><select name="role" defaultValue={String(member.role)} aria-label="Função"><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option><option value="third">3º integrante</option></select><footer><button type="button" onClick={()=>setMemberEditing(null)}>Cancelar</button><button className="save" disabled={busy}>Salvar</button><button type="button" className="remove-slot" disabled={busy} onClick={()=>confirm(`Remover ${member.guard_name} deste padrão?`)&&action({action:"delete_slot",id:member.id})}>Remover</button></footer></form>:<button type="button" className="pattern-member" key={String(member.id)} onClick={()=>setMemberEditing(Number(member.id))}><span className={`pattern-role ${String(member.role)}`}>{roleLabel(String(member.role))}</span><b>{member.guard_name}</b><small>{member.registration} · clique para editar ou mover</small></button>)}</div>{addDestination===resource.key?<form className="pattern-resource-add" onSubmit={addSlot}><input type="hidden" name="destination" value={resource.key}/><select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{data.guards.filter((guard)=>!members.some((member)=>Number(member.guard_id)===Number(guard.id))).map((guard)=><option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select><select name="role" defaultValue={resource.kind==="vehicle"?"driver":"guard"}><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option><option value="third">3º integrante</option></select><footer><button type="button" onClick={()=>setAddDestination(null)}>Cancelar</button><button className="save" disabled={busy}>Adicionar</button></footer></form>:<button type="button" className="pattern-add-here" onClick={()=>setAddDestination(resource.key)}>+ Adicionar GM neste local</button>}</article>)}</div></section>)}
          {resources.length===0&&<p className="pattern-map-empty">Nenhum destino encontrado. Ative “Mostrar postos e VTRs vazios” ou ajuste a busca.</p>}
        </div>
      </section>
      </>}
      {workspace === "weekly" && <section className="weekly-patterns">
        <header><div><span>SEGUNDA A SEXTA</span><h2>Padrões semanais</h2><p>Horários contínuos ou com intervalo, incluindo extensão diária de hora extra.</p></div><b>{data.weeklySlots.length} integrantes</b></header>
        <div className="weekly-grid weekly-head"><span>GM e destino</span><span>Dias</span><span>Expediente normal</span><span>Intervalo / extensão</span><span>Ações</span></div>
        {data.weeklySlots.map(slot=><form className="weekly-grid" key={String(slot.id)} onSubmit={e=>saveWeekly(e,Number(slot.id))}>
          <div><select name="guardId" defaultValue={String(slot.guard_id)} aria-label="GM semanal">{data.guards.map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)}</option>)}</select><select name="destination" defaultValue={slot.vehicle_id?`vehicle:${slot.vehicle_id}`:`post:${slot.post_id}`} aria-label="Destino semanal">{data.posts.map(p=><option key={`wp${p.id}`} value={`post:${p.id}`}>{String(p.group_name)} · {String(p.name)}</option>)}{data.vehicles.map(v=><option key={`wv${v.id}`} value={`vehicle:${v.id}`}>{String(v.prefix)} · {String(v.zone)}</option>)}</select></div>
          <input name="weekdays" defaultValue={String(slot.weekdays)} aria-label="Dias da semana" title="1=segunda, 5=sexta"/>
          <div className="weekly-times"><input name="startsAt" type="time" defaultValue={String(slot.starts_at)} aria-label="Entrada do expediente" title="Entrada do expediente"/><input name="regularEnd" type="time" defaultValue={String(slot.regular_end)} aria-label="Fim do expediente normal" title="Fim do expediente normal"/></div>
          <div className="weekly-times"><input name="breakStart" type="time" defaultValue={String(slot.break_start||"")} aria-label="Início do intervalo" title="Início do intervalo"/><input name="breakEnd" type="time" defaultValue={String(slot.break_end||"")} aria-label="Fim do intervalo" title="Fim do intervalo"/><input name="overtimeEnd" type="time" defaultValue={String(slot.overtime_end||"")} aria-label="Fim com HE semanal" title="Fim com HE semanal"/></div>
          <div><select name="role" defaultValue={String(slot.role)}><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option></select><button disabled={busy}>Salvar</button><button type="button" className="remove-slot" onClick={()=>confirm(`Remover escala semanal de ${slot.guard_name}?`)&&action({action:"weekly_delete",id:slot.id})}>Remover</button></div>
        </form>)}
        <form className="weekly-add" onSubmit={e=>saveWeekly(e)}><b>Adicionar escala semanal — exemplo: 08:00–12:00 / 13:00–17:00; HE semanal até 19:00</b><select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{data.guards.filter(g=>!data.weeklySlots.some(s=>Number(s.guard_id)===Number(g.id))).map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)} · {String(g.platoon)}</option>)}</select><select name="destination" required defaultValue=""><option value="">Selecione posto ou VTR</option>{data.posts.map(p=><option key={`ap${p.id}`} value={`post:${p.id}`}>{String(p.group_name)} · {String(p.name)}</option>)}{data.vehicles.map(v=><option key={`av${v.id}`} value={`vehicle:${v.id}`}>{String(v.prefix)} · {String(v.zone)}</option>)}</select><input name="weekdays" defaultValue="1,2,3,4,5" aria-label="Dias úteis" title="1=segunda; 5=sexta"/><input name="startsAt" type="time" defaultValue="08:00" aria-label="Entrada" title="Entrada"/><input name="regularEnd" type="time" defaultValue="17:00" aria-label="Fim normal" title="Fim do expediente normal"/><input name="breakStart" type="time" defaultValue="12:00" aria-label="Início do intervalo" title="Início do intervalo"/><input name="breakEnd" type="time" defaultValue="13:00" aria-label="Fim do intervalo" title="Fim do intervalo"/><input name="overtimeEnd" type="time" aria-label="Fim com HE semanal" title="Fim com HE semanal — deixe vazio se não houver HE"/><select name="role"><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option></select><button className="save" disabled={busy}>Adicionar semanal</button></form>
      </section>}
    </main>
  );
}

function roleLabel(role:string){return role==="driver"?"M":role==="patrol"?"P":role==="third"?"3º":"GM"}
