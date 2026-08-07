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
};
const empty: Data = {
  guards: [],
  posts: [],
  vehicles: [],
  movements: [],
  campaign: null,
  days: [],
  choices: [],
};

export function GestaoClient({
  mode,
}: {
  mode: "cadastros" | "folgas" | "movimentos";
}) {
  const [data, setData] = useState<Data>(empty),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(""),
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
  async function reorderSection(groupName: string, direction: "up" | "down") {
    setMessage("");
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "section_reorder", groupName, direction }),
    });
    const j = await r.json();
    setMessage(r.ok ? `Seção ${groupName} movida com sucesso.` : j.error);
    if (r.ok) await load();
  }
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
            </select>
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
          <SectionOrder posts={data.posts} onReorder={(group, direction) => void reorderSection(group, direction)} />
          <GuardImport onImport={(rows) => void importGuards(rows)} />
        </div>
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
        />
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

function SectionOrder({posts,onReorder}:{posts:Item[];onReorder:(group:string,direction:"up"|"down")=>void}) {
  const sections=useMemo(()=>{
    const seen=new Set<string>();
    return posts.map(post=>String(post.group_name||"SEM SEÇÃO")).filter(group=>!seen.has(group)&&Boolean(seen.add(group)));
  },[posts]);
  return <section className="section-order">
    <header><div><small>ORDEM NA ESCALA E NO PDF</small><h3>Seções operacionais</h3></div><span>{sections.length}</span></header>
    <p>Reposicione áreas inteiras. A ordem dos postos dentro de cada área continua ajustável na lista abaixo.</p>
    <div className="section-order-list">{sections.map((group,index)=><div key={group}>
      <b><span>{index+1}</span>{group}</b>
      <span className="record-actions">
        <button disabled={index===0} aria-label={`Mover ${group} para cima`} onClick={()=>onReorder(group,"up")}>↑</button>
        <button disabled={index===sections.length-1} aria-label={`Mover ${group} para baixo`} onClick={()=>onReorder(group,"down")}>↓</button>
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
}: {
  title: string;
  items: Item[];
  main: string;
  detail: string;
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
          </div>
        ))
      )}
    </section>
  );
}

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
              </select>
            </label>
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
