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
  assignmentOverlapsShift,
  coveredOperationalShifts,
  fullPeriodLabel,
  fullPeriodWindow,
  isDayShift,
  operationalShiftWindow,
  shiftTimes,
  SHIFT_DEFS,
} from "../lib/shift-rules";
import { HoleSuggestBox, type SameDayCandidate } from "./hole-suggest-box";
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
  extension?: boolean;
};
type HolePick = {
  kind: "post" | "vehicle";
  resource: Rec;
  shift: string;
  role: string | null;
  position: SuggestionPosition | null;
};
type RedeployPick = { assignments: Rec[] };
type ResourceRemovalPick = { kind: "post" | "vehicle"; resource: Rec; assignments: Rec[] };
type UndoState = { id: number; label: string };
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
    [contextPick, setContextPick] = useState<Pick | null>(null),
    [vehicleEdit, setVehicleEdit] = useState<Rec | null>(null),
    [resourceRemoval, setResourceRemoval] = useState<ResourceRemovalPick | null>(null),
    [createOpen, setCreateOpen] = useState(false),
    [createKind, setCreateKind] = useState<"guard" | "post" | "vehicle" | "section">("guard"),
    [resourceDialog, setResourceDialog] = useState<"post" | "vehicle" | null>(null),
    [addMenuOpen, setAddMenuOpen] = useState(false),
    [movementsExpanded, setMovementsExpanded] = useState(false),
    [redeploymentExpanded, setRedeploymentExpanded] = useState(false),
    [undoEvent, setUndoEvent] = useState<UndoState | null>(null),
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
      setContextPick(null);
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
        if (!assignmentOverlapsShift(a, data.date, s.id)) continue;
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
        if (j.auditEventId) setUndoEvent({id:Number(j.auditEventId),label:String(j.message||"Desfazer a última alteração")});
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
        setContextPick(null);
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
    const extensionDestination = String(body.extensionDestination || body.destination).split(":");
    await postAssignment({
      ...body,
      action: body.saveMode === "split" ? "save_with_extension" : undefined,
      startsAt: fillingHole ? t.start : body.startsAt,
      endsAt: fillingHole ? t.end : body.endsAt,
      fillFullPeriod: fillingHole,
      id: pick.assignment?.id || null,
      scheduleId: data.schedule.id,
      postId: destination === "post" ? Number(id) : null,
      vehicleId: destination === "vehicle" ? Number(id) : null,
      extensionPostId: extensionDestination[0] === "post" ? Number(extensionDestination[1]) : null,
      extensionVehicleId: extensionDestination[0] === "vehicle" ? Number(extensionDestination[1]) : null,
    });
  }
  async function remove() {
    if (!pick?.assignment) return;
    await postAssignment({
      action: "delete",
      id: Number(pick.assignment.id),
    });
  }
  async function quickStatus(assignment:Rec,status:string){
    if(!data)return;
    await postAssignment({id:assignment.id,scheduleId:data.schedule.id,guardId:assignment.guard_id,postId:assignment.post_id||null,vehicleId:assignment.vehicle_id||null,shift:assignment.shift,role:assignment.role,startsAt:assignment.starts_at,endsAt:assignment.ends_at,regularEndsAt:assignment.regular_ends_at||null,workKind:assignment.work_kind||"shift",status,requestRef:assignment.request_ref||null,isReassigned:Number(assignment.is_reassigned)===1,reassignmentNote:assignment.reassignment_note||null});
  }
  async function undoLast(){
    if(!undoEvent||saving)return;
    setSaving(true);
    try{const response=await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"undo",id:undoEvent.id})});const result=await response.json();setMessage(response.ok?result.message:result.error);if(response.ok){setUndoEvent(null);await load()}}finally{setSaving(false)}
  }
  async function createCatalogItem(event:FormEvent<HTMLFormElement>,kind:"guard"|"post"|"vehicle"|"section"){
    event.preventDefault();if(!data||saving)return;setSaving(true);
    try{const values=Object.fromEntries(new FormData(event.currentTarget));const response=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...values,action:kind==="section"?"section_create":kind})});const result=await response.json();setMessage(response.ok?result.message:result.error);if(!response.ok)return;const entity=result.entity as Rec;setData(current=>{if(!current)return current;if(kind==="guard")return{...current,guards:[...current.guards,entity].sort((a,b)=>String(a.name).localeCompare(String(b.name),"pt-BR"))};if(kind==="post")return{...current,posts:[...current.posts,entity]};if(kind==="vehicle")return{...current,vehicles:[...current.vehicles,entity],allVehicles:[...current.allVehicles,entity]};return{...current,sections:[...current.sections,entity]}});setCreateOpen(false)}finally{setSaving(false)}
  }
  async function saveResourceCrew(event: FormEvent<HTMLFormElement>, kind: "post" | "vehicle") {
    event.preventDefault();
    if (!data || saving) return;
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const mode = String(form.get("resourceMode") || "existing");
      let resourceId = Number(form.get("resourceId") || 0);
      let entity: Rec | null = null;
      if (mode === "new") {
        const payload = kind === "vehicle"
          ? { action: "vehicle", prefix: form.get("prefix"), type: form.get("type"), zone: form.get("zone") }
          : { action: "post", name: form.get("name"), groupName: form.get("groupName"), sortOrder: form.get("sortOrder") || 99 };
        const createResponse = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const created = await createResponse.json();
        if (!createResponse.ok) { setMessage(created.error); return; }
        entity = created.entity as Rec;
        resourceId = Number(entity.id);
      }
      const guardIds = form.getAll("crewGuardId").map(Number);
      const roles = form.getAll("crewRole").map(String);
      const members = guardIds.map((guardId, index) => ({ guardId, role: kind === "vehicle" ? roles[index] || "third" : "guard" })).filter((member) => member.guardId > 0);
      const assignResponse = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "assign_resource_group", scheduleId: data.schedule.id, shift: form.get("shift"), postId: kind === "post" ? resourceId : null, vehicleId: kind === "vehicle" ? resourceId : null, members }) });
      const assigned = await assignResponse.json();
      setMessage(assignResponse.ok ? assigned.message : assigned.error);
      if (!assignResponse.ok) {
        if (entity) await load();
        return;
      }
      if (assigned.auditEventId) setUndoEvent({ id: Number(assigned.auditEventId), label: "Desfazer inclusão da equipe" });
      setData((current) => {
        if (!current) return current;
        const merged = mergeScheduleAssignments(current.assignments, current.availableForRedeployment, assigned.assignments || []);
        if (!entity) return { ...current, ...merged };
        return kind === "vehicle"
          ? { ...current, ...merged, vehicles: [...current.vehicles, entity], allVehicles: [...current.allVehicles, entity] }
          : { ...current, ...merged, posts: [...current.posts, entity] };
      });
      setResourceDialog(null);
    } finally {
      setSaving(false);
    }
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
  async function confirmSameDayRedeployment(candidate: SameDayCandidate) {
    if (!data || !holePick) return;
    await postAssignment({
      action: "redeploy_group",
      assignmentIds: candidate.assignmentIds,
      scheduleId: data.schedule.id,
      postId: holePick.kind === "post" ? Number(holePick.resource.id) : null,
      vehicleId: holePick.kind === "vehicle" ? Number(holePick.resource.id) : null,
      role: holePick.role || (holePick.kind === "vehicle" ? "patrol" : "guard"),
      reassignmentNote: `AVISAR REMANEJAMENTO: ${candidate.origins.join(" + ")} → ${
        holePick.kind === "vehicle" ? holePick.resource.prefix : holePick.resource.name
      }`,
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
  function openCreate(kind: "guard" | "post" | "vehicle" | "section") {
    if (kind === "post" || kind === "vehicle") {
      setResourceDialog(kind);
      return;
    }
    setCreateKind(kind);
    setCreateOpen(true);
  }
  function startExtension(assignment: Rec, kind: "post" | "vehicle", resource: Rec, shift: string) {
    setPick({ kind, resource, shift, assignment, extension: true });
    setContextPick(null);
  }
  async function move(
    assignment: Rec,
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
    sourceShift?: string,
  ) {
    if (!data) return;
    const regularEnd = String(assignment.regular_ends_at || "");
    if (regularEnd && String(assignment.status) === "overtime") {
      const extensionMove = sourceShift
        ? operationalShiftWindow(data.date, sourceShift).start >= regularEnd
        : operationalShiftWindow(data.date, shift).start >= regularEnd;
      const originalPostId = assignment.post_id || null;
      const originalVehicleId = assignment.vehicle_id || null;
      await postAssignment({
        action: "save_with_extension",
        id: assignment.id,
        scheduleId: data.schedule.id,
        guardId: assignment.guard_id,
        shift: assignment.shift,
        role: extensionMove ? assignment.role : kind === "post" ? "guard" : "driver",
        startsAt: assignment.starts_at,
        endsAt: regularEnd,
        postId: extensionMove ? originalPostId : kind === "post" ? resource.id : null,
        vehicleId: extensionMove ? originalVehicleId : kind === "vehicle" ? resource.id : null,
        extensionStartsAt: regularEnd,
        extensionEndsAt: assignment.ends_at,
        extensionShift: "4",
        extensionRole: extensionMove ? (kind === "post" ? "guard" : "third") : assignment.role,
        extensionPostId: extensionMove ? (kind === "post" ? resource.id : null) : originalPostId,
        extensionVehicleId: extensionMove ? (kind === "vehicle" ? resource.id : null) : originalVehicleId,
        requestRef: assignment.request_ref || null,
        isReassigned: 1,
        reassignmentNote: "Expediente e extensão separados durante o remanejamento",
      });
      return;
    }
    const t = times(data.date, shift),
      preserveInterval = String(assignment.shift) === shift || Boolean(sourceShift && sourceShift === shift && assignmentOverlapsShift(assignment, data.date, sourceShift)),
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
      startsAt: preserveInterval ? assignment.starts_at : t.start,
      endsAt: preserveInterval ? assignment.ends_at : t.end,
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
  async function removeResourceFromDay() {
    if (!data || !resourceRemoval || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "remove_resource_from_day",
          scheduleId: data.schedule.id,
          resourceKind: resourceRemoval.kind,
          resourceId: resourceRemoval.resource.id,
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (!response.ok) return;
      if (result.auditEventId) setUndoEvent({ id: Number(result.auditEventId), label: "Desfazer retirada do local" });
      setData((current) => {
        if (!current) return current;
        const merged = mergeScheduleAssignments(
          current.assignments,
          current.availableForRedeployment,
          result.assignments || [],
        );
        return {
          ...current,
          ...merged,
          posts: resourceRemoval.kind === "post"
            ? current.posts.filter((post) => Number(post.id) !== Number(resourceRemoval.resource.id))
            : current.posts,
          vehicles: resourceRemoval.kind === "vehicle"
            ? current.vehicles.filter((vehicle) => Number(vehicle.id) !== Number(resourceRemoval.resource.id))
            : current.vehicles,
        };
      });
      setResourceRemoval(null);
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
        return x.kind === "vehicle"
          ? !list.some((assignment)=>assignment.role==="driver"&&!isOvertimeExtensionCell(assignment,data.date,s.id)) || !list.some((assignment)=>assignment.role==="patrol"&&!isOvertimeExtensionCell(assignment,data.date,s.id))
          : list.length < 1;
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
        <div className="schedule-add-menu">
          <button type="button" className="schedule-add-trigger" aria-expanded={addMenuOpen} onClick={()=>setAddMenuOpen(value=>!value)}>＋ Adicionar</button>
          {addMenuOpen&&<div role="menu"><button type="button" onClick={()=>{setAddMenuOpen(false);startManualAdd()}}>👤 Escalar GM</button><button type="button" onClick={()=>{setAddMenuOpen(false);openCreate("vehicle")}}>🚓 Viatura</button><button type="button" onClick={()=>{setAddMenuOpen(false);openCreate("post")}}>📍 Posto</button><button type="button" onClick={()=>{setAddMenuOpen(false);openCreate("section")}}>▦ Seção</button></div>}
        </div>
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
          {undoEvent&&<button className="toast-undo" disabled={saving} onClick={undoLast}>↶ Desfazer</button>}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      <div className={`workspace ${pick?"has-editor":"schedule-only"}`}>
        <section className={`schedule-wrap ${data.date!==date?"is-switching":""}`}>
          {data.date!==date&&<div className="schedule-switching" role="status"><b>Abrindo escala de {formatScheduleDate(date)}</b><span>A escala anterior permanece bloqueada até a nova data terminar de carregar.</span></div>}
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
                  date={data.date}
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
                  selectedId={Number(contextPick?.assignment?.id || pick?.assignment?.id || 0)}
                  onContextPick={setContextPick}
                  onEdit={setPick}
                  onQuickStatus={quickStatus}
                  onExtend={startExtension}
                  onQuickDelete={(assignment)=>confirm(`Remover ${assignment.guard_name} da escala?`)&&postAssignment({action:"delete",id:assignment.id})}
                  onMove={move}
                  onMoveGroup={moveGroup}
                  onHolePick={openHoleSuggest}
                  onEditVehicle={setVehicleEdit}
                  onRemoveResource={(kind,resource)=>setResourceRemoval({
                    kind,
                    resource,
                    assignments:data.assignments.filter((assignment)=>kind==="post"
                      ? Number(assignment.post_id)===Number(resource.id)
                      : Number(assignment.vehicle_id)===Number(resource.id)),
                  })}
                />
              );
              })}
            </tbody>
          </table>
          )}
          <section className={`movement-grid compact-movements ${movementsExpanded?"expanded":"collapsed"}`}>
            <button type="button" className="compact-section-toggle" onClick={()=>setMovementsExpanded(value=>!value)}><span><b>Efetivo retirado</b><small>{movementGroups.map(group=>`${group.label} ${group.items.length}`).join(" · ")||"Nenhum afastamento"}</small></span><strong>{data.movements.length}</strong><i>{movementsExpanded?"Recolher":"Ver nomes"}</i></button>
            {movementsExpanded&&(movementGroups.length ? (
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
            ))}
          </section>
          {showRedeploy && data.availableForRedeployment.length > 0 && (
            <section className={`redeployment-pool ${redeploymentExpanded||view==="redeploy"?"expanded":"collapsed"}`}>
              <header><div><span>À DISPOSIÇÃO</span><h2>{redeploymentGroups.length} GM(s) aguardando destino</h2><p>Arraste o bloco para um posto/VTR ou escolha o destino.</p></div><button type="button" onClick={()=>setRedeploymentExpanded(value=>!value)}>{redeploymentExpanded||view==="redeploy"?"Recolher":"Abrir bandeja"}</button></header>
              {(redeploymentExpanded||view==="redeploy")&&<div>{redeploymentGroups.map((group) => (
                <article key={group.key} draggable onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/assignment", String(group.assignments[0].id));
                  event.dataTransfer.setData("text/assignment-group", group.assignments.map((assignment) => assignment.id).join(","));
                }}>
                  <span className="redeploy-drag" aria-hidden="true">⋮⋮</span>
                  <div><b>{group.guardName}</b><small>{redeploymentTimeLabel(group.assignments)} · {group.period === "day" ? "Diurno · 2º + 3º" : "Noturno · 4º + 1º"}</small></div>
                  <button type="button" onClick={() => setRedeployPick({ assignments: group.assignments })}>Escolher destino</button>
                </article>
              ))}</div>}
            </section>
          )}
        </section>
        {pick&&<aside className="editor editor-active">
          {(
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
          )}
        </aside>}
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
            onRedeploy={confirmSameDayRedeployment}
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
      {createOpen&&<QuickCreateDialog key={createKind} initialKind={createKind} data={data} saving={saving} onClose={()=>setCreateOpen(false)} onSave={createCatalogItem}/>}
      {resourceDialog&&<ResourceCrewDialog key={resourceDialog} kind={resourceDialog} data={data} saving={saving} onClose={()=>setResourceDialog(null)} onSave={saveResourceCrew}/>}
      {resourceRemoval&&<ResourceRemovalDialog pick={resourceRemoval} saving={saving} onClose={()=>setResourceRemoval(null)} onConfirm={removeResourceFromDay}/>}
    </main>
  );
}

function QuickCreateDialog({initialKind,data,saving,onClose,onSave}:{initialKind:"guard"|"post"|"vehicle"|"section";data:State;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>,kind:"guard"|"post"|"vehicle"|"section")=>void}){
  const [kind,setKind]=useState<"guard"|"post"|"vehicle"|"section">(initialKind);
  const sectionLabels=[...new Set(data.sections.filter(section=>String(section.section_key).startsWith("POST:")).map(section=>String(section.label)))];
  return <div className="quick-create-backdrop"><section className="quick-create-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-create-title"><header><div><small>CRIAR SEM SAIR DA ESCALA</small><h2 id="quick-create-title">Cadastrar GM ou seção</h2><p>Viaturas e postos são incluídos pelos botões próprios da barra da escala.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><nav>{([['guard','GM'],['section','Seção']] as const).map(option=><button type="button" className={kind===option[0]?"active":""} key={option[0]} onClick={()=>setKind(option[0])}>{option[1]}</button>)}</nav>
    {kind==="guard"&&<form onSubmit={event=>onSave(event,"guard")}><label>Nome operacional<input name="name" required placeholder="Ex.: SILVA"/></label><label>Matrícula<input name="registration" required placeholder="Identificação única"/></label><label>Equipe / padrão<input name="platoon" placeholder="D1, D2, N1, N2…"/></label><label>Escala de trabalho<select name="workRegime" defaultValue="12x36"><option value="12x36">Plantão 12x36</option><option value="weekly">Expediente semanal</option></select></label><input type="hidden" name="baseShift" value={kind==="guard"?"12x36":""}/><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Criando…":"Cadastrar GM"}</button></footer></form>}
    {kind==="post"&&<form onSubmit={event=>onSave(event,"post")}><label>Nome do posto<input name="name" required placeholder="Ex.: Recepção"/></label><label>Seção<select name="groupName" required defaultValue=""><option value="">Selecionar seção</option>{sectionLabels.map(label=><option key={label} value={label}>{label}</option>)}</select></label><label>Ordem<input name="sortOrder" type="number" defaultValue="99"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>Adicionar posto</button></footer></form>}
    {kind==="vehicle"&&<form onSubmit={event=>onSave(event,"vehicle")}><label>Prefixo<input name="prefix" required placeholder="VTR 1400"/></label><label>Tipo<select name="type" defaultValue="sedan"><option value="sedan">Sedan</option><option value="pickup">Caminhonete</option><option value="suv">SUV</option><option value="van">Furgão</option><option value="moto">Moto</option><option value="other">Outro</option></select></label><label>Zona / área<input name="zone" placeholder="Área de atuação"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>Adicionar viatura</button></footer></form>}
    {kind==="section"&&<form onSubmit={event=>onSave(event,"section")}><label>Nome da nova seção<input name="label" required placeholder="Ex.: Escolas e operações"/></label><p className="quick-create-help">Depois de criar, use “Posto” para adicionar os locais que ficarão dentro desta seção.</p><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>Criar seção</button></footer></form>}
  </section></div>
}

function ResourceCrewDialog({kind,data,saving,onClose,onSave}:{kind:"post"|"vehicle";data:State;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>,kind:"post"|"vehicle")=>void}){
  const resources=kind==="vehicle"?data.vehicles:data.posts;
  const [mode,setMode]=useState<"existing"|"new">(resources.length?"existing":"new");
  const [resourceId,setResourceId]=useState(String(resources[0]?.id||""));
  const [shift,setShift]=useState<"2"|"4">("2");
  const firstHasPair=kind==="vehicle"&&vehicleHasPair(data,Number(resourceId),shift);
  const [extraCount,setExtraCount]=useState(kind==="post"||firstHasPair?1:0);
  const needsPair=kind==="vehicle"&&(mode==="new"||!vehicleHasPair(data,Number(resourceId),shift));
  const sectionLabels=[...new Set(data.sections.filter(section=>String(section.section_key).startsWith("POST:")).map(section=>String(section.label)))];
  function chooseExisting(id:string){setResourceId(id);setExtraCount(kind==="post"||vehicleHasPair(data,Number(id),shift)?1:0)}
  function chooseShift(value:"2"|"4"){setShift(value);setExtraCount(kind==="post"||(mode==="existing"&&vehicleHasPair(data,Number(resourceId),value))?1:0)}
  return <div className="quick-create-backdrop"><form className="resource-crew-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-crew-title" onSubmit={event=>onSave(event,kind)}><header><div><small>INCLUIR DIRETAMENTE NA ESCALA</small><h2 id="resource-crew-title">{kind==="vehicle"?"Viatura e guarnição":"Posto e efetivo"}</h2><p>Use um cadastro existente ou crie outro e já posicione os GMs.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><nav className="resource-mode"><button type="button" className={mode==="existing"?"active":""} disabled={!resources.length} onClick={()=>{setMode("existing");setExtraCount(kind==="post"||vehicleHasPair(data,Number(resourceId),shift)?1:0)}}>Usar {kind==="vehicle"?"VTR":"posto"} existente</button><button type="button" className={mode==="new"?"active":""} onClick={()=>{setMode("new");setExtraCount(kind==="post"?1:0)}}>＋ Criar {kind==="vehicle"?"nova VTR":"novo posto"}</button></nav><input type="hidden" name="resourceMode" value={mode}/>
    {mode==="existing"&&<label>{kind==="vehicle"?"Viatura disponível na escala":"Posto existente"}<select name="resourceId" value={resourceId} onChange={event=>chooseExisting(event.target.value)} required>{resources.map(resource=>{const crew=kind==="vehicle"?uniqueCrewCount(data,Number(resource.id)):0;return <option key={String(resource.id)} value={String(resource.id)}>{kind==="vehicle"?`${vehicleIcon(String(resource.type))} ${resource.prefix} · ${resource.zone||"Sem zona"} · ${crew} GM(s)`:`${resource.group_name} · ${resource.name}`}</option>})}</select></label>}
    {mode==="new"&&kind==="vehicle"&&<div className="new-resource-fields"><label>Prefixo<input name="prefix" required placeholder="Ex.: VTR 1400"/></label><label>Tipo<select name="type" defaultValue="sedan"><option value="sedan">Sedan</option><option value="pickup">Caminhonete</option><option value="suv">SUV</option><option value="van">Furgão</option><option value="moto">Moto</option><option value="other">Outro</option></select></label><label>Zona / área<input name="zone" placeholder="Área de atuação"/></label></div>}
    {mode==="new"&&kind==="post"&&<div className="new-resource-fields"><label>Nome do posto<input name="name" required placeholder="Ex.: Recepção"/></label><label>Seção<select name="groupName" required defaultValue=""><option value="">Selecionar seção</option>{sectionLabels.map(label=><option key={label} value={label}>{label}</option>)}</select></label><input type="hidden" name="sortOrder" value="99"/></div>}
    <label>Período da equipe<select name="shift" value={shift} onChange={event=>chooseShift(event.target.value as "2"|"4")}><option value="2">Diurno · 07h–19h</option><option value="4">Noturno · 19h–07h</option></select></label>
    <fieldset className="crew-builder"><legend>{kind==="vehicle"?"Composição da guarnição":"GMs do posto"}</legend>{needsPair&&<div className="crew-rule"><b>Dupla obrigatória</b><span>A VTR precisa sair com motorista e patrulheiro.</span></div>}{!needsPair&&kind==="vehicle"&&<div className="crew-rule complete"><b>Dupla já existente</b><span>Os novos nomes entrarão como reforço.</span></div>}{needsPair&&<><CrewGuardRow data={data} label="Motorista" crewRole="driver"/><CrewGuardRow data={data} label="Patrulheiro" crewRole="patrol"/></>}{Array.from({length:extraCount},(_,index)=><CrewGuardRow key={index} data={data} label={kind==="vehicle"?`Integrante adicional ${index+1}`:`GM ${index+1}`} crewRole={kind==="vehicle"?"third":"guard"} removable onRemove={()=>setExtraCount(count=>Math.max(0,count-1))}/>)}<button type="button" className="add-crew-member" disabled={extraCount>=6} onClick={()=>setExtraCount(count=>Math.min(6,count+1))}>＋ {kind==="vehicle"?"Adicionar terceiro integrante ou reforço":"Adicionar outro GM"}</button></fieldset>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Incluindo…":mode==="new"?`Criar e escalar ${kind==="vehicle"?"guarnição":"efetivo"}`:`Adicionar à escala`}</button></footer></form></div>
}

function CrewGuardRow({data,label,crewRole,removable,onRemove}:{data:State;label:string;crewRole:string;removable?:boolean;onRemove?:()=>void}){
  return <div className={`crew-guard-row ${crewRole}`}><span className="crew-role">{crewRole==="driver"?"M":crewRole==="patrol"?"P":crewRole==="third"?"R":"GM"}</span><label>{label}<select name="crewGuardId" required defaultValue=""><option value="">Selecionar GM</option>{data.guards.map(guard=><option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select></label><input type="hidden" name="crewRole" value={crewRole}/>{removable&&<button type="button" onClick={onRemove} aria-label={`Remover ${label}`}>×</button>}</div>
}

function vehicleHasPair(data:State,vehicleId:number,shift:string){const period=isDayShift(shift)?"day":"night";const crew=data.assignments.filter(assignment=>Number(assignment.vehicle_id)===vehicleId&&(isDayShift(String(assignment.shift))?"day":"night")===period);return crew.some(assignment=>assignment.role==="driver")&&crew.some(assignment=>assignment.role==="patrol")}
function uniqueCrewCount(data:State,vehicleId:number){return new Set(data.assignments.filter(assignment=>Number(assignment.vehicle_id)===vehicleId).map(assignment=>Number(assignment.guard_id))).size}

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
function ResourceRemovalDialog({pick,saving,onClose,onConfirm}:{pick:ResourceRemovalPick;saving:boolean;onClose:()=>void;onConfirm:()=>void}){
  const label=String(pick.kind==="vehicle"?pick.resource.prefix:pick.resource.name);
  const guards=[...new Map(pick.assignments.map((assignment)=>[Number(assignment.guard_id),String(assignment.guard_name)])).values()];
  return <div className="resource-remove-backdrop"><section className="resource-remove-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-remove-title">
    <header><div><small>RETIRAR SOMENTE DESTA ESCALA</small><h2 id="resource-remove-title">{label}</h2><p>O cadastro continuará disponível para outros dias e para os padrões.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
    <div className="resource-remove-alert"><b>{guards.length?`${guards.length} GM(s) não serão apagados`:`Este local está sem GMs`}</b><span>{guards.length?"Eles irão para À disposição / aguardando remanejamento.":"Apenas a linha será retirada da escala deste dia."}</span></div>
    {guards.length>0&&<div className="resource-remove-guards">{guards.map((guard)=><span key={guard}>{guard}</span>)}</div>}
    <p>A retirada cria um registro no histórico e pode ser desfeita. O local não será excluído do cadastro geral.</p>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button type="button" className="danger" disabled={saving} onClick={onConfirm}>{saving?"Retirando…":"Retirar local desta escala"}</button></footer>
  </section></div>
}

function Row({
  date,
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
  onContextPick,
  onEdit,
  onQuickStatus,
  onExtend,
  onQuickDelete,
  onMove,
  onMoveGroup,
  onHolePick,
  onEditVehicle,
  onRemoveResource,
}: {
  date: string;
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
  onContextPick: (p: Pick) => void;
  onEdit: (p: Pick) => void;
  onQuickStatus: (assignment:Rec,status:string) => void;
  onExtend: (assignment: Rec, kind: "post" | "vehicle", resource: Rec, shift: string) => void;
  onQuickDelete: (assignment:Rec) => void;
  onMove: (a: Rec, k: "post" | "vehicle", r: Rec, s: string, sourceShift?: string) => void;
  onMoveGroup: (a: Rec[], k: "post" | "vehicle", r: Rec) => void;
  onHolePick: (
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onEditVehicle: (vehicle: Rec) => void;
  onRemoveResource: (kind: "post" | "vehicle", resource: Rec) => void;
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
    const sourceShift = e.dataTransfer.getData("text/assignment-source-shift") || undefined;
    for (const list of assignmentIndex.values()) {
      const assignment = list.find((a) => Number(a.id) === id);
      if (assignment) {
        void onMove(assignment, kind, resource, shift, sourceShift);
        return;
      }
    }
    const available = availableForRedeployment.find((a) => Number(a.id) === id);
    if (available) void onMove(available, kind, resource, shift, sourceShift);
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
          <button
            type="button"
            className="resource-remove-button"
            aria-label={`Retirar ${String(kind === "vehicle" ? resource.prefix : resource.name)} desta escala`}
            title="Retirar somente desta escala"
            onClick={() => onRemoveResource(kind, resource)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </td>
        {visibleShifts.map((s) => {
          const list = assignmentIndex.get(assignmentKey(kind, Number(resource.id), s.id)) || [];
          const missingRoles = kind === "vehicle"
            ? ["driver", "patrol"].filter((role) => !list.some((assignment) => String(assignment.role) === role && !isOvertimeExtensionCell(assignment,date,s.id)))
            : list.length ? [] : ["guard"];
          return (
            <td
              key={s.id}
              className={`${missingRoles.length ? "furo" : ""} drop-cell`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, s.id)}
            >
              {list.map((a) => {const visualStatus=statusInShift(a,date,s.id);return (<Fragment key={String(a.id)}>
                <button
                  draggable
                  className={`live-person ${visualStatus} ${Number(a.is_reassigned)?"reassigned":""} ${Number(a.id) === selectedId ? "is-selected" : ""}`}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/assignment", String(a.id));
                    e.dataTransfer.setData("text/assignment-source-shift", s.id);
                  }}
                  onClick={() =>
                    onContextPick({ kind, resource, shift: s.id, assignment: a })
                  }
                >
                  {kind === "vehicle" && (
                    <span className="role">
                      {isOvertimeExtensionCell(a,date,s.id)?"R":a.role === "driver" ? "M" : a.role === "patrol" ? "P" : "R"}
                    </span>
                  )}
                  <b>{a.guard_name}</b>
                  {visualStatus !== "normal" && (
                    <span className={`badge ${statusClass(visualStatus)}`}>
                      {visualStatus==="overtime"&&a.regular_ends_at?`HE · após ${String(a.regular_ends_at).slice(11,16)}`:statusShort(visualStatus)}
                    </span>
                  )}
                  {Number(a.is_reassigned)===1&&<span className="badge remanejamento" title={String(a.reassignment_note||"Avisar sobre o remanejamento")}>AVISAR REM</span>}
                  <small>
                    {assignmentDisplayInShift(a,date,s.id)}
                  </small>
                </button>
                {Number(a.id)===selectedId&&<div className="cell-quick-actions" role="group" aria-label={`Ações rápidas de ${String(a.guard_name)}`}><b>{a.guard_name}</b><button type="button" onClick={()=>onEdit({kind,resource,shift:s.id,assignment:a})}><span aria-hidden="true">✎</span> Editar / mover</button><button type="button" className="extend-action" onClick={()=>onExtend(a,kind,resource,s.id)}><span aria-hidden="true">＋</span> Estender HE</button><button type="button" className={a.status==="time_bank"?"active":""} onClick={()=>onQuickStatus(a,a.status==="time_bank"?"normal":"time_bank")}><span aria-hidden="true">◷</span> BH</button><button type="button" className="danger" onClick={()=>onQuickDelete(a)}><span aria-hidden="true">×</span> Remover</button><button type="button" aria-label="Fechar ações" onClick={()=>onContextPick({kind,resource,shift:s.id})}>×</button></div>}</Fragment>
              )})}
              {missingRoles.length > 0 && (
                <button
                  className="live-hole"
                  onClick={(e) => onHolePick(kind, resource, s.id, e)}
                >
                  <span>FURO</span>＋ Selecionar{" "}
                  {kind === "vehicle"
                    ? missingRoles[0] === "driver" ? "motorista" : "patrulheiro"
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
    initialRegularEnd = String(a?.regular_ends_at || a?.ends_at || `${data.date}T19:00`),
    [guardId, setGuardId] = useState(String(a?.guard_id || "")),
    [guardQuery, setGuardQuery] = useState(""),
    [shiftId, setShiftId] = useState(String(a?.shift || pick.shift)),
    [startsAt, setStartsAt] = useState(String(a?.starts_at || t.start)),
    [endsAt, setEndsAt] = useState(String(pick.extension ? initialRegularEnd : a?.ends_at || t.end)),
    [regularEndsAt, setRegularEndsAt] = useState(String(a?.regular_ends_at || "")),
    [assignmentStatus, setAssignmentStatus] = useState(String(pick.extension && a?.status === "overtime" ? "normal" : a?.status || "normal")),
    [extensionMode, setExtensionMode] = useState(Boolean(pick.extension)),
    [extensionStartsAt, setExtensionStartsAt] = useState(String(a?.regular_ends_at || `${data.date}T19:00`)),
    [extensionEndsAt, setExtensionEndsAt] = useState(String(a?.regular_ends_at ? a?.ends_at : `${data.date}T23:00`)),
    [extensionDestination, setExtensionDestination] = useState(`${pick.kind}:${pick.resource.id}`),
    guard = data.guards.find((g) => String(g.id) === guardId);
  const tomorrow=new Date(`${data.date}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const tomorrowDate=tomorrow.toISOString().slice(0,10);
  const covered=coveredOperationalShifts({shift:shiftId,starts_at:startsAt,ends_at:endsAt},data.date);
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
      {!fillingHole&&<div className="cross-shift-tools"><div><b>Expediente e extensão independentes</b><small>A HE pode ter outro posto ou VTR sem mover o horário normal.</small></div><button type="button" className={extensionMode?"active":""} onClick={()=>{if(shiftId!=="W")setShiftId("3");setStartsAt(`${data.date}T13:00`);setEndsAt(`${data.date}T19:00`);setRegularEndsAt("");setExtensionStartsAt(`${data.date}T19:00`);setExtensionEndsAt(`${tomorrowDate}T01:00`);setAssignmentStatus("normal");setExtensionMode(true)}}>13h–01h em 2 blocos</button><button type="button" className={extensionMode?"active":""} onClick={()=>{const boundary=`${data.date}T19:00`;if(endsAt>boundary)setEndsAt(boundary);setRegularEndsAt("");setExtensionStartsAt(boundary);if(extensionEndsAt<=boundary)setExtensionEndsAt(`${data.date}T23:00`);setAssignmentStatus("normal");setExtensionMode(true)}}>＋ HE depois das 19h</button><p><span>Horário normal:</span> {covered.length?covered.map((shift)=>`${shift}º`).join(" + "):"revise os horários"}</p></div>}
      <input type="hidden" name="saveMode" value={extensionMode ? "split" : "single"}/>
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
        <select name="shift" value={shiftId} onChange={(event)=>setShiftId(event.target.value)}>
          {shiftId==="W"&&<option value="W">Semanal / expediente</option>}
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
          <option value="third">R — Reforço / extensão</option>
        </select>
      </label>
      <div className="two">
        <label>
          Entrada
          <input
            name="startsAt"
            type="datetime-local"
            value={startsAt}
            onChange={(event)=>setStartsAt(event.target.value)}
            required
            readOnly={fillingHole}
          />
        </label>
        <label>
          Saída
          <input
            name="endsAt"
            type="datetime-local"
            value={endsAt}
            onChange={(event)=>setEndsAt(event.target.value)}
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
      {!fillingHole&&!extensionMode&&<label>Fim do horário normal <small>Compatibilidade com lançamentos antigos; para nova HE use “HE depois das 19h”.</small><input name="regularEndsAt" type="datetime-local" value={regularEndsAt} onChange={(event)=>setRegularEndsAt(event.target.value)}/></label>}
      {extensionMode&&<fieldset className="extension-editor"><legend><span aria-hidden="true">＋</span> Extensão em hora extra — bloco independente</legend><p>Alterar este destino não movimentará o expediente normal acima.</p><label>Destino da extensão<select name="extensionDestination" value={extensionDestination} onChange={(event)=>setExtensionDestination(event.target.value)}>{data.vehicles.map((v)=><option key={`xv${v.id}`} value={`vehicle:${v.id}`}>{v.prefix} · {v.zone}</option>)}{data.posts.map((p)=><option key={`xp${p.id}`} value={`post:${p.id}`}>{p.group_name} · {p.name}</option>)}</select></label><label>Função na extensão<select name="extensionRole" defaultValue={pick.kind==="vehicle"?"third":"guard"}><option value="guard">GM do posto</option><option value="driver">M — Motorista</option><option value="patrol">P — Patrulheiro</option><option value="third">R — Reforço</option></select></label><div className="two"><label>Início da HE<input name="extensionStartsAt" type="datetime-local" value={extensionStartsAt} onChange={(event)=>setExtensionStartsAt(event.target.value)} required/></label><label>Fim da HE<input name="extensionEndsAt" type="datetime-local" value={extensionEndsAt} onChange={(event)=>setExtensionEndsAt(event.target.value)} required/></label></div><button type="button" className="cancel-extension" onClick={()=>setExtensionMode(false)}>Remover extensão</button></fieldset>}
      <label>
        Situação
        <select name="status" value={assignmentStatus} onChange={(event)=>setAssignmentStatus(event.target.value)}>
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
        {saving ? "Salvando…" : fillingHole ? "Escalar turno inteiro" : extensionMode ? "Salvar expediente + HE independente" : manualAdd ? "Adicionar à escala" : "Salvar alteração"}
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
function statusInShift(a:Rec,date:string,shift:string){
  const status=String(a.status||"normal"),regular=String(a.regular_ends_at||"");
  if(status!=="overtime"||!regular)return status;
  const window=operationalShiftWindow(date,shift);
  return window.end<=regular?"normal":status;
}
function isOvertimeExtensionCell(a:Rec,date:string,shift:string){const regular=String(a.regular_ends_at||"");return Boolean(regular)&&String(a.status)==="overtime"&&operationalShiftWindow(date,shift).start>=regular}
function assignmentDisplayInShift(a:Rec,date:string,shift:string){
  if(String(a.work_kind)==="weekly"&&(shift==="2"||shift==="3"))return weeklyDisplay(a);
  const window=operationalShiftWindow(date,shift),start=String(a.starts_at),end=String(a.ends_at);
  const segmentStart=start>window.start?start:window.start,segmentEnd=end<window.end?end:window.end;
  const range=`${segmentStart.slice(11,16)}–${segmentEnd.slice(11,16)}`;
  return statusInShift(a,date,shift)==="overtime"&&a.regular_ends_at?`Extensão HE ${range}`:range;
}
