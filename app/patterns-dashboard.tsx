"use client";

import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { issuesForResource, validatePattern } from "../lib/pattern-validation";
import { defaultOperationalGroupStart, operationalGroupAnchorShift, timeAfterHours } from "../lib/operational-group-schedule";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { AppDialog } from "./app-dialog";
import { BackToSchedule, ScheduleNav } from "./schedule-nav";
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
  operationalGroups: Rec[];
  operationalGroupMembers: Rec[];
  patternOperationalGroupMembers: Rec[];
};
type Resource = {
  key: string;
  kind: "post" | "vehicle";
  section: string;
  label: string;
  detail: string;
  type?: string | number | null;
  members: Rec[];
};

const patternCachePrefix = "escala-patterns-cache:";
function readPatternCache(date: string): Data | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${patternCachePrefix}${date}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Data;
    if (!Array.isArray(cached.patterns) || !Array.isArray(cached.slots) || !Array.isArray(cached.guards)) return null;
    return { ...cached, operationalGroups: cached.operationalGroups || [], operationalGroupMembers: cached.operationalGroupMembers || [], patternOperationalGroupMembers: cached.patternOperationalGroupMembers || [] };
  } catch {
    return null;
  }
}
function writePatternCache(date: string, value: Data) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${patternCachePrefix}${date}`, JSON.stringify(value));
  } catch {
    // Cache is optional; storage limits must never interrupt the pattern editor.
  }
}

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
      const normalized = { ...json, operationalGroups: json.operationalGroups || [], operationalGroupMembers: json.operationalGroupMembers || [], patternOperationalGroupMembers: json.patternOperationalGroupMembers || [] } as Data;
      setData(normalized);
      writePatternCache(date, normalized);
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
    const cached = readPatternCache(date);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(cached);
      setLoading(false);
    }
    void load(Boolean(cached));
  }, [date, load]);

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
    const targetVehicle = destination.startsWith("vehicle:")
      ? data!.vehicles.find((vehicle) => Number(vehicle.id) === Number(destination.split(":")[1]))
      : null;
    if (String(targetVehicle?.type || "").toLowerCase() === "moto") role = "driver";
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
      shift: slot.shift || null,
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
  const assignedShiftGuardIds = new Set(data.slots.map((slot) => Number(slot.guard_id)));
  const unassignedGuards = shiftGuards(data.guards).filter(
    (guard) => !assignedShiftGuardIds.has(Number(guard.id)),
  );

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

      <ScheduleNav date={date} active="/padroes" />

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
        <section className="pattern-conventional-focus" aria-label="Padrões convencionais 12x36">
          <header className="pattern-conventional-heading">
            <div><span>PRIORIDADE DA ESCALA</span><h2>Padrões convencionais 12x36</h2><p>Edite aqui a composição-base que será aplicada aos quatro turnos da escala diária.</p></div>
            <strong>D1 · D2 · N1 · N2</strong>
          </header>
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
        </section>
      )}

      {workspace === "weekly" && <WeeklyEditor data={data} busy={busy} onSave={saveWeekly} onDelete={(slot) => confirm(`Remover escala semanal de ${slot.guard_name}?`) && void action({ action: "weekly_delete", id: slot.id })} />}

      <PatternGroupsPanel data={data} busy={busy} onAction={action} />

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
  const issues = validatePattern(members, data.vehicles);
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
            <div className="pattern-resource-members">{resource.members.map((member) => memberEditing === Number(member.id) ? <form className="pattern-member-edit" key={String(member.id)} onSubmit={(event) => onSave(event, Number(member.id))}><select name="guardId" defaultValue={String(member.guard_id)} aria-label="GM">{data.guards.map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select><select name="destination" defaultValue={resource.key} aria-label="Destino"><DestinationOptions data={data} /></select><select name="shift" defaultValue={String(member.shift || "")} aria-label="Turno do período"><option value="">Ambos os turnos</option>{pattern.period === "day" ? <><option value="2">2º turno (07–13)</option><option value="3">3º turno (13–19)</option></> : <><option value="4">4º turno (19–01)</option><option value="1">1º turno (01–07)</option></>}</select><select name="role" defaultValue={String(member.role)} aria-label="Função"><RoleOptions /></select><footer><button type="button" onClick={() => onEdit(null)}>Cancelar</button><button className="save" disabled={busy}>Salvar</button><button type="button" className="remove-slot" disabled={busy} onClick={() => onDelete(member)}>Remover</button></footer></form> : <button type="button" draggable className="pattern-member" key={String(member.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/pattern-slot", String(member.id)); }} onClick={() => onEdit(Number(member.id))}><span className={`pattern-role ${String(member.role)}`}>{roleLabel(String(member.role))}</span><b>{member.guard_name}</b><small>{member.registration} · {member.shift ? shiftLabel(String(member.shift)) : "ambos os turnos"} · arraste ou clique para editar</small></button>)}</div>
            {addDestination === addKey ? <form className="pattern-resource-add" onSubmit={(event) => onAddSlot(event, patternId)}><input type="hidden" name="destination" value={resource.key} /><select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{data.guards.filter((guard) => !members.some((member) => Number(member.guard_id) === Number(guard.id))).map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select><select name="shift" defaultValue="" aria-label="Turno do período"><option value="">Ambos os turnos</option>{pattern.period === "day" ? <><option value="2">2º turno (07–13)</option><option value="3">3º turno (13–19)</option></> : <><option value="4">4º turno (19–01)</option><option value="1">1º turno (01–07)</option></>}</select><select name="role" defaultValue={suggestRole(resource)}><RoleOptions /></select><footer><button type="button" onClick={() => onAdd("")}>Cancelar</button><button className="save" disabled={busy}>Adicionar</button></footer></form> : <button type="button" className="pattern-add-here" onClick={() => onAdd(addKey)}>+ Adicionar GM neste local</button>}
          </article>;
        })}</div></section>)}
        {!resources.length && <p className="pattern-map-empty">Nenhum destino encontrado. Mostre locais vazios ou ajuste a busca.</p>}
      </div>
    </section>
  );
}

function patternVehicleIcon(type: string) {
  return type === "moto" ? "🏍️" : type === "pickup" ? "🛻" : type === "van" ? "🚐" : type === "suv" ? "🚙" : type === "sedan" ? "🚓" : "🚘";
}

function PatternGroupsPanel({ data, busy, onAction }: { data: Data; busy: boolean; onAction: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [patternId, setPatternId] = useState(String(data.patterns[0]?.id || ""));
  const [resourceKind, setResourceKind] = useState<"guard" | "post" | "vehicle">("guard");
  const [resourceId, setResourceId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [teamLabel, setTeamLabel] = useState("");
  const [groupVehicleId, setGroupVehicleId] = useState("");
  const [groupStartAt, setGroupStartAt] = useState(defaultOperationalGroupStart(data.patterns[0]?.period));
  const [scope, setScope] = useState<"pattern" | "global">("pattern");
  const [expanded, setExpanded] = useState(true);
  const activePatternId = data.patterns.some((pattern) => String(pattern.id) === patternId) ? patternId : String(data.patterns[0]?.id || "");
  const selectedPattern = data.patterns.find((pattern) => String(pattern.id) === activePatternId);
  const groupEndsAt = timeAfterHours(groupStartAt, 12);
  const patternMembers = data.patternOperationalGroupMembers.filter((member) => String(member.pattern_id) === activePatternId);
  const resourceOptions = resourceKind === "guard"
    ? data.guards.map((item) => ({ id: item.id, label: `${item.name}${item.registration ? ` · ${item.registration}` : ""}` }))
    : resourceKind === "post"
      ? data.posts.map((item) => ({ id: item.id, label: `${item.name} · ${item.group_name || "Posto"}` }))
      : data.vehicles.map((item) => ({ id: item.id, label: `${item.prefix} · ${item.zone || "Zona não definida"}` }));
  const resourceLabel = (member: Rec) => {
    const source = member.resource_kind === "guard" ? data.guards : member.resource_kind === "post" ? data.posts : data.vehicles;
    const item = source.find((candidate) => Number(candidate.id) === Number(member.resource_id));
    if (!item) return `Recurso ${member.resource_id}`;
    const base = String(item.name || item.prefix);
    if (member.resource_kind === "guard") {
      const vehicle = member.vehicle_id ? data.vehicles.find((candidate) => Number(candidate.id) === Number(member.vehicle_id)) : null;
      const destination = vehicle ? `${patternVehicleIcon(String(vehicle.type || "other"))} ${String(vehicle.prefix || "VTR")}` : "À disposição";
      const schedule = member.starts_at && member.ends_at ? `${String(member.starts_at).slice(0, 5)}–${String(member.ends_at).slice(0, 5)} · 12h` : "jornada integral do padrão";
      return `${base} · ${destination} · ${schedule}`;
    }
    return base;
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const ok = await onAction({
      ...values,
      action: scope === "pattern" ? "pattern_operational_group_member_set" : "operational_group_member_set",
       patternId: scope === "pattern" ? activePatternId : null,
      resourceKind,
      vehicleId: scope === "pattern" && resourceKind === "guard" ? groupVehicleId || null : null,
      shift: scope === "pattern" && resourceKind === "guard" ? operationalGroupAnchorShift(groupStartAt) : null,
      startsAt: scope === "pattern" && resourceKind === "guard" ? groupStartAt : null,
      endsAt: scope === "pattern" && resourceKind === "guard" ? groupEndsAt : null,
    });
    if (ok) { setResourceId(""); setTeamLabel(""); setGroupVehicleId(""); setGroupStartAt(defaultOperationalGroupStart(selectedPattern?.period)); }
  };
  const prepareQuickGuard = (groupIdValue: number, team = "") => {
    setScope("pattern");
    setGroupId(String(groupIdValue));
    setResourceKind("guard");
    setResourceId("");
    setGroupVehicleId("");
    setGroupStartAt(defaultOperationalGroupStart(selectedPattern?.period));
    setTeamLabel(team === "EQUIPE GERAL" ? "" : team);
    window.setTimeout(() => document.querySelector(".pattern-group-link")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };
  const editPatternMember = (member: Rec) => {
    const pattern = data.patterns.find((item) => Number(item.id) === Number(member.pattern_id));
    setPatternId(String(member.pattern_id || activePatternId));
    setScope("pattern");
    setGroupId(String(member.group_id || ""));
    setResourceKind(String(member.resource_kind) as "guard" | "post" | "vehicle");
    setResourceId(String(member.resource_id || ""));
    setTeamLabel(String(member.team_label || ""));
    setGroupVehicleId(String(member.vehicle_id || ""));
    setGroupStartAt(String(member.starts_at || defaultOperationalGroupStart(pattern?.period)).slice(0, 5));
    window.setTimeout(() => document.querySelector(".pattern-group-link")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };
  return <section className={`pattern-groups-panel ${expanded ? "expanded" : "collapsed"}`}>
    <header className="pattern-groups-panel-head">
      <button type="button" className="pattern-groups-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span><small>ORGANIZAÇÃO DA ESCALA IDEAL</small><b>Grupamentos e equipes</b><em>{data.operationalGroups.length} grupamentos · {patternMembers.length} vínculos em {selectedPattern?.code || "padrão"}</em></span>
        <strong>{expanded ? "Recolher" : "Abrir"}</strong>
      </button>
    </header>
    {expanded && <>
      <div className="pattern-groups-scope">
         <label>Padrão que receberá o grupamento<select value={activePatternId} onChange={(event) => { const next = data.patterns.find((pattern) => String(pattern.id) === event.target.value); setPatternId(event.target.value); setGroupStartAt(defaultOperationalGroupStart(next?.period)); }}>{data.patterns.map((pattern) => <option key={String(pattern.id)} value={String(pattern.id)}>{pattern.code} · {pattern.name}</option>)}</select></label>
        <p>Vínculos feitos no padrão selecionado aparecem automaticamente nos dias em que ele for aplicado. O vínculo global serve apenas como identificação comum a todos os padrões.</p>
      </div>
      <div className="pattern-groups-forms">
        <form className="pattern-group-create" onSubmit={(event) => { event.preventDefault(); void onAction({ ...Object.fromEntries(new FormData(event.currentTarget)), action: "operational_group_create" }); }}>
          <h3>Novo grupamento</h3>
          <label>Nome exibido<input name="name" placeholder="Ex.: ROMU" required /></label>
          <div className="two"><label>Sigla curta<input name="shortName" placeholder="ROMU" /></label><label>Cor<input name="color" type="color" defaultValue="#1769aa" /></label></div>
          <label>Ordem<input name="sortOrder" type="number" min="0" defaultValue="99" /></label>
          <button className="save" disabled={busy}>＋ Criar grupamento</button>
        </form>
        <form className="pattern-group-link" onSubmit={(event) => void submit(event)}>
          <h3>Compor o padrão</h3>
          <label>Escopo<select value={scope} onChange={(event) => setScope(event.target.value as "pattern" | "global")}><option value="pattern">Somente {selectedPattern?.code || "padrão selecionado"}</option><option value="global">Todos os padrões</option></select></label>
          <label>Grupamento<select name="groupId" value={groupId} onChange={(event) => setGroupId(event.target.value)} required><option value="">Selecione</option>{data.operationalGroups.map((group) => <option key={String(group.id)} value={String(group.id)}>{group.name}</option>)}</select></label>
          <label>Tipo<select value={resourceKind} onChange={(event) => { setResourceKind(event.target.value as typeof resourceKind); setResourceId(""); setGroupVehicleId(""); }}><option value="guard">GM</option><option value="vehicle">Viatura</option><option value="post">Posto</option></select></label>
          <label>Recurso<select name="resourceId" value={resourceId} onChange={(event) => setResourceId(event.target.value)} required><option value="">Selecione</option>{resourceOptions.map((option) => <option key={String(option.id)} value={String(option.id)}>{option.label}</option>)}</select></label>
          {scope === "pattern" && resourceKind === "guard" && <div className="pattern-group-guard-placement">
            <span className="pattern-group-field-caption">Destino operacional do GM</span>
            <label>VTR do grupamento<select name="vehicleId" value={groupVehicleId} onChange={(event) => setGroupVehicleId(event.target.value)}><option value="">À disposição / selecionar depois</option>{data.vehicles.map((vehicle) => <option key={String(vehicle.id)} value={String(vehicle.id)}>{patternVehicleIcon(String(vehicle.type))} {vehicle.prefix} · {vehicle.zone || "Zona não definida"}</option>)}</select></label>
            <label>Início da jornada de 12h<input name="startsAt" type="time" value={groupStartAt} onChange={(event) => setGroupStartAt(event.target.value)} required /></label>
            <div className="pattern-group-workday-preview"><span>Jornada completa</span><b>{groupStartAt || "—"}–{groupEndsAt || "—"}</b><small>O sistema posiciona o GM em todos os quadrantes alcançados pelo horário, inclusive ao atravessar dia e noite.</small></div>
            <input type="hidden" name="endsAt" value={groupEndsAt} />
            <small>A VTR substitui o destino convencional do padrão. O horário pode começar em qualquer momento e sempre gera uma jornada contínua de 12 horas.</small>
          </div>}
          <label>Equipe interna (opcional)<input name="teamLabel" value={teamLabel} onChange={(event) => setTeamLabel(event.target.value.toUpperCase())} list="pattern-team-options" placeholder="Alfa, Bravo, Charlie…" /><datalist id="pattern-team-options"><option value="ALFA"/><option value="BRAVO"/><option value="CHARLIE"/><option value="DELTA"/><option value="ECHO"/><option value="FOXTROT"/></datalist></label>
          <button className="save" disabled={busy || !resourceId || !groupId}>Vincular ao {scope === "pattern" ? "padrão" : "cadastro geral"}</button>
        </form>
      </div>
      <div className="pattern-group-list">
        {data.operationalGroups.map((group) => {
          const globalMembers = data.operationalGroupMembers.filter((member) => Number(member.group_id) === Number(group.id));
          const contextualMembers = patternMembers.filter((member) => Number(member.group_id) === Number(group.id));
          const visibleMembers = [...contextualMembers, ...globalMembers];
          const teamBuckets = Array.from(visibleMembers.reduce((map, member) => {
            const team = String(member.team_label || "EQUIPE GERAL").trim().toUpperCase() || "EQUIPE GERAL";
            const list = map.get(team) || [];
            list.push(member);
            map.set(team, list);
            return map;
          }, new Map<string, Rec[]>()).entries()).sort(([left], [right]) => left.localeCompare(right, "pt-BR"));
          const groupGuardCount = visibleMembers.filter((member) => String(member.resource_kind) === "guard").length;
          return <article key={String(group.id)} className="pattern-group-card" style={{ borderTopColor: String(group.color || "#1769aa") }}>
            <form onSubmit={(event) => { event.preventDefault(); void onAction({ ...Object.fromEntries(new FormData(event.currentTarget)), action: "operational_group_update", id: group.id }); }}>
              <div className="pattern-group-card-head"><span className="pattern-group-swatch" style={{ background: String(group.color || "#1769aa") }} /><input name="name" defaultValue={String(group.name || "")} aria-label="Nome do grupamento" required /><span>{globalMembers.length + contextualMembers.length} vínculos</span></div>
              <div className="pattern-group-edit-fields"><input name="shortName" defaultValue={String(group.short_name || "")} aria-label="Sigla curta" placeholder="Sigla curta" /><input name="color" type="color" defaultValue={String(group.color || "#1769aa")} aria-label="Cor" /><input name="sortOrder" type="number" defaultValue={String(group.sort_order || 99)} aria-label="Ordem" min="0" /><button disabled={busy}>Salvar</button><button type="button" className="danger-link" disabled={busy} onClick={() => { if (confirm(`Remover o grupamento ${String(group.name)}? Os cadastros não serão apagados.`)) void onAction({ action: "operational_group_delete", id: group.id }); }}>Remover</button></div>
            </form>
            <div className="pattern-group-composition"><header><div><b>Composicao interna</b><small>{teamBuckets.length} equipe(s) · {groupGuardCount} GM(s) neste padrao</small></div><button type="button" onClick={() => prepareQuickGuard(Number(group.id))}>+ GM</button></header>{teamBuckets.length > 0 ? <div className="pattern-group-team-summary">{teamBuckets.map(([team, teamMembers]) => <div key={team}><span><strong>{team}</strong><small>{teamMembers.filter((member) => String(member.resource_kind) === "guard").length} GM(s) · {teamMembers.filter((member) => String(member.resource_kind) !== "guard").length} recurso(s)</small></span><p>{teamMembers.map((member) => resourceLabel(member)).join(" · ")}</p><button type="button" aria-label={`Adicionar GM a equipe ${team}`} onClick={() => prepareQuickGuard(Number(group.id), team)}>+ GM nesta equipe</button></div>)}</div> : <p>Nenhuma equipe interna definida. Use + GM para comecar.</p>}</div>
            <div className="pattern-group-members">
              {contextualMembers.length > 0 && <div className="pattern-group-members-scope"><b>{selectedPattern?.code || "Padrão"}</b>{contextualMembers.map((member) => <span key={`p-${member.id}`}><strong>{resourceLabel(member)}</strong><small>{member.resource_kind === "guard" ? "GM" : member.resource_kind === "post" ? "Posto" : "VTR"}{member.team_label ? ` · Equipe ${member.team_label}` : ""}</small>{member.resource_kind === "guard" && <button type="button" className="edit-member" aria-label={`Editar ${resourceLabel(member)}`} disabled={busy} onClick={() => editPatternMember(member)}>Editar</button>}<button type="button" aria-label={`Remover ${resourceLabel(member)} do padrão`} disabled={busy} onClick={() => void onAction({ action: "pattern_operational_group_member_remove", id: member.id })}>×</button></span>)}</div>}
              {globalMembers.length > 0 && <div className="pattern-group-members-scope global"><b>Todos os padrões</b>{globalMembers.map((member) => <span key={`g-${member.id}`}><strong>{resourceLabel(member)}</strong><small>{member.resource_kind === "guard" ? "GM" : member.resource_kind === "post" ? "Posto" : "VTR"}{member.team_label ? ` · Equipe ${member.team_label}` : ""}</small><button type="button" aria-label={`Remover ${resourceLabel(member)} do cadastro geral`} disabled={busy} onClick={() => void onAction({ action: "operational_group_member_remove", resourceKind: member.resource_kind, resourceId: member.resource_id })}>×</button></span>)}</div>}
              {!globalMembers.length && !contextualMembers.length && <p>Nenhum recurso vinculado ainda.</p>}
            </div>
          </article>;
        })}
      </div>
    </>}
  </section>;
}

function PatternResourceForm({ kind, defaultGroup, busy, onCancel, onSubmit }: { kind: "post" | "vehicle"; defaultGroup: string; busy: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await onSubmit({ ...values, action: kind === "post" ? "add_post" : "add_vehicle" });
  }
  return <form className="pattern-resource-create" onSubmit={(event) => void send(event)}>
    <header><div><b>{kind === "post" ? "Novo posto na composição" : "Nova viatura e zona"}</b><small>O cadastro ficará disponível em todos os padrões e na escala diária.</small></div><button type="button" onClick={onCancel} aria-label="Cancelar criação">×</button></header>
    {kind === "post" ? <div className="pattern-resource-create-fields"><label>Nome do posto<input name="name" placeholder="Ex.: Rodoviária" required /></label><label>Seção<select name="groupName" defaultValue={defaultGroup}><option value={defaultGroup}>{defaultGroup}</option>{["SEDE DA GM", "POSTOS FIXOS", "PRAÇAS E PARQUES", "POSTOS DIVERSOS", "ÁREA DA SAÚDE"].filter((group) => group !== defaultGroup).map((group) => <option key={group} value={group}>{group}</option>)}</select></label><label>Ordem<input name="sortOrder" type="number" min="0" defaultValue="99" /></label></div> : <div className="pattern-resource-create-fields"><label>Prefixo<input name="prefix" placeholder="VTR 0000" required /></label><label>Tipo<select name="type" defaultValue="sedan"><option value="sedan">Sedan</option><option value="pickup">Caminhonete</option><option value="van">Furgão</option><option value="moto">Moto</option><option value="suv">SUV</option><option value="other">Outro</option></select></label><label>Zona de atuação<input name="zone" placeholder="Ex.: Zona B3 Dia" /></label></div>}
    <footer><button type="button" onClick={onCancel}>Cancelar</button><button className="save" disabled={busy}>{busy ? "Salvando…" : kind === "post" ? "Adicionar posto" : "Adicionar viatura"}</button></footer>
  </form>;
}

function PatternPreview({ data, date, dayCode, nightCode, busy, onClose, onApply }: { data: Data; date: string; dayCode: string; nightCode: string; busy: boolean; onClose: () => void; onApply: () => void }) {
  const dayPattern = data.patterns.find((pattern) => pattern.code === dayCode);
  const nightPattern = data.patterns.find((pattern) => pattern.code === nightCode);
  const daySlots = data.slots.filter((slot) => Number(slot.pattern_id) === Number(dayPattern?.id));
  const nightSlots = data.slots.filter((slot) => Number(slot.pattern_id) === Number(nightPattern?.id));
  const allResources = buildResources(data, [...daySlots, ...nightSlots], "", false);
  const issues = [...validatePattern(daySlots, data.vehicles), ...validatePattern(nightSlots, data.vehicles)];
  const formatted = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR");
  return <AppDialog className="pattern-preview-backdrop" onClose={onClose}><section className="pattern-preview" role="dialog" aria-modal="true" aria-labelledby="pattern-preview-title" tabIndex={-1}><header><div><small>PRÉVIA ANTES DE SUBSTITUIR A ESCALA</small><h2 id="pattern-preview-title">Escala de {formatted}</h2><p>{dayCode} no diurno · {nightCode} no noturno · {data.weeklySlots.length} posições semanais também serão consideradas</p></div><button onClick={onClose} aria-label="Fechar prévia">×</button></header><div className="pattern-preview-summary"><span><b>{daySlots.length}</b> diurno</span><span><b>{nightSlots.length}</b> noturno</span><span className={issues.length ? "warn" : "ok"}><b>{issues.length}</b> pendências</span></div><div className="pattern-preview-table"><div className="preview-row preview-head"><b>Posto / VTR</b><b>2º · 07–13</b><b>3º · 13–19</b><b>4º · 19–01</b><b>1º · 01–07</b></div>{allResources.map((resource) => { const day = daySlots.filter((slot) => resourceKey(slot) === resource.key); const night = nightSlots.filter((slot) => resourceKey(slot) === resource.key); return <div className="preview-row" key={resource.key}><div><b>{resource.label}</b><small>{resource.detail}</small></div><PreviewMembers members={membersForShift(day, "2")} /><PreviewMembers members={membersForShift(day, "3")} /><PreviewMembers members={membersForShift(night, "4")} /><PreviewMembers members={membersForShift(night, "1")} /></div>; })}</div><footer><p>{issues.length ? "Existem pendências visuais. Você pode voltar e corrigi-las antes de aplicar." : "A composição está pronta para gerar a escala diária."}</p><button onClick={onClose}>Voltar ao editor</button><button className="save" disabled={busy} onClick={onApply}>{busy ? "Aplicando…" : `Aplicar ${dayCode} + ${nightCode}`}</button></footer></section></AppDialog>;
}

function WeeklyEditor({ data, busy, onSave, onDelete }: { data: Data; busy: boolean; onSave: (event: FormEvent<HTMLFormElement>, id?: number) => void; onDelete: (slot: Rec) => void }) {
  const eligibleGuards = weeklyGuards(data.guards);
  const grouped = [...new Map(data.weeklySlots.map((slot) => {
    const key = slot.vehicle_id ? `vehicle:${slot.vehicle_id}` : `post:${slot.post_id}`;
    return [key, { key, label: weeklyDestinationLabel(slot, data), slots: data.weeklySlots.filter((item) => (item.vehicle_id ? `vehicle:${item.vehicle_id}` : `post:${item.post_id}`) === key) }];
  })).values()];
  return <section className="weekly-patterns">
    <header><div><span>SEGUNDA A SEXTA</span><h2>Padrões semanais</h2><p>Cada GM aparece no destino correspondente, com expediente normal e HE fixa claramente separados.</p></div><b>{data.weeklySlots.length} integrantes</b></header>
    {!data.weeklySlots.length && <div className="weekly-empty">Nenhum GM semanal cadastrado. Use o formulário abaixo para criar o primeiro expediente.</div>}
    <div className="weekly-slot-groups">{grouped.map((group) => <article className="weekly-slot-group" key={group.key}>
      <header><div><span>DESTINO</span><b>{group.label}</b></div><small>{group.slots.length} GM(s)</small></header>
      <div className="weekly-slot-list">{group.slots.map((slot) => <form className="weekly-slot-card" key={String(slot.id)} onSubmit={(event) => onSave(event, Number(slot.id))}>
        <div className="weekly-slot-card-head"><label>GM<select name="guardId" defaultValue={String(slot.guard_id)} aria-label="GM semanal">{eligibleGuards.map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name}</option>)}</select></label><label>Função<select name="role" defaultValue={String(slot.role)}><RoleOptions /></select></label><span className={slot.overtime_end ? "weekly-he-badge" : "weekly-normal-badge"}>{slot.overtime_end ? `HE fixa até ${String(slot.overtime_end)}` : "Sem HE fixa"}</span></div>
        <input type="hidden" name="destination" value={slot.vehicle_id ? `vehicle:${slot.vehicle_id}` : `post:${slot.post_id}`} />
        <div className="weekly-slot-row"><label>Dias úteis<input name="weekdays" defaultValue={String(slot.weekdays)} aria-label="Dias da semana" /></label><label>Entrada<input name="startsAt" type="time" defaultValue={String(slot.starts_at)} aria-label="Entrada" /></label><label>Saída normal<input name="regularEnd" type="time" defaultValue={String(slot.regular_end)} aria-label="Fim normal" /></label></div>
        <div className="weekly-slot-row"><label>Início intervalo<input name="breakStart" type="time" defaultValue={String(slot.break_start || "")} aria-label="Início do intervalo" /></label><label>Fim intervalo<input name="breakEnd" type="time" defaultValue={String(slot.break_end || "")} aria-label="Fim do intervalo" /></label><label className="weekly-he-field">Fim da HE fixa<input name="overtimeEnd" type="time" defaultValue={String(slot.overtime_end || "")} aria-label="Fim com HE semanal" /></label></div>
        <div className="weekly-slot-summary"><span>Normal: {weeklyHoursLabel(slot)}</span>{slot.overtime_end && <strong>+ HE diária fixa: {String(slot.regular_end)}–{String(slot.overtime_end)}</strong>}<button disabled={busy}>Salvar alteração</button><button type="button" className="remove-slot" onClick={() => onDelete(slot)}>Remover</button></div>
      </form>)}</div>
    </article>)}</div>
    <form className="weekly-add" onSubmit={(event) => onSave(event)}><b>Adicionar escala semanal</b><small className="weekly-add-help">Somente GMs definidos como “Semanal” em Cadastros aparecem aqui. Importações de folgas permanecem no efetivo 12x36.</small><label>GM<select name="guardId" required defaultValue=""><option value="">Selecione o GM semanal</option>{eligibleGuards.filter((guard) => !data.weeklySlots.some((slot) => Number(slot.guard_id) === Number(guard.id))).map((guard) => <option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.platoon}</option>)}</select></label><label>Destino<select name="destination" required defaultValue=""><option value="">Selecione posto ou VTR</option><DestinationOptions data={data} /></select></label><label>Dias<input name="weekdays" defaultValue="1,2,3,4,5" aria-label="Dias úteis" /></label><label>Entrada<input name="startsAt" type="time" defaultValue="08:00" aria-label="Entrada" /></label><label>Saída normal<input name="regularEnd" type="time" defaultValue="17:00" aria-label="Fim normal" /></label><label>Início intervalo<input name="breakStart" type="time" defaultValue="12:00" aria-label="Início do intervalo" /></label><label>Fim intervalo<input name="breakEnd" type="time" defaultValue="13:00" aria-label="Fim do intervalo" /></label><label>Fim da HE fixa<input name="overtimeEnd" type="time" aria-label="Fim com HE semanal" /></label><label>Função<select name="role"><RoleOptions /></select></label><button className="save" disabled={busy || eligibleGuards.length === 0}>Adicionar semanal</button></form>
  </section>;
}

function weeklyDestinationLabel(slot: Rec, data: Data) {
  if (slot.vehicle_id) {
    const vehicle = data.vehicles.find((item) => Number(item.id) === Number(slot.vehicle_id));
    return vehicle ? `${vehicle.prefix} · ${vehicle.zone || "Zona não definida"}` : "Viatura";
  }
  const post = data.posts.find((item) => Number(item.id) === Number(slot.post_id));
  return post ? `${post.group_name || "Posto"} · ${post.name}` : "Posto não definido";
}

function weeklyHoursLabel(slot: Rec) {
  const start = String(slot.starts_at || "").slice(0, 5), regular = String(slot.regular_end || "").slice(0, 5);
  const breakStart = String(slot.break_start || "").slice(0, 5), breakEnd = String(slot.break_end || "").slice(0, 5);
  return breakStart && breakEnd ? `${start}–${breakStart} / ${breakEnd}–${regular}` : `${start}–${regular}`;
}

function shiftGuards(guards: Rec[]) {
  return guards.filter((guard) => String(guard.work_regime || "12x36") === "12x36");
}

function weeklyGuards(guards: Rec[]) {
  return guards.filter((guard) => String(guard.work_regime || "12x36") === "weekly");
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
    type: vehicle.type,
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
  if (String(resource.type || "").toLowerCase() === "moto") return "driver";
  if (!resource.members.some((member) => member.role === "driver")) return "driver";
  if (!resource.members.some((member) => member.role === "patrol")) return "patrol";
  return "third";
}

function roleLabel(role: string) {
  return role === "driver" ? "M" : role === "patrol" ? "P" : role === "third" ? "3º" : "GM";
}

function shiftLabel(shift: string) {
  return shift === "2" ? "2º turno" : shift === "3" ? "3º turno" : shift === "4" ? "4º turno" : shift === "1" ? "1º turno" : shift;
}

function membersForShift(members: Rec[], shift: string) {
  return members.filter((member) => !member.shift || String(member.shift) === shift);
}
