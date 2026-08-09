"use client";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { ScheduleNav } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";
import { formatScheduleDate } from "../lib/schedule-date";
import { orderScheduleResources } from "../lib/schedule-sections";
import {
  groupRedeploymentAssignments,
  mergeScheduleAssignments,
  type RedeploymentGroup,
} from "../lib/schedule-state";
import { suggestionPosition, type SuggestionPosition } from "../lib/suggestion-position";
import {
  formatHoursDuration,
  fullPeriodLabel,
  fullPeriodWindow,
  isDayShift,
  shiftTimes,
  SHIFT_DEFS,
} from "../lib/shift-rules";
import { HoleSuggestBox } from "./hole-suggest-box";
import {
  DragEvent,
  FormEvent,
  Fragment,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
type Rec = Record<string, string | number | null>;
type State = {
  date: string;
  schedule: Rec;
  guards: Rec[];
  posts: Rec[];
  vehicles: Rec[];
  allVehicles: Rec[];
  outages: Rec[];
  assignments: Rec[];
  removed: Rec[];
  movements: Rec[];
  notices: Rec[];
  sections: Rec[];
  availableForRedeployment: Rec[];
  patternLabel?: string;
};
type Pick = {
  kind: "post" | "vehicle";
  resource: Rec;
  shift: string;
  assignment?: Rec;
  manualAdd?: boolean;
};
type HolePick = {
  kind: "post" | "vehicle";
  resource: Rec;
  shift: string;
  role: string | null;
  position: SuggestionPosition | null;
};
type RedeployPick = { assignments: Rec[] };
type ViewFilter = "all" | "day" | "night" | "holes" | "redeploy";
const shifts = SHIFT_DEFS;
function times(date: string, shift: string) {
  return shiftTimes(date, shift);
}
function assignmentKey(kind: "post" | "vehicle", resourceId: string | number, shift: string) {
  return `${kind}:${resourceId}:${shift}`;
}
export function LiveSchedule() {
  const { date, setDate, hrefFor } = useScheduleDate();
  const [data, setData] = useState<State | null>(null),
    [pick, setPick] = useState<Pick | null>(null),
    [holePick, setHolePick] = useState<HolePick | null>(null),
    [redeployPick, setRedeployPick] = useState<RedeployPick | null>(null),
    [vehicleEdit, setVehicleEdit] = useState<Rec | null>(null),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [view, setView] = useState<ViewFilter>("all"),
    [collapsed, setCollapsed] = useState<Record<string, boolean>>({}),
    [saving, setSaving] = useState(false),
    [loadError, setLoadError] = useState("");
  const loadSequence=useRef(0);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const load = useCallback(async () => {
    const sequence=++loadSequence.current;
    try {
      setPick(null);
      setData(null);
      setLoadError("");
      const r = await fetch(`/api/schedule?date=${date}&_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error();
      const value=await r.json();
      if(sequence===loadSequence.current)setData(value);
    } catch {
      if(sequence===loadSequence.current){
        setLoadError("Não foi possível consultar a escala. Recarregue a página para tentar novamente.");
        setMessage("Não foi possível consultar a escala. Recarregue a página para tentar novamente.");
      }
    }
  }, [date]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const assignmentIndex = useMemo(() => {
    const map = new Map<string, Rec[]>();
    if (!data) return map;
    for (const a of data.assignments) {
      for (const s of shifts) {
        if (!belongsToShift(a, s.id)) continue;
        if (a.post_id != null) {
          const key = assignmentKey("post", Number(a.post_id), s.id);
          const list = map.get(key) || [];
          list.push(a);
          map.set(key, list);
        }
        if (a.vehicle_id != null) {
          const key = assignmentKey("vehicle", Number(a.vehicle_id), s.id);
          const list = map.get(key) || [];
          list.push(a);
          map.set(key, list);
        }
      }
    }
    return map;
  }, [data]);
  const redeploymentGroups = useMemo(
    () => groupRedeploymentAssignments(data?.availableForRedeployment || []),
    [data?.availableForRedeployment],
  );
  const resources = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase().trim();
    return orderScheduleResources(data.vehicles, data.posts, data.sections).filter((x) => {
      const text = `${x.r.name || ""} ${x.r.prefix || ""} ${x.r.zone || ""} ${x.r.group_name || ""} ${x.section}`
        .toLowerCase();
      if (q && !text.includes(q)) {
        const hasGuard = shifts.some((s) =>
          (assignmentIndex.get(assignmentKey(x.kind, Number(x.r.id), s.id)) || []).some((a) =>
            String(a.guard_name || "").toLowerCase().includes(q),
          ),
        );
        if (!hasGuard) return false;
      }
      if (view === "holes") {
        return shifts.some((s) => {
          const list = assignmentIndex.get(assignmentKey(x.kind, Number(x.r.id), s.id)) || [];
          return list.length < (x.kind === "vehicle" ? 2 : 1);
        });
      }
      return true;
    });
  }, [assignmentIndex, data, query, view]);
  async function postAssignment(body: Record<string, unknown>) {
    if (saving) return false;
    setSaving(true);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setMessage(r.ok ? (j.message || "Alteração salva e já exibida na escala.") : j.error);
      if (r.ok) {
        const changedAssignments: Rec[] = Array.isArray(j.assignments)
          ? j.assignments
          : j.assignment
            ? [j.assignment]
            : [];
        if (j.reload && changedAssignments.length === 0 && !j.deletedId) {
          await load();
        } else {
          setData((current) =>
            current
              ? {
                  ...current,
                  ...mergeScheduleAssignments(
                    current.assignments,
                    current.availableForRedeployment,
                    changedAssignments,
                    Number(j.deletedId || 0),
                  ),
                }
              : current,
          );
        }
        setPick(null);
        setHolePick(null);
        setRedeployPick(null);
      }
      return r.ok;
    } finally {
      setSaving(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !pick) return;
    const body = Object.fromEntries(new FormData(e.currentTarget)),
      [destination, id] = String(body.destination).split(":");
    const fillingHole = !pick.assignment && !pick.manualAdd;
    const t = fillingHole
      ? fullPeriodWindow(data.date, String(body.shift || pick.shift))
      : { start: String(body.startsAt), end: String(body.endsAt) };
    await postAssignment({
      ...body,
      startsAt: fillingHole ? t.start : body.startsAt,
      endsAt: fillingHole ? t.end : body.endsAt,
      fillFullPeriod: fillingHole,
      id: pick.assignment?.id || null,
      scheduleId: data.schedule.id,
      postId: destination === "post" ? Number(id) : null,
      vehicleId: destination === "vehicle" ? Number(id) : null,
    });
  }
  async function remove() {
    if (!pick?.assignment) return;
    await postAssignment({
      action: "delete",
      id: Number(pick.assignment.id),
    });
  }
  async function confirmHoleSuggestion(guardId: number) {
    if (!data || !holePick) return;
    const t = fullPeriodWindow(data.date, holePick.shift);
    const role =
      holePick.role ||
      (holePick.kind === "vehicle" ? "driver" : "guard");
    await postAssignment({
      fillFullPeriod: true,
      scheduleId: data.schedule.id,
      guardId,
      postId: holePick.kind === "post" ? Number(holePick.resource.id) : null,
      vehicleId: holePick.kind === "vehicle" ? Number(holePick.resource.id) : null,
      shift: holePick.shift,
      role,
      startsAt: t.start,
      endsAt: t.end,
      status: "overtime",
      reassignmentNote: "Sugestão inteligente para preenchimento de furo",
    });
  }
  function openHoleSuggest(
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    if (!data) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const list = assignmentIndex.get(assignmentKey(kind, Number(resource.id), shift)) || [];
    const missingRole =
      kind === "vehicle" ? (list.length === 0 ? "driver" : "patrol") : "guard";
    setHolePick({
      kind,
      resource,
      shift,
      role: missingRole,
      position: suggestionPosition(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    });
    setPick(null);
  }
  function jumpToManualEditor() {
    if (!holePick) return;
    setPick({
      kind: holePick.kind,
      resource: holePick.resource,
      shift: holePick.shift,
    });
    setHolePick(null);
  }
  function startManualAdd() {
    const resource = data?.posts[0] || data?.vehicles[0];
    if (!resource || !data) return;
    const kind = data.posts.some((post) => Number(post.id) === Number(resource.id))
      ? "post"
      : "vehicle";
    setPick({
      kind,
      resource,
      shift: view === "night" ? "4" : "2",
      manualAdd: true,
    });
    setHolePick(null);
  }
  async function move(
    assignment: Rec,
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
  ) {
    if (!data) return;
    const t = times(data.date, shift),
      sameShift = String(assignment.shift) === shift,
      currentCount = data.assignments.filter(
        (a) =>
          (kind === "post"
            ? a.post_id === resource.id
            : a.vehicle_id === resource.id) && a.shift === shift,
      ).length;
    await postAssignment({
      id: assignment.id,
      scheduleId: data.schedule.id,
      guardId: assignment.guard_id,
      postId: kind === "post" ? resource.id : null,
      vehicleId: kind === "vehicle" ? resource.id : null,
      shift,
      role:
        kind === "post" ? "guard" : currentCount === 0 ? "driver" : "patrol",
      startsAt: sameShift ? assignment.starts_at : t.start,
      endsAt: sameShift ? assignment.ends_at : t.end,
      status: assignment.status,
      requestRef: assignment.request_ref || null,
      isReassigned: 1,
      reassignmentNote: assignment.reassignment_note || "Remanejamento na escala",
    });
  }
  async function saveRedeployment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !redeployPick) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const [kind, resourceId] = String(body.destination).split(":");
    const resource = (kind === "vehicle" ? data.vehicles : data.posts).find(
      (item) => Number(item.id) === Number(resourceId),
    );
    if (!resource) return;
    await moveGroup(
      redeployPick.assignments,
      kind === "vehicle" ? "vehicle" : "post",
      resource,
    );
  }
  async function moveGroup(
    assignments: Rec[],
    kind: "post" | "vehicle",
    resource: Rec,
  ) {
    if (!data || !assignments.length) return;
    await postAssignment({
      action: "redeploy_group",
      assignmentIds: assignments.map((assignment) => Number(assignment.id)),
      scheduleId: data.schedule.id,
      postId: kind === "post" ? Number(resource.id) : null,
      vehicleId: kind === "vehicle" ? Number(resource.id) : null,
    });
  }
  async function saveVehicleQuick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !vehicleEdit || saving) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setSaving(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "vehicle_quick_update",
          scheduleId: data.schedule.id,
          fromVehicleId: vehicleEdit.id,
          toVehicleId: Number(body.toVehicleId),
          zone: String(body.zone || ""),
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (!response.ok) return;
      const changedAssignments: Rec[] = result.assignments || [];
      setData((current) => {
        if (!current) return current;
        const merged = mergeScheduleAssignments(
          current.assignments,
          current.availableForRedeployment,
          changedAssignments,
        );
        const updateVehicle = (vehicle: Rec) =>
          Number(vehicle.id) === Number(result.vehicle.id)
            ? { ...vehicle, ...result.vehicle }
            : vehicle;
        return {
          ...current,
          ...merged,
          vehicles: current.vehicles.map(updateVehicle),
          allVehicles: current.allVehicles.map(updateVehicle),
        };
      });
      setVehicleEdit(null);
    } finally {
      setSaving(false);
    }
  }
  // Hooks must stay above any early return.
  const movementGroups = useMemo(() => {
    const groups = [
      { key: "technical_reserve", label: "Reserva técnica", types: ["technical_reserve"] },
      { key: "day_off", label: "Folgas", types: ["day_off"] },
      { key: "vacation", label: "Férias", types: ["vacation"] },
      { key: "course", label: "Cursos", types: ["course"] },
      { key: "medical_leave", label: "Licenças/atestados", types: ["medical_leave"] },
      { key: "adjustments", label: "Banco de horas / Trocas", types: ["time_bank", "swap"] },
    ];
    if (!data) return [];
    return groups
      .map((g) => ({
        ...g,
        items: data.movements.filter((m) => g.types.includes(String(m.type))),
      }))
      .filter((g) => g.items.length > 0);
  }, [data]);
  if (!data)
    return (
      <ModuleLoading
        area="escala operacional"
        detail={loadError || "Aplicando padrões, afastamentos e disponibilidade das viaturas…"}
      />
    );
  const holes = resources.reduce(
    (sum, x) =>
      sum +
      shifts.filter((s) => {
        const list = assignmentIndex.get(assignmentKey(x.kind, Number(x.r.id), s.id)) || [];
        return list.length < (x.kind === "vehicle" ? 2 : 1);
      }).length,
    0,
  );
  const visibleShifts =
    view === "day"
      ? shifts.filter((s) => s.period === "day")
      : view === "night"
        ? shifts.filter((s) => s.period === "night")
        : shifts;
  function jump(target: "day" | "night" | "pending") {
    if (target === "day") setView("day");
    if (target === "night") setView("night");
    if (target === "pending") setView(data.availableForRedeployment.length ? "redeploy" : "holes");
    requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  const showRedeploy = view === "all" || view === "redeploy";
  const showTable = view !== "redeploy";

  return (
    <main className="app compact">
      <header className="topbar">
        <div className="brand">
          <span className="crest">GM</span>
          <div>
            <b>Escala diária</b>
            <small>{formatScheduleDate(data.date)} · {data.patternLabel}</small>
          </div>
        </div>
        <div className="date">
          <input
            aria-label="Data da escala"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="stats">
          <span>
            <b>{data.assignments.length}</b> escalados
          </span>
          <span className="warn">
            <b>{data.removed.length}</b> afastados
          </span>
          <span className="danger">
            <b>{holes}</b> furos
          </span>
        </div>
        <Link className="primary top-action" href={hrefFor("/validacao")}>
          Validar e publicar
        </Link>
      </header>
      <ScheduleNav date={date} active="/" />
      <section className="toolbar">
        <strong>Escala de {formatScheduleDate(data.date)}</strong>
        <span className="pattern-confirm">Padrão: {data.patternLabel}</span>
        <span className="sync">● sincronizado</span>
        <div className="seg toolbar-seg" role="group" aria-label="Atalhos da escala">
          <button type="button" className={view==="all"?"active":""} onClick={()=>setView("all")}>Tudo</button>
          <button type="button" className={view==="day"?"active":""} onClick={()=>jump("day")}>Diurno</button>
          <button type="button" className={view==="night"?"active":""} onClick={()=>jump("night")}>Noturno</button>
          <button type="button" className={view==="holes"||view==="redeploy"?"active":""} onClick={()=>jump("pending")}>Pendências</button>
        </div>
        <button type="button" className="toolbar-add" onClick={startManualAdd}>
          + Adicionar GM
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar posto, VTR, zona ou GM…"
        />
        <Link className="toolbar-link" href={hrefFor("/impressao")}>
          Gerar PDF
        </Link>
      </section>
      {data.notices?.length > 0 && (
        <section className="daily-notices">
          <b>Alterações previstas para esta data</b>
          {data.notices.map((n) => (
            <span key={n.id}>{n.title}</span>
          ))}
          <Link href={hrefFor("/alteracoes")}>Conferir</Link>
        </section>
      )}

      {message && (
        <div className="schedule-toast" role="status">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      <div className="workspace">
        <section className="schedule-wrap">
          <div className="drag-help">
            Arraste um GM para outra célula ou clique para editar. Ao preencher um furo diurno, o GM é escalado no turno inteiro (07:00–19:00).
          </div>
          {showTable && (
          <table className="schedule" ref={tableRef}>
            <thead>
              <tr>
                <th rowSpan={2}>POSTO / RECURSO</th>
                {visibleShifts.some((s)=>s.period==="day") && (
                  <th colSpan={visibleShifts.filter((s)=>s.period==="day").length}>DIURNO</th>
                )}
                {visibleShifts.some((s)=>s.period==="night") && (
                  <th colSpan={visibleShifts.filter((s)=>s.period==="night").length}>NOTURNO</th>
                )}
              </tr>
              <tr>
                {visibleShifts.map((s) => (
                  <th key={s.id}>
                    {s.label} · {s.time}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map(({ kind, r, section }, index) => {
                const first = index === 0 || resources[index - 1].section !== section;
                const isCollapsed = Boolean(collapsed[section]);
                if (isCollapsed && !first) return null;
                return (
                <Row
                  key={`${kind}-${r.id}`}
                  kind={kind}
                  resource={r}
                  section={section}
                  first={first}
                  collapsed={isCollapsed}
                  onToggleSection={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [section]: !current[section],
                    }))
                  }
                  shifts={visibleShifts}
                  assignmentIndex={assignmentIndex}
                  availableForRedeployment={data.availableForRedeployment}
                  redeploymentGroups={redeploymentGroups}
                  selectedId={Number(pick?.assignment?.id || 0)}
                  onPick={setPick}
                  onMove={move}
                  onMoveGroup={moveGroup}
                  onHolePick={openHoleSuggest}
                  onEditVehicle={setVehicleEdit}
                />
              );
              })}
            </tbody>
          </table>
          )}
          <section className="movement-grid compact-movements">
            <h2>Efetivo retirado automaticamente</h2>
            <p>
              Movimentações aprovadas não aparecem nos postos e deixam o furo
              visível.
            </p>
            {movementGroups.length ? (
              <div className="movement-groups">
                {movementGroups.map((group) => (
                  <article key={group.key} className="movement-group">
                    <header>
                      <b>{group.label}</b>
                      <span>{group.items.length}</span>
                    </header>
                    <div>
                      {group.items.map((m) => (
                        <span key={String(m.id)}>
                          <strong>{m.guard_name}</strong>
                          <small>
                            {movementDetail(m)}
                            {m.request_ref ? ` · Req. ${m.request_ref}` : ""}
                          </small>
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>Nenhum afastamento nesta data.</p>
            )}
          </section>
          {showRedeploy && data.availableForRedeployment.length > 0 && (
            <section className="redeployment-pool">
              <header><div><span>VIATURA INDISPONÍVEL</span><h2>GMs à disposição para remanejamento</h2><p>Cada card reúne os dois horários do mesmo período. Ao mover, ambos seguem juntos.</p></div><b title={`${data.availableForRedeployment.length} horários`}>{redeploymentGroups.length}</b></header>
              <div>{redeploymentGroups.map((group) => (
                <article key={group.key} draggable onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/assignment", String(group.assignments[0].id));
                  event.dataTransfer.setData("text/assignment-group", group.assignments.map((assignment) => assignment.id).join(","));
                }}>
                  <span className="redeploy-drag" aria-hidden="true">⋮⋮</span>
                  <div><b>{group.guardName}</b><small>{redeploymentTimeLabel(group.assignments)} · {group.period === "day" ? "Diurno · 2º + 3º" : "Noturno · 4º + 1º"}</small></div>
                  <button type="button" onClick={() => setRedeployPick({ assignments: group.assignments })}>Escolher destino</button>
                </article>
              ))}</div>
            </section>
          )}
        </section>
        <aside className={`editor ${pick ? "editor-active" : ""}`}>
          {pick ? (
            <Editor
              key={String(
                pick.assignment?.id ||
                  `${pick.kind}-${pick.resource.id}-${pick.shift}-${pick.manualAdd ? "manual" : "hole"}`,
              )}
              pick={pick}
              data={data}
              saving={saving}
              onClose={() => setPick(null)}
              onSave={save}
              onRemove={remove}
            />
          ) : (
            <div className="empty">
              <h2>Edição rápida</h2>
              <p>
                Selecione um GM ou uma vaga. Ao clicar em um furo, aparece a
                sugestão inteligente de GMs.
              </p>
            </div>
          )}
        </aside>
      </div>
      {holePick && (
        <>
          <button
            type="button"
            className="hole-suggest-backdrop"
            aria-label="Fechar sugestões"
            onClick={() => setHolePick(null)}
          />
          <HoleSuggestBox
            key={`${holePick.kind}-${holePick.resource.id}-${holePick.shift}-${holePick.role}`}
            date={data.date}
            shift={holePick.shift}
            postId={holePick.kind === "post" ? Number(holePick.resource.id) : null}
            vehicleId={holePick.kind === "vehicle" ? Number(holePick.resource.id) : null}
            role={holePick.role}
            resourceLabel={
              holePick.kind === "vehicle"
                ? String(holePick.resource.prefix)
                : String(holePick.resource.name)
            }
            position={holePick.position}
            busy={saving}
            onPick={confirmHoleSuggestion}
            onManual={jumpToManualEditor}
            onClose={() => setHolePick(null)}
          />
        </>
      )}
      {vehicleEdit && (
        <VehicleQuickEditor
          data={data}
          vehicle={vehicleEdit}
          saving={saving}
          onClose={() => setVehicleEdit(null)}
          onSave={saveVehicleQuick}
        />
      )}
      {redeployPick && (
        <RedeployQuickEditor
          data={data}
          assignments={redeployPick.assignments}
          saving={saving}
          onClose={() => setRedeployPick(null)}
          onSave={saveRedeployment}
        />
      )}
    </main>
  );
}

function RedeployQuickEditor({data,assignments,saving,onClose,onSave}:{data:State;assignments:Rec[];saving:boolean;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}) {
  const [query,setQuery]=useState("");
  const assignment=assignments[0];
  const destinations=useMemo(()=>{
    const value=query.toLowerCase().trim();
    const items=[
      ...data.posts.map(resource=>({kind:"post",resource,label:String(resource.name),detail:String(resource.group_name||"Posto")})),
      ...data.vehicles.map(resource=>({kind:"vehicle",resource,label:String(resource.prefix),detail:String(resource.zone||"Zona não definida")})),
    ];
    return items.filter(item=>!value||`${item.label} ${item.detail}`.toLowerCase().includes(value));
  },[data.posts,data.vehicles,query]);
  const defaultDestination=destinations[0];
  return <div className="redeploy-quick-backdrop"><form className="redeploy-quick-editor" role="dialog" aria-modal="true" aria-labelledby="redeploy-title" onSubmit={onSave}>
    <header><div><small>REMANEJAMENTO DO PERÍODO COMPLETO</small><h2 id="redeploy-title">{String(assignment.guard_name)}</h2><p>{redeploymentTimeLabel(assignments)} · {assignments.length} horários vinculados</p></div><button type="button" onClick={onClose} aria-label="Fechar remanejamento">×</button></header>
    <div className="redeploy-alert"><b>Os horários serão movidos juntos</b><span>Funções e horários de cada metade serão preservados.</span></div>
    <label>Buscar posto, viatura ou zona<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Ex.: Sala de Operações, VTR 1337, Centro…" /></label>
    <label>Destino<select name="destination" key={defaultDestination?`${defaultDestination.kind}-${defaultDestination.resource.id}`:"empty"} required>{destinations.length?destinations.map(item=><option key={`${item.kind}-${item.resource.id}`} value={`${item.kind}:${item.resource.id}`}>{item.kind==="vehicle"?vehicleIcon(String(item.resource.type)):"◆"} {item.label} — {item.detail}</option>):<option value="">Nenhum destino encontrado</option>}</select></label>
    <p className="redeploy-help">Também é possível fechar esta janela e arrastar o card para qualquer célula do mesmo período. O destino receberá todas as metades exibidas acima.</p>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving||!destinations.length}>{saving?"Movendo…":"Confirmar remanejamento"}</button></footer>
  </form></div>;
}

function redeploymentTimeLabel(assignments:Rec[]){return assignments.map(assignment=>`${String(assignment.starts_at).slice(11,16)}–${String(assignment.ends_at).slice(11,16)}`).join(" + ")}

function movementDetail(m: Rec) {
  const start = new Date(String(m.starts_at));
  const end = new Date(String(m.ends_at));
  const date = (value: Date) => value.toLocaleDateString("pt-BR");
  const time = (value: Date) =>
    value.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (m.type === "medical_leave") return `Afastado até ${date(end)}`;
  if (m.type === "vacation" || m.type === "course")
    return `Período: ${date(start)} a ${date(end)}`;
  if (m.type === "day_off" || m.type === "technical_reserve")
    return `Dia ${date(start)}`;
  return `${date(start)} · ${time(start)}–${time(end)}`;
}
function VehicleQuickEditor({data,vehicle,saving,onClose,onSave}:{data:State;vehicle:Rec;saving:boolean;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}) {
  const[selectedId,setSelectedId]=useState(String(vehicle.id));
  const[zone,setZone]=useState(String(vehicle.zone||""));
  const occupiedIds=new Set([
    ...data.assignments.map(assignment=>Number(assignment.vehicle_id||0)),
    ...data.availableForRedeployment.map(assignment=>Number(assignment.vehicle_id||0)),
  ]);
  const outageIds=new Set(data.outages.map(outage=>Number(outage.vehicle_id)));
  const crewNames=[...new Set(data.assignments.filter(assignment=>Number(assignment.vehicle_id)===Number(vehicle.id)).map(assignment=>String(assignment.guard_name)))];
  function availability(candidate:Rec){
    if(Number(candidate.id)===Number(vehicle.id))return"VTR atual";
    if(outageIds.has(Number(candidate.id)))return"Em FA";
    if(occupiedIds.has(Number(candidate.id)))return"Em serviço";
    return"Disponível";
  }
  return <div className="vehicle-quick-backdrop"><form className="vehicle-quick-editor" role="dialog" aria-modal="true" aria-labelledby="vehicle-quick-title" onSubmit={onSave}>
    <header><div><small>EDIÇÃO NA PRÓPRIA ESCALA</small><h2 id="vehicle-quick-title">{String(vehicle.prefix)}</h2><p>{crewNames.length?`${crewNames.length} GMs: ${crewNames.join(" / ")}`:"Sem guarnição nesta data"}</p></div><button type="button" onClick={onClose} aria-label="Fechar editor de viatura">×</button></header>
    <label>Viatura física<select name="toVehicleId" value={selectedId} onChange={event=>{setSelectedId(event.target.value);const selected=data.allVehicles.find(item=>String(item.id)===event.target.value);if(selected)setZone(String(selected.zone||""))}}>{data.allVehicles.map(candidate=>{const status=availability(candidate),blocked=status==="Em FA"||status==="Em serviço";return <option key={String(candidate.id)} value={String(candidate.id)} disabled={blocked}>{vehicleIcon(String(candidate.type))} {String(candidate.prefix)} · {String(candidate.zone||"Sem zona")} — {status}</option>})}</select></label>
    <div className="vehicle-status-legend"><span className="available">Disponíveis podem receber a equipe</span><span className="busy">Em serviço</span><span className="outage">Em FA</span></div>
    <label>Zona / área de atuação<input name="zone" value={zone} onChange={event=>setZone(event.target.value)} placeholder="Definir zona de atuação"/></label>
    <p className="vehicle-quick-help">Ao trocar a VTR, motorista, patrulheiro e demais integrantes são movidos juntos, mantendo turno, horário e marcações.</p>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Salvando…":selectedId===String(vehicle.id)?"Salvar zona":"Trocar VTR e mover equipe"}</button></footer>
  </form></div>
}
function Row({
  kind,
  resource,
  section,
  first,
  collapsed,
  onToggleSection,
  shifts: visibleShifts,
  assignmentIndex,
  availableForRedeployment,
  redeploymentGroups,
  selectedId,
  onPick,
  onMove,
  onMoveGroup,
  onHolePick,
  onEditVehicle,
}: {
  kind: "post" | "vehicle";
  resource: Rec;
  section: string;
  first: boolean;
  collapsed: boolean;
  onToggleSection: () => void;
  shifts: typeof SHIFT_DEFS;
  assignmentIndex: Map<string, Rec[]>;
  availableForRedeployment: Rec[];
  redeploymentGroups: RedeploymentGroup[];
  selectedId: number;
  onPick: (p: Pick) => void;
  onMove: (a: Rec, k: "post" | "vehicle", r: Rec, s: string) => void;
  onMoveGroup: (a: Rec[], k: "post" | "vehicle", r: Rec) => void;
  onHolePick: (
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onEditVehicle: (vehicle: Rec) => void;
}) {
  function drop(e: DragEvent, shift: string) {
    e.preventDefault();
    const groupIds = e.dataTransfer
      .getData("text/assignment-group")
      .split(",")
      .map(Number)
      .filter(Boolean);
    if (groupIds.length) {
      const group = redeploymentGroups.find((item) =>
        item.assignments.every((assignment) => groupIds.includes(Number(assignment.id))),
      );
      const targetPeriod = isDayShift(shift) ? "day" : "night";
      if (group && group.period === targetPeriod) {
        void onMoveGroup(group.assignments, kind, resource);
      }
      return;
    }
    const id = Number(e.dataTransfer.getData("text/assignment"));
    for (const list of assignmentIndex.values()) {
      const assignment = list.find((a) => Number(a.id) === id);
      if (assignment) {
        void onMove(assignment, kind, resource, shift);
        return;
      }
    }
    const available = availableForRedeployment.find((a) => Number(a.id) === id);
    if (available) void onMove(available, kind, resource, shift);
  }
  return (
    <Fragment>
      {first && (
        <tr
          className={`group ${section === "SEDE DA GM" ? "headquarters" : ""}`}
        >
          <td colSpan={1 + visibleShifts.length}>
            <button type="button" className="section-toggle" onClick={onToggleSection}>
              {collapsed ? "▸" : "▾"} {kind === "vehicle" ? "🚓" : "◆"} {section}
            </button>
          </td>
        </tr>
      )}
      {!collapsed && (
      <tr className={kind === "vehicle" ? "vehicle-row" : "post-row"}>
        <td className="resource">
          <span className="vehicle">
            {kind === "vehicle" ? vehicleIcon(String(resource.type)) : ""}
          </span>
          <div>
            <b>{kind === "vehicle" ? resource.prefix : resource.name}</b>
            <small>
              {kind === "vehicle"
                ? `⌖ ${resource.zone || "Zona não definida"}`
                : resource.group_name}
            </small>
          </div>
          {kind === "vehicle" && (
            <button
              type="button"
              className="vehicle-quick-button"
              aria-label={`Editar ${String(resource.prefix)} e zona`}
              onClick={() => onEditVehicle(resource)}
            >
              Editar
            </button>
          )}
        </td>
        {visibleShifts.map((s) => {
          const list = assignmentIndex.get(assignmentKey(kind, Number(resource.id), s.id)) || [];
          const need = kind === "vehicle" ? 2 : 1;
          return (
            <td
              key={s.id}
              className={`${list.length < need ? "furo" : ""} drop-cell`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, s.id)}
            >
              {list.map((a) => (
                <button
                  draggable
                  className={`live-person ${a.status} ${Number(a.is_reassigned)?"reassigned":""} ${Number(a.id) === selectedId ? "is-selected" : ""}`}
                  key={a.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/assignment", String(a.id));
                  }}
                  onClick={() =>
                    onPick({ kind, resource, shift: s.id, assignment: a })
                  }
                >
                  {kind === "vehicle" && (
                    <span className="role">
                      {a.role === "driver" ? "M" : "P"}
                    </span>
                  )}
                  <b>{a.guard_name}</b>
                  {a.status !== "normal" && (
                    <span className={`badge ${statusClass(String(a.status))}`}>
                      {String(a.work_kind)==="weekly"&&String(a.regular_ends_at||"")!==String(a.ends_at)?weeklyHeShort(a):statusShort(String(a.status))}
                    </span>
                  )}
                  {Number(a.is_reassigned)===1&&<span className="badge remanejamento">REM</span>}
                  <small>
                    {weeklyDisplay(a)}
                  </small>
                </button>
              ))}
              {list.length < need && (
                <button
                  className="live-hole"
                  onClick={(e) => onHolePick(kind, resource, s.id, e)}
                >
                  <span>FURO</span>＋ Selecionar{" "}
                  {kind === "vehicle"
                    ? list.length === 0
                      ? "motorista"
                      : "patrulheiro"
                    : "GM"}
                </button>
              )}
            </td>
          );
        })}
      </tr>
      )}
    </Fragment>
  );
}
function Editor({
  pick,
  data,
  saving,
  onClose,
  onSave,
  onRemove,
}: {
  pick: Pick;
  data: State;
  saving: boolean;
  onClose: () => void;
  onSave: (e: FormEvent<HTMLFormElement>) => void;
  onRemove: () => void;
}) {
  const a = pick.assignment,
    manualAdd = Boolean(pick.manualAdd),
    fillingHole = !a && !manualAdd,
    t = fillingHole ? fullPeriodWindow(data.date, pick.shift) : times(data.date, pick.shift),
    [guardId, setGuardId] = useState(String(a?.guard_id || "")),
    [guardQuery, setGuardQuery] = useState(""),
    guard = data.guards.find((g) => String(g.id) === guardId);
  const eligibleGuards = useMemo(() => {
    const q = guardQuery.toLowerCase().trim();
    return data.guards.filter((g) => {
      if (!q) return true;
      return `${g.name || ""} ${g.registration || ""} ${g.platoon || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [data.guards, guardQuery]);
  return (
    <form onSubmit={onSave}>
      <div className="editor-head">
        <div>
          <span className="editing-pill">
            {a ? "EDITANDO GM" : manualAdd ? "ADICIONANDO GM" : "PREENCHENDO VAGA"}
          </span>
          <h2 aria-live="polite">{guard?.name || "Selecione um GM"}</h2>
          <p>
            {pick.kind === "vehicle"
              ? pick.resource.prefix
              : pick.resource.name}{" "}
            · {shifts.find((s) => s.id === pick.shift)?.label}
          </p>
        </div>
        <button
          className="editor-close"
          type="button"
          onClick={onClose}
          aria-label="Fechar editor"
        >
          ×
        </button>
      </div>
      {fillingHole && (
        <div className="editing-alert full-period-alert">
          <b>Regra de negócio:</b>
          <span>{fullPeriodLabel(pick.shift)}. O GM cobrirá o bloco completo.</span>
        </div>
      )}
      {manualAdd && (
        <div className="editing-alert manual-add-alert">
          <b>Novo lançamento:</b>
          <span>Escolha GM, destino, turno, função e horário.</span>
        </div>
      )}
      <div className="editing-alert">
        <b>Confira antes de salvar:</b>
        <span>{guard?.name || "nenhum GM selecionado"}</span>
      </div>
      <label>
        Buscar GM
        <input
          value={guardQuery}
          onChange={(e) => setGuardQuery(e.target.value)}
          placeholder="Nome ou matrícula…"
        />
      </label>
      <label>
        Guarda
        <select
          name="guardId"
          value={guardId}
          onChange={(e) => setGuardId(e.target.value)}
          required
        >
          <option value="">Selecionar GM</option>
          {eligibleGuards.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {g.name} · {g.registration} · {g.platoon}
            </option>
          ))}
        </select>
      </label>
      <label>
        Destino
        <select
          name="destination"
          defaultValue={`${pick.kind}:${pick.resource.id}`}
        >
          {data.vehicles.map((v) => (
            <option key={`v${v.id}`} value={`vehicle:${v.id}`}>
              {v.prefix} · {v.zone}
            </option>
          ))}
          {data.posts.map((p) => (
            <option key={`p${p.id}`} value={`post:${p.id}`}>
              {p.group_name} · {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Turno de referência
        <select name="shift" defaultValue={pick.shift}>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.time}
            </option>
          ))}
        </select>
      </label>
      <label>
        Função
        <select
          name="role"
          defaultValue={String(
            a?.role ||
              (pick.kind === "vehicle"
                ? data.assignments.filter(
                    (x) =>
                      x.vehicle_id === pick.resource.id &&
                      x.shift === pick.shift,
                  ).length
                  ? "patrol"
                  : "driver"
                : "guard"),
          )}
        >
          <option value="guard">GM do posto</option>
          <option value="driver">M — Motorista</option>
          <option value="patrol">P — Patrulheiro</option>
          <option value="third">3º integrante</option>
        </select>
      </label>
      <div className="two">
        <label>
          Entrada
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={String(a?.starts_at || t.start)}
            required
            readOnly={fillingHole}
          />
        </label>
        <label>
          Saída
          <input
            name="endsAt"
            type="datetime-local"
            defaultValue={String(a?.ends_at || t.end)}
            required
            readOnly={fillingHole}
          />
        </label>
      </div>
      {fillingHole && (
        <p className="full-period-note">
          {isDayShift(pick.shift)
            ? "Horário fixo do furo diurno: 07:00 às 19:00 (2º + 3º turnos)."
            : "Horário fixo do furo noturno: 19:00 às 07:00 (4º + 1º turnos)."}
        </p>
      )}
      <label>
        Situação
        <select name="status" defaultValue={String(a?.status || "normal")}>
          <option value="normal">Normal</option>
          <option value="overtime">Hora extra</option>
          <option value="time_bank">Banco de horas</option>
          <option value="swap">Troca de serviço</option>
        </select>
      </label>
      <label className="reassignment-check"><span><input type="checkbox" name="isReassigned" defaultChecked={Number(a?.is_reassigned)===1}/> GM remanejado — precisa ser avisado</span></label>
      <label>Observação do remanejamento<input name="reassignmentNote" defaultValue={String(a?.reassignment_note||"")} placeholder="Origem, motivo ou orientação"/></label>
      <label>
        Requerimento
        <input
          name="requestRef"
          defaultValue={String(a?.request_ref || "")}
          placeholder="Número ou referência"
        />
      </label>
      <button className="save" disabled={saving}>
        {saving ? "Salvando…" : fillingHole ? "Escalar turno inteiro" : manualAdd ? "Adicionar à escala" : "Salvar alteração"}
      </button>
      {a && (
        <button
          type="button"
          className="remove"
          disabled={saving}
          onClick={onRemove}
        >
          Remover da escala
        </button>
      )}
    </form>
  );
}
const vehicleIcon = (t: string) =>
  t === "moto" ? "🏍️" : t === "pickup" ? "🛻" : t === "van" ? "🚐" : t === "suv" ? "🚙" : "🚓";
const statusClass = (s: string) =>
  s === "overtime" ? "he" : s === "time_bank" ? "bh" : "troca";
const statusShort = (s: string) =>
  s === "overtime" ? "HE" : s === "time_bank" ? "BH" : "TROCA";
function weeklyDisplay(a:Rec){const start=String(a.starts_at).slice(11,16),regular=String(a.regular_ends_at||"").slice(11,16),end=String(a.ends_at).slice(11,16),breakStart=String(a.break_starts_at||"").slice(11,16),breakEnd=String(a.break_ends_at||"").slice(11,16);if(String(a.work_kind)!=="weekly")return `${start}–${end}`;const base=breakStart&&breakEnd?`${start}–${breakStart} / ${breakEnd}–${regular}`:`${start}–${regular}`;return end!==regular?`${base} + HE semanal ${regular}–${end}`:base}
function weeklyHeShort(a:Rec){
  const start=String(a.regular_ends_at).slice(11,16),end=String(a.ends_at).slice(11,16);
  const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
  const hours=Math.max(0,(minutes(end)-minutes(start))/60);
  return `HE SEMANAL · ${formatHoursDuration(hours)}`;
}
function belongsToShift(a:Rec,shift:string){if(String(a.shift)===shift)return true;if(String(a.shift)!=="W")return false;const start=String(a.starts_at).slice(11,16),end=String(a.ends_at).slice(11,16);if(shift==="2")return start<"13:00"&&end>"07:00";if(shift==="3")return start<"19:00"&&end>"13:00";return false}
