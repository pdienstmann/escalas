"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FullPageLink as Link } from "./full-page-link";
type Item = Record<string, string | number | null>;
type Data = {
  guards: Item[];
  posts: Item[];
  vehicles: Item[];
  movements: Item[];
  campaign: Item | null;
  days: Item[];
  choices: Item[];
  vehicleOutages: Item[];
  sections: Item[];
};
const empty: Data = {
  guards: [],
  posts: [],
  vehicles: [],
  movements: [],
  campaign: null,
  days: [],
  choices: [],
  vehicleOutages: [],
  sections: [],
};

export function GestaoClient({
  mode,
}: {
  mode: "cadastros" | "folgas" | "movimentos";
}) {
  const [data, setData] = useState<Data>(empty),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(""),
    [movementEditing,setMovementEditing]=useState<Item|null>(null),
    [editing, setEditing] = useState<{
      kind: "guard" | "post" | "vehicle";
      item: Item;
    } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin?_=${Date.now()}`, { cache: "no-store" });
    setData(await r.json());
    setBusy(false);
  }, []);
  useEffect(() => {
    // The first request synchronizes this client view with the durable D1 state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setMessage("");
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, action }),
    });
    const j = await r.json();
    setMessage(
      r.ok
        ? j.status === "waitlist"
          ? "Limite atingido: solicitação incluída na lista de espera."
          : "Registro salvo com sucesso."
        : j.error,
    );
    if (r.ok) {
      form.reset();
      if (action === "movement" && j.movement) {
        setData((current) => ({
          ...current,
          movements: [j.movement, ...current.movements].slice(0, 30),
        }));
        return;
      }
      if (action === "leave") {
        const date = String(body.date);
        const guard = data.guards.find(
          (item) => Number(item.id) === Number(body.guardId),
        );
        setData((current) => ({
          ...current,
          choices: [
            ...current.choices,
            {
              id: Number(j.choiceId),
              guard_id: Number(body.guardId),
              guard_name: String(guard?.name || "GM"),
              date,
              category: String(body.category),
              status: String(j.status),
            },
          ],
          days: current.days.map((day) =>
            day.date === date && j.status === "confirmed"
              ? { ...day, used: Number(day.used) + 1 }
              : day,
          ),
        }));
        return;
      }
      await load();
    }
  }
  async function catalogSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        id: editing.item.id,
        entity: editing.kind,
        action: "catalog_update",
      }),
    });
    const j = await r.json();
    setMessage(r.ok ? "Cadastro atualizado com sucesso." : j.error);
    if (r.ok) {
      setEditing(null);
      await load();
    }
  }
  async function deactivate(kind: "guard" | "post" | "vehicle", item: Item) {
    if (!confirm(`Desativar ${String(item.name || item.prefix)}?`)) return;
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "catalog_deactivate",
        entity: kind,
        id: item.id,
      }),
    });
    const j = await r.json();
    setMessage(r.ok ? "Cadastro desativado." : j.error);
    if (r.ok) await load();
  }
  async function reorderPost(item: Item, direction: "up" | "down") {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "post_reorder", id: item.id, direction }),
    });
    const j = await r.json();
    setMessage(r.ok ? "Ordem da escala atualizada." : j.error);
    if (r.ok) await load();
  }
  async function reorderSection(sectionKey: string, direction: "up" | "down") {
    setMessage("");
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "section_reorder", sectionKey, direction }),
    });
    const j = await r.json();
    setMessage(r.ok ? "Ordem das seções atualizada." : j.error);
    if (r.ok) await load();
  }
  async function renameSection(section:Item){const label=prompt("Nome exibido da seção:",String(section.label||""));if(!label?.trim())return;const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"section_update",sectionKey:section.section_key,label:label.trim()})});const j=await r.json();setMessage(r.ok?"Seção atualizada.":j.error);if(r.ok)await load()}
  async function importGuards(rows: Array<{ registration: string; name: string; platoon: string; baseShift: string }>) {
    setMessage("");
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "guard_import", rows }),
    });
    const j = await r.json();
    setMessage(r.ok ? `${j.count} GMs importados ou atualizados.` : j.error);
    if (r.ok) await load();
  }
  async function choiceAction(
    action: "leave_approve" | "leave_cancel",
    id: Item["id"],
  ) {
    setMessage("");
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id }),
    });
    const j = await r.json();
    setMessage(
      r.ok
        ? action === "leave_approve"
          ? "Folga aprovada e integrada à escala."
          : "Solicitação cancelada."
        : j.error,
    );
    if (r.ok) await load();
  }
  async function deleteOutage(id:Item["id"]){if(!confirm("Retirar o registro de FA e disponibilizar novamente a viatura?"))return;const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"vehicle_outage_delete",id})});const j=await r.json();setMessage(r.ok?"Viatura novamente disponível.":j.error);if(r.ok)await load()}
  async function movementAction(action:"movement_update"|"movement_delete",body:Record<string,string|number|null>) {
    if(action==="movement_delete"&&!confirm("Remover esta movimentação? A escala será recalculada imediatamente."))return;
    setMessage("");
    const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,action})});
    const j=await r.json();
    setMessage(r.ok?(action==="movement_delete"?"Movimentação removida.":"Movimentação atualizada."):j.error);
    if(r.ok){setMovementEditing(null);await load()}
  }
  if (busy)
    return (
      <div className="module-shell">
        <p>Carregando dados da escala…</p>
      </div>
    );
  if (mode === "cadastros")
    return (
      <Module
        title="Cadastros operacionais"
        subtitle="Pessoas, postos e viaturas alimentam a mesma escala diária."
      >
        <div className="forms-grid">
          <Form title="Novo GM" onSubmit={(e) => submit(e, "guard")}>
            <input name="registration" placeholder="Matrícula" required />
            <input name="name" placeholder="Nome de escala" required />
            <input name="platoon" placeholder="Pelotão" />
            <select name="baseShift">
              <option>12x36 dia</option>
              <option>12x36 noite</option>
              <option>Semanal</option>
            </select>
            <select name="workRegime"><option value="12x36">Plantão 12x36</option><option value="weekly">Semanal</option></select>
          </Form>
          <Form title="Novo posto" onSubmit={(e) => submit(e, "post")}>
            <input name="name" placeholder="Nome do posto" required />
            <input
              name="groupName"
              placeholder="Seção / grupo"
              defaultValue="SEDE DA GM"
              required
            />
            <input name="sortOrder" type="number" placeholder="Ordem" />
          </Form>
          <Form title="Nova viatura" onSubmit={(e) => submit(e, "vehicle")}>
            <input name="prefix" placeholder="VTR 0000" required />
            <select name="type">
              <option value="sedan">Sedan</option>
              <option value="pickup">Caminhonete</option>
              <option value="van">Furgão</option>
              <option value="moto">Moto</option>
              <option value="suv">SUV</option>
            </select>
            <input name="zone" placeholder="Zona de atuação" />
          </Form>
        </div>
        <div className="catalog-tools">
          <SectionOrder sections={data.sections} onReorder={(key, direction) => void reorderSection(key, direction)} onRename={(section)=>void renameSection(section)} />
          <GuardImport onImport={(rows) => void importGuards(rows)} />
        </div>
        <FleetAvailability vehicles={data.vehicles} outages={data.vehicleOutages} onSubmit={(e)=>submit(e,"vehicle_outage")} onDelete={(id)=>void deleteOutage(id)}/>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <div className="records">
          <Record
            kind="guard"
            title="Guardas"
            items={data.guards}
            main="name"
            detail="registration"
            onEdit={(item) => setEditing({ kind: "guard", item })}
            onDeactivate={deactivate}
          />
          <Record
            kind="post"
            title="Postos e seções"
            items={data.posts}
            main="name"
            detail="group_name"
            onEdit={(item) => setEditing({ kind: "post", item })}
            onDeactivate={deactivate}
            onReorder={reorderPost}
          />
          <Record
            kind="vehicle"
            title="Viaturas"
            items={data.vehicles}
            main="prefix"
            detail="zone"
            onEdit={(item) => setEditing({ kind: "vehicle", item })}
            onDeactivate={deactivate}
          />
        </div>
        {editing && (
          <CatalogEditor
            editing={editing}
            onClose={() => setEditing(null)}
            onSubmit={catalogSubmit}
          />
        )}
      </Module>
    );
  if (mode === "movimentos")
    return (
      <Module
        title="Movimentações do efetivo"
        subtitle="Afastamentos aprovados retiram o GM da escala e abrem o furo correspondente."
      >
        <Form
          title="Novo afastamento ou ajuste"
          onSubmit={(e) => submit(e, "movement")}
        >
          <GuardSelect guards={data.guards} />
          <select name="type">
            <option value="day_off">Folga</option>
            <option value="vacation">Férias</option>
            <option value="course">Curso</option>
            <option value="medical_leave">Atestado / licença</option>
            <option value="technical_reserve">Reserva técnica</option>
            <option value="time_bank">Banco de horas</option>
            <option value="swap">Troca de serviço</option>
          </select>
          <input name="startsAt" type="datetime-local" required />
          <input name="endsAt" type="datetime-local" required />
          <input name="requestRef" placeholder="Nº do requerimento" />
          <input name="notes" placeholder="Observação" />
        </Form>
        {message && <p className="notice">{message}</p>}
        <SimpleRecords
          title="Registros recentes"
          items={data.movements}
          main="guard_name"
          detail="type"
          onEdit={setMovementEditing}
          onDelete={(item)=>void movementAction("movement_delete",{id:item.id})}
        />
        {movementEditing&&<MovementEditor item={movementEditing} guards={data.guards} onClose={()=>setMovementEditing(null)} onSubmit={(body)=>void movementAction("movement_update",body)}/>}
      </Module>
    );
  const campaign = data.campaign;
  return (
    <Module
      title={String(campaign?.title || "Folgas mensais")}
      subtitle="Cada GM escolhe uma data útil e uma data de fim de semana. A capacidade é atualizada automaticamente."
    >
      <div className="leave-layout">
        <Form title="Registrar escolha" onSubmit={(e) => submit(e, "leave")}>
          <input
            type="hidden"
            name="campaignId"
            value={String(campaign?.id || "")}
          />
          <GuardSelect guards={data.guards} />
          <select name="category">
            <option value="weekday">Folga durante a semana</option>
            <option value="weekend">Folga no fim de semana</option>
          </select>
          <select name="date" required>
            <option value="">Selecione uma data</option>
            {data.days.map((d) => (
              <option key={String(d.date)} value={String(d.date)}>
                {formatDate(d.date)} · {Number(d.capacity) - Number(d.used)}{" "}
                vagas
              </option>
            ))}
          </select>
        </Form>
        <section className="capacity">
          <h3>Capacidade por dia</h3>
          {data.days.map((d) => (
            <div key={String(d.date)}>
              <span>{formatDate(d.date)}</span>
              <progress value={Number(d.used)} max={Number(d.capacity)} />
              <b>
                {d.used}/{d.capacity}
              </b>
            </div>
          ))}
        </section>
      </div>
      {message && <p className="notice">{message}</p>}
      <LeaveRecords
        items={data.choices}
        onAction={(action, id) => void choiceAction(action, id)}
      />
    </Module>
  );
}

function SectionOrder({sections,onReorder,onRename}:{sections:Item[];onReorder:(key:string,direction:"up"|"down")=>void;onRename:(section:Item)=>void}) {
  return <section className="section-order">
    <header><div><small>ORDEM NA ESCALA E NO PDF</small><h3>Seções operacionais</h3></div><span>{sections.length}</span></header>
    <p>Reposicione áreas inteiras. A ordem dos postos dentro de cada área continua ajustável na lista abaixo.</p>
    <div className="section-order-list">{sections.map((section,index)=><div key={String(section.section_key)}>
      <b><span>{index+1}</span>{String(section.label)}</b>
      <span className="record-actions">
        <button aria-label={`Renomear ${section.label}`} onClick={()=>onRename(section)}>Editar</button>
        <button disabled={index===0} aria-label={`Mover ${section.label} para cima`} onClick={()=>onReorder(String(section.section_key),"up")}>↑</button>
        <button disabled={index===sections.length-1} aria-label={`Mover ${section.label} para baixo`} onClick={()=>onReorder(String(section.section_key),"down")}>↓</button>
      </span>
    </div>)}</div>
  </section>
}

function GuardImport({onImport}:{onImport:(rows:Array<{registration:string;name:string;platoon:string;baseShift:string}>)=>Promise<void>|void}) {
  const [raw,setRaw]=useState("");
  const [sending,setSending]=useState(false);
  const rows=useMemo(()=>raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,index)=>{
    const parts=(line.includes("\t")?line.split("\t"):line.split(/[;,]/)).map(value=>value.trim());
    return {registration:parts[0]||"",name:parts[1]||"",platoon:parts[2]||"",baseShift:parts[3]||"12x36 dia",index};
  }).filter((row,index)=>!(index===0&&/matr[ií]cula|registro/i.test(`${row.registration} ${row.name}`))).filter(row=>row.registration&&row.name),[raw]);
  async function send(){if(!rows.length)return;setSending(true);await onImport(rows.map(({registration,name,platoon,baseShift})=>({registration,name,platoon,baseShift})));setSending(false);setRaw("")}
  return <section className="import-panel">
    <header><div><small>SUBSTITUIÇÃO GRADUAL DOS DADOS</small><h3>Importar GMs</h3></div><span>{rows.length} válidos</span></header>
    <p>Cole diretamente do Excel ou Google Planilhas: matrícula, nome, equipe e regime. A matrícula identifica e atualiza um cadastro existente.</p>
    <textarea value={raw} onChange={event=>setRaw(event.target.value)} rows={6} placeholder={"Matrícula\tNome de escala\tEquipe\t12x36 dia\n12345\tSILVA\tD1\t12x36 dia"}/>
    {rows.length>0&&<div className="import-preview"><b>Pré-visualização</b>{rows.slice(0,3).map(row=><span key={`${row.registration}-${row.index}`}><strong>{row.registration}</strong>{row.name}<small>{row.platoon||"Sem equipe"} · {row.baseShift}</small></span>)}{rows.length>3&&<em>+ {rows.length-3} linhas</em>}</div>}
    <button className="save" disabled={!rows.length||sending} onClick={()=>void send()}>{sending?"Importando…":`Confirmar importação${rows.length?` (${rows.length})`:""}`}</button>
  </section>
}
const formatDate = (value: string | number | null) =>
  new Date(String(value) + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
function GuardSelect({ guards }: { guards: Item[] }) {
  return (
    <select name="guardId" required>
      <option value="">Selecione o GM</option>
      {guards.map((g) => (
        <option key={g.id} value={String(g.id)}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
function Module({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="module-shell">
      <header>
        <Link href="/">← Voltar à escala</Link>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      {children}
    </main>
  );
}
function Form({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <form className="data-form" onSubmit={onSubmit}>
      <h3>{title}</h3>
      {children}
      <button className="save">Salvar</button>
    </form>
  );
}
function Record({
  kind,
  title,
  items,
  main,
  detail,
  onEdit,
  onDeactivate,
  onReorder,
}: {
  kind: "guard" | "post" | "vehicle";
  title: string;
  items: Item[];
  main: string;
  detail: string;
  onEdit: (item: Item) => void;
  onDeactivate: (kind: "guard" | "post" | "vehicle", item: Item) => void;
  onReorder?: (item: Item, direction: "up" | "down") => void;
}) {
  return (
    <section className="record-list">
      <h3>
        {title}
        <span>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p>Nenhum registro.</p>
      ) : (
        items.map((i, n) => (
          <div key={String(i.id ?? n)}>
            <b>{String(i[main] ?? "")}</b>
            <small>{String(i[detail] ?? "")}</small>
            <span className="record-actions">
              {kind === "post" && onReorder && (
                <>
                  <button
                    aria-label="Mover posto para cima"
                    onClick={() => onReorder(i, "up")}
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Mover posto para baixo"
                    onClick={() => onReorder(i, "down")}
                  >
                    ↓
                  </button>
                </>
              )}
              <button onClick={() => onEdit(i)}>Editar</button>
              <button
                className="danger-link"
                onClick={() => onDeactivate(kind, i)}
              >
                Desativar
              </button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}

function SimpleRecords({
  title,
  items,
  main,
  detail,
  onEdit,
  onDelete,
}: {
  title: string;
  items: Item[];
  main: string;
  detail: string;
  onEdit?:(item:Item)=>void;
  onDelete?:(item:Item)=>void;
}) {
  return (
    <section className="record-list">
      <h3>
        {title}
        <span>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p>Nenhum registro.</p>
      ) : (
        items.map((item, index) => (
          <div key={String(item.id ?? index)}>
            <b>{String(item[main] ?? "")}</b>
            <small>
              {movementLabel(String(item[detail] ?? ""))} ·{" "}
              {movementPeriod(item)}
              {item.request_ref ? ` · Req. ${item.request_ref}` : ""}
            </small>
            {(onEdit||onDelete)&&<span className="record-actions">{onEdit&&<button onClick={()=>onEdit(item)}>Editar</button>}{onDelete&&<button className="danger-link" onClick={()=>onDelete(item)}>Remover</button>}</span>}
          </div>
        ))
      )}
    </section>
  );
}

function MovementEditor({item,guards,onClose,onSubmit}:{item:Item;guards:Item[];onClose:()=>void;onSubmit:(body:Record<string,string|number|null>)=>void}) {
  function send(e:FormEvent<HTMLFormElement>){e.preventDefault();onSubmit({id:item.id,...Object.fromEntries(new FormData(e.currentTarget))} as Record<string,string|number|null>)}
  return <div className="catalog-backdrop" role="presentation"><form className="catalog-editor" onSubmit={send}>
    <header><div><small>EDITAR MOVIMENTAÇÃO</small><h2>{String(item.guard_name)}</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
    <label>GM<select name="guardId" defaultValue={String(item.guard_id)} required>{guards.map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)}</option>)}</select></label>
    <label>Tipo<select name="type" defaultValue={String(item.type)}><option value="day_off">Folga</option><option value="vacation">Férias</option><option value="course">Curso</option><option value="medical_leave">Atestado / licença</option><option value="technical_reserve">Reserva técnica</option><option value="time_bank">Banco de horas</option><option value="swap">Troca de serviço</option></select></label>
    <label>Início<input name="startsAt" type="datetime-local" defaultValue={toLocalInput(item.starts_at)} required/></label>
    <label>Fim<input name="endsAt" type="datetime-local" defaultValue={toLocalInput(item.ends_at)} required/></label>
    <label>Nº do requerimento<input name="requestRef" defaultValue={String(item.request_ref||"")}/></label>
    <label>Observação<input name="notes" defaultValue={String(item.notes||"")}/></label>
    <button className="save">Salvar alteração</button>
  </form></div>
}
function toLocalInput(value:Item[string]){const text=String(value||"");return text.length>=16?text.slice(0,16):text}

function LeaveRecords({
  items,
  onAction,
}: {
  items: Item[];
  onAction: (action: "leave_approve" | "leave_cancel", id: Item["id"]) => void;
}) {
  return (
    <section className="record-list leave-records">
      <h3>
        Escolhas registradas<span>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p>Nenhuma escolha registrada.</p>
      ) : (
        items.map((item) => (
          <div key={String(item.id)}>
            <b>{String(item.guard_name)}</b>
            <small>
              {formatDate(item.date)} ·{" "}
              {item.category === "weekday" ? "dia útil" : "fim de semana"}
            </small>
            <span className={`choice-status ${item.status}`}>
              {item.status === "confirmed" ? "APROVADA" : "LISTA DE ESPERA"}
            </span>
            <span className="record-actions">
              {item.status === "waitlist" && (
                <button onClick={() => onAction("leave_approve", item.id)}>
                  Aprovar
                </button>
              )}
              <button
                className="danger-link"
                onClick={() => onAction("leave_cancel", item.id)}
              >
                Cancelar
              </button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}

function movementLabel(type: string) {
  return (
    (
      {
        day_off: "Folga",
        vacation: "Férias",
        course: "Curso",
        medical_leave: "Atestado / licença",
        technical_reserve: "Reserva técnica",
        time_bank: "Banco de horas",
        swap: "Troca de serviço",
      } as Record<string, string>
    )[type] || type
  );
}
function movementPeriod(item: Item) {
  const start = new Date(String(item.starts_at)),
    end = new Date(String(item.ends_at));
  return `${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`;
}
function FleetAvailability({vehicles,outages,onSubmit,onDelete}:{vehicles:Item[];outages:Item[];onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onDelete:(id:Item["id"])=>void}){
  return <section className="fleet-status"><header><div><small>DISPONIBILIDADE EM TEMPO REAL</small><h3>Viaturas em funcionamento / FA</h3></div><span>{outages.length} em FA</span></header><div className="fleet-layout"><form className="data-form" onSubmit={onSubmit}><select name="vehicleId" required defaultValue=""><option value="">Selecionar viatura</option>{vehicles.map(v=><option key={String(v.id)} value={String(v.id)}>{String(v.prefix)} · {String(v.type)}</option>)}</select><label>Início do FA<input name="startsOn" type="date" required/></label><label>Retorno previsto — opcional<input name="endsOn" type="date"/></label><input name="reason" placeholder="Motivo / observação"/><button className="save">Registrar em FA</button></form><div className="fleet-list">{outages.length?outages.map(o=><article key={String(o.id)}><span className="fleet-icon">{vehicleIconLabel(String(o.type))}</span><div><b>{String(o.prefix)}</b><small>FA desde {formatDate(o.starts_on)}{o.ends_on?` até ${formatDate(o.ends_on)}`:" · prazo indeterminado"}</small>{o.reason&&<em>{String(o.reason)}</em>}</div><button onClick={()=>onDelete(o.id)}>Disponibilizar</button></article>):<p>Todas as viaturas estão disponíveis.</p>}</div></div></section>
}
const vehicleIconLabel=(type:string)=>type==="moto"?"🏍️":type==="pickup"?"🛻":type==="van"?"🚐":type==="suv"?"🚙":"🚓";
function CatalogEditor({
  editing,
  onClose,
  onSubmit,
}: {
  editing: { kind: "guard" | "post" | "vehicle"; item: Item };
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const i = editing.item;
  return (
    <div className="catalog-backdrop" role="presentation">
      <form className="catalog-editor" onSubmit={onSubmit}>
        <header>
          <div>
            <small>EDITAR CADASTRO</small>
            <h2>{String(i.name || i.prefix)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        {editing.kind === "guard" && (
          <>
            <label>
              Matrícula
              <input
                name="registration"
                defaultValue={String(i.registration || "")}
                required
              />
            </label>
            <label>
              Nome de escala
              <input name="name" defaultValue={String(i.name || "")} required />
            </label>
            <label>
              Equipe / pelotão
              <input name="platoon" defaultValue={String(i.platoon || "")} />
            </label>
            <label>
              Regime
              <select
                name="baseShift"
                defaultValue={String(i.base_shift || "12x36 dia")}
              >
                <option>12x36 dia</option>
                <option>12x36 noite</option>
                <option>Semanal</option>
              </select>
            </label>
            <label>Tipo de escala<select name="workRegime" defaultValue={String(i.work_regime||"12x36")}><option value="12x36">Plantão 12x36</option><option value="weekly">Semanal</option></select></label>
          </>
        )}
        {editing.kind === "post" && (
          <>
            <label>
              Nome do local
              <input name="name" defaultValue={String(i.name || "")} required />
            </label>
            <label>
              Seção da escala
              <input
                name="groupName"
                defaultValue={String(i.group_name || "")}
                required
              />
            </label>
            <label>
              Ordem
              <input
                name="sortOrder"
                type="number"
                defaultValue={String(i.sort_order || 99)}
              />
            </label>
          </>
        )}
        {editing.kind === "vehicle" && (
          <>
            <label>
              Prefixo
              <input
                name="prefix"
                defaultValue={String(i.prefix || "")}
                required
              />
            </label>
            <label>
              Tipo
              <select name="type" defaultValue={String(i.type || "sedan")}>
                <option value="sedan">Sedan</option>
                <option value="pickup">Caminhonete</option>
                <option value="van">Furgão</option>
                <option value="moto">Moto</option>
                <option value="suv">SUV</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <label>
              Zona de atuação
              <input name="zone" defaultValue={String(i.zone || "")} />
            </label>
          </>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="save">Salvar mudanças</button>
        </footer>
      </form>
    </div>
  );
}
