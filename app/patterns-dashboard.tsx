"use client";

import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { issuesForResource, validatePattern } from "../lib/pattern-validation";
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
type Resource = {
  key: string;
  kind: "post" | "vehicle";
  section: string;
  label: string;
  detail: string;
  members: Rec[];
};

export function PatternsDashboard() {
  const { date, setDate, hrefFor } = useScheduleDate();
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dayCode, setDayCode] = useState("D1");
  const [nightCode, setNightCode] = useState("N1");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<"shift" | "weekly">("shift");
  const [memberEditing, setMemberEditing] = useState<number | null>(null);
  const [addDestination, setAddDestination] = useState("");
  const [patternSearch, setPatternSearch] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [compare, setCompare] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/patterns?date=${date}&_=${Date.now()}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as Data & { error?: string };
      if (!response.ok || !Array.isArray(json.patterns)) {
        throw new Error(json.error || "Não foi possível consultar os padrões.");
      }
      setData(json);
      setSelected((current) =>
        current && json.patterns.some((pattern) => Number(pattern.id) === current)
          ? current
          : Number(json.patterns[0]?.id || 0),
      );
      setDayCode(json.dayCode || "D1");
      setNightCode(json.nightCode || "N1");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao carregar os padrões.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function action(body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    try {
      const response = await fetch("/api/patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { error?: string; message?: string };
      setMessage(response.ok ? json.message || "Padrão atualizado." : json.error || "Não foi possível salvar.");
      if (response.ok) await load(true);
      return response.ok;
    } catch {
      setMessage("A alteração não foi salva. Tente novamente.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSlot(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    if (await action({ ...Object.fromEntries(new FormData(event.currentTarget)), action: "update_slot", id })) {
      setMemberEditing(null);
    }
  }

  async function addSlot(event: FormEvent<HTMLFormElement>, patternId: number) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await action({ ...Object.fromEntries(new FormData(form)), action: "add_slot", patternId })) {
      form.reset();
      setAddDestination("");
    }
  }

  async function addResource(body: Record<string, unknown>) {
    const ok = await action(body);
    if (ok) setShowEmpty(true);
    return ok;
  }

  async function moveSlot(slotId: number, patternId: number, destination: string) {
    const slot = data?.slots.find((item) => Number(item.id) === slotId);
    if (!slot || busy) return;
    const targetMembers = data!.slots.filter(
      (item) => Number(item.pattern_id) === patternId && resourceKey(item) === destination && Number(item.id) !== slotId,
    );
    let role = String(slot.role || "guard");
    if (destination.startsWith("post:")) role = "guard";
    if (destination.startsWith("vehicle:") && !["driver", "patrol", "third"].includes(role)) {
      role = !targetMembers.some((item) => item.role === "driver")
        ? "driver"
        : !targetMembers.some((item) => item.role === "patrol")
          ? "patrol"
          : "third";
    }
    await action({
      action: "update_slot",
      id: slot.id,
      patternId,
      guardId: slot.guard_id,
      destination,
      role,
    });
  }

  async function saveWeekly(event: FormEvent<HTMLFormElement>, id?: number) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await action({ ...Object.fromEntries(new FormData(form)), action: "weekly_save", id: id || null })) {
      if (!id) form.reset();
    }
  }

  async function applyPreview() {
    if (await action({ action: "apply", date, dayCode, nightCode, confirm: true })) {
      setPreviewOpen(false);
    }
  }

  if (loading && !data) {
    return <ModuleLoading area="padrões 12x36" detail="Carregando equipes-base e composição…" />;
  }
  if (!data) {
    return (
      <main className="patterns-page pattern-load-error">
        <h1>Não foi possível abrir os padrões</h1>
        <p>{loadError || "A consulta não foi concluída."}</p>
        <button onClick={() => void load()}>Tentar novamente</button>
      </main>
    );
  }

  const current = data.patterns.find((pattern) => Number(pattern.id) === selected) || data.patterns[0];
  const samePeriod = data.patterns
    .filter((pattern) => pattern.period === current?.period)
    .sort((a, b) => Number(a.parity) - Number(b.parity));
  const visiblePatterns = compare ? samePeriod : [current];
  const assignedGuardIds = new Set(
    [...data.slots, ...data.weeklySlots].map((slot) => Number(slot.guard_id)),
  );
  const unassignedGuards = data.guards.filter((guard) => !assignedGuardIds.has(Number(guard.id)));

  return (
    <main className="patterns-page">
      <header>
        <BackToSchedule date={date} />
        <div>
          <span>BASE CONFIGURÁVEL DA ESCALA</span>
          <h1>Editor dos padrões</h1>
          <p>Monte a escala ideal, compare equipes e confira o resultado antes de aplicar.</p>
        </div>
      </header>

      <section className="pattern-config">
        <div>
          <label>Data-base do Padrão 1 <input id="anchor-date" type="date" defaultValue={data.anchorDate} /></label>
          <small>Nesta data trabalham D1 e N1; no dia seguinte, D2 e N2.</small>
        </div>
        <button disabled={busy} onClick={() => action({ action: "anchor", anchorDate: (document.getElementById("anchor-date") as HTMLInputElement).value })}>
          Salvar data-base
        </button>
      </section>

      <section className="pattern-apply">
        <div>
          <label>Data da escala <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <p>Sugestão automática: <b>{data.dayCode} + {data.nightCode}</b></p>
        </div>
        <label>Diurno <select value={dayCode} onChange={(event) => setDayCode(event.target.value)}>{data.patterns.filter((pattern) => pattern.period === "day").map((pattern) => <option key={String(pattern.id)} value={String(pattern.code)}>{pattern.code} · {pattern.name}</option>)}</select></label>
        <label>Noturno <select value={nightCode} onChange={(event) => setNightCode(event.target.value)}>{data.patterns.filter((pattern) => pattern.period === "night").map((pattern) => <option key={String(pattern.id)} value={String(pattern.code)}>{pattern.code} · {pattern.name}</option>)}</select></label>
        <button disabled={busy} onClick={() => setPreviewOpen(true)}>Pré-visualizar e aplicar</button>
      </section>

      {message && <p className="pattern-message" role="status">{message} <Link href={hrefFor("/")}>Abrir escala →</Link></p>}

      <nav className="pattern-workspaces" aria-label="Tipo de padrão">
        <button className={workspace === "shift" ? "active" : ""} onClick={() => setWorkspace("shift")}><b>Padrões 12x36</b><small>Equipes D1, D2, N1 e N2</small></button>
        <button className={workspace === "weekly" ? "active" : ""} onClick={() => setWorkspace("weekly")}><b>Escala semanal</b><small>Expediente de segunda a sexta</small></button>
      </nav>

      {workspace === "shift" && (
        <>
          <section className="pattern-tabs" aria-label="Equipes-base">
            {data.patterns.map((pattern) => <button className={selected === Number(pattern.id) ? "active" : ""} key={String(pattern.id)} onClick={() => { setSelected(Number(pattern.id)); setMemberEditing(null); setAddDestination(""); }}><span className={`pattern-code ${pattern.period}`}>{pattern.code}</span><b>{pattern.name}</b><small>{pattern.member_count} posições</small></button>)}
          </section>

          <section className="pattern-editor pattern-ideal-editor">
            <header>
              <div><span>ESCALA IDEAL</span><h2>{compare ? `${samePeriod[0]?.code} × ${samePeriod[1]?.code}` : current?.name}</h2><p>Sem folgas, férias, afastamentos ou alterações específicas do dia.</p></div>
              <button className={`pattern-compare-toggle ${compare ? "active" : ""}`} onClick={() => setCompare((value) => !value)}>{compare ? "Ver uma equipe" : `Comparar ${samePeriod.map((pattern) => pattern.code).join(" × ")}`}</button>
            </header>
            <div className="pattern-map-toolbar">
              <label><span>Buscar na composição</span><input value={patternSearch} onChange={(event) => setPatternSearch(event.target.value)} placeholder="GM, posto, VTR ou zona…" /></label>
              <label className="pattern-empty-toggle"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} /><span>Mostrar locais sem composição</span></label>
            </div>
            {unassignedGuards.length > 0 && <aside className="pattern-unassigned"><div><b>GMs sem posição em nenhum padrão</b><small>Permanecem visíveis para não desaparecerem durante a montagem.</small></div><span>{unassignedGuards.length}</span><div>{unassignedGuards.slice(0, 12).map((guard) => <small key={String(guard.id)}>{guard.name}</small>)}{unassignedGuards.length > 12 && <small>+ {unassignedGuards.length - 12} outros</small>}</div></aside>}
            <div className={`pattern-comparison ${compare ? "is-comparing" : ""}`}>
              {visiblePatterns.map((pattern) => (
                <PatternBoard
                  key={String(pattern.id)}
                  pattern={pattern}
                  data={data}
                  search={patternSearch}
                  showEmpty={showEmpty}
                  busy={busy}
                  memberEditing={memberEditing}
                  addDestination={addDestination}
                  onEdit={setMemberEditing}
                  onAdd={setAddDestination}
                  onSave={saveSlot}
                  onAddSlot={addSlot}
                  onAddResource={addResource}
                  onDelete={(slot) => confirm(`Remover ${slot.guard_name} deste padrão?`) && void action({ action: "delete_slot", id: slot.id })}
                  onMove={moveSlot}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {workspace === "weekly" && <WeeklyEditor data={data} busy={busy} onSave={saveWeekly} onDelete={(slot) => confirm(`Remover escala semanal de ${slot.guard_name}?`) && void action({ action: "weekly_delete", id: slot.id })} />}

      {previewOpen && <PatternPreview data={data} date={date} dayCode={dayCode} nightCode={nightCode} busy={busy} onClose={() => setPreviewOpen(false)} onApply={applyPreview} />}
    </main>
  );
}

function PatternBoard({ pattern, data, search, showEmpty, busy, memberEditing, addDestination, onEdit, onAdd, onSave, onAddSlot, onAddResource, onDelete, onMove }: {
  pattern: Rec;
  data: Data;
  search: string;
  showEmpty: boolean;
  busy: boolean;
  memberEditing: number | null;
  addDestination: string;
  onEdit: (id: number | null) => void;
  onAdd: (key: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>, id: number) => void;
  onAddSlot: (event: FormEvent<HTMLFormElement>, patternId: number) => void;
  onAddResource: (body: Record<string, unknown>) => Promise<boolean>;
  onDelete: (slot: Rec) => void;
  onMove: (slotId: number, patternId: number, destination: string) => void;
}) {
  const [resourceEditing, setResourceEditing] = useState<{ kind: "post" | "vehicle"; section: string } | null>(null);
  const patternId = Number(pattern.id);
  const members = data.slots.filter((slot) => Number(slot.pattern_id) === patternId);
  const resources = buildResources(data, members, search, showEmpty);
  const issues = validatePattern(members);
  const addKeyPrefix = `${patternId}|`;
  const sections = [...new Set(resources.map((resource) => resource.section))];

  return (
    <section className="pattern-board">
      <header><div><span className={`pattern-code ${pattern.period}`}>{pattern.code}</span><div><b>{pattern.name}</b><small>{members.length} GMs posicionados</small></div></div><span className={issues.length ? "pattern-health warning" : "pattern-health ok"}>{issues.length ? `${issues.length} pendência${issues.length > 1 ? "s" : ""}` : "Composição válida"}</span></header>
      <div className="pattern-resource-toolbar"><span><b>Recursos da composição</b><small>Crie um destino e depois use “Adicionar GM neste local”.</small></span><div><button type="button" onClick={() => setResourceEditing({ kind: "post", section: "POSTOS DIVERSOS" })}>＋ Adicionar posto</button><button type="button" onClick={() => setResourceEditing({ kind: "vehicle", section: "VIATURAS E ZONAS" })}>＋ Viatura / zona</button></div></div>
      {resourceEditing && <PatternResourceForm kind={resourceEditing.kind} defaultGroup={resourceEditing.section} busy={busy} onCancel={() => setResourceEditing(null)} onSubmit={async (body) => { const ok = await onAddResource(body); if (ok) setResourceEditing(null); return ok; }} />}
      {issues.length > 0 && <details className="pattern-issues"><summary>Conferir pendências</summary>{issues.map((issue, index) => <p key={`${issue.kind}-${index}`}>{issue.message}</p>)}</details>}
      <div className="pattern-map">
        {sections.map((section) => <section className="pattern-map-section" key={section}><header><div><b>{section}</b><span>{resources.filter((resource) => resource.section === section).reduce((sum, resource) => sum + resource.members.length, 0)} GMs</span></div><div className="pattern-section-actions">{section !== "VIATURAS E ZONAS" && <button type="button" onClick={() => setResourceEditing({ kind: "post", section })}>＋ Posto</button>}{section === "VIATURAS E ZONAS" && <button type="button" onClick={() => setResourceEditing({ kind: "vehicle", section })}>＋ VTR / zona</button>}</div></header><div className="pattern-resource-grid">{resources.filter((resource) => resource.section === section).map((resource) => {
          const resourceIssues = issuesForResource(issues, resource.key);
          const addKey = `${addKeyPrefix}${resource.key}`;
          return <article className={`pattern-resource kind-${resource.kind} ${resourceIssues.length ? "has-warning" : ""}`} key={resource.key} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => dropPatternMember(event, patternId, resource.key, onMove)}>
            <header><span aria-hidden="true">{resource.kind === "vehicle" ? "🚓" : "●"}</span><div><b>{resource.label}</b><small>{resource.detail}</small></div><strong>{resource.members.length}</strong></header>
            {resourceIssues.length > 0 && <div className="pattern-resource-alert">{resourceIssues.map((issue) => issue.message).join(" · ")}</div>}
            <div className="pattern-resource-members">{resource.members.map((member) => memberEditing === Number(member.id) ? <form className="pattern-member-edit" key={String(member.id)} onSubmit={(event) => onSave(event, Number(member.id))}><select name="guardId" defaultValue={String(member.guard_id)} aria-label="GM">{data.guards.map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select><select name="destination" defaultValue={resource.key} aria-label="Destino"><DestinationOptions data={data} /></select><select name="role" defaultValue={String(member.role)} aria-label="Função"><RoleOptions /></select><footer><button type="button" onClick={() => onEdit(null)}>Cancelar</button><button className="save" disabled={busy}>Salvar</button><button type="button" className="remove-slot" disabled={busy} onClick={() => onDelete(member)}>Remover</button></footer></form> : <button type="button" draggable className="pattern-member" key={String(member.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/pattern-slot", String(member.id)); }} onClick={() => onEdit(Number(member.id))}><span className={`pattern-role ${String(member.role)}`}>{roleLabel(String(member.role))}</span><b>{member.guard_name}</b><small>{member.registration} · arraste ou clique para editar</small></button>)}</div>
            {addDestination === addKey ? <form className="pattern-resource-add" onSubmit={(event) => onAddSlot(event, patternId)}><input type="hidden" name="destination" value={resource.key} /><select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{data.guards.filter((guard) => !members.some((member) => Number(member.guard_id) === Number(guard.id))).map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select><select name="role" defaultValue={suggestRole(resource)}><RoleOptions /></select><footer><button type="button" onClick={() => onAdd("")}>Cancelar</button><button className="save" disabled={busy}>Adicionar</button></footer></form> : <button type="button" className="pattern-add-here" onClick={() => onAdd(addKey)}>+ Adicionar GM neste local</button>}
          </article>;
        })}</div></section>)}
        {!resources.length && <p className="pattern-map-empty">Nenhum destino encontrado. Mostre locais vazios ou ajuste a busca.</p>}
      </div>
    </section>
  );
}

function PatternResourceForm({ kind, defaultGroup, busy, onCancel, onSubmit }: { kind: "post" | "vehicle"; defaultGroup: string; busy: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await onSubmit({ ...values, action: kind === "post" ? "add_post" : "add_vehicle" });
  }
  return <form className="pattern-resource-create" onSubmit={(event) => void send(event)}>
    <header><div><b>{kind === "post" ? "Novo posto na composição" : "Nova viatura e zona"}</b><small>O cadastro ficará disponível em todos os padrões e na escala diária.</small></div><button type="button" onClick={onCancel} aria-label="Cancelar criação">×</button></header>
    {kind === "post" ? <div className="pattern-resource-create-fields"><label>Nome do posto<input name="name" placeholder="Ex.: Rodoviária" required /></label><label>Seção<select name="groupName" defaultValue={defaultGroup}><option value={defaultGroup}>{defaultGroup}</option><option value="SEDE DA GM">SEDE DA GM</option><option value="POSTOS FIXOS">POSTOS FIXOS</option><option value="PRAÇAS E PARQUES">PRAÇAS E PARQUES</option><option value="POSTOS DIVERSOS">POSTOS DIVERSOS</option><option value="ÁREA DA SAÚDE">ÁREA DA SAÚDE</option></select></label><label>Ordem<input name="sortOrder" type="number" min="0" defaultValue="99" /></label></div> : <div className="pattern-resource-create-fields"><label>Prefixo<input name="prefix" placeholder="VTR 0000" required /></label><label>Tipo<select name="type" defaultValue="sedan"><option value="sedan">Sedan</option><option value="pickup">Caminhonete</option><option value="van">Furgão</option><option value="moto">Moto</option><option value="suv">SUV</option><option value="other">Outro</option></select></label><label>Zona de atuação<input name="zone" placeholder="Ex.: Zona B3 Dia" /></label></div>}
    <footer><button type="button" onClick={onCancel}>Cancelar</button><button className="save" disabled={busy}>{busy ? "Salvando…" : kind === "post" ? "Adicionar posto" : "Adicionar viatura"}</button></footer>
  </form>;
}

function PatternPreview({ data, date, dayCode, nightCode, busy, onClose, onApply }: { data: Data; date: string; dayCode: string; nightCode: string; busy: boolean; onClose: () => void; onApply: () => void }) {
  const dayPattern = data.patterns.find((pattern) => pattern.code === dayCode);
  const nightPattern = data.patterns.find((pattern) => pattern.code === nightCode);
  const daySlots = data.slots.filter((slot) => Number(slot.pattern_id) === Number(dayPattern?.id));
  const nightSlots = data.slots.filter((slot) => Number(slot.pattern_id) === Number(nightPattern?.id));
  const allResources = buildResources(data, [...daySlots, ...nightSlots], "", false);
  const issues = [...validatePattern(daySlots), ...validatePattern(nightSlots)];
  const formatted = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR");
  return <div className="pattern-preview-backdrop"><section className="pattern-preview" role="dialog" aria-modal="true" aria-labelledby="pattern-preview-title"><header><div><small>PRÉVIA ANTES DE SUBSTITUIR A ESCALA</small><h2 id="pattern-preview-title">Escala de {formatted}</h2><p>{dayCode} no diurno · {nightCode} no noturno · {data.weeklySlots.length} posições semanais também serão consideradas</p></div><button onClick={onClose} aria-label="Fechar prévia">×</button></header><div className="pattern-preview-summary"><span><b>{daySlots.length}</b> diurno</span><span><b>{nightSlots.length}</b> noturno</span><span className={issues.length ? "warn" : "ok"}><b>{issues.length}</b> pendências</span></div><div className="pattern-preview-table"><div className="preview-row preview-head"><b>Posto / VTR</b><b>2º · 07–13</b><b>3º · 13–19</b><b>4º · 19–01</b><b>1º · 01–07</b></div>{allResources.map((resource) => { const day = daySlots.filter((slot) => resourceKey(slot) === resource.key); const night = nightSlots.filter((slot) => resourceKey(slot) === resource.key); return <div className="preview-row" key={resource.key}><div><b>{resource.label}</b><small>{resource.detail}</small></div><PreviewMembers members={day} /><PreviewMembers members={day} /><PreviewMembers members={night} /><PreviewMembers members={night} /></div>; })}</div><footer><p>{issues.length ? "Existem pendências visuais. Você pode voltar e corrigi-las antes de aplicar." : "A composição está pronta para gerar a escala diária."}</p><button onClick={onClose}>Voltar ao editor</button><button className="save" disabled={busy} onClick={onApply}>{busy ? "Aplicando…" : `Aplicar ${dayCode} + ${nightCode}`}</button></footer></section></div>;
}

function WeeklyEditor({ data, busy, onSave, onDelete }: { data: Data; busy: boolean; onSave: (event: FormEvent<HTMLFormElement>, id?: number) => void; onDelete: (slot: Rec) => void }) {
  return <section className="weekly-patterns"><header><div><span>SEGUNDA A SEXTA</span><h2>Padrões semanais</h2><p>Expediente, intervalo e extensão diária de hora extra.</p></div><b>{data.weeklySlots.length} integrantes</b></header><div className="weekly-grid weekly-head"><span>GM e destino</span><span>Dias</span><span>Expediente normal</span><span>Intervalo / extensão</span><span>Ações</span></div>{data.weeklySlots.map((slot) => <form className="weekly-grid" key={String(slot.id)} onSubmit={(event) => onSave(event, Number(slot.id))}><div><select name="guardId" defaultValue={String(slot.guard_id)} aria-label="GM semanal">{data.guards.map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name}</option>)}</select><select name="destination" defaultValue={slot.vehicle_id ? `vehicle:${slot.vehicle_id}` : `post:${slot.post_id}`} aria-label="Destino semanal"><DestinationOptions data={data} /></select></div><input name="weekdays" defaultValue={String(slot.weekdays)} aria-label="Dias da semana" /><div className="weekly-times"><input name="startsAt" type="time" defaultValue={String(slot.starts_at)} aria-label="Entrada" /><input name="regularEnd" type="time" defaultValue={String(slot.regular_end)} aria-label="Fim normal" /></div><div className="weekly-times"><input name="breakStart" type="time" defaultValue={String(slot.break_start || "")} aria-label="Início do intervalo" /><input name="breakEnd" type="time" defaultValue={String(slot.break_end || "")} aria-label="Fim do intervalo" /><input name="overtimeEnd" type="time" defaultValue={String(slot.overtime_end || "")} aria-label="Fim com HE semanal" /></div><div><select name="role" defaultValue={String(slot.role)}><RoleOptions /></select><button disabled={busy}>Salvar</button><button type="button" className="remove-slot" onClick={() => onDelete(slot)}>Remover</button></div></form>)}<form className="weekly-add" onSubmit={(event) => onSave(event)}><b>Adicionar escala semanal</b><select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{data.guards.filter((guard) => !data.weeklySlots.some((slot) => Number(slot.guard_id) === Number(guard.id))).map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.platoon}</option>)}</select><select name="destination" required defaultValue=""><option value="">Selecione posto ou VTR</option><DestinationOptions data={data} /></select><input name="weekdays" defaultValue="1,2,3,4,5" aria-label="Dias úteis" /><input name="startsAt" type="time" defaultValue="08:00" aria-label="Entrada" /><input name="regularEnd" type="time" defaultValue="17:00" aria-label="Fim normal" /><input name="breakStart" type="time" defaultValue="12:00" aria-label="Início do intervalo" /><input name="breakEnd" type="time" defaultValue="13:00" aria-label="Fim do intervalo" /><input name="overtimeEnd" type="time" aria-label="Fim com HE semanal" /><select name="role"><RoleOptions /></select><button className="save" disabled={busy}>Adicionar semanal</button></form></section>;
}

function DestinationOptions({ data }: { data: Data }) {
  return <>{data.posts.map((post) => <option key={`p${post.id}`} value={`post:${post.id}`}>{post.group_name} · {post.name}</option>)}{data.vehicles.map((vehicle) => <option key={`v${vehicle.id}`} value={`vehicle:${vehicle.id}`}>{vehicle.prefix} · {vehicle.zone}</option>)}</>;
}

function RoleOptions() {
  return <><option value="guard">GM do posto</option><option value="driver">Motorista</option><option value="patrol">Patrulheiro</option><option value="third">3º integrante</option></>;
}

function PreviewMembers({ members }: { members: Rec[] }) {
  return <div className={members.length ? "preview-members" : "preview-members empty"}>{members.length ? members.map((member) => <span key={String(member.id)}><i>{roleLabel(String(member.role))}</i>{member.guard_name}</span>) : <small>FURO / sem composição</small>}</div>;
}

function buildResources(data: Data, members: Rec[], search: string, showEmpty: boolean): Resource[] {
  const value = search.trim().toLowerCase();
  const posts: Resource[] = data.posts.map((post) => ({
    key: `post:${post.id}`,
    kind: "post",
    section: String(post.group_name || "POSTOS"),
    label: String(post.name),
    detail: "Posto",
    members: members.filter((member) => Number(member.post_id) === Number(post.id)),
  }));
  const vehicles: Resource[] = data.vehicles.map((vehicle) => ({
    key: `vehicle:${vehicle.id}`,
    kind: "vehicle",
    section: "VIATURAS E ZONAS",
    label: String(vehicle.prefix),
    detail: String(vehicle.zone || "Zona não definida"),
    members: members.filter((member) => Number(member.vehicle_id) === Number(vehicle.id)),
  }));
  return [...posts, ...vehicles].filter((resource) => {
    if (!showEmpty && resource.members.length === 0) return false;
    if (!value) return true;
    const haystack = `${resource.section} ${resource.label} ${resource.detail} ${resource.members.map((member) => member.guard_name).join(" ")}`;
    return haystack.toLowerCase().includes(value);
  });
}

function dropPatternMember(event: DragEvent<HTMLElement>, patternId: number, destination: string, onMove: (slotId: number, patternId: number, destination: string) => void) {
  event.preventDefault();
  const slotId = Number(event.dataTransfer.getData("text/pattern-slot"));
  if (slotId) onMove(slotId, patternId, destination);
}

function resourceKey(slot: Rec) {
  return Number(slot.vehicle_id) ? `vehicle:${slot.vehicle_id}` : Number(slot.post_id) ? `post:${slot.post_id}` : "unassigned";
}

function suggestRole(resource: Resource) {
  if (resource.kind === "post") return "guard";
  if (!resource.members.some((member) => member.role === "driver")) return "driver";
  if (!resource.members.some((member) => member.role === "patrol")) return "patrol";
  return "third";
}

function roleLabel(role: string) {
  return role === "driver" ? "M" : role === "patrol" ? "P" : role === "third" ? "3º" : "GM";
}
