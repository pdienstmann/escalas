"use client";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { ScheduleNav } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";
import { formatScheduleDate } from "../lib/schedule-date";
import { orderScheduleResources } from "../lib/schedule-sections";
import { operationalGroupLabel, operationalGroupOrder, operationalGroupVehicleIds, operationalTeamLabel, operationalTeamOrder } from "../lib/operational-groups";
import {
  groupRedeploymentAssignments,
  mergeScheduleAssignments,
  type RedeploymentGroup,
} from "../lib/schedule-state";
import { suggestionPosition, type SuggestionPosition } from "../lib/suggestion-position";
import { orderAssignmentsInResourceCell } from "../lib/schedule-lanes";
import { compactRequestReference } from "../lib/request-reference";
import { isMotorcycleType, vehicleRequiresPair } from "../lib/crew-rules";
import { operationalGroupMemberCoversShift } from "../lib/operational-group-schedule";
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
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
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
  serviceAdjustments?: Rec[];
  notices: Rec[];
  sections: Rec[];
  availableForRedeployment: Rec[];
  operations?: Rec[];
  patternLabel?: string;
  weeklySlotCount?: number;
  operationalGroups?: Rec[];
  operationalGroupMembers?: Rec[];
};
type Pick = {
  kind: "post" | "vehicle";
  resource: Rec;
  shift: string;
  assignment?: Rec;
  manualAdd?: boolean;
  extension?: boolean;
  groupId?: number;
};
type HolePick = {
  kind: "post" | "vehicle";
  resource: Rec;
  shift: string;
  role: string | null;
  position: SuggestionPosition | null;
};
type RedeployPick = { assignments: Rec[] };
type ExtensionPick = Pick & { assignment: Rec; extensionMode: "after" | "before" };
type ResourceRemovalPick = { kind: "post" | "vehicle"; resource: Rec; assignments: Rec[] };
type UndoState = { id: number; label: string };
type ViewFilter = "all" | "day" | "night" | "holes" | "redeploy";
type MovementEdit = { type: string; movement?: Rec };
type ScheduleDensity = "compact" | "detailed";
type SwapPick = { pick: Pick; assignments: Rec[] };
type ResourceDialogState = {
  kind: "post" | "vehicle";
  initialResourceId?: number;
  initialShift?: "2" | "4";
  initialMode?: "existing" | "new";
  initialSection?: string;
};
type OperationalGroupGridProps = {
  date: string;
  groups: Rec[];
  members: Rec[];
  guards: Rec[];
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  movements?: Rec[];
  serviceAdjustments?: Rec[];
  shifts: typeof SHIFT_DEFS;
  selectedGroup: string;
  selectedId: number;
  onOpenAssignment: (assignment: Rec, shift: string) => void;
  onExtend: (assignment: Rec, shift: string, mode: "after" | "before") => void;
  onAdjust: (assignment: Rec, shift: string) => void;
  onSwap: (assignment: Rec, shift: string) => void;
  onQuickStatus: (assignment: Rec, status: string) => void;
  onCopy: (assignment: Rec) => void;
  onSuggestHe: (assignment: Rec, shift: string, member: Rec) => void;
  onDetails: (assignment: Rec, shift: string) => void;
  onDelete: (assignment: Rec, shift: string) => void;
  onDragStart: (assignment: Rec) => void;
  onDragEnd: () => void;
  onCloseActions: () => void;
};
type SmartEditorCandidate = {
  guardId: number;
  source: "redeploy" | "overtime";
  detail: string;
  assignmentIds?: number[];
};
const shifts = SHIFT_DEFS;
const scheduleCacheKey=(date:string)=>`gmnh:schedule:${date}`;
function readScheduleCache(date:string):State|null{if(typeof window==="undefined")return null;try{const raw=sessionStorage.getItem(scheduleCacheKey(date));if(!raw)return null;const parsed=JSON.parse(raw) as {savedAt:number;data:State};return Date.now()-parsed.savedAt<5*60_000?parsed.data:null}catch{return null}}
function writeScheduleCache(data:State){if(typeof window==="undefined")return;try{sessionStorage.setItem(scheduleCacheKey(data.date),JSON.stringify({savedAt:Date.now(),data}))}catch{/* cache opcional */}}
function readUiSetting(key:string){if(typeof window==="undefined")return null;try{return sessionStorage.getItem(`gmnh:ui:${key}`)}catch{return null}}
function writeUiSetting(key:string,value:string){if(typeof window==="undefined")return;try{sessionStorage.setItem(`gmnh:ui:${key}`,value)}catch{/* preferência opcional */}}
function setAssignmentDragPreview(event: DragEvent, name: unknown, detail: unknown) {
  if (typeof document === "undefined") return;
  const preview = document.createElement("div");
  preview.className = "assignment-drag-preview";
  const strong = document.createElement("strong");
  strong.textContent = String(name || "GM");
  const small = document.createElement("small");
  small.textContent = String(detail || "Mover na escala");
  preview.append(strong, small);
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 24, 18);
  window.setTimeout(() => preview.remove(), 0);
}
function times(date: string, shift: string) {
  return shiftTimes(date, shift);
}
function addLocalHours(value:string,hours:number){const date=new Date(value);date.setHours(date.getHours()+hours);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function assignmentKey(kind: "post" | "vehicle", resourceId: string | number, shift: string) {
  return `${kind}:${resourceId}:${shift}`;
}
function resourceAssignmentKey(kind: "post" | "vehicle", resourceId: string | number) {
  return `${kind}:${resourceId}`;
}
export function LiveSchedule() {
  const { date, setDate, hrefFor } = useScheduleDate();
  const [data, setData] = useState<State | null>(null),
    [pick, setPick] = useState<Pick | null>(null),
    [holePick, setHolePick] = useState<HolePick | null>(null),
    [redeployPick, setRedeployPick] = useState<RedeployPick | null>(null),
    [extensionPick, setExtensionPick] = useState<ExtensionPick | null>(null),
    [contextPick, setContextPick] = useState<Pick | null>(null),
    [vehicleEdit, setVehicleEdit] = useState<Rec | null>(null),
    [postEdit, setPostEdit] = useState<Rec | null>(null),
    [sectionEdit, setSectionEdit] = useState<{ sectionKey: string; label: string } | null>(null),
    [quickEdit, setQuickEdit] = useState<Pick | null>(null),
    [resourceRemoval, setResourceRemoval] = useState<ResourceRemovalPick | null>(null),
    [createOpen, setCreateOpen] = useState(false),
    [createKind, setCreateKind] = useState<"guard" | "post" | "vehicle" | "section">("guard"),
    [resourceDialog, setResourceDialog] = useState<ResourceDialogState | null>(null),
    [addMenuOpen, setAddMenuOpen] = useState(false),
    [movementsExpanded, setMovementsExpanded] = useState(false),
    [redeploymentExpanded, setRedeploymentExpanded] = useState(false),
    [undoEvents, setUndoEvents] = useState<UndoState[]>([]),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [view, setView] = useState<ViewFilter>("all"),
    [groupFilter, setGroupFilter] = useState("all"),
    [density, setDensity] = useState<ScheduleDensity>("compact"),
    [settingsHydrated, setSettingsHydrated] = useState(false),
    [movementEdit, setMovementEdit] = useState<MovementEdit | null>(null),
    [swapPick,setSwapPick]=useState<SwapPick|null>(null),
    [copiedAssignment,setCopiedAssignment]=useState<Rec|null>(null),
    [draggingAssignmentId,setDraggingAssignmentId]=useState<number|null>(null),
    [recentAssignmentIds,setRecentAssignmentIds]=useState<number[]>([]),
    [collapsed, setCollapsed] = useState<Record<string, boolean>>({}),
    [saving, setSaving] = useState(false),
    [syncing, setSyncing] = useState(false),
    [loadError, setLoadError] = useState(""),
    [conflictNotice, setConflictNotice] = useState(""),
    [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null),
    [sectionJump, setSectionJump] = useState("");
  const loadSequence=useRef(0);
  const loadController=useRef<AbortController|null>(null);
  const savingRef=useRef(false);
  const currentDateRef=useRef(date);
  currentDateRef.current=date;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const scheduleWrapRef = useRef<HTMLElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const load = useCallback(async (background = true) => {
    const sequence=++loadSequence.current;
    loadController.current?.abort();
    const controller=new AbortController();
    loadController.current=controller;
    try {
      const cached=readScheduleCache(date);if(cached&&!background)setData(cached);
      if(!background){setPick(null);setContextPick(null)}
      if(background)setSyncing(true);else setSyncing(false);
      setLoadError("");
      const r = await fetch(`/api/schedule?date=${date}&_=${Date.now()}`, {
        cache: "no-store",
        signal:controller.signal,
      });
      if (!r.ok) throw new Error();
      const value=await r.json();
      if(sequence===loadSequence.current){setData(value);writeScheduleCache(value);setLastSyncedAt(Date.now())}
    } catch (error) {
      if(error instanceof DOMException&&error.name==="AbortError")return;
      if(sequence===loadSequence.current){
        setLoadError("Não foi possível consultar a escala. Recarregue a página para tentar novamente.");
        setMessage("Não foi possível consultar a escala. Recarregue a página para tentar novamente.");
      }
    } finally {
      if(sequence===loadSequence.current&&background)setSyncing(false);
    }
  }, [date]);
  useEffect(()=>()=>loadController.current?.abort(),[]);
  useEffect(() => {
    const savedView = readUiSetting("view");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(readUiSetting("query") || "");
    setView(savedView && ["all", "day", "night", "holes", "redeploy"].includes(savedView) ? savedView as ViewFilter : "all");
    setGroupFilter(readUiSetting("group") || "all");
    setDensity(readUiSetting("density") === "detailed" ? "detailed" : "compact");
    setSettingsHydrated(true);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);
  useEffect(() => {
    if (typeof window === "undefined" || !data) return;
    const refresh = window.setInterval(() => {
      if (!savingRef.current && !pick && !quickEdit && !resourceDialog && !sectionEdit) void load(true);
    }, 60_000);
    return () => window.clearInterval(refresh);
  }, [data, load, pick, quickEdit, resourceDialog, sectionEdit]);
  useEffect(()=>{if(data)writeScheduleCache(data)},[data]);
  useEffect(()=>{if(settingsHydrated){writeUiSetting("query",query);writeUiSetting("view",view);writeUiSetting("group",groupFilter);writeUiSetting("density",density)}},[query,view,groupFilter,density,settingsHydrated]);
  useEffect(() => {
    if (!draggingAssignmentId) return;
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDraggingAssignmentId(null);
      setMessage("Movimentação cancelada.");
    };
    window.addEventListener("keydown", cancelDrag);
    return () => window.removeEventListener("keydown", cancelDrag);
  }, [draggingAssignmentId]);
  useEffect(()=>{
    if(typeof window==="undefined"||data?.date!==date)return;
    const pageKey=`gmnh:scroll:${date}`;
    const gridKey=`gmnh:grid-scroll:${date}`;
    const savedPage=Number(readUiSetting(pageKey)||0);
    const savedGrid=(()=>{try{return JSON.parse(readUiSetting(gridKey)||"{}")}catch{return {}}})();
    const restore=window.requestAnimationFrame(()=>{
      window.scrollTo({top:savedPage,behavior:"instant"});
      const wrapper=scheduleWrapRef.current;
      if(wrapper){wrapper.scrollLeft=Number(savedGrid.left||0);wrapper.scrollTop=Number(savedGrid.top||0)}
    });
    const remember=()=>writeUiSetting(pageKey,String(window.scrollY));
    const rememberGrid=()=>{const wrapper=scheduleWrapRef.current;if(wrapper)writeUiSetting(gridKey,JSON.stringify({left:wrapper.scrollLeft,top:wrapper.scrollTop}))};
    window.addEventListener("scroll",remember,{passive:true});
    const wrapper=scheduleWrapRef.current;
    wrapper?.addEventListener("scroll",rememberGrid,{passive:true});
    return()=>{window.cancelAnimationFrame(restore);remember();rememberGrid();window.removeEventListener("scroll",remember);wrapper?.removeEventListener("scroll",rememberGrid)};
  },[data?.date,date]);
  const scheduleAssignments = data?.assignments;
  const scheduleDate = data?.date;
  const operationalGroupMembers = data?.operationalGroupMembers;
  const operationalGroupByResource = useMemo(() => {
    const map = new Map<string, Rec>();
    for (const member of operationalGroupMembers || []) map.set(`${member.resource_kind}:${member.resource_id}`, member);
    return map;
  }, [operationalGroupMembers]);
  const operationalGroupByGuard = useMemo(() => {
    const map = new Map<number, Rec>();
    for (const member of operationalGroupMembers || []) if (String(member.resource_kind) === "guard") map.set(Number(member.resource_id), member);
    return map;
  }, [operationalGroupMembers]);
  const operationalGroupByGuardShift = useMemo(() => {
    const map = new Map<string, Rec>();
    for (const member of operationalGroupMembers || []) {
      if (String(member.resource_kind) !== "guard") continue;
      const guardId = Number(member.resource_id), period = String(member.pattern_period || ""), shift = String(member.shift || "");
      if (["1", "2", "3", "4"].includes(shift)) map.set(`${guardId}:${shift}`, member);
      if (period === "day" || period === "night") map.set(`${guardId}:${period}`, member);
      if (!shift && !period) map.set(`${guardId}:global`, member);
    }
    return map;
  }, [operationalGroupMembers]);
  const operationalGroupOwnedVehicleIds = useMemo(
    () => operationalGroupVehicleIds((operationalGroupMembers || []) as Parameters<typeof operationalGroupVehicleIds>[0]),
    [operationalGroupMembers],
  );
  const resourceOperationalMeta = useCallback((kind: "post" | "vehicle", resource: Rec) => {
    const member = operationalGroupByResource.get(`${kind}:${resource.id}`);
    return {
      group: member ? String(member.group_name || "") || operationalGroupLabel(resource) : operationalGroupLabel(resource),
      team: member ? String(member.team_label || "") || operationalTeamLabel(resource) : operationalTeamLabel(resource),
      color: member ? String(member.group_color || "") || null : null,
    };
  }, [operationalGroupByResource]);
  const assignmentIndex = useMemo(() => {
    const map = new Map<string, Rec[]>();
    if (!scheduleAssignments || !scheduleDate) return map;
    for (const a of scheduleAssignments) {
      for (const s of shifts) {
        if (!assignmentOverlapsShift(a, scheduleDate, s.id)) continue;
        const period = isDayShift(s.id) ? "day" : "night";
        const ownedMember = operationalGroupByGuardShift.get(`${Number(a.guard_id)}:${s.id}`) || operationalGroupByGuardShift.get(`${Number(a.guard_id)}:${period}`);
        if (ownedMember?.pattern_id) continue;
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
  }, [operationalGroupByGuardShift, scheduleAssignments, scheduleDate]);
  // These indexes are shared by every rendered row. Keeping them at the
  // schedule level avoids each post/VTR scanning the full assignment list
  // again, which is noticeable with a 200+ GM scale.
  const allScheduleAssignments = useMemo(() => {
    if (!scheduleAssignments) return [];
    return [...new Map(scheduleAssignments.map((assignment) => [Number(assignment.id), assignment])).values()];
  }, [scheduleAssignments]);
  const assignmentById = useMemo(
    () => new Map(allScheduleAssignments.map((assignment) => [Number(assignment.id), assignment])),
    [allScheduleAssignments],
  );
  const resourceAssignmentIndex = useMemo(() => {
    const map = new Map<string, Rec[]>();
    for (const assignment of allScheduleAssignments) {
      if (assignment.post_id != null) {
        const key = resourceAssignmentKey("post", Number(assignment.post_id));
        const list = map.get(key) || [];
        list.push(assignment);
        map.set(key, list);
      }
      if (assignment.vehicle_id != null) {
        const key = resourceAssignmentKey("vehicle", Number(assignment.vehicle_id));
        const list = map.get(key) || [];
        list.push(assignment);
        map.set(key, list);
      }
    }
    return map;
  }, [allScheduleAssignments]);
  const redeploymentGroups = useMemo(
    () => groupRedeploymentAssignments(data?.availableForRedeployment || []),
    [data?.availableForRedeployment],
  );
  const deferredQuery=useDeferredValue(query);
  const operationalGroupOptions = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const group of data.operationalGroups || []) {
      const name = String(group.name || "").trim();
      if (name) counts.set(name, 0);
    }
    for (const member of data.operationalGroupMembers || []) {
      const name = String(member.group_name || "").trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    for (const item of orderScheduleResources(data.vehicles, data.posts, data.sections)) {
      const name = resourceOperationalMeta(item.kind, item.r).group;
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const sortOrder = new Map((data.operationalGroups || []).map((group) => [String(group.name), Number(group.sort_order || 99)]));
    return [...counts.entries()].filter(([, count]) => count > 0).sort((left, right) => (sortOrder.get(left[0]) || 99) - (sortOrder.get(right[0]) || 99) || left[0].localeCompare(right[0], "pt-BR"));
  }, [data, resourceOperationalMeta]);
  const activeGroupFilter = useMemo(() => {
    if (groupFilter === "all") return "all";
    return operationalGroupOptions.some(([name, count]) => name === groupFilter && count > 0) ? groupFilter : "all";
  }, [groupFilter, operationalGroupOptions]);
  useEffect(() => {
    if (!data || data.date !== date || groupFilter === "all" || activeGroupFilter !== "all") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroupFilter("all");
  }, [activeGroupFilter, data, date, groupFilter]);
  const resources = useMemo(() => {
    if (!data) return [];
    const q = deferredQuery.toLowerCase().trim();
    const filtered = orderScheduleResources(data.vehicles, data.posts, data.sections).filter((x) => {
      // Recursos da composição aplicada do grupamento aparecem somente na
      // seção do próprio grupamento, sem uma segunda linha convencional.
      if (x.kind === "vehicle" && operationalGroupOwnedVehicleIds.has(Number(x.r.id))) return false;
      const meta = resourceOperationalMeta(x.kind, x.r);
      if (activeGroupFilter !== "all" && meta.group !== activeGroupFilter) return false;
      const text = `${x.r.name || ""} ${x.r.prefix || ""} ${x.r.zone || ""} ${x.r.group_name || ""} ${x.section} ${meta.group || ""} ${meta.team || ""}`
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
          const resourceNeedsPair = x.kind !== "vehicle" || vehicleRequiresPair(x.r.type);
          return list.length < (x.kind === "vehicle" ? resourceNeedsPair ? 2 : 1 : 1);
        });
      }
      return true;
    });
    return filtered.sort((left, right) =>
      left.order - right.order ||
      left.section.localeCompare(right.section, "pt-BR") ||
      operationalGroupOrder({ ...left.r, group_name: resourceOperationalMeta(left.kind, left.r).group }) - operationalGroupOrder({ ...right.r, group_name: resourceOperationalMeta(right.kind, right.r).group }) ||
      operationalTeamOrder({ ...left.r, name: resourceOperationalMeta(left.kind, left.r).team }) - operationalTeamOrder({ ...right.r, name: resourceOperationalMeta(right.kind, right.r).team }) ||
      String(left.r.prefix || left.r.name || "").localeCompare(String(right.r.prefix || right.r.name || ""), "pt-BR"),
    );
  }, [activeGroupFilter, assignmentIndex, data, deferredQuery, operationalGroupOwnedVehicleIds, resourceOperationalMeta, view]);
  const gridResources = useMemo(() => {
    const firstSectionOrder = new Map<string, number>();
    let nextSectionOrder = 0;
    const mapped = resources.map((item, index) => {
      const displaySectionFromItem = item.section;
      // Os grupamentos agora possuem linhas próprias; os recursos permanecem na seção de origem.
      const group = "";
      const displaySection = group ? `GRUPAMENTO · ${group}` : item.section;
      if (!firstSectionOrder.has(displaySection)) firstSectionOrder.set(displaySection, nextSectionOrder++);
      return {
        ...item,
        sourceSection: item.section,
        displaySection: displaySectionFromItem,
        operationalSession: false,
        originalIndex: index,
      };
    });
    return mapped.sort((left, right) =>
      (left.kind === "vehicle" ? 0 : 1) - (right.kind === "vehicle" ? 0 : 1) ||
      (firstSectionOrder.get(left.displaySection) || 0) - (firstSectionOrder.get(right.displaySection) || 0) ||
      left.originalIndex - right.originalIndex,
    );
  }, [resources]);
  const sectionOptions = useMemo(
    () => [...new Set(gridResources.map((item) => item.displaySection))],
    [gridResources],
  );
  const sectionResourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of gridResources) {
      counts.set(item.displaySection, (counts.get(item.displaySection) || 0) + 1);
    }
    return counts;
  }, [gridResources]);
  const firstPostIndex = useMemo(() => gridResources.findIndex((item) => item.kind === "post"), [gridResources]);
  function registerUndo(event: UndoState) {
    setUndoEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 5));
  }
  async function postAssignment(body: Record<string, unknown>) {
    if (savingRef.current) return false;
    const mutationDate=data?.date||date;
    savingRef.current=true;
    setSaving(true);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if(currentDateRef.current!==mutationDate)return r.ok;
      setMessage(r.ok ? (j.message || "Alteração salva e já exibida na escala.") : j.error);
      if (!r.ok) {
        if (r.status === 409 && j.conflict) {
          await load();
          const notice = `${j.error || "A escala foi alterada por outra pessoa."} A versão atual já foi carregada.`;
          setConflictNotice(notice);
          setQuickEdit(null);
          setPick(null);
          setContextPick(null);
          setHolePick(null);
          setSwapPick(null);
          setMessage(`${j.error || "A escala foi alterada por outra pessoa."} A versão atual já foi carregada.`);
        }
        return false;
      }
      if (r.ok) {
        if (j.auditEventId) registerUndo({id:Number(j.auditEventId),label:String(j.message||"Desfazer a última alteração")});
        const changedAssignments: Rec[] = Array.isArray(j.assignments)
          ? j.assignments
          : j.assignment
            ? [j.assignment]
            : [];
        if(changedAssignments.length){const ids=changedAssignments.map(item=>Number(item.id));setRecentAssignmentIds(ids);window.setTimeout(()=>setRecentAssignmentIds(current=>current.filter(id=>!ids.includes(id))),1800)}
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
        setSwapPick(null);
        if(j.deletedId&&Number(copiedAssignment?.id)===Number(j.deletedId))setCopiedAssignment(null);
      }
      return r.ok;
    } catch {
      setMessage("A alteração não foi concluída. Verifique a conexão e tente novamente.");
      return false;
    } finally {
      savingRef.current=false;
      setSaving(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !pick) return;
    const body = Object.fromEntries(new FormData(e.currentTarget)),
      [destination, id] = String(body.destination).split(":");
    const smartSource = String(body.smartSource || "");
    const smartAssignmentIds = String(body.smartAssignmentIds || "").split(",").map(Number).filter(Boolean);
    if (pick.manualAdd && smartSource === "redeploy" && smartAssignmentIds.length) {
      await postAssignment({
        action: "redeploy_group",
        assignmentIds: smartAssignmentIds,
        scheduleId: data.schedule.id,
        postId: destination === "post" ? Number(id) : null,
        vehicleId: destination === "vehicle" ? Number(id) : null,
        role: body.role || (pick.kind === "vehicle" ? "patrol" : "guard"),
        reassignmentNote: "Remanejamento rápido a partir da sugestão inteligente",
      });
      return;
    }
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
      expectedUpdatedAt: pick.assignment?.updated_at || null,
      scheduleId: data.schedule.id,
      postId: destination === "post" ? Number(id) : null,
      vehicleId: destination === "vehicle" ? Number(id) : null,
      extensionPostId: extensionDestination[0] === "post" ? Number(extensionDestination[1]) : null,
      extensionVehicleId: extensionDestination[0] === "vehicle" ? Number(extensionDestination[1]) : null,
      status: smartSource === "overtime" ? "overtime" : body.status,
      requestRef: smartSource === "overtime" ? "Sugestão inteligente · equipe oposta" : body.requestRef || null,
    });
  }
  async function remove() {
    if (!pick?.assignment) return;
    await postAssignment({
      action: "delete",
      id: Number(pick.assignment.id),
      expectedUpdatedAt: pick.assignment.updated_at || null,
    });
  }
  async function removeAssignmentSegment(assignment: Rec, shift?: string) {
    if (!data) return;
    const targetShift = shift || String(contextPick?.shift || pick?.shift || assignment.shift || "2");
    const window = operationalShiftWindow(data.date, targetShift);
    if (!confirm(`Remover ${assignment.guard_name} somente de ${window.start.slice(11, 16)}–${window.end.slice(11, 16)}? Os outros horários serão preservados.`)) return;
    await postAssignment({
      action: "delete_shift_segment",
      id: Number(assignment.id),
      scheduleId: data.schedule.id,
      shift: targetShift,
      expectedUpdatedAt: assignment.updated_at || null,
    });
  }
  async function saveQuickExtension(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!data||!extensionPick)return;
    const values=Object.fromEntries(new FormData(event.currentTarget));
    const[destination,id]=String(values.destination).split(":");
    const saved=await postAssignment({
      action:"create_overtime_extension",
      baseAssignmentId:extensionPick.assignment.id,
      expectedUpdatedAt: extensionPick.assignment.updated_at || null,
      scheduleId:data.schedule.id,
      startsAt:values.startsAt,
      endsAt:values.endsAt,
      shift:values.shift,
      role:values.role,
      requestRef:values.requestRef||null,
      direction:extensionPick.extensionMode,
      postId:destination==="post"?Number(id):null,
      vehicleId:destination==="vehicle"?Number(id):null,
    });
    if(saved)setExtensionPick(null);
  }
  async function quickStatus(assignment:Rec,status:string){
    if(!data)return;
    await postAssignment({id:assignment.id,expectedUpdatedAt:assignment.updated_at||null,scheduleId:data.schedule.id,guardId:assignment.guard_id,postId:assignment.post_id||null,vehicleId:assignment.vehicle_id||null,shift:assignment.shift,role:assignment.role,startsAt:assignment.starts_at,endsAt:assignment.ends_at,regularEndsAt:assignment.regular_ends_at||null,workKind:assignment.work_kind||"shift",status,requestRef:assignment.request_ref||null,isReassigned:Number(assignment.is_reassigned)===1,reassignmentNote:assignment.reassignment_note||null});
  }
  async function undoLast(){
    const undoEvent = undoEvents[0];
    if(!undoEvent||savingRef.current)return;
    savingRef.current=true;setSaving(true);
    try{
      const response=await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"undo",id:undoEvent.id})});
      const result=await response.json();
      setMessage(response.ok?result.message:result.error);
      if(!response.ok)return;
      setUndoEvents((current) => current.filter((item) => item.id !== undoEvent.id));
      const deletedIds=new Set<number>((result.deletedAssignmentIds||[]).map(Number));
      const restored:Rec[]=result.assignments||[];
      if(result.requiresReload){await load();return;}
      setData(current=>{
        if(!current)return current;
        const active=current.assignments.filter(item=>!deletedIds.has(Number(item.id)));
        const available=current.availableForRedeployment.filter(item=>!deletedIds.has(Number(item.id)));
        return{...current,...mergeScheduleAssignments(active,available,restored)};
      });
      if(restored.length){const ids=restored.map(item=>Number(item.id));setRecentAssignmentIds(ids);window.setTimeout(()=>setRecentAssignmentIds(current=>current.filter(id=>!ids.includes(id))),1800)}
      if(copiedAssignment&&deletedIds.has(Number(copiedAssignment.id)))setCopiedAssignment(null);
    }catch{setMessage("Não foi possível desfazer agora. A escala exibida foi preservada.")}
    finally{savingRef.current=false;setSaving(false)}
  }
  async function createCatalogItem(event:FormEvent<HTMLFormElement>,kind:"guard"|"post"|"vehicle"|"section"){
    event.preventDefault();if(!data||saving)return;setSaving(true);
    try{const values=Object.fromEntries(new FormData(event.currentTarget));const response=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...values,action:kind==="section"?"section_create":kind})});const result=await response.json();setMessage(response.ok?result.message:result.error);if(!response.ok)return;const entity=result.entity as Rec;setData(current=>{if(!current)return current;if(kind==="guard")return{...current,guards:[...current.guards,entity].sort((a,b)=>String(a.name).localeCompare(String(b.name),"pt-BR"))};if(kind==="post")return{...current,posts:[...current.posts,entity]};if(kind==="vehicle")return{...current,vehicles:[...current.vehicles,entity],allVehicles:[...current.allVehicles,entity]};return{...current,sections:[...current.sections,entity]}});setCreateOpen(false)}finally{setSaving(false)}
  }
  async function saveMovement(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!movementEdit||saving)return;setSaving(true);
    try{const values=Object.fromEntries(new FormData(event.currentTarget));const response=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...values,action:movementEdit.movement?"movement_update":"movement",id:movementEdit.movement?.id||null,type:movementEdit.type})});const result=await response.json();setMessage(response.ok?(movementEdit.movement?"Registro atualizado.":"Registro incluído e aplicado à escala."):result.error);if(response.ok){setMovementEdit(null);await load()}}finally{setSaving(false)}
  }
  async function deleteMovement(movement:Rec){
    if(saving||!confirm(`Remover ${movement.guard_name} desta seção?`))return;setSaving(true);
    try{const response=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"movement_delete",id:movement.id})});const result=await response.json();setMessage(response.ok?"Registro removido e GM devolvido à escala.":result.error);if(response.ok)await load()}finally{setSaving(false)}
  }
  async function saveResourceCrew(event: FormEvent<HTMLFormElement>, kind: "post" | "vehicle") {
    event.preventDefault();
    if (!data || savingRef.current) return;
    savingRef.current=true;
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
       const selectedGuards = form.getAll("crewGuardId").map(String);
       const roles = form.getAll("crewRole").map(String);
       const members = selectedGuards.map((value, index) => {
         const [rawId, source] = value.split("|");
         return { guardId: Number(rawId), role: kind === "vehicle" ? roles[index] || "third" : "guard", source: source === "redeploy" ? "redeploy" : "overtime" };
       }).filter((member) => member.guardId > 0);
      const assignResponse = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "assign_resource_group", scheduleId: data.schedule.id, shift: form.get("shift"), postId: kind === "post" ? resourceId : null, vehicleId: kind === "vehicle" ? resourceId : null, members }) });
      const assigned = await assignResponse.json();
      setMessage(assignResponse.ok ? assigned.message : assigned.error);
      if (!assignResponse.ok) {
        if (entity) await load();
        return;
      }
      if (assigned.auditEventId) registerUndo({ id: Number(assigned.auditEventId), label: "Desfazer inclusão da equipe" });
      setData((current) => {
        if (!current) return current;
        const merged = mergeScheduleAssignments(current.assignments, current.availableForRedeployment, assigned.assignments || []);
        if (!entity) return { ...current, ...merged };
        return kind === "vehicle"
          ? { ...current, ...merged, vehicles: [...current.vehicles, entity], allVehicles: [...current.allVehicles, entity] }
          : { ...current, ...merged, posts: [...current.posts, entity] };
      });
      setResourceDialog(null);
    } catch {
      setMessage("Não foi possível adicionar a equipe. Verifique a conexão e tente novamente.");
    } finally {
      savingRef.current=false;
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
      expectedUpdatedAts: candidate.assignmentIds.map((id) => {
        const assignment = [...data.assignments, ...data.availableForRedeployment].find((item) => Number(item.id) === Number(id));
        return { id, updatedAt: assignment?.updated_at };
      }),
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
    const regularCrew = list.filter((assignment) => !isOvertimeExtensionCell(assignment, data.date, shift));
    const missingRole =
      kind === "vehicle"
        ? isMotorcycleType(resource.type)
          ? "driver"
          : !regularCrew.some((assignment) => String(assignment.role) === "driver")
          ? "driver"
          : !regularCrew.some((assignment) => String(assignment.role) === "patrol")
            ? "patrol"
            : "third"
        : "guard";
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
  async function quickAddGuard(guardId: number, kind: "post" | "vehicle", resource: Rec, shift: string) {
    if (!data) return;
    const list = assignmentIndex.get(assignmentKey(kind, Number(resource.id), shift)) || [];
    const regularCrew = list.filter((assignment) => !isOvertimeExtensionCell(assignment, data.date, shift));
    const role = kind === "post"
      ? "guard"
      : isMotorcycleType(resource.type)
        ? "driver"
        : !regularCrew.some((assignment) => String(assignment.role) === "driver")
        ? "driver"
          : !regularCrew.some((assignment) => String(assignment.role) === "patrol")
            ? "patrol"
            : "third";
    const t = fullPeriodWindow(data.date, shift);
    const poolGroup = data.availableForRedeployment.filter((assignment) =>
      Number(assignment.guard_id) === Number(guardId) &&
      String(assignment.starts_at) < t.end &&
      String(assignment.ends_at) > t.start,
    );
    if (poolGroup.length) {
      await postAssignment({
        action: "redeploy_group",
        assignmentIds: poolGroup.map((assignment) => Number(assignment.id)),
        expectedUpdatedAts: poolGroup.map((assignment) => ({ id: assignment.id, updatedAt: assignment.updated_at })),
        scheduleId: data.schedule.id,
        postId: kind === "post" ? Number(resource.id) : null,
        vehicleId: kind === "vehicle" ? Number(resource.id) : null,
        role,
        reassignmentNote: "Remanejamento rápido a partir da fila à disposição",
      });
      return;
    }
    const hasOtherBlock = [...data.assignments, ...data.availableForRedeployment].some((assignment) =>
      Number(assignment.guard_id) === Number(guardId) &&
      String(assignment.starts_at) !== t.start &&
      String(assignment.ends_at) !== t.end,
    );
    await postAssignment({
      fillFullPeriod: true,
      scheduleId: data.schedule.id,
      guardId,
      postId: kind === "post" ? Number(resource.id) : null,
      vehicleId: kind === "vehicle" ? Number(resource.id) : null,
      shift,
      role,
      startsAt: t.start,
      endsAt: t.end,
      status: hasOtherBlock ? "overtime" : "normal",
      isReassigned: 0,
      requestRef: null,
    });
  }
  function openCreate(kind: "guard" | "post" | "vehicle" | "section") {
    if (kind === "post" || kind === "vehicle") {
      setResourceDialog({ kind });
      return;
    }
    setCreateKind(kind);
    setCreateOpen(true);
  }
  function startExtension(assignment: Rec, kind: "post" | "vehicle", resource: Rec, shift: string, extensionMode:"after"|"before"="after") {
    setExtensionPick({ kind, resource, shift, assignment, extensionMode });
    setPick(null);
    setContextPick(null);
  }
  function copyAssignment(assignment:Rec){setCopiedAssignment(assignment);setContextPick(null);setMessage(`${assignment.guard_name} copiado. Escolha “Colar” no quadrante de destino.`)}
  async function pasteAssignment(kind:"post"|"vehicle",resource:Rec,shift:string){
    if(!data||!copiedAssignment)return;
    const saved=await postAssignment({action:"copy_assignment_to_cell",sourceAssignmentId:copiedAssignment.id,scheduleId:data.schedule.id,postId:kind==="post"?resource.id:null,vehicleId:kind==="vehicle"?resource.id:null,shift});
    if(saved)setCopiedAssignment(null);
  }
  useEffect(()=>{
    if(!copiedAssignment)return;
    const cancel=(event:KeyboardEvent)=>{if(event.key==="Escape"){setCopiedAssignment(null);setMessage("Cópia cancelada.")}};
    window.addEventListener("keydown",cancel);
    return()=>window.removeEventListener("keydown",cancel);
  },[copiedAssignment]);
  function openQuickSwap(assignment:Rec,kind:"post"|"vehicle",resource:Rec,shift:string){
    if(!data)return;
    const period=isDayShift(shift)?"day":"night",extension=String(assignment.work_kind)==="overtime_extension";
    const linked=data.assignments.filter(item=>Number(item.guard_id)===Number(assignment.guard_id)&&(kind==="post"?Number(item.post_id)===Number(resource.id):Number(item.vehicle_id)===Number(resource.id))&&(String(item.work_kind)==="overtime_extension")===extension&&coveredOperationalShifts(item,data.date).some(id=>(isDayShift(id)?"day":"night")===period));
    const unique=[...new Map(linked.map(item=>[Number(item.id),item])).values()];
    setSwapPick({pick:{kind,resource,shift,assignment},assignments:unique.length?unique:[assignment]});setContextPick(null);setPick(null);
  }
  async function replaceGuard(guardId:number){
    if(!swapPick)return;
    await postAssignment({action:"replace_guard_group",guardId,assignmentIds:swapPick.assignments.map(item=>Number(item.id)),expectedUpdatedAts:swapPick.assignments.map(item=>({id:item.id,updatedAt:item.updated_at}))});
  }
  async function move(
    assignment: Rec,
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
    sourceShift?: string,
    targetAssignmentId?: number,
  ) {
    if (!data) return;
    const independentOvertime = String(assignment.work_kind) === "overtime_extension";
    const availableGroup = !independentOvertime
      ? redeploymentGroups.find((group) =>
          group.assignments.some((item) => Number(item.id) === Number(assignment.id)),
        )
      : null;
    const targetPeriod = isDayShift(shift) ? "day" : "night";
    // A bandeja representa o expediente operacional inteiro do GM. Mesmo que
    // uma integração antiga envie só um dos quadradinhos, ambos os turnos do
    // mesmo período seguem juntos para o destino.
    if (availableGroup && availableGroup.period === targetPeriod) {
      await moveGroup(availableGroup.assignments, kind, resource);
      return;
    }
    const sameResource = kind === "post"
      ? Number(assignment.post_id) === Number(resource.id)
      : Number(assignment.vehicle_id) === Number(resource.id);
    // A cross-turn assignment can be rendered in both columns. When the user
    // is only changing its lane in the visible cell, the drag source is the
    // reliable cell identity; do not rewrite the assignment's real shift.
    const sameShift = sourceShift ? sourceShift === shift : String(assignment.shift) === shift;
    const reorder = async (expectedUpdatedAt?: unknown) => {
      const reordered = await postAssignment({
        action: "reorder_resource_assignments",
        scheduleId: data.schedule.id,
        resourceKind: kind,
        resourceId: resource.id,
        assignmentId: assignment.id,
        beforeAssignmentId: targetAssignmentId || null,
        expectedUpdatedAt: expectedUpdatedAt || null,
      });
      if (reordered) setMessage(`${String(assignment.guard_name || "GM")} reposicionado.`);
      return reordered;
    };
    if (!independentOvertime && sameResource && sameShift) {
      await reorder(assignment.updated_at);
      return;
    }
    if (!sameShift) {
      await postAssignment({
        action: "move_assignment_to_cell",
        id: assignment.id,
        expectedUpdatedAt: assignment.updated_at || null,
        scheduleId: data.schedule.id,
        sourceShift: sourceShift || assignment.shift,
        shift,
        postId: kind === "post" ? resource.id : null,
        vehicleId: kind === "vehicle" ? resource.id : null,
      });
      return;
    }
    const regularEnd = String(assignment.regular_ends_at || "");
    if (regularEnd && String(assignment.status) === "overtime") {
      const extensionMove = sourceShift
        ? operationalShiftWindow(data.date, sourceShift).start >= regularEnd
        : operationalShiftWindow(data.date, shift).start >= regularEnd;
      const originalPostId = assignment.post_id || null;
      const originalVehicleId = assignment.vehicle_id || null;
      const moved = await postAssignment({
        action: "save_with_extension",
        id: assignment.id,
        expectedUpdatedAt: assignment.updated_at || null,
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
      if (moved && !independentOvertime && !extensionMove) await reorder();
      return;
    }
    const t = times(data.date, shift),
      preserveInterval = String(assignment.shift) === shift || Boolean(sourceShift && sourceShift === shift && assignmentOverlapsShift(assignment, data.date, sourceShift)),
      targetStart=preserveInterval?String(assignment.starts_at):t.start,
      targetEnd=preserveInterval?String(assignment.ends_at):t.end,
      targetCrew=data.assignments.filter((a)=>Number(a.id)!==Number(assignment.id)&&(kind==="post"?Number(a.post_id)===Number(resource.id):Number(a.vehicle_id)===Number(resource.id))&&String(a.starts_at)<targetEnd&&String(a.ends_at)>targetStart),
      targetRoles=new Set(targetCrew.map(item=>String(item.role))),
      targetRole=kind==="post"?"guard":!targetRoles.has("driver")?"driver":!targetRoles.has("patrol")?"patrol":"third";
    const moved = await postAssignment({
      id: assignment.id,
      expectedUpdatedAt: assignment.updated_at || null,
      scheduleId: data.schedule.id,
      guardId: assignment.guard_id,
      postId: kind === "post" ? resource.id : null,
      vehicleId: kind === "vehicle" ? resource.id : null,
      shift,
      role:targetRole,
      startsAt:targetStart,
      endsAt:targetEnd,
      status: assignment.status,
      requestRef: assignment.request_ref || null,
      isReassigned: 1,
      reassignmentNote: assignment.reassignment_note || "Remanejamento na escala",
    });
    if (moved && !independentOvertime) await reorder();
    else if (moved) setMessage(`${String(assignment.guard_name || "GM")} movido para ${String(kind === "vehicle" ? resource.prefix : resource.name)}.`);
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
    const moved = await postAssignment({
      action: "redeploy_group",
      assignmentIds: assignments.map((assignment) => Number(assignment.id)),
      expectedUpdatedAts: assignments.map((assignment) => ({ id: assignment.id, updatedAt: assignment.updated_at })),
      scheduleId: data.schedule.id,
      postId: kind === "post" ? Number(resource.id) : null,
      vehicleId: kind === "vehicle" ? Number(resource.id) : null,
    });
    if (moved) setMessage(`${String(assignments[0].guard_name || "GM")} movido para ${String(kind === "vehicle" ? resource.prefix : resource.name)}.`);
  }
  async function saveVehicleQuick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !vehicleEdit || savingRef.current) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    savingRef.current=true;setSaving(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "vehicle_quick_update",
          scheduleId: data.schedule.id,
          fromVehicleId: vehicleEdit.id,
          expectedVehicleUpdatedAt: vehicleEdit.updated_at || null,
          toVehicleId: Number(body.toVehicleId),
          zone: String(body.zone || ""),
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (!response.ok) {
        if (response.status === 409 && result.conflict) {
          await load();
          setMessage(`${result.error || "A viatura foi alterada por outra pessoa."} A versão atual já foi carregada.`);
        }
        return;
      }
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
    } catch {
      setMessage("Não foi possível atualizar a viatura. Nenhum GM foi removido da tela.");
    } finally {
      savingRef.current=false;
      setSaving(false);
    }
  }
  async function savePostQuick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !postEdit || savingRef.current) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "catalog_update",
          entity: "post",
          id: postEdit.id,
          name: String(body.name || "").trim(),
          groupName: String(body.groupName || "").trim(),
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 99,
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? "Posto atualizado na escala." : result.error);
      if (!response.ok) return;
      const updated = {
        ...postEdit,
        name: String(body.name || "").trim(),
        group_name: String(body.groupName || "").trim(),
        sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 99,
      };
      setData((current) => current ? {
        ...current,
        posts: current.posts.map((post) => Number(post.id) === Number(updated.id) ? updated : post),
      } : current);
      setPostEdit(null);
    } catch {
      setMessage("Nao foi possivel atualizar o posto. A escala exibida foi preservada.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function saveSectionQuick(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !sectionEdit || savingRef.current) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const label = String(body.label || "").trim();
    if (!label) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "section_update", sectionKey: sectionEdit.sectionKey, label }),
      });
      const result = await response.json();
      setMessage(response.ok ? "Seção atualizada na escala." : result.error);
      if (!response.ok) return;
      setData((current) => current ? {
        ...current,
        sections: current.sections.map((section) => String(section.section_key) === sectionEdit.sectionKey
          ? { ...section, label }
          : section),
      } : current);
      setSectionEdit(null);
    } catch {
      setMessage("Não foi possível atualizar a seção. A escala exibida foi preservada.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function saveQuickAssignment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !quickEdit?.assignment) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const assignment = quickEdit.assignment;
    const saved = await postAssignment({
      id: assignment.id,
      expectedUpdatedAt: assignment.updated_at || null,
      scheduleId: data.schedule.id,
      guardId: assignment.guard_id,
      postId: quickEdit.kind === "post" ? Number(quickEdit.resource.id) : null,
      vehicleId: quickEdit.kind === "vehicle" ? Number(quickEdit.resource.id) : null,
      shift: body.shift || assignment.shift,
      role: body.role || assignment.role,
      startsAt: body.startsAt || assignment.starts_at,
      endsAt: body.endsAt || assignment.ends_at,
      regularEndsAt: assignment.regular_ends_at || null,
      workKind: assignment.work_kind || "shift",
      status: body.status || assignment.status || "normal",
      requestRef: body.requestRef || assignment.request_ref || null,
      isReassigned: body.isReassigned ? 1 : 0,
      reassignmentNote: body.reassignmentNote || null,
    });
    if (saved) setQuickEdit(null);
  }
  async function removeResourceFromDay() {
    if (!data || !resourceRemoval || savingRef.current) return;
    savingRef.current=true;setSaving(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "remove_resource_from_day",
          scheduleId: data.schedule.id,
          resourceKind: resourceRemoval.kind,
          resourceId: resourceRemoval.resource.id,
          expectedResourceUpdatedAt: resourceRemoval.resource.updated_at || null,
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (!response.ok) {
        if (response.status === 409 && result.conflict) {
          await load();
          setMessage(`${result.error || "Este local foi alterado por outra pessoa."} A versão atual já foi carregada.`);
        }
        return;
      }
      if (result.auditEventId) registerUndo({ id: Number(result.auditEventId), label: "Desfazer retirada do local" });
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
    } catch {
      setMessage("Não foi possível retirar o local. A escala exibida foi preservada.");
    } finally {
      savingRef.current=false;
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
      { key: "medical_leave", label: "Licenças/atestados", types: ["medical_leave", "other_leave"] },
      { key: "adjustments", label: "Banco de horas / Trocas", types: ["time_bank", "swap"] },
    ];
    if (!data) return [];
    return groups.map((g) => ({
        ...g,
        items: data.movements.filter((m) => g.types.includes(String(m.type))),
      }));
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
          ? isMotorcycleType(x.r.type)
            ? !list.some((assignment) => !isOvertimeExtensionCell(assignment, data.date, s.id))
            : !list.some((assignment)=>assignment.role==="driver"&&!isOvertimeExtensionCell(assignment,data.date,s.id)) || !list.some((assignment)=>assignment.role==="patrol"&&!isOvertimeExtensionCell(assignment,data.date,s.id))
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
    // Pendências precisa manter a grade visível: a pessoa consegue conferir
    // o furo e, logo abaixo, arrastar um GM da bandeja à disposição para ele.
    if (target === "pending") setView("holes");
    requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function jumpToSection(section: string) {
    setSectionJump(section);
    if (!section) return;
    requestAnimationFrame(() => {
      const row = sectionRefs.current.get(section);
      const wrapper = scheduleWrapRef.current;
      if (!row || !wrapper) return;
      const rowBox = row.getBoundingClientRect();
      const wrapperBox = wrapper.getBoundingClientRect();
      wrapper.scrollBy({ top: rowBox.top - wrapperBox.top - 42, behavior: "smooth" });
    });
  }
  const showRedeploy = view === "all" || view === "holes" || view === "redeploy";
  const showTable = view !== "redeploy";

  return (
    <main className={`app ${density} ${saving?"is-saving":""}`} aria-busy={saving||syncing}>
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
            onChange={(e) => {setCopiedAssignment(null);setContextPick(null);setPick(null);setDate(e.target.value)}}
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
      <ScheduleNav date={date} active="/escala" />
      {syncing&&<div className="schedule-sync-banner" role="status">Atualizando a escala sem fechar a visualização atual…</div>}
      <section className="toolbar">
        <strong>Escala de {formatScheduleDate(data.date)}</strong>
        <span
          className="pattern-confirm"
          title={Number(data.weeklySlotCount || 0) > 0
            ? `${data.weeklySlotCount} posição(ões) semanais também são consideradas nesta data.`
            : "Nenhuma posição semanal está cadastrada; a escala usa somente os padrões 12x36 e os ajustes do dia."}
        >
          Padrão: {data.patternLabel || "Sem padrão aplicado"}
        </span>
        <span className={`sync ${saving?"saving":""}`} aria-live="polite">{saving?"◌ salvando alteração…":lastSyncedAt?`● sincronizado às ${new Date(lastSyncedAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`:"● sincronizado"}</span>
        <button type="button" className="sync-refresh" disabled={saving} onClick={()=>void load()} title="Atualizar a escala sem sair da data">↻ Atualizar</button>
        <div className="seg toolbar-seg" role="group" aria-label="Atalhos da escala">
          <button type="button" className={view==="all"?"active":""} onClick={()=>setView("all")}>Tudo</button>
          <button type="button" className={view==="day"?"active":""} onClick={()=>jump("day")}>Diurno</button>
          <button type="button" className={view==="night"?"active":""} onClick={()=>jump("night")}>Noturno</button>
          <button type="button" className={view==="holes"||view==="redeploy"?"active":""} onClick={()=>jump("pending")}>Pendências</button>
        </div>
        <div className="seg density-seg" role="group" aria-label="Nível de detalhes da escala">
          <button type="button" className={density==="compact"?"active":""} aria-pressed={density==="compact"} onClick={()=>setDensity("compact")}>Compacto</button>
          <button type="button" className={density==="detailed"?"active":""} aria-pressed={density==="detailed"} onClick={()=>setDensity("detailed")}>Detalhado</button>
        </div>
        <label className="section-jump">
          <span>Ir para área</span>
          <select
            aria-label="Ir diretamente para uma área da escala"
            value={sectionJump}
            onChange={(event) => jumpToSection(event.target.value)}
          >
            <option value="">Selecionar...</option>
            {sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
          </select>
        </label>
        <label className="section-jump group-filter">
          <span>Grupamento</span>
          <select aria-label="Filtrar por grupamento operacional" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">Todos</option>
            {operationalGroupOptions.map(([name, count]) => <option key={name} value={name}>{name} · {count}</option>)}
          </select>
        </label>
        <div className="schedule-add-menu">
          <button type="button" className="schedule-add-trigger" aria-expanded={addMenuOpen} onClick={()=>setAddMenuOpen(value=>!value)}>＋ Adicionar</button>
          {addMenuOpen&&<div role="menu"><button type="button" onClick={()=>{setAddMenuOpen(false);startManualAdd()}}>👤 Escalar GM</button><button type="button" onClick={()=>{setAddMenuOpen(false);openCreate("vehicle")}}>🚓 Viatura</button><button type="button" onClick={()=>{setAddMenuOpen(false);openCreate("post")}}>📍 Posto</button><button type="button" onClick={()=>{setAddMenuOpen(false);openCreate("section")}}>▦ Seção</button></div>}
        </div>
        <input
          aria-busy={query!==deferredQuery}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar posto, VTR, zona ou GM…"
        />
        <Link className="toolbar-link" href={hrefFor("/impressao")}>
          Gerar PDF
        </Link>
        <Link className="toolbar-operation-link" href={hrefFor("/operacoes")}>
          ＋ Operação
        </Link>
        <div className="schedule-scroll-controls" role="group" aria-label="Mover visualização dos turnos">
          <button type="button" title="Turnos anteriores" onClick={()=>scheduleWrapRef.current?.scrollBy({left:-420,behavior:"smooth"})}>←</button>
          <button type="button" title="Próximos turnos" onClick={()=>scheduleWrapRef.current?.scrollBy({left:420,behavior:"smooth"})}>→</button>
        </div>
      </section>
      <section className="scale-reading-key" aria-label="Legenda rápida da escala">
        <strong>Leitura rápida</strong>
        <span><b className="key-chip key-he">HE</b> hora extra</span>
        <span><b className="key-chip key-bh">BH</b> banco de horas</span>
        <span><b className="key-chip key-troca">TROCA</b> troca de serviço</span>
        <span><b className="key-chip key-rem">AVISAR REM</b> remanejamento</span>
        <span><b className="key-chip key-furo">FURO</b> conferir vaga</span>
      </section>
      {copiedAssignment&&<section className="schedule-clipboard" role="status"><span aria-hidden="true">▣</span><div><b>{copiedAssignment.guard_name} copiado</b><small>Os destinos compatíveis estão destacados. O horário será ajustado ao quadrante; se já houver turno normal no dia, a cópia será marcada como HE.</small></div><button type="button" onClick={()=>{setCopiedAssignment(null);setMessage("Cópia cancelada.")}}>Cancelar · Esc</button></section>}
      {data.notices?.length > 0 && (
        <section className="daily-notices">
          <b>Alterações previstas para esta data</b>
          {data.notices.map((n) => (
            <span key={n.id}>{n.title}</span>
          ))}
          <Link href={hrefFor("/alteracoes")}>Conferir</Link>
        </section>
      )}
      {Boolean(data.operations?.length) && <section className="daily-operations-summary"><div><span>OPERAÇÕES DO DIA</span><b>{data.operations?.length} mini escala(s) vinculada(s)</b></div><div>{data.operations?.slice(0,3).map(operation=><span key={String(operation.id)}><b>{operation.title}</b><small>{String(operation.starts_at).slice(11,16)}–{String(operation.ends_at).slice(11,16)} · {operation.filled}/{operation.total_slots} GMs</small></span>)}</div><Link href={hrefFor("/operacoes")}>Abrir operações</Link></section>}

      {message && (
        <div className="schedule-toast" role="status">
          <span className="schedule-toast-message">{message}</span>
          {undoEvents.length>0&&<span className="schedule-toast-undo-label">Ultima acao: {undoEvents[0].label}</span>}
          {undoEvents.length>0&&<button className="toast-undo" disabled={saving} onClick={undoLast} title={`${undoEvents.length} alteração(ões) recente(s) disponíveis`}>↶ Desfazer{undoEvents.length>1?` (${undoEvents.length})`:""}</button>}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      {conflictNotice && (
        <section className="schedule-conflict-notice" role="alert">
          <div><b>Escala atualizada por outra pessoa</b><span>{conflictNotice}</span></div>
          <button type="button" onClick={() => setConflictNotice("")}>Entendi</button>
        </section>
      )}
      {showRedeploy && data.availableForRedeployment.length > 0 && (
        <section className={`redeployment-pool redeployment-pool-top ${redeploymentExpanded||view==="redeploy"||view==="holes"?"expanded":"collapsed"}`}>
          <header><div><span>À DISPOSIÇÃO</span><h2>{redeploymentGroups.length} GM(s) aguardando destino</h2><p>O bloco reúne os dois turnos. Arraste para um posto/VTR ou escolha o destino.</p></div><button type="button" onClick={()=>setRedeploymentExpanded(value=>!value)}>{redeploymentExpanded||view==="redeploy"||view==="holes"?"Recolher":"Abrir bandeja"}</button></header>
          {(redeploymentExpanded||view==="redeploy"||view==="holes")&&<div>{redeploymentGroups.map((group) => (
            <article key={group.key} draggable className={draggingAssignmentId === Number(group.assignments[0]?.id) ? "dragging-source" : ""} aria-label={`GM à disposição ${group.guardName}. Arraste o expediente completo para um posto ou viatura`} onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/assignment", String(group.assignments[0].id));
              event.dataTransfer.setData("text/assignment-group", group.assignments.map((assignment) => assignment.id).join(","));
              setAssignmentDragPreview(event, group.guardName, `${group.period === "day" ? "Diurno" : "Noturno"} completo`);
              setDraggingAssignmentId(Number(group.assignments[0].id));
            }} onDragEnd={() => setDraggingAssignmentId(null)}>
              <span className="redeploy-drag" aria-hidden="true">⋮⋮</span>
              <div><b>{group.guardName}</b><small>{redeploymentTimeLabel(group.assignments)} · {group.period === "day" ? "Diurno · 2º + 3º" : "Noturno · 4º + 1º"}</small></div>
              <button type="button" onClick={() => setRedeployPick({ assignments: group.assignments })}>Escolher destino</button>
            </article>
          ))}</div>}
        </section>
      )}
      <div className={`workspace ${pick?"has-editor":"schedule-only"}`}>
        <section ref={scheduleWrapRef} className={`schedule-wrap ${data.date!==date?"is-switching":""}`}>
          {data.date!==date&&<div className="schedule-switching" role="status"><b>Abrindo escala de {formatScheduleDate(date)}</b><span>A escala anterior permanece bloqueada até a nova data terminar de carregar.</span></div>}
          <div className="drag-help">
            <span className="keyboard-help">Teclado: Tab entra na grade · Enter abre o quadrante · setas navegam · Esc fecha ações.</span>
            {draggingAssignmentId && <strong className="drag-active-help">Arraste ativo: solte em uma célula azul compatível ou sobre outro GM para escolher a posição.</strong>}
            Arraste um GM para outra célula ou solte sobre outro quadradinho para escolher a posição. A ordem é alinhada somente dentro do mesmo posto/viatura; HE independente fica fora. Ao preencher um furo diurno, o GM é escalado no turno inteiro (07:00–19:00).
          </div>
          {showTable && (
          <table className="schedule" ref={tableRef}>
            <thead>
              <><tr>
                <th rowSpan={2}>POSTO / RECURSO</th>
                {visibleShifts.some((s)=>s.period==="day") && (
                  <th className="period-group period-day-head" colSpan={visibleShifts.filter((s)=>s.period==="day").length}>DIURNO</th>
                )}
                {visibleShifts.some((s)=>s.period==="night") && (
                  <th className="period-group period-night-head period-night-start" colSpan={visibleShifts.filter((s)=>s.period==="night").length}>NOTURNO</th>
                )}
              </tr><tr>
                {visibleShifts.map((s) => (
                  <th key={s.id} className={`period-${s.period} ${s.id==="4"?"period-night-start":""}`}>
                    {s.label} · {s.time}
                  </th>
                ))}
              </tr></>
            </thead>
            <tbody>
              {gridResources.map(({ kind, r, displaySection, sourceSection, operationalSession }, index) => {
                const groupGrid = index === firstPostIndex && <OperationalGroupsGrid
                  date={data.date}
                  groups={data.operationalGroups || []}
                  members={data.operationalGroupMembers || []}
                  guards={data.guards}
                  posts={data.posts}
                   vehicles={[...data.vehicles, ...(data.allVehicles || [])]}
                   assignments={[...data.assignments, ...data.availableForRedeployment]}
                   movements={data.movements}
                  serviceAdjustments={data.serviceAdjustments}
                  shifts={visibleShifts}
                  selectedGroup={activeGroupFilter}
                  selectedId={Number(contextPick?.assignment?.id || pick?.assignment?.id || 0)}
                   onOpenAssignment={(assignment, shift) => {
                    const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                    const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                   if (resource) setContextPick({ kind, resource, shift, assignment });
                 }}
                 onExtend={(assignment, shift, mode) => {
                   const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                   const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                   if (resource) startExtension(assignment, kind, resource, shift, mode);
                 }}
                 onAdjust={(assignment, shift) => {
                   const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                   const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                   if (resource) setQuickEdit({ kind, resource, shift, assignment });
                 }}
                 onSwap={(assignment, shift) => {
                   const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                   const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                   if (resource) openQuickSwap(assignment, kind, resource, shift);
                 }}
                 onQuickStatus={quickStatus}
                 onCopy={copyAssignment}
                 onSuggestHe={(assignment, shift, member) => {
                   const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                   const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                   if (resource) setPick({ kind, resource, shift, manualAdd: true, groupId: Number(member.group_id) });
                 }}
                 onDetails={(assignment, shift) => {
                   const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                   const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                   if (resource) setPick({ kind, resource, shift, assignment });
                 }}
                 onDelete={removeAssignmentSegment}
                 onDragStart={(assignment) => setDraggingAssignmentId(Number(assignment.id))}
                 onDragEnd={() => setDraggingAssignmentId(null)}
                 onCloseActions={() => setContextPick(null)}
                />;
                const first = index === 0 || gridResources[index - 1].displaySection !== displaySection;
                const last = index === gridResources.length - 1 || gridResources[index + 1].displaySection !== displaySection;
                const operationalGroup = null;
                const operationalTeam = null;
                const operationalGroupColor = null;
                const previousResource = gridResources[index - 1]?.r;
                const previousKind = gridResources[index - 1]?.kind;
                const previousOperationalGroup = previousResource ? resourceOperationalMeta(previousKind || kind, previousResource).group : null;
                const previousOperationalTeam = previousResource ? resourceOperationalMeta(previousKind || kind, previousResource).team : null;
                const groupFirst = Boolean(operationalGroup && (
                  first ||
                  previousOperationalGroup !== operationalGroup
                ));
                const teamFirst = Boolean(operationalGroup && operationalTeam && (
                  first ||
                  previousOperationalGroup !== operationalGroup ||
                  previousOperationalTeam !== operationalTeam
                ));
                const isCollapsed = Boolean(collapsed[displaySection]);
                if (isCollapsed && !first) return null;
                return (
                <Fragment key={`${kind}-${r.id}`}>
                {groupGrid}
                <MemoizedRow
                  date={data.date}
                  kind={kind}
                   resource={r}
                   section={displaySection}
                   sourceSection={sourceSection}
                   operationalSession={operationalSession}
                   sectionKey={kind === "vehicle" ? "VEHICLES" : `POST:${r.group_name || "POSTOS"}`}
                   sectionResourceCount={sectionResourceCounts.get(displaySection) || 0}
                   draggingAssignmentId={draggingAssignmentId}
                   onDragStart={(assignment) => setDraggingAssignmentId(Number(assignment.id))}
                   onDragEnd={() => setDraggingAssignmentId(null)}
                   first={first}
                   groupFirst={groupFirst}
                   teamFirst={teamFirst}
                   operationalGroup={operationalGroup}
                   operationalTeam={operationalTeam}
                   operationalGroupColor={operationalGroupColor}
                   collapsed={isCollapsed}
                  onToggleSection={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [displaySection]: !current[displaySection],
                    }))
                  }
                  shifts={visibleShifts}
                   assignmentIndex={assignmentIndex}
                   resourceAssignments={resourceAssignmentIndex.get(resourceAssignmentKey(kind, Number(r.id))) || []}
                   allScheduleAssignments={allScheduleAssignments}
                   assignmentById={assignmentById}
                   guards={data.guards}
                   guardOperationalMeta={operationalGroupByGuard}
                   guardOperationalMetaByShift={operationalGroupByGuardShift}
                   onQuickAdd={quickAddGuard}
                   onSectionRef={(sectionName, element) => {
                     if (element) sectionRefs.current.set(sectionName, element);
                     else sectionRefs.current.delete(sectionName);
                   }}
                   serviceAdjustments={data.serviceAdjustments || []}
                   movements={data.movements}
                   availableForRedeployment={data.availableForRedeployment}
                  redeploymentGroups={redeploymentGroups}
                  selectedId={Number(contextPick?.assignment?.id || pick?.assignment?.id || 0)}
                  recentAssignmentIds={recentAssignmentIds}
                  onContextPick={setContextPick}
                  onEdit={setPick}
                  onSwap={openQuickSwap}
                  onQuickStatus={quickStatus}
                  onExtend={startExtension}
                  copiedAssignment={copiedAssignment}
                  onCopy={copyAssignment}
                  onPaste={pasteAssignment}
                  onQuickDelete={removeAssignmentSegment}
                  onMove={move}
                  onMoveGroup={moveGroup}
                  onHolePick={openHoleSuggest}
                  onEditVehicle={setVehicleEdit}
                  onEditPost={setPostEdit}
                  onEditSection={(sectionKey, label) => setSectionEdit({ sectionKey, label })}
                  onQuickEdit={setQuickEdit}
                  onAddToResource={(kind,resource,shift)=>setResourceDialog({
                    kind,
                    initialResourceId:Number(resource.id),
                    initialShift:isDayShift(shift)?"2":"4",
                    initialMode:"existing",
                  })}
                  onAddInSection={(kind,section)=>setResourceDialog({
                    kind,
                    initialMode:"new",
                    initialSection:kind==="post"?section:undefined,
                  })}
                  onRemoveResource={(kind,resource)=>setResourceRemoval({
                    kind,
                    resource,
                    assignments:data.assignments.filter((assignment)=>kind==="post"
                      ? Number(assignment.post_id)===Number(resource.id)
                      : Number(assignment.vehicle_id)===Number(resource.id)),
                  })}
                />
                {last && !isCollapsed && (
                  <tr className="resource-section-footer">
                    <td colSpan={visibleShifts.length + 1}>
                      <button type="button" onClick={()=>setResourceDialog({
                        kind,
                        initialMode:"existing",
                        initialShift:"2",
                        initialSection:kind==="post"?sourceSection:undefined,
                      })}>
                        ＋ Adicionar {kind==="vehicle"?"viatura à escala":`posto em ${sourceSection}`}
                      </button>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
              })}
              {firstPostIndex === -1 && <OperationalGroupsGrid
                date={data.date}
                groups={data.operationalGroups || []}
                members={data.operationalGroupMembers || []}
                guards={data.guards}
                posts={data.posts}
                vehicles={data.vehicles}
                assignments={[...data.assignments, ...data.availableForRedeployment]}
                movements={data.movements}
                serviceAdjustments={data.serviceAdjustments}
                shifts={visibleShifts}
                selectedGroup={activeGroupFilter}
                selectedId={Number(contextPick?.assignment?.id || pick?.assignment?.id || 0)}
                 onOpenAssignment={(assignment, shift) => {
                  const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                  const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                 if (resource) setContextPick({ kind, resource, shift, assignment });
               }}
               onExtend={(assignment, shift, mode) => {
                 const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                 const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                 if (resource) startExtension(assignment, kind, resource, shift, mode);
               }}
               onAdjust={(assignment, shift) => {
                 const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                 const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                 if (resource) setQuickEdit({ kind, resource, shift, assignment });
               }}
               onSwap={(assignment, shift) => {
                 const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                 const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                 if (resource) openQuickSwap(assignment, kind, resource, shift);
               }}
               onQuickStatus={quickStatus}
               onCopy={copyAssignment}
               onDetails={(assignment, shift) => {
                 const kind = assignment.vehicle_id != null ? "vehicle" : "post";
                 const resource = (kind === "vehicle" ? data.vehicles : data.posts).find((item) => Number(item.id) === Number(kind === "vehicle" ? assignment.vehicle_id : assignment.post_id));
                 if (resource) setPick({ kind, resource, shift, assignment });
               }}
               onDelete={removeAssignmentSegment}
               onCloseActions={() => setContextPick(null)}
               />}
            </tbody>
          </table>
          )}
          <section className={`movement-grid compact-movements ${movementsExpanded?"expanded":"collapsed"}`}>
            <button type="button" className="compact-section-toggle" onClick={()=>setMovementsExpanded(value=>!value)}><span><b>Registros do dia</b><small>{`${data.removed.length} afetaram a escala`}{movementGroups.some(group=>group.items.length)?` · ${movementGroups.filter(group=>group.items.length).map(group=>`${group.label} ${group.items.length}`).join(" · ")}`:" · Nenhum afastamento"}</small></span><strong>{data.movements.length}</strong><i>{movementsExpanded?"Recolher":"Ver nomes"}</i></button>
            {movementsExpanded&&(
              <div className="movement-groups">
                {movementGroups.map((group) => (
                  <article key={group.key} className="movement-group">
                    <header>
                      <b>{group.label}</b>
                      <span>{group.items.length}</span><button type="button" title={`Adicionar em ${group.label}`} aria-label={`Adicionar pessoa em ${group.label}`} onClick={()=>setMovementEdit({type:group.types[0]})}>＋</button>
                    </header>
                    <div>
                      {group.items.map((m) => (
                        <span key={String(m.id)} className="movement-person">
                          <strong>{m.guard_name}</strong>
                          <small>
                            {movementDetail(m)}
                            {m.request_ref ? ` · Req. ${m.request_ref}` : ""}
                            {m.notes ? ` · ${m.notes}` : ""}
                          </small>
                          <span className="movement-actions"><button type="button" aria-label={`Editar ${m.guard_name}`} onClick={()=>setMovementEdit({type:String(m.type),movement:m})}>✎</button><button type="button" aria-label={`Remover ${m.guard_name}`} onClick={()=>void deleteMovement(m)}>×</button></span>
                        </span>
                      ))}
                      {!group.items.length&&<small className="movement-empty">Nenhum registro</small>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          {data.serviceAdjustments?.length ? (
            <section className="service-adjustment-bottom" aria-label="Bancos de horas e trocas da escala">
              <header>
                <div>
                  <span>ALTERAÇÕES COM REQUERIMENTO</span>
                  <h2>Banco de horas e trocas</h2>
                  <p>Confira os ajustes aplicados nesta data antes de liberar a escala.</p>
                </div>
                <strong>{data.serviceAdjustments.length}</strong>
              </header>
              <div className="service-adjustment-bottom-grid">
                {data.serviceAdjustments.map((item) => (
                  <article key={String(item.id)} className={`service-adjustment-entry ${String(item.settlement_date||"")===data.date?"settlement":String(item.subtype)}`}>
                    <div className="service-adjustment-entry-main">
                      <span className="service-adjustment-kind">{liveServiceAdjustmentCode(String(item.subtype),item,data.date)}</span>
                      <div>
                        <b>{String(item.guard_name)}{item.counterpart_guard_name ? ` ⇄ ${String(item.counterpart_guard_name)}` : ""}</b>
                        <small>{liveServiceAdjustmentRange(item, data.date)}</small>
                      </div>
                    </div>
                    <div className="service-adjustment-entry-ref">
                      <span>{item.request_ref ? `Req. ${String(item.request_ref)}` : "Sem requerimento"}</span>
                      {item.notes && <small>{String(item.notes)}</small>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
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
      {postEdit && (
        <PostQuickEditor
          post={postEdit}
          saving={saving}
          onClose={() => setPostEdit(null)}
          onSave={savePostQuick}
        />
      )}
      {sectionEdit && (
        <SectionQuickEditor
          section={sectionEdit}
          saving={saving}
          onClose={() => setSectionEdit(null)}
          onSave={saveSectionQuick}
        />
      )}
      {quickEdit?.assignment && (
        <QuickAssignmentEditor
          pick={quickEdit}
          saving={saving}
          onClose={() => setQuickEdit(null)}
          onSave={saveQuickAssignment}
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
      {resourceDialog&&<ResourceCrewDialog
        key={`${resourceDialog.kind}-${resourceDialog.initialResourceId||"new"}-${resourceDialog.initialShift||"2"}-${resourceDialog.initialSection||""}`}
        {...resourceDialog}
        data={data}
        saving={saving}
        onClose={()=>setResourceDialog(null)}
        onSave={saveResourceCrew}
      />}
      {resourceRemoval&&<ResourceRemovalDialog pick={resourceRemoval} saving={saving} onClose={()=>setResourceRemoval(null)} onConfirm={removeResourceFromDay}/>} 
      {movementEdit&&<MovementDialog data={data} edit={movementEdit} saving={saving} onClose={()=>setMovementEdit(null)} onSave={saveMovement}/>} 
      {swapPick&&<GuardSwapDialog data={data} swap={swapPick} saving={saving} onClose={()=>setSwapPick(null)} onSelect={replaceGuard}/>}
      {extensionPick&&<QuickExtensionDialog key={String(extensionPick.assignment.id)} pick={extensionPick} data={data} saving={saving} onClose={()=>setExtensionPick(null)} onSave={saveQuickExtension}/>}
    </main>
  );
}

function QuickExtensionDialog({pick,data,saving,onClose,onSave}:{pick:ExtensionPick;data:State;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const period=isDayShift(pick.shift)?"day":"night";
  const related=data.assignments.filter(item=>Number(item.guard_id)===Number(pick.assignment.guard_id)&&String(item.work_kind)!=="overtime_extension"&&coveredOperationalShifts(item,data.date).some(id=>(isDayShift(id)?"day":"night")===period));
  const normalStart=related.reduce((earliest,item)=>String(item.starts_at)<earliest?String(item.starts_at):earliest,String(pick.assignment.starts_at));
  const normalEnd=related.reduce((latest,item)=>{const value=String(item.regular_ends_at||item.ends_at);return value>latest?value:latest},String(pick.assignment.regular_ends_at||pick.assignment.ends_at));
  const before=pick.extensionMode==="before";
  const[start,setStart]=useState(before?addLocalHours(normalStart,-3):normalEnd),[end,setEnd]=useState(before?normalStart:addLocalHours(normalEnd,3)),[destination,setDestination]=useState(`${pick.kind}:${pick.resource.id}`);
  const destinationKind=destination.split(":")[0];
  function duration(hours:number){if(before)setStart(addLocalHours(end,-hours));else setEnd(addLocalHours(start,hours))}
  const heHours=Math.max(0,(Date.parse(end)-Date.parse(start))/3600000);
  const heLabel=`${String(Math.round(heHours)).padStart(2,"0")} HE`;
  return <div className="quick-create-backdrop"><form className="quick-extension-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-extension-title" onSubmit={onSave}><header><div><small>HORA EXTRA NA PRÓPRIA ESCALA</small><h2 id="quick-extension-title">{before?"Antecipar":"Estender"} {pick.assignment.guard_name}</h2><p>O expediente normal permanece intacto. A HE poderá ter outro local e ser removida separadamente.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><div className="quick-extension-summary"><span>{before?"Início normal":"Fim do expediente"}</span><b>{(before?normalStart:normalEnd).slice(11,16)}</b><strong className="quick-extension-total">{heLabel}</strong></div><div className="quick-extension-durations" role="group" aria-label="Duração rápida"><button type="button" onClick={()=>duration(2)}>2h</button><button type="button" onClick={()=>duration(3)}>3h</button><button type="button" onClick={()=>duration(4)}>4h</button><button type="button" onClick={()=>duration(6)}>6h</button></div><label>Local da hora extra<select name="destination" value={destination} onChange={event=>setDestination(event.target.value)}>{data.vehicles.map(v=><option key={`hev${v.id}`} value={`vehicle:${v.id}`}>{vehicleIcon(String(v.type))} {v.prefix} · {v.zone}</option>)}{data.posts.map(p=><option key={`hep${p.id}`} value={`post:${p.id}`}>{p.group_name} · {p.name}</option>)}</select></label><label>Função<select name="role" defaultValue={destinationKind==="vehicle"?"third":"guard"} key={destinationKind}><option value="guard">GM do posto</option><option value="driver">M — Motorista</option><option value="patrol">P — Patrulheiro</option><option value="third">R — Reforço</option></select></label><div className="two"><label>Início da HE<input name="startsAt" type="datetime-local" value={start} onChange={event=>setStart(event.target.value)} required/></label><label>Fim da HE<input name="endsAt" type="datetime-local" value={end} onChange={event=>setEnd(event.target.value)} required/></label></div><input type="hidden" name="shift" value={before?"3":isDayShift(pick.shift)?"4":"1"}/><label>Requerimento ou observação<input name="requestRef" placeholder="Opcional"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving||heHours<=0}>{saving?"Adicionando…":`Adicionar ${heLabel}`}</button></footer></form></div>
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

type CrewCandidate = { id: number; name: string; registration: string; detail: string; source: "redeploy" | "overtime" };

function ResourceCrewDialog({kind,initialResourceId,initialShift="2",initialMode,initialSection,data,saving,onClose,onSave}:ResourceDialogState&{data:State;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>,kind:"post"|"vehicle")=>void}){
  const resources=kind==="vehicle"?data.vehicles:data.posts;
  const selectableResources=kind==="post"&&initialSection
    ? resources.filter(resource=>{
        const section=data.sections.find(item=>String(item.section_key)===`POST:${resource.group_name||"POSTOS"}`);
        return String(section?.label||resource.group_name||"POSTOS")===initialSection;
      })
    : resources;
  const [mode,setMode]=useState<"existing"|"new">(initialMode||(selectableResources.length?"existing":"new"));
  const [resourceId,setResourceId]=useState(String(initialResourceId||selectableResources[0]?.id||resources[0]?.id||""));
  const [shift,setShift]=useState<"2"|"4">(initialShift);
  const [newVehicleType, setNewVehicleType] = useState("sedan");
  const selectedVehicle = kind === "vehicle" ? resources.find((resource) => Number(resource.id) === Number(resourceId)) : null;
  const motorcycle = kind === "vehicle" && (mode === "new" ? isMotorcycleType(newVehicleType) : isMotorcycleType(selectedVehicle?.type));
  const firstHasPair=kind==="vehicle"&&!motorcycle&&vehicleHasPair(data,Number(resourceId),shift);
  const [rawExtraCount,setExtraCount]=useState(kind==="post"||firstHasPair||motorcycle?1:0);
  const extraCount = motorcycle ? 1 : rawExtraCount;
  const needsPair=kind==="vehicle"&&!motorcycle&&(mode==="new"||!vehicleHasPair(data,Number(resourceId),shift));
  const sectionLabels=[...new Set(data.sections.filter(section=>String(section.section_key).startsWith("POST:")).map(section=>String(section.label)))];
  const [smartData, setSmartData] = useState<{ sameDayCandidates?: Array<{ guardId: number; origins?: string[]; availableForRedeployment?: boolean }>; suggestions?: Array<{ id: number; oppositeTeam?: boolean; currentHeHours?: number }> }>({});
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ date: data.date, shift, suggest: "1" });
    if (mode === "existing" && kind === "post" && resourceId) params.set("postId", String(resourceId));
    if (mode === "existing" && kind === "vehicle" && resourceId) params.set("vehicleId", String(resourceId));
    fetch(`/api/schedule?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value) => setSmartData(value))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setSmartData({});
      });
    return () => controller.abort();
  }, [data.date, kind, mode, resourceId, shift]);
  const smartCrewCandidates = useMemo<CrewCandidate[]>(() => {
    const byId = new Map<number, CrewCandidate>();
    const guardById = new Map(data.guards.map((guard) => [Number(guard.id), guard]));
    for (const candidate of smartData.sameDayCandidates || []) {
      if (!candidate.availableForRedeployment) continue;
      const guard = guardById.get(Number(candidate.guardId));
      if (!guard) continue;
      byId.set(Number(candidate.guardId), {
        id: Number(candidate.guardId),
        name: String(guard.name || ""),
        registration: String(guard.registration || ""),
        detail: `À disposição · ${(candidate.origins || []).join(" + ") || "aguardando destino"}`,
        source: "redeploy",
      });
    }
    for (const candidate of smartData.suggestions || []) {
      if (!candidate.oppositeTeam || byId.has(Number(candidate.id))) continue;
      const guard = guardById.get(Number(candidate.id));
      if (!guard) continue;
      byId.set(Number(candidate.id), {
        id: Number(candidate.id),
        name: String(guard.name || ""),
        registration: String(guard.registration || ""),
        detail: `HE · ${Number(candidate.currentHeHours || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h no mês · equipe oposta`,
        source: "overtime",
      });
    }
    return [...byId.values()];
  }, [data.guards, smartData]);
  function chooseExisting(id:string){const nextVehicle=kind==="vehicle"?resources.find((resource)=>Number(resource.id)===Number(id)):null;const isMoto=kind==="vehicle"&&isMotorcycleType(nextVehicle?.type);setResourceId(id);setExtraCount(kind==="post"||isMoto||(mode==="existing"&&vehicleHasPair(data,Number(id),shift))?1:0)}
  function chooseShift(value:"2"|"4"){setShift(value);setExtraCount(kind==="post"||motorcycle||(mode==="existing"&&vehicleHasPair(data,Number(resourceId),value))?1:0)}
  return <div className="quick-create-backdrop"><form className="resource-crew-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-crew-title" onSubmit={event=>onSave(event,kind)}><header><div><small>INCLUIR DIRETAMENTE NA ESCALA</small><h2 id="resource-crew-title">{kind==="vehicle"?"Viatura e guarnição":"Posto e efetivo"}</h2><p>Use um cadastro existente ou crie outro e já posicione os GMs.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><nav className="resource-mode"><button type="button" className={mode==="existing"?"active":""} disabled={!selectableResources.length} onClick={()=>{setMode("existing");setExtraCount(kind==="post"||vehicleHasPair(data,Number(resourceId),shift)?1:0)}}>Usar {kind==="vehicle"?"VTR":"posto"} existente</button><button type="button" className={mode==="new"?"active":""} onClick={()=>{setMode("new");setExtraCount(kind==="post"?1:0)}}>＋ Criar {kind==="vehicle"?"nova VTR":"novo posto"}</button></nav><input type="hidden" name="resourceMode" value={mode}/>
    {mode==="existing"&&<label>{kind==="vehicle"?"Viatura disponível na escala":initialSection?`Posto existente em ${initialSection}`:"Posto existente"}<select name="resourceId" value={resourceId} onChange={event=>chooseExisting(event.target.value)} required>{selectableResources.map(resource=>{const crew=kind==="vehicle"?uniqueCrewCount(data,Number(resource.id)):0;return <option key={String(resource.id)} value={String(resource.id)}>{kind==="vehicle"?`${vehicleIcon(String(resource.type))} ${resource.prefix} · ${resource.zone||"Sem zona"} · ${crew} GM(s)`:`${resource.group_name} · ${resource.name}`}</option>})}</select></label>}
    {mode==="new"&&kind==="vehicle"&&<div className="new-resource-fields"><label>Prefixo<input name="prefix" required placeholder="Ex.: VTR 1400"/></label><label>Tipo<select name="type" value={newVehicleType} onChange={event=>setNewVehicleType(event.target.value)}><option value="sedan">Sedan</option><option value="pickup">Caminhonete</option><option value="suv">SUV</option><option value="van">Furgão</option><option value="moto">Moto</option><option value="other">Outro</option></select></label><label>Zona / área<input name="zone" placeholder="Área de atuação"/></label></div>}
    {mode==="new"&&kind==="post"&&<div className="new-resource-fields"><label>Nome do posto<input name="name" required placeholder="Ex.: Recepção"/></label><label>Seção<select name="groupName" required defaultValue={initialSection||""}><option value="">Selecionar seção</option>{sectionLabels.map(label=><option key={label} value={label}>{label}</option>)}</select></label><input type="hidden" name="sortOrder" value="99"/></div>}
    <label>Período da equipe<select name="shift" value={shift} onChange={event=>chooseShift(event.target.value as "2"|"4")}><option value="2">Diurno · 07h–19h</option><option value="4">Noturno · 19h–07h</option></select></label>
    <fieldset className="crew-builder"><legend>{kind==="vehicle"?"Composição da guarnição":"GMs do posto"}</legend><div className="crew-rule smart-crew-rule"><b>Sugestões inteligentes</b><span>Somente GMs à disposição ou da equipe oposta elegível para HE.</span></div>{motorcycle&&<div className="crew-rule motorcycle-rule"><b>Moto · 1 lugar</b><span>Selecione somente o condutor; não há furo de patrulheiro.</span></div>}{needsPair&&<div className="crew-rule"><b>Dupla obrigatória</b><span>A VTR precisa sair com motorista e patrulheiro.</span></div>}{!needsPair&&!motorcycle&&kind==="vehicle"&&<div className="crew-rule complete"><b>Dupla já existente</b><span>Os novos nomes entrarão como reforço.</span></div>}{needsPair&&<><CrewGuardRow candidates={smartCrewCandidates} shift={shift} label="Motorista" crewRole="driver"/><CrewGuardRow candidates={smartCrewCandidates} shift={shift} label="Patrulheiro" crewRole="patrol"/></>}{Array.from({length:extraCount},(_,index)=><CrewGuardRow key={index} candidates={smartCrewCandidates} shift={shift} label={kind==="vehicle"?(motorcycle?"Condutor da moto":`Integrante adicional ${index+1}`):`GM ${index+1}`} crewRole={kind==="vehicle"?(motorcycle?"driver":"third"):"guard"} removable={!motorcycle} onRemove={()=>setExtraCount(count=>Math.max(0,count-1))}/>)}{!smartCrewCandidates.length&&<small className="crew-suggestion-empty">Nenhum GM à disposição ou da equipe oposta está elegível neste período.</small>}{!motorcycle&&<button type="button" className="add-crew-member" disabled={extraCount>=6} onClick={()=>setExtraCount(count=>Math.min(6,count+1))}>＋ {kind==="vehicle"?"Adicionar terceiro integrante ou reforço":"Adicionar outro GM"}</button>}</fieldset>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Incluindo…":mode==="new"?`Criar e escalar ${kind==="vehicle"?"guarnição":"efetivo"}`:`Adicionar à escala`}</button></footer></form></div>
}

function CrewGuardRow({candidates,label,crewRole,removable,onRemove}:{candidates:CrewCandidate[];shift:string;label:string;crewRole:string;removable?:boolean;onRemove?:()=>void}){
  return <div className={`crew-guard-row ${crewRole}`}><span className="crew-role">{crewRole==="driver"?"M":crewRole==="patrol"?"P":crewRole==="third"?"R":"GM"}</span><label>{label}<select name="crewGuardId" required defaultValue=""><option value="">Selecionar sugestão</option>{candidates.map(guard=><option key={`${guard.id}|${guard.source}`} value={`${guard.id}|${guard.source}`}>{guard.name} · {guard.registration} · {guard.detail}</option>)}</select></label><input type="hidden" name="crewRole" value={crewRole}/>{removable&&<button type="button" onClick={onRemove} aria-label={`Remover ${label}`}>×</button>}</div>
}

function MovementDialog({data,edit,saving,onClose,onSave}:{data:State;edit:MovementEdit;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const movement=edit.movement;
  const start=String(movement?.starts_at||`${data.date}T00:00`).slice(0,16);
  const end=String(movement?.ends_at||`${data.date}T23:59`).slice(0,16);
  const labels:Record<string,string>={technical_reserve:"Reserva técnica",day_off:"Folga",vacation:"Férias",course:"Curso",medical_leave:"Licença / atestado",time_bank:"Banco de horas",other_leave:"Outro afastamento",swap:"Troca de serviço"};
  return <div className="movement-dialog-backdrop"><form className="movement-dialog" role="dialog" aria-modal="true" aria-labelledby="movement-dialog-title" onSubmit={onSave}><header><div><small>{movement?"EDITAR REGISTRO":"INCLUIR NO EFETIVO RETIRADO"}</small><h2 id="movement-dialog-title">{labels[edit.type]||"Movimentação"}</h2><p>O período será aplicado automaticamente às escalas correspondentes.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><label>GM<select name="guardId" required defaultValue={String(movement?.guard_id||"")}><option value="">Selecione o GM</option>{data.guards.map(guard=><option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}</option>)}</select></label><div className="two"><label>Início<input name="startsAt" type="datetime-local" required defaultValue={start}/></label><label>Fim / retorno<input name="endsAt" type="datetime-local" required defaultValue={end}/></label></div><label>Requerimento<input name="requestRef" defaultValue={String(movement?.request_ref||"")} placeholder="Número ou referência"/></label><label>Observação<textarea name="notes" rows={3} defaultValue={String(movement?.notes||"")}/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Salvando…":movement?"Salvar alteração":"Incluir e aplicar"}</button></footer></form></div>
}

function GuardSwapDialog({data,swap,saving,onClose,onSelect}:{data:State;swap:SwapPick;saving:boolean;onClose:()=>void;onSelect:(guardId:number)=>void}){
  const[query,setQuery]=useState("");
  const current=swap.assignments[0],ids=useMemo(()=>new Set(swap.assignments.map(item=>Number(item.id))),[swap.assignments]);
  const candidates=useMemo(()=>{
    const value=query.toLowerCase().trim();
    return data.guards.filter(guard=>{
      if(Number(guard.id)===Number(current.guard_id))return false;
      if(value&&!`${guard.name} ${guard.registration} ${guard.platoon||""}`.toLowerCase().includes(value))return false;
      const conflict=data.assignments.some(item=>!ids.has(Number(item.id))&&Number(item.guard_id)===Number(guard.id)&&swap.assignments.some(target=>String(item.starts_at)<String(target.ends_at)&&String(item.ends_at)>String(target.starts_at)));
      const movement=data.movements.some(item=>Number(item.guard_id)===Number(guard.id)&&swap.assignments.some(target=>String(item.starts_at)<String(target.ends_at)&&String(item.ends_at)>String(target.starts_at)));
      return !conflict&&!movement;
    }).slice(0,30);
  },[current.guard_id,data.assignments,data.guards,data.movements,ids,query,swap.assignments]);
  const destination=swap.pick.kind==="vehicle"?String(swap.pick.resource.prefix):String(swap.pick.resource.name);
  return <div className="guard-swap-backdrop"><section className="guard-swap-dialog" role="dialog" aria-modal="true" aria-labelledby="guard-swap-title"><header><div><small>TROCA RÁPIDA NA ESCALA</small><h2 id="guard-swap-title">Trocar {String(current.guard_name)}</h2><p>{destination} · {redeploymentTimeLabel(swap.assignments)}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><div className="guard-swap-summary"><span>Será substituído</span><b>{swap.assignments.length>1?"Todo o período exibido":"Somente este horário"}</b><small>Local, função, horário e marcações serão preservados. A troca ficará destacada para aviso.</small></div><label>Buscar GM disponível<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nome ou matrícula…"/></label><div className="guard-swap-list">{candidates.map(guard=><button type="button" key={String(guard.id)} disabled={saving} onClick={()=>onSelect(Number(guard.id))}><span><b>{guard.name}</b><small>{guard.registration} · {guard.platoon||"Sem equipe"}</small></span><strong>Selecionar</strong></button>)}{!candidates.length&&<p>Nenhum GM disponível corresponde à busca.</p>}</div><footer><span>{candidates.length} opção(ões) sem conflito neste horário</span><button type="button" onClick={onClose}>Cancelar</button></footer></section></div>
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
  const [destination,setDestination]=useState("");
  const selectedDestination=destination|| (defaultDestination?`${defaultDestination.kind}:${defaultDestination.resource.id}`:"");
  const movingIds=new Set(assignments.map(item=>Number(item.id)));
  function destinationStatus(item:{kind:string;resource:Rec}){
    const matches=data.assignments.filter(current=>!movingIds.has(Number(current.id))&&(item.kind==="post"?Number(current.post_id)===Number(item.resource.id):Number(current.vehicle_id)===Number(item.resource.id))&&String(current.starts_at)<String(assignment.ends_at)&&String(current.ends_at)>String(assignment.starts_at));
    if(!matches.length)return{label:"Livre no período",available:true};
    if(item.kind==="vehicle"){
      if(isMotorcycleType(item.resource.type))return{label:"Em serviço · condutor definido",available:false};
      const roles=new Set(matches.map(current=>String(current.role)));
      const hasHole=!roles.has("driver")||!roles.has("patrol");
      return{label:hasHole?`Com furo · ${matches.length} GM(s)`:`Em serviço · ${matches.length} GM(s)`,available:hasHole};
    }
    return{label:`Com ${matches.length} GM(s) · aceita reforço`,available:true};
  }
  return <div className="redeploy-quick-backdrop"><form className="redeploy-quick-editor" role="dialog" aria-modal="true" aria-labelledby="redeploy-title" onSubmit={onSave}>
    <header><div><small>REMANEJAMENTO DO PERÍODO COMPLETO</small><h2 id="redeploy-title">{String(assignment.guard_name)}</h2><p>{redeploymentTimeLabel(assignments)} · {assignments.length} horários vinculados</p></div><button type="button" onClick={onClose} aria-label="Fechar remanejamento">×</button></header>
    <div className="redeploy-alert"><b>Os horários serão movidos juntos</b><span>Funções e horários de cada metade serão preservados.</span></div>
    <label>Buscar posto, viatura ou zona<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Ex.: Sala de Operações, VTR 1337, Centro…" /></label>
    <input type="hidden" name="destination" value={selectedDestination}/>
    <div className="redeploy-destination-grid" role="radiogroup" aria-label="Escolher destino">{destinations.length?destinations.map(item=>{const value=`${item.kind}:${item.resource.id}`,status=destinationStatus(item);return <button type="button" role="radio" aria-checked={selectedDestination===value} className={`${selectedDestination===value?"selected":""} ${status.available?"available":"busy"}`} key={value} onClick={()=>setDestination(value)}><span>{item.kind==="vehicle"?vehicleIcon(String(item.resource.type)):"◆"}</span><div><b>{item.label}</b><small>{item.detail}</small><em>{status.label}</em></div></button>}):<p>Nenhum destino encontrado</p>}</div>
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
  const displayedEnd = /T00:00(?:$|:00)/.test(String(m.ends_at || "")) ? new Date(end.getTime() - 86400000) : end;
  if (m.type === "medical_leave" || m.type === "other_leave") return `Afastado até ${date(displayedEnd)}`;
  if (m.type === "vacation" || m.type === "course")
    return `Período: ${date(start)} a ${date(displayedEnd)}`;
  if (m.type === "day_off" || m.type === "technical_reserve")
    return `Dia ${date(start)}`;
  return `${date(start)} · ${time(start)}–${time(end)}`;
}
function liveServiceAdjustmentLabel(subtype:string){return ({negative_early:"BH- · saída antecipada",negative_late:"BH- · entrada tardia",negative_full:"BH- · retirada integral",positive:"BH+ · dia extra",swap:"Troca de serviço"} as Record<string,string>)[subtype]||subtype}
function liveServiceAdjustmentCode(subtype:string,item?:Rec,date?:string){if(item&&date&&String(item.settlement_date||"")===date)return "BH+";return ({negative_early:"BH-",negative_late:"BH-",negative_full:"BH-",positive:"BH+",swap:"TROCA"} as Record<string,string>)[subtype]||"AJUSTE"}
function scheduleAdjustmentHoursLabel(value:unknown){
  const hours=Number(value);
  if(!Number.isFinite(hours)||hours<=0)return "";
  const rounded=Math.round(hours*100)/100;
  return `${Number.isInteger(rounded)?rounded:rounded.toFixed(2).replace(/0+$/, "").replace(".", ",")}h`;
}
function assignmentAdjustmentBadge(assignment:Rec,adjustments:Rec[],date:string){
  const item=adjustments.find(candidate=>Number(candidate.guard_id)===Number(assignment.guard_id)&&(
    String(candidate.settlement_date||"")===date || (String(candidate.service_date)===date&&String(candidate.subtype).startsWith("negative_")&&String(assignment.status)==="time_bank")
  ));
  if(!item)return "";
  const paid=String(item.settlement_date||"")===date;
  const hours=scheduleAdjustmentHoursLabel(paid?item.settlement_hours||item.hours:item.hours);
  return `${paid?"BH+":"BH-"}${hours?` ${hours}`:""}`;
}
function liveServiceAdjustmentRange(item:Rec,date:string){
  if(!item.hours&&!item.settlement_date)return liveLegacyServiceAdjustmentRange(item,date);
  const hours=scheduleAdjustmentHoursLabel(item.hours);
  const isSettlement=String(item.settlement_date||"")===date;
  if(isSettlement){
    const paidHours=scheduleAdjustmentHoursLabel(item.settlement_hours||item.hours);
    return `BH+${paidHours?` ${paidHours}`:""} · pagamento do BH- · ${String(item.settlement_starts_at||"").slice(11,16)}–${String(item.settlement_ends_at||"").slice(11,16)}${item.request_ref?` · Req. ${String(item.request_ref)}`:""}`;
  }
  const isSecond=String(item.service_date)!==date&&String(item.counterpart_service_date||"")===date;
  const start=String(isSecond?item.counterpart_starts_at:item.starts_at||"").slice(11,16),end=String(isSecond?item.counterpart_ends_at:item.ends_at||"").slice(11,16);
  const label=liveServiceAdjustmentLabel(String(item.subtype));
  if(!isSecond&&String(item.subtype)==="negative_full")return `${label}${hours?` · ${hours}`:""} · ${String(item.service_date)} · dia inteiro${item.settlement_date?` · BH+ em ${String(item.settlement_date)}`:""}${item.request_ref?` · Req. ${String(item.request_ref)}`:""}`;
  if(String(item.subtype)!=="swap")return `${label}${hours?` · ${hours}`:""} · ${start}–${end}${item.settlement_date?` · BH+ em ${String(item.settlement_date)}`:""}${item.request_ref?` · Req. ${String(item.request_ref)}`:""}`;
  const otherDate=isSecond?String(item.service_date):String(item.counterpart_service_date||"");
  return `${label} · ${start}–${end} · troca com ${otherDate}${item.request_ref?` · Req. ${String(item.request_ref)}`:""}`;
}
function liveLegacyServiceAdjustmentRange(item:Rec,date:string){
  const isSecond=String(item.service_date)!==date&&String(item.counterpart_service_date||"")===date;
  const start=String(isSecond?item.counterpart_starts_at:item.starts_at||"").slice(11,16),end=String(isSecond?item.counterpart_ends_at:item.ends_at||"").slice(11,16);
  const label=liveServiceAdjustmentLabel(String(item.subtype));
  if(String(item.subtype)!=="swap")return `${label} · ${start}–${end}${item.request_ref?` · Req. ${String(item.request_ref)}`:""}`;
  const otherDate=isSecond?String(item.service_date):String(item.counterpart_service_date||"");
  return `${label} · ${start}–${end} · troca com ${otherDate}${item.request_ref?` · Req. ${String(item.request_ref)}`:""}`;
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
function PostQuickEditor({post,saving,onClose,onSave}:{post:Rec;saving:boolean;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}) {
  return <div className="vehicle-quick-backdrop"><form className="vehicle-quick-editor" role="dialog" aria-modal="true" aria-labelledby="post-quick-title" onSubmit={onSave}>
    <header><div><small>EDIÇÃO NA PRÓPRIA ESCALA</small><h2 id="post-quick-title">{String(post.name)}</h2><p>Atualize o posto sem sair do dia aberto.</p></div><button type="button" onClick={onClose} aria-label="Fechar editor de posto">×</button></header>
    <label>Nome do posto<input name="name" defaultValue={String(post.name || "")} required /></label>
    <label>Seção da escala<input name="groupName" defaultValue={String(post.group_name || "")} required placeholder="Ex.: Postos fixos" /></label>
    <label>Ordem de exibição<input name="sortOrder" type="number" min="0" defaultValue={String(post.sort_order ?? 99)} /></label>
    <p className="vehicle-quick-help">A alteração mantém os GMs e os horários deste posto. A seção e a ordem também serão usadas no PDF.</p>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar posto"}</button></footer>
  </form></div>
}
function SectionQuickEditor({section,saving,onClose,onSave}:{section:{sectionKey:string;label:string};saving:boolean;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}) {
  return <div className="vehicle-quick-backdrop"><form className="vehicle-quick-editor" role="dialog" aria-modal="true" aria-labelledby="section-quick-title" onSubmit={onSave}>
    <header><div><small>EDIÇÃO NA PRÓPRIA ESCALA</small><h2 id="section-quick-title">{section.label}</h2><p>Renomeie a área sem alterar os postos ou os GMs.</p></div><button type="button" onClick={onClose} aria-label="Fechar editor de seção">×</button></header>
    <label>Nome da seção<input name="label" defaultValue={section.label} required /></label>
    <p className="vehicle-quick-help">A nova identificação será usada na grade e no PDF. O código interno da seção permanece o mesmo.</p>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar seção"}</button></footer>
  </form></div>
}
function QuickAssignmentEditor({pick,saving,onClose,onSave}:{pick:Pick;saving:boolean;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}) {
  const assignment=pick.assignment;
  if (!assignment) return null;
  const isVehicle=pick.kind === "vehicle";
  const destination=isVehicle ? String(pick.resource.prefix) : String(pick.resource.name);
  return <div className="vehicle-quick-backdrop"><form className="vehicle-quick-editor" role="dialog" aria-modal="true" aria-labelledby="quick-assignment-title" onSubmit={onSave}>
    <header><div><small>AJUSTE RÁPIDO NA ESCALA</small><h2 id="quick-assignment-title">{String(assignment.guard_name)}</h2><p>{destination} · {String(assignment.shift)}º turno</p></div><button type="button" onClick={onClose} aria-label="Fechar ajuste rápido">×</button></header>
    <div className="vehicle-status-legend"><span className="busy">Edite somente este quadrante</span><span className="available">Use “Trocar GM” para substituir a pessoa</span></div>
    <input type="hidden" name="shift" value={String(assignment.shift || pick.shift)} />
    <label>Função<select name="role" defaultValue={String(assignment.role || (isVehicle ? "third" : "guard"))}>{isVehicle ? <><option value="driver">M — Motorista</option><option value="patrol">P — Patrulheiro</option><option value="third">R — Reforço</option></> : <option value="guard">GM do posto</option>}</select></label>
    <div className="two"><label>Entrada<input name="startsAt" type="datetime-local" defaultValue={String(assignment.starts_at || "")} required /></label><label>Saída<input name="endsAt" type="datetime-local" defaultValue={String(assignment.ends_at || "")} required /></label></div>
    <label>Situação<select name="status" defaultValue={String(assignment.status || "normal")}><option value="normal">Normal</option><option value="overtime">Hora extra</option><option value="time_bank">Banco de horas</option><option value="swap">Troca de serviço</option></select></label>
    <label className="reassignment-check"><span><input type="checkbox" name="isReassigned" defaultChecked={Number(assignment.is_reassigned) === 1} /> Avisar remanejamento</span></label>
    <label>Observação / requerimento<input name="requestRef" defaultValue={String(assignment.request_ref || "")} placeholder="Opcional" /></label>
    <label>Nota do remanejamento<input name="reassignmentNote" defaultValue={String(assignment.reassignment_note || "")} placeholder="Opcional" /></label>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar ajuste"}</button></footer>
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

function shiftLabel(shift: string) {
  return ({ "1": "01:00–07:00", "2": "07:00–13:00", "3": "13:00–19:00", "4": "19:00–01:00" } as Record<string, string>)[shift] || "horário do período";
}

function OperationalGroupsGrid({ date, groups, members, guards, posts, vehicles, assignments, movements = [], serviceAdjustments = [], shifts: visibleShifts, selectedGroup, selectedId, onOpenAssignment, onExtend, onAdjust, onSwap, onQuickStatus, onCopy, onSuggestHe, onDetails, onDelete, onDragStart, onDragEnd, onCloseActions }: OperationalGroupGridProps) {
  const guardById = useMemo(() => new Map(guards.map((guard) => [Number(guard.id), guard])), [guards]);
  const postById = useMemo(() => new Map(posts.map((post) => [Number(post.id), post])), [posts]);
  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [Number(vehicle.id), vehicle])), [vehicles]);
  const groupSections = useMemo(() => {
    const specific = new Set(
      members
        .filter((member) => ["day", "night"].includes(String(member.pattern_period || "")))
        .map((member) => `${member.group_id}:${member.resource_kind}:${member.resource_id}:${String(member.team_label || "").trim().toUpperCase()}`),
    );
    const visibleMembers = members.filter((member) => {
      if (!["guard", "post", "vehicle"].includes(String(member.resource_kind))) return false;
      // Global guard links classify the personnel record only. A GM becomes
      // part of the daily group section when linked to the applied pattern;
      // otherwise the conventional assignment would appear twice.
      if (String(member.resource_kind) === "guard" && member.pattern_id == null) return false;
      const period = String(member.pattern_period || "");
      if (period === "day" || period === "night") return true;
      return !specific.has(`${member.group_id}:${member.resource_kind}:${member.resource_id}:${String(member.team_label || "").trim().toUpperCase()}`);
    });
    const byGroup = new Map<number, { group: Rec; teams: Map<string, { period: string; label: string; members: Rec[]; resources: Rec[] }> }>();
    for (const group of groups) byGroup.set(Number(group.id), { group, teams: new Map() });
    for (const member of visibleMembers) {
      const bucket = byGroup.get(Number(member.group_id));
      if (!bucket) continue;
      const period = ["day", "night"].includes(String(member.pattern_period)) ? String(member.pattern_period) : "all";
      const label = String(member.team_label || "EQUIPE GERAL").trim().toUpperCase() || "EQUIPE GERAL";
      const key = `${period}:${label}`;
      const team = bucket.teams.get(key) || { period, label, members: [], resources: [] };
      if (String(member.resource_kind) === "guard") team.members.push(member);
      else team.resources.push(member);
      bucket.teams.set(key, team);
    }
    return [...byGroup.values()]
      .filter((item) => item.teams.size > 0 && (!selectedGroup || selectedGroup === "all" || String(item.group.name) === selectedGroup))
      .sort((left, right) => Number(left.group.sort_order || 99) - Number(right.group.sort_order || 99) || String(left.group.name).localeCompare(String(right.group.name), "pt-BR"))
      .map((item) => ({
        ...item,
        teams: [...item.teams.values()].sort((left, right) => {
          const periodOrder = (value: string) => value === "day" ? 0 : value === "night" ? 1 : 2;
          return periodOrder(left.period) - periodOrder(right.period) || left.label.localeCompare(right.label, "pt-BR");
        }),
      }));
  }, [groups, members, selectedGroup]);

  function allowedShift(member: Rec, shift: string) {
    return operationalGroupMemberCoversShift(member, date, shift);
  }
  function locationLabel(assignment: Rec, member?: Rec) {
    if (assignment.vehicle_id != null) {
      const vehicle = vehicleById.get(Number(assignment.vehicle_id));
      return `${vehicleIcon(String(vehicle?.type || "other"))} ${String(vehicle?.prefix || "VTR")} · ${String(vehicle?.zone || "zona não definida")}`;
    }
    if (assignment.post_id != null) return String(postById.get(Number(assignment.post_id))?.name || "Posto");
    if (member?.vehicle_id != null) {
      const vehicle = vehicleById.get(Number(member.vehicle_id));
      return `${vehicleIcon(String(vehicle?.type || "other"))} ${String(vehicle?.prefix || "VTR")} · ${String(vehicle?.zone || "zona não definida")}`;
    }
    return "À disposição";
  }
  if (!groupSections.length) return null;
  return <>
    <tr className="operational-groups-grid-heading"><td colSpan={visibleShifts.length + 1}><div><span className="operational-group-mark" aria-hidden="true">◆</span><b>GRUPAMENTOS E EQUIPES</b><small>GMs vinculados ao padrão · seção operacional após viaturas e zonas</small></div></td></tr>
    {groupSections.map((section) => <Fragment key={`grid-group-${String(section.group.id)}`}>
      <tr className="operational-groups-grid-group"><td colSpan={visibleShifts.length + 1}><span style={{ background: String(section.group.color || "#1769aa") }} /> <b>{String(section.group.name)}</b><small>{String(section.group.short_name || "Grupamento")} · composição do padrão</small></td></tr>
      {section.teams.map((team) => <tr className="operational-groups-grid-team" key={`grid-team-${String(section.group.id)}-${team.period}-${team.label}`}>
        <td className="operational-groups-grid-team-label"><b>{team.label}</b><small>{team.period === "day" ? "DIURNO · D1/D2" : team.period === "night" ? "NOTURNO · N1/N2" : "TODOS OS TURNOS"}</small>{team.resources.length > 0 && <div className="operational-groups-grid-resources">{team.resources.map((resource) => <span key={`${resource.resource_kind}-${resource.resource_id}`}>{String(resource.resource_kind) === "vehicle" ? String(vehicleById.get(Number(resource.resource_id))?.prefix || "VTR") : String(postById.get(Number(resource.resource_id))?.name || "Posto")}</span>)}</div>}</td>
        {visibleShifts.map((shift) => <td className={`operational-groups-grid-cell period-${shift.period} ${shift.id === "4" ? "period-night-start" : ""}`} key={shift.id}>
          {team.members.filter((member) => allowedShift(member, shift.id)).map((member) => {
            const teamVehicleIds = [...new Set(team.resources.filter((resource) => String(resource.resource_kind) === "vehicle").map((resource) => Number(resource.resource_id)).filter(Boolean))];
            const configuredVehicleId = member.vehicle_id != null
              ? Number(member.vehicle_id)
              : teamVehicleIds.length === 1
                ? teamVehicleIds[0]
                : null;
            const displayMember = configuredVehicleId != null ? { ...member, vehicle_id: configuredVehicleId } : member;
            const memberAssignments = assignments.filter((item) => Number(item.guard_id) === Number(member.resource_id) && String(item.work_kind || "shift") !== "overtime_extension" && assignmentOverlapsShift(item, date, shift.id));
            // O destino do padrão é apenas a origem. Depois de um remanejamento
            // diário, a designação real pode estar em outra VTR/posto e deve
            // continuar editável dentro da seção do grupamento.
            const assignment = memberAssignments.find((item) =>
              configuredVehicleId != null
                ? Number(item.vehicle_id) === configuredVehicleId
                : member.post_id != null
                  ? Number(item.post_id) === Number(member.post_id)
                  : true,
            ) || memberAssignments[0];
            const extension = assignments.find((item) => Number(item.guard_id) === Number(member.resource_id) && String(item.work_kind || "") === "overtime_extension" && assignmentOverlapsShift(item, date, shift.id));
            const movement = movements.find((item) => Number(item.guard_id) === Number(member.resource_id) && String(item.starts_at || "") < `${date}T23:59` && String(item.ends_at || "") > `${date}T00:00`);
            const serviceAdjustment = serviceAdjustments.find((item) => Number(item.guard_id) === Number(member.resource_id) && (String(item.service_date || "") === date || String(item.counterpart_service_date || "") === date || String(item.settlement_date || "") === date));
            const adjustmentStatus = serviceAdjustment ? String(serviceAdjustment.subtype) === "swap" ? "swap" : "time_bank" : "";
            const visualStatus = assignment ? statusInShift(assignment, date, shift.id) : movement ? "away" : adjustmentStatus || "unassigned";
            const hasVisualBadge = ["overtime", "time_bank", "swap", "away"].includes(visualStatus);
            const adjustmentBadge = assignment ? assignmentAdjustmentBadge(assignment, serviceAdjustments, date) : serviceAdjustment ? `${liveServiceAdjustmentCode(String(serviceAdjustment.subtype || ""), serviceAdjustment, date)}${scheduleAdjustmentHoursLabel(String(serviceAdjustment.settlement_date || "") === date ? serviceAdjustment.settlement_hours || serviceAdjustment.hours : serviceAdjustment.hours) ? ` ${scheduleAdjustmentHoursLabel(String(serviceAdjustment.settlement_date || "") === date ? serviceAdjustment.settlement_hours || serviceAdjustment.hours : serviceAdjustment.hours)}` : ""}` : "";
            const vehicle = assignment?.vehicle_id != null ? vehicleById.get(Number(assignment.vehicle_id)) : configuredVehicleId != null ? vehicleById.get(configuredVehicleId) : null;
            const roleBadge = vehicle && isMotorcycleType(vehicle.type) ? "M" : assignment ? String(assignment.role || "GM").toUpperCase() : "GM";
            const guard = guardById.get(Number(member.resource_id));
            const configuredTime = member.starts_at && member.ends_at ? `${String(member.starts_at).slice(0, 5)}–${String(member.ends_at).slice(0, 5)} · 12h` : String(member.pattern_period) === "night" ? "19:00–07:00 · 12h" : String(member.pattern_period) === "day" ? "07:00–19:00 · 12h" : shiftLabel(shift.id);
            const actionAssignment = assignment ? { ...assignment, vehicle_id: assignment.vehicle_id ?? configuredVehicleId ?? null, post_id: assignment.post_id ?? member.post_id ?? null } : null;
            const destinationText = assignment
              ? locationLabel(assignment, displayMember)
              : configuredVehicleId != null || member.post_id != null
                ? locationLabel({}, displayMember)
                : "Sem VTR ou posto definido no padrão";
            const assignmentState = assignment
              ? roleBadge
              : movement
                ? "INDISPONÍVEL"
                : "NÃO LANÇADO NESTA ESCALA";
            return <div className="operational-groups-grid-gm-wrap" key={`${member.id}-${shift.id}`}>
              <button type="button" draggable={Boolean(actionAssignment)} className={`operational-groups-grid-gm ${assignment ? "assigned" : "unassigned"} ${visualStatus}`} onDragStart={(event) => { if (!actionAssignment) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/assignment", String(actionAssignment.id)); event.dataTransfer.setData("text/assignment-source-shift", shift.id); setAssignmentDragPreview(event, guard?.name, destinationText); onDragStart(actionAssignment); }} onDragEnd={onDragEnd} onClick={() => actionAssignment && onOpenAssignment(actionAssignment, shift.id)} disabled={!assignment} title={assignment ? "Clique para editar ou arraste para mover este quadradinho" : "Integrante previsto no padrão, ainda sem lançamento nesta escala"}>
                <strong>{String(guard?.name || `GM ${member.resource_id}`)}{hasVisualBadge && <span className={`group-status-badge ${visualStatus === "overtime" ? "he" : visualStatus === "time_bank" ? "bh" : visualStatus === "swap" ? "swap" : "away"}`}>{adjustmentBadge || (visualStatus === "overtime" && assignment?.regular_ends_at ? `HE · após ${String(assignment.regular_ends_at).slice(11, 16)}` : visualStatus === "away" ? String(movement?.type || "AFASTADO").replace("medical_leave", "ATESTADO").replace("day_off", "FOLGA").replace("vacation", "FÉRIAS").toUpperCase() : statusShort(visualStatus))}</span>}</strong><span>{movement && !assignment ? "Fora da escala neste período" : destinationText}</span><em>{assignmentState}</em><small className="operational-groups-grid-time">{assignment ? assignmentDisplayInShift(assignment, date, shift.id) : configuredTime}{extension ? ` · +HE ${overtimeHoursLabel(extension)}` : ""}</small>
              </button>
              {actionAssignment && extensionShortcutAvailable(actionAssignment, shift.id, date, assignments) && <button type="button" className="operational-group-inline-he" title="Estender este GM em hora extra" onClick={() => onExtend(actionAssignment, shift.id, "after")}>+HE</button>}
              {actionAssignment && earlyExtensionShortcutAvailable(actionAssignment, shift.id, date) && <button type="button" className="operational-group-inline-he early" title="Antecipar este GM em hora extra" onClick={() => onExtend(actionAssignment, shift.id, "before")}>+HE antes</button>}
              {actionAssignment && Number(actionAssignment.id) === selectedId && <div className="operational-group-quick-actions" role="group" aria-label={`Ações rápidas de ${String(guard?.name || "GM")}`}>
                <header><b>{String(guard?.name || "GM")}</b><button type="button" aria-label="Fechar ações" onClick={onCloseActions}>×</button></header>
                <button type="button" onClick={() => onAdjust(actionAssignment, shift.id)}><span aria-hidden="true">✎</span>Ajustar</button>
                <details className="cell-more-actions"><summary>Mais ações</summary><div>
                  <button type="button" onClick={() => onSwap(actionAssignment, shift.id)}><span aria-hidden="true">⇄</span>Trocar</button>
                  <button type="button" className={actionAssignment.status === "time_bank" ? "active" : ""} onClick={() => onQuickStatus(actionAssignment, actionAssignment.status === "time_bank" ? "normal" : "time_bank")}><span aria-hidden="true">◷</span>BH</button>
                  <button type="button" onClick={() => onCopy(actionAssignment)}><span aria-hidden="true">▣</span>Copiar</button>
                  <button type="button" className="group-he-suggestions" onClick={() => onSuggestHe(actionAssignment, shift.id, member)}><span aria-hidden="true">＋</span>HE do grupamento</button>
                  <button type="button" onClick={() => onDetails(actionAssignment, shift.id)}><span aria-hidden="true">⋯</span>Detalhes</button>
                  <button type="button" className="danger" onClick={() => onDelete(actionAssignment, shift.id)}><span aria-hidden="true">×</span>Remover</button>
                </div></details>
              </div>}
            </div>;
          })}
          {!team.members.some((member) => allowedShift(member, shift.id)) && <span className="operational-groups-grid-empty">—</span>}
        </td>)}
      </tr>)}
    </Fragment>)}
  </>;
}

function OperationalGroupsSection({
  groups,
  members,
  guards,
  posts,
  vehicles,
  assignments,
  patternLabel,
  selectedGroup,
  onSelectGroup,
}: {
  groups: Rec[];
  members: Rec[];
  guards: Rec[];
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  patternLabel: string;
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  const sections = useMemo(() => {
    const guardById = new Map(guards.map((guard) => [Number(guard.id), guard]));
    const postById = new Map(posts.map((post) => [Number(post.id), post]));
    const vehicleById = new Map(vehicles.map((vehicle) => [Number(vehicle.id), vehicle]));
    const locationByGuard = new Map<number, string>();
    for (const assignment of assignments) {
      const guardId = Number(assignment.guard_id);
      if (locationByGuard.has(guardId)) continue;
      if (assignment.vehicle_id != null) {
        locationByGuard.set(guardId, String(vehicleById.get(Number(assignment.vehicle_id))?.prefix || "VTR"));
      } else if (assignment.post_id != null) {
        locationByGuard.set(guardId, String(postById.get(Number(assignment.post_id))?.name || "Posto"));
      }
    }
    const specific = new Set(
      members
        .filter((member) => String(member.pattern_period || "") === "day" || String(member.pattern_period || "") === "night")
        .map((member) => `${member.group_id}:${member.resource_kind}:${member.resource_id}:${String(member.team_label || "").toUpperCase()}`),
    );
    const visible = members.filter((member) => {
      const period = String(member.pattern_period || "");
      if (period !== "day" && period !== "night") return !specific.has(`${member.group_id}:${member.resource_kind}:${member.resource_id}:${String(member.team_label || "").toUpperCase()}`);
      return true;
    });
    const byGroup = new Map<number, { group: Rec; totalGuards: number; totalResources: number; teams: Map<string, { period: string; team: string; members: Rec[] }> }>();
    for (const group of groups) {
      byGroup.set(Number(group.id), { group, totalGuards: 0, totalResources: 0, teams: new Map() });
    }
    for (const member of visible) {
      const bucket = byGroup.get(Number(member.group_id));
      if (!bucket) continue;
      const kind = String(member.resource_kind);
      if (kind === "guard") bucket.totalGuards += 1;
      else bucket.totalResources += 1;
      const period = ["day", "night"].includes(String(member.pattern_period)) ? String(member.pattern_period) : "all";
      const team = String(member.team_label || "EQUIPE GERAL").trim().toUpperCase() || "EQUIPE GERAL";
      const key = `${period}:${team}`;
      const teamBucket = bucket.teams.get(key) || { period, team, members: [] };
      teamBucket.members.push(member);
      bucket.teams.set(key, teamBucket);
    }
    return [...byGroup.values()]
      .filter((item) => item.teams.size > 0)
      .sort((left, right) => Number(left.group.sort_order || 99) - Number(right.group.sort_order || 99) || String(left.group.name).localeCompare(String(right.group.name), "pt-BR"))
      .map((item) => ({
        ...item,
        teams: [...item.teams.values()].sort((left, right) => {
          const periodOrder = (value: string) => value === "day" ? 0 : value === "night" ? 1 : 2;
          return periodOrder(left.period) - periodOrder(right.period) || left.team.localeCompare(right.team, "pt-BR");
        }),
        labelFor: (member: Rec) => {
          const kind = String(member.resource_kind);
          if (kind === "guard") return String(guardById.get(Number(member.resource_id))?.name || `GM ${member.resource_id}`);
          if (kind === "vehicle") return String(vehicleById.get(Number(member.resource_id))?.prefix || `VTR ${member.resource_id}`);
          return String(postById.get(Number(member.resource_id))?.name || `Posto ${member.resource_id}`);
        },
        detailFor: (member: Rec) => {
          const kind = String(member.resource_kind);
          if (kind === "guard") return locationByGuard.get(Number(member.resource_id)) || "GM do grupamento";
          return kind === "vehicle" ? String(vehicleById.get(Number(member.resource_id))?.zone || "Zona não definida") : "Posto vinculado";
        },
      }));
  }, [assignments, guards, groups, members, posts, vehicles]);

  if (!sections.length) return null;
  return <section className="operational-groups-summary" aria-label="Grupamentos operacionais aplicados">
    <header className="operational-groups-summary-head"><div><span>COMPOSIÇÃO DO PADRÃO APLICADO</span><h2>Grupamentos operacionais</h2><p>Os GMs e recursos abaixo pertencem ao padrão exibido nesta escala. As equipes internas permanecem separadas por turno.</p></div><strong>{patternLabel || "Padrão do dia"}</strong></header>
    <div className="operational-groups-summary-filter" aria-label="Filtrar grade por grupamento"><span>Filtrar grade:</span><button type="button" className={selectedGroup === "all" ? "active" : ""} aria-pressed={selectedGroup === "all"} onClick={() => onSelectGroup("all")}>Todos</button>{sections.filter((section) => section.totalResources > 0).map((section) => { const value = String(section.group.name); return <button type="button" key={value} className={selectedGroup === value ? "active" : ""} aria-pressed={selectedGroup === value} onClick={() => onSelectGroup(value)}>{String(section.group.short_name || section.group.name)}</button>; })}</div>
    <div className="operational-groups-summary-grid">{sections.map((section) => <article className="operational-group-summary-card" key={String(section.group.id)} style={{ borderTopColor: String(section.group.color || "#1769aa") }}>
      <header><span className="operational-group-summary-swatch" style={{ background: String(section.group.color || "#1769aa") }} /><div><b>{String(section.group.name)}</b><small>{section.totalGuards} GM(s) · {section.totalResources} recurso(s)</small></div></header>
      <div className="operational-group-team-grid">{section.teams.map((team) => <section className="operational-group-team-card" key={`${String(section.group.id)}-${team.period}-${team.team}`}>
        <header><b>{team.team}</b><span>{team.period === "day" ? "DIURNO" : team.period === "night" ? "NOTURNO" : "TODOS OS TURNOS"}</span></header>
        <div>{team.members.map((member) => <span className={`operational-group-member kind-${String(member.resource_kind)}`} key={String(member.id)}><strong>{section.labelFor(member)}</strong><small>{String(member.resource_kind) === "guard" ? "GM" : String(member.resource_kind) === "vehicle" ? "Viatura" : "Posto"} · {section.detailFor(member)}</small></span>)}</div>
      </section>)}</div>
    </article>)}</div>
  </section>;
}

void OperationalGroupsSection;

type RowProps = {
  date: string;
  kind: "post" | "vehicle";
  resource: Rec;
  section: string;
  sourceSection: string;
  operationalSession: boolean;
  sectionKey: string;
  sectionResourceCount: number;
  draggingAssignmentId: number | null;
  onDragStart: (assignment: Rec) => void;
  onDragEnd: () => void;
  first: boolean;
  groupFirst: boolean;
  teamFirst: boolean;
  operationalGroup: string | null;
  operationalTeam: string | null;
  operationalGroupColor: string | null;
  collapsed: boolean;
  onToggleSection: () => void;
  shifts: typeof SHIFT_DEFS;
  assignmentIndex: Map<string, Rec[]>;
  resourceAssignments: Rec[];
  allScheduleAssignments: Rec[];
  assignmentById: Map<number, Rec>;
  guards: Rec[];
  guardOperationalMeta: Map<number, Rec>;
  guardOperationalMetaByShift: Map<string, Rec>;
  onQuickAdd: (guardId: number, kind: "post" | "vehicle", resource: Rec, shift: string) => void | Promise<void>;
  onSectionRef: (section: string, element: HTMLTableRowElement | null) => void;
  serviceAdjustments: Rec[];
  movements: Rec[];
  availableForRedeployment: Rec[];
  redeploymentGroups: RedeploymentGroup[];
  selectedId: number;
  recentAssignmentIds: number[];
  onContextPick: (p: Pick) => void;
  onEdit: (p: Pick) => void;
  onSwap: (assignment:Rec,kind:"post"|"vehicle",resource:Rec,shift:string) => void;
  onQuickStatus: (assignment:Rec,status:string) => void;
  onExtend: (assignment: Rec, kind: "post" | "vehicle", resource: Rec, shift: string, extensionMode?:"after"|"before") => void;
  copiedAssignment: Rec | null;
  onCopy: (assignment:Rec) => void;
  onPaste: (kind:"post"|"vehicle",resource:Rec,shift:string) => void | Promise<void>;
  onQuickDelete: (assignment:Rec, shift?:string) => void;
  onMove: (a: Rec, k: "post" | "vehicle", r: Rec, s: string, sourceShift?: string, targetAssignmentId?: number) => void;
  onMoveGroup: (a: Rec[], k: "post" | "vehicle", r: Rec) => void;
  onHolePick: (
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onEditVehicle: (vehicle: Rec) => void;
  onEditPost: (post: Rec) => void;
  onEditSection: (sectionKey: string, label: string) => void;
  onQuickEdit: (pick: Pick) => void;
  onAddToResource: (kind: "post" | "vehicle", resource: Rec, shift: string) => void;
  onAddInSection: (kind: "post" | "vehicle", section: string) => void;
  onRemoveResource: (kind: "post" | "vehicle", resource: Rec) => void;
};

function Row({
  date,
  kind,
  resource,
  section,
  sourceSection,
  operationalSession,
  sectionKey,
  sectionResourceCount,
  draggingAssignmentId,
  onDragStart,
  onDragEnd,
  first,
  groupFirst,
  teamFirst,
  operationalGroup,
  operationalTeam,
  operationalGroupColor,
  collapsed,
  onToggleSection,
  shifts: visibleShifts,
  assignmentIndex,
  resourceAssignments,
  allScheduleAssignments,
  assignmentById,
  guards,
  guardOperationalMeta,
  guardOperationalMetaByShift,
  onQuickAdd,
  onSectionRef,
  serviceAdjustments,
  movements,
  availableForRedeployment,
  redeploymentGroups,
  selectedId,
  recentAssignmentIds,
  onContextPick,
  onEdit,
  onSwap,
  onQuickStatus,
  onExtend,
  copiedAssignment,
  onCopy,
  onPaste,
  onQuickDelete,
  onMove,
  onMoveGroup,
  onHolePick,
  onEditVehicle,
  onEditPost,
  onEditSection,
  onQuickEdit,
  onAddToResource,
  onAddInSection,
  onRemoveResource,
}: RowProps) {
  const alignedAssignmentsByShift=useMemo(()=>new Map(visibleShifts.map(shift=>{
    const period = isDayShift(shift.id) ? "day" : "night";
    const raw = assignmentIndex.get(assignmentKey(kind,Number(resource.id),shift.id)) || [];
    // Pattern-owned GMs are rendered in the dedicated grupamento section.
    // Keep the assignment in memory for editing, but do not show it twice in
    // the conventional post/VTR cell.
    const visible = raw.filter((assignment) => {
      const ownedMember = guardOperationalMetaByShift.get(`${Number(assignment.guard_id)}:${shift.id}`) || guardOperationalMetaByShift.get(`${Number(assignment.guard_id)}:${period}`);
      return !(ownedMember && ownedMember.pattern_id);
    });
    return [shift.id, orderAssignmentsInResourceCell(visible,resourceAssignments,kind)] as const;
  })),[assignmentIndex,guardOperationalMetaByShift,kind,resource.id,resourceAssignments,visibleShifts]);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [addShift, setAddShift] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const quickAddAvailableIds = useMemo(() => {
    if (!addShift) return new Set<number>();
    const target = operationalShiftWindow(date, addShift);
    return new Set(
      availableForRedeployment
        .filter((assignment) => String(assignment.starts_at) < target.end && String(assignment.ends_at) > target.start)
        .map((assignment) => Number(assignment.guard_id)),
    );
  }, [addShift, availableForRedeployment, date]);
  const quickAddCandidates = useMemo(() => {
    if (!addShift) return [];
    const target = operationalShiftWindow(date, addShift);
    const query = addQuery.trim().toLowerCase();
    const serviceAdjustmentBlockedIds = new Set(
      serviceAdjustments
        .filter((adjustment) => String(adjustment.subtype) === "negative_full" && String(adjustment.service_date) === date)
        .map((adjustment) => Number(adjustment.guard_id)),
    );
    return guards
      .filter((guard) => {
        // A inclusÃ£o rÃ¡pida sÃ³ usa a bandeja Ã€ disposiÃ§Ã£o. GMs sem escala
        // nÃ£o aparecem aqui; a equipe oposta Ã© oferecida pelo fluxo de HE.
        if (!quickAddAvailableIds.has(Number(guard.id))) return false;
        if (query && !`${guard.name || ""} ${guard.registration || ""} ${guard.platoon || ""}`.toLowerCase().includes(query)) return false;
        if (serviceAdjustmentBlockedIds.has(Number(guard.id))) return false;
        if (movements.some((movement) => Number(movement.guard_id) === Number(guard.id) && String(movement.starts_at) < target.end && String(movement.ends_at) > target.start)) return false;
        return !allScheduleAssignments.some((assignment) =>
          Number(assignment.guard_id) === Number(guard.id) &&
          String(assignment.starts_at) < target.end &&
          String(assignment.ends_at) > target.start,
        );
      })
      .sort((left, right) => {
        return String(left.name || "").localeCompare(String(right.name || ""), "pt-BR");
      })
      .slice(0, 8);
  }, [addQuery, addShift, allScheduleAssignments, date, guards, movements, quickAddAvailableIds, serviceAdjustments]);
  const draggingAssignment = useMemo(() => {
    if (!draggingAssignmentId) return null;
    return assignmentById.get(draggingAssignmentId) || availableForRedeployment.find((assignment) => Number(assignment.id) === draggingAssignmentId) || null;
  }, [assignmentById, availableForRedeployment, draggingAssignmentId]);
  function canReceiveDrag(shift: string) {
    if (!draggingAssignment) return false;
    const target = operationalShiftWindow(date, shift);
    return !allScheduleAssignments.some((assignment) =>
      Number(assignment.id) !== Number(draggingAssignment.id) &&
      Number(assignment.guard_id) === Number(draggingAssignment.guard_id) &&
      String(assignment.starts_at) < target.end &&
      String(assignment.ends_at) > target.start,
    );
  }
  function canDropOnCard(target: Rec) {
    return Boolean(
      draggingAssignment &&
      Number(draggingAssignment.id) !== Number(target.id) &&
      String(target.work_kind) !== "overtime_extension",
    );
  }
  function linkedRegularJourney(assignment: Rec, shift: string) {
    if (String(assignment.work_kind || "shift") === "overtime_extension") return [assignment];
    const period = isDayShift(shift) ? "day" : "night";
    const sameResource = (candidate: Rec) => kind === "post"
      ? Number(candidate.post_id) === Number(resource.id)
      : Number(candidate.vehicle_id) === Number(resource.id);
    const linked = allScheduleAssignments.filter((candidate) =>
      Number(candidate.guard_id) === Number(assignment.guard_id) &&
      String(candidate.work_kind || "shift") !== "overtime_extension" &&
      sameResource(candidate) &&
      coveredOperationalShifts(candidate, date).some((coveredShift) => (isDayShift(coveredShift) ? "day" : "night") === period),
    );
    return [...new Map(linked.map((candidate) => [Number(candidate.id), candidate])).values()];
  }
  function navigateCell(event: ReactKeyboardEvent<HTMLTableCellElement>, shift: string, list: Rec[]) {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const assignment = list.find((item) => String(item.work_kind) !== "overtime_extension") || list[0];
      if (assignment) onContextPick({ kind, resource, shift, assignment });
      else onAddToResource(kind, resource, shift);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onContextPick({ kind, resource, shift });
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const cell = event.currentTarget;
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const column = cell.cellIndex;
    let next: HTMLTableCellElement | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      next = row.cells[column + (event.key === "ArrowLeft" ? -1 : 1)] || null;
    } else {
      const rows = Array.from(row.parentElement?.children || []).filter((item): item is HTMLTableRowElement => item instanceof HTMLTableRowElement && item.classList.contains(kind === "vehicle" ? "vehicle-row" : "post-row"));
      const index = rows.indexOf(row as HTMLTableRowElement);
      const targetRow = rows[index + (event.key === "ArrowUp" ? -1 : 1)];
      next = targetRow?.cells[column] || null;
    }
    next?.focus();
  }
  function canPasteInShift(shift:string){
    if(!copiedAssignment)return false;
    const target=operationalShiftWindow(date,shift);
    return ![...allScheduleAssignments,...availableForRedeployment].some(item=>Number(item.guard_id)===Number(copiedAssignment.guard_id)&&String(item.starts_at)<target.end&&String(item.ends_at)>target.start);
  }
  function drop(e: DragEvent, shift: string, targetAssignmentId?: number) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    const groupIds = e.dataTransfer
      .getData("text/assignment-group")
      .split(",")
      .map(Number)
      .filter(Boolean);
    if (groupIds.length) {
      const group = redeploymentGroups.find((item) => item.assignments.every((assignment) => groupIds.includes(Number(assignment.id))));
      const groupedAssignments = group?.assignments || groupIds.map((groupId) => assignmentById.get(groupId) || availableForRedeployment.find((assignment) => Number(assignment.id) === groupId)).filter((assignment): assignment is Rec => Boolean(assignment));
      const targetPeriod = isDayShift(shift) ? "day" : "night";
      const sourcePeriod = groupedAssignments.some((assignment) => coveredOperationalShifts(assignment, date).some((coveredShift) => isDayShift(coveredShift))) ? "day" : "night";
      if (groupedAssignments.length === groupIds.length && sourcePeriod === targetPeriod) {
        const firstAssignment = groupedAssignments[0];
        const alreadyHere = kind === "post"
          ? Number(firstAssignment.post_id) === Number(resource.id)
          : Number(firstAssignment.vehicle_id) === Number(resource.id);
        // A API de ordenação alinha todas as partes regulares do mesmo GM.
        // Assim, soltar a jornada sobre outro card muda a faixa visual sem
        // transformar a ação em um remanejamento.
        if (alreadyHere) {
          void onMove(firstAssignment, kind, resource, shift, shift, targetAssignmentId);
          return;
        }
        void onMoveGroup(groupedAssignments, kind, resource);
        return;
      }
      // Ao atravessar de diurno para noturno (ou no sentido inverso), move
      // somente o quadradinho efetivamente arrastado. A outra metade da
      // jornada regular permanece no turno original. Antes, o retorno
      // incondicional acima encerrava o drop silenciosamente sempre que o
      // card carregava o identificador da jornada completa.
    }
    const id = Number(e.dataTransfer.getData("text/assignment"));
    const sourceShift = e.dataTransfer.getData("text/assignment-source-shift") || undefined;
    if (!id || (targetAssignmentId && targetAssignmentId === id)) return;
    const assignment = assignmentById.get(id);
    if (assignment) {
      void onMove(assignment, kind, resource, shift, sourceShift, targetAssignmentId);
      return;
    }
    const available = availableForRedeployment.find((a) => Number(a.id) === id);
     if (available) void onMove(available, kind, resource, shift, sourceShift, targetAssignmentId);
  }
  return (
    <Fragment>
      {first && (
        <tr
          ref={(element) => onSectionRef(section, element)}
          className={`group ${section === "SEDE DA GM" ? "headquarters" : ""} ${operationalSession ? "operational-group-session" : ""}`}
        >
          <td colSpan={1 + visibleShifts.length}>
            <div className="section-heading-actions">
              <button type="button" className="section-toggle" aria-expanded={!collapsed} onClick={onToggleSection}>
                <span className="section-toggle-label">
                  <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
                  <span aria-hidden="true">{operationalSession ? "◆" : kind === "vehicle" ? "🚓" : "◆"}</span>
                  <b>{section}</b>
                  <small className="section-heading-summary">{sectionResourceCount} {sectionResourceCount === 1 ? "recurso" : "recursos"}</small>
                </span>
              </button>
              <button type="button" className="section-inline-add" onClick={()=>onAddInSection(kind,sourceSection)}>
                ＋ {kind==="vehicle"?"Viatura":"Posto"}
              </button>
              {!operationalSession && <button type="button" className="section-inline-edit" onClick={()=>onEditSection(sectionKey,sourceSection)} aria-label={`Editar seção ${sourceSection}`} title="Editar nome da seção">✎</button>}
            </div>
          </td>
        </tr>
      )}
      {!collapsed && !operationalSession && groupFirst && operationalGroup && (
        <tr className="operational-group-heading">
          <td colSpan={1 + visibleShifts.length} style={operationalGroupColor ? { borderTopColor: operationalGroupColor } : undefined}>
            <div className="operational-group-section-label">
              <span className="operational-group-mark" style={operationalGroupColor ? { background: operationalGroupColor } : undefined} aria-hidden="true">◆</span>
              <span className="operational-group-title" style={operationalGroupColor ? { color: operationalGroupColor } : undefined}>{operationalGroup}</span>
              <small>Grupamento operacional · sessão da escala</small>
            </div>
          </td>
        </tr>
      )}
      {!collapsed && teamFirst && operationalTeam && (
        <tr className="operational-team-heading">
          <td colSpan={1 + visibleShifts.length}>
            <span>Equipe {operationalTeam}</span>
            <small>composição operacional</small>
          </td>
        </tr>
      )}
      {!collapsed && (
      <tr className={kind === "vehicle" ? "vehicle-row" : "post-row"}>
        <td className="resource-cell">
          <div className="resource">
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
            {(operationalGroup || operationalTeam) && (
              <span className="resource-unit-tags" aria-label="Classificação operacional">
                {operationalGroup && <em className="resource-group-chip">{operationalGroup}</em>}
                {operationalTeam && <em className="resource-team-chip">Equipe {operationalTeam}</em>}
              </span>
            )}
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
            {kind === "post" && (
            <button
              type="button"
              className="resource-quick-button"
              aria-label={`Editar ${String(resource.name)}`}
              onClick={() => onEditPost(resource)}
            >
              Editar
            </button>
          )}
            <button
            type="button"
            className="resource-add-person"
            aria-label={`Adicionar GM em ${String(kind === "vehicle" ? resource.prefix : resource.name)}`}
            title="Adicionar GM neste local"
            onClick={() => onAddToResource(kind, resource, visibleShifts[0]?.id || "2")}
          >
            ＋ GM
          </button>
            <button
            type="button"
            className="resource-remove-button"
            aria-label={`Retirar ${String(kind === "vehicle" ? resource.prefix : resource.name)} desta escala`}
            title="Retirar somente desta escala"
            onClick={() => onRemoveResource(kind, resource)}
          >
            <span aria-hidden="true">×</span>
          </button>
          </div>
        </td>
        {visibleShifts.map((s) => {
          const list = alignedAssignmentsByShift.get(s.id) || [];
          const pasteAllowed=canPasteInShift(s.id);
          const missingRoles = kind === "vehicle"
            ? isMotorcycleType(resource.type)
              ? list.some((assignment) => !isOvertimeExtensionCell(assignment,date,s.id)) ? [] : ["driver"]
              : ["driver", "patrol"].filter((role) => !list.some((assignment) => String(assignment.role) === role && !isOvertimeExtensionCell(assignment,date,s.id)))
            : list.length ? [] : ["guard"];
          const toggleQuickAdd = () => { setAddShift(current => current === s.id ? null : s.id); setAddQuery(""); };
          const quickPicker = (withSmartSuggestion = false) => addShift === s.id && <div className="quick-add-picker" role="group" aria-label={`Sugestões inteligentes para ${String(kind === "vehicle" ? resource.prefix : resource.name)}`}>
            <strong className="quick-add-title">Sugestões para este furo</strong>
            <input value={addQuery} onChange={(event) => setAddQuery(event.target.value)} placeholder="Buscar GM à disposição..." aria-label="Buscar GM à disposição" />
            <div className="quick-add-results">
              {quickAddCandidates.map((guard) => <button type="button" key={String(guard.id)} onClick={() => { setAddShift(null); setAddQuery(""); void onQuickAdd(Number(guard.id), kind, resource, s.id); }}>
                <span><b>{guard.name}</b><small><em className="quick-add-origin available">À disposição</em> · {guard.registration || "Sem matrícula"} · {guard.platoon || "Equipe do dia"}</small></span><strong>Remanejar</strong>
              </button>)}
              {!quickAddCandidates.length && <small>Nenhum GM à disposição neste período. Use as sugestões de HE da equipe oposta.</small>}
            </div>
            {withSmartSuggestion && <button type="button" className="quick-add-smart" onClick={(event) => { setAddShift(null); onHolePick(kind, resource, s.id, event); }}>Abrir sugestões inteligentes · HE/remanejamento</button>}
          </div>;
          return (
            <td
              key={s.id}
              className={`${missingRoles.length ? "furo" : ""} ${pasteAllowed?"paste-target":""} ${draggingAssignmentId && canReceiveDrag(s.id) ? "drag-drop-ready" : ""} ${draggingAssignmentId && !canReceiveDrag(s.id) ? "drag-drop-blocked" : ""} drop-cell period-${s.period} ${s.id==="4"?"period-night-start":""}`}
              tabIndex={0}
              aria-label={`${kind === "vehicle" ? String(resource.prefix) : String(resource.name)} · ${s.label} · ${list.length ? `${list.length} GM(s)` : "Furo"}`}
              onKeyDown={(event) => navigateCell(event, s.id, list)}
              onDragOver={(e) => { if (canReceiveDrag(s.id)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
               onDrop={(e) => { if (canReceiveDrag(s.id)) drop(e, s.id); else { e.preventDefault(); e.stopPropagation(); setDropTargetId(null); } }}
            >
              {list.map((a) => {const visualStatus=statusInShift(a,date,s.id),adjustmentBadge=assignmentAdjustmentBadge(a,serviceAdjustments,date),weeklyFixedHe=fixedWeeklyOvertimeLabel(a),canExtendAfter=extensionShortcutAvailable(a,s.id,date,allScheduleAssignments),canExtendBefore=earlyExtensionShortcutAvailable(a,s.id,date);return (<Fragment key={String(a.id)}><Fragment>
                <div className={`live-person-card ${canExtendAfter||canExtendBefore?"has-he-action":""} ${dropTargetId===Number(a.id)?"drop-target":""} ${draggingAssignmentId===Number(a.id)?"dragging-source":""}`} onDragEnter={()=>{if(canDropOnCard(a))setDropTargetId(Number(a.id))}} onDragLeave={(event)=>{const next=event.relatedTarget;if(next instanceof Node&&event.currentTarget.contains(next))return;setDropTargetId(current=>current===Number(a.id)?null:current)}} onDragOver={(event)=>{if(!draggingAssignment)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canDropOnCard(a)?"move":"none"}} onDrop={(event)=>{if(!draggingAssignment)return;event.preventDefault();event.stopPropagation();if(canDropOnCard(a))drop(event,s.id,Number(a.id))}}>
                <button
                  type="button"
                  draggable
                  className={`live-person ${visualStatus} ${Number(a.is_reassigned)?"reassigned":""} ${Number(a.id) === selectedId ? "is-selected" : ""} ${recentAssignmentIds.includes(Number(a.id))?"recent-update":""}`}
                  title="Arraste para outro posto/viatura ou solte sobre outro GM para ordenar"
                  aria-label={`${String(a.guard_name)}. Arraste para mover ou ordenar este quadradinho`}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/assignment", String(a.id));
                    e.dataTransfer.setData("text/assignment-source-shift", s.id);
                    const linkedJourney = linkedRegularJourney(a, s.id);
                    if (linkedJourney.length > 1) e.dataTransfer.setData("text/assignment-group", linkedJourney.map((assignment) => assignment.id).join(","));
                    setAssignmentDragPreview(e, a.guard_name, linkedJourney.length > 1 ? "Jornada completa" : assignmentDisplayInShift(a, date, s.id));
                    onDragStart(a);
                  }}
                  onDragEnd={onDragEnd}
                  onClick={() =>
                    onContextPick({ kind, resource, shift: s.id, assignment: a })
                  }
                >
                  {kind === "vehicle" && (
                    <span className="role">
                       {isOvertimeExtensionCell(a,date,s.id) ? "R" : isMotorcycleType(resource.type) ? "M" : a.role === "driver" ? "M" : a.role === "patrol" ? "P" : "R"}
                    </span>
                  )}
                  <b>{a.guard_name}</b>
                  {operationalSession && (() => { const period = a.shift === "2" || a.shift === "3" ? "day" : a.shift === "4" || a.shift === "1" ? "night" : "global"; const guardMeta = guardOperationalMetaByShift.get(`${Number(a.guard_id)}:${period}`) || guardOperationalMeta.get(Number(a.guard_id)); return guardMeta && (guardMeta.team_label || guardMeta.group_short_name || guardMeta.group_name) ? <span className="person-operational-chip">{guardMeta.team_label ? `Equipe ${guardMeta.team_label}` : String(guardMeta.group_short_name || guardMeta.group_name)}</span> : null; })()}
                  {(visualStatus !== "normal" || weeklyFixedHe) && (
                    <span className={`badge ${weeklyFixedHe ? "he weekly-fixed-he" : statusClass(visualStatus)} ${adjustmentBadge.startsWith("BH+")?"settlement-badge":""}`}>
                      {weeklyFixedHe || adjustmentBadge|| (String(a.work_kind)==="overtime_extension"?overtimeHoursLabel(a):visualStatus==="overtime"&&a.regular_ends_at?`HE · após ${String(a.regular_ends_at).slice(11,16)}`:statusShort(visualStatus))}
                    </span>
                  )}
                  {Number(a.is_reassigned)===1&&<span className="badge remanejamento" title={String(a.reassignment_note||"Avisar sobre o remanejamento")}>AVISAR REM</span>}
                  <small>
                    {assignmentDisplayInShift(a,date,s.id)}
                  </small>
                  {a.request_ref && (
                    <span
                      className="request-reference"
                      title={`Requerimento: ${String(a.request_ref)}`}
                    >
                      Req. {compactRequestReference(a.request_ref)}
                    </span>
                  )}
                </button>
                {canExtendAfter&&<button type="button" className="inline-he-extension" aria-label={`Adicionar hora extra para ${String(a.guard_name)} após o expediente`} title="Adicionar hora extra após o expediente" onClick={()=>onExtend(a,kind,resource,s.id,"after")}><span aria-hidden="true">◷</span>+HE</button>}
                {canExtendBefore&&<button type="button" className="inline-he-extension early" aria-label={`Adicionar hora extra antes do turno de ${String(a.guard_name)}`} title="Fazer o GM da noite começar mais cedo em HE" onClick={()=>onExtend(a,kind,resource,s.id,"before")}><span aria-hidden="true">◷</span>+HE</button>}
                </div>
                {Number(a.id)===selectedId&&<div className="cell-quick-actions" role="group" aria-label={`Ações rápidas de ${String(a.guard_name)}`}>
                  <div className="cell-quick-head">
                    <span>
                      <b>{a.guard_name}</b>
                      <small>{kind==="vehicle"?String(resource.prefix):String(resource.name)} · {s.label}</small>
                    </span>
                    <button type="button" className="cell-quick-close" aria-label="Fechar ações" title="Fechar" onClick={()=>onContextPick({kind,resource,shift:s.id})}>×</button>
                  </div>
                  <button type="button" className="primary-action" onClick={()=>onQuickEdit({kind,resource,shift:s.id,assignment:a})}><span aria-hidden="true">✎</span> Ajustar</button>
                  <details className="cell-more-actions"><summary>Mais ações</summary><div>
                    <button type="button" className="swap-action" onClick={()=>onSwap(a,kind,resource,s.id)}><span aria-hidden="true">⇄</span> Trocar GM</button>
                    <button type="button" className={a.status==="time_bank"?"active":""} onClick={()=>onQuickStatus(a,a.status==="time_bank"?"normal":"time_bank")}><span aria-hidden="true">◷</span> BH</button>
                    <button type="button" className="copy-action" onClick={()=>onCopy(a)}><span aria-hidden="true">▣</span> Copiar</button>
                    <button type="button" className="advanced-action" onClick={()=>onEdit({kind,resource,shift:s.id,assignment:a})}><span aria-hidden="true">⋯</span> Mais detalhes</button>
                    <button type="button" className="danger" onClick={()=>onQuickDelete(a,s.id)}><span aria-hidden="true">×</span> Remover horário</button>
                  </div></details>
                  <small className="drag-context-hint">Para mover ou alinhar, arraste o quadradinho diretamente.</small>
                </div>}</Fragment>
              </Fragment>)})}
              {copiedAssignment&&pasteAllowed&&<button type="button" className="cell-paste-assignment" onClick={()=>onPaste(kind,resource,s.id)}><span aria-hidden="true">▣</span> Colar aqui</button>}
              {missingRoles.length > 0 && (
                <button
                  type="button"
                  className="live-hole"
                  aria-haspopup="dialog"
                  onClick={(event) => onHolePick(kind, resource, s.id, event)}
                >
                  <span>FURO</span>＋ Preencher{" "}
                  {kind === "vehicle"
                    ? missingRoles[0] === "driver" ? "motorista" : "patrulheiro"
                    : "GM"}
                </button>
              )}
              {missingRoles.length === 0 && (
                <>
                <button
                  type="button"
                  className="cell-add-member"
                  onClick={toggleQuickAdd}
                >
                  ＋ GM
                </button>
                {quickPicker(true)}
                </>
              )}
            </td>
          );
        })}
      </tr>
      )}
    </Fragment>
  );
}

function sameNumberList(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// The parent owns the callbacks and they are intentionally recreated when a
// schedule mutation changes. Comparing the data inputs here prevents a click
// toast, save indicator or other shell state from repainting every row.
const MemoizedRow = memo(Row, (previous, next) =>
  previous.date === next.date &&
  previous.kind === next.kind &&
  previous.resource === next.resource &&
  previous.section === next.section &&
  previous.sourceSection === next.sourceSection &&
  previous.operationalSession === next.operationalSession &&
  previous.sectionKey === next.sectionKey &&
  previous.sectionResourceCount === next.sectionResourceCount &&
  previous.draggingAssignmentId === next.draggingAssignmentId &&
  previous.first === next.first &&
  previous.groupFirst === next.groupFirst &&
  previous.teamFirst === next.teamFirst &&
  previous.operationalGroup === next.operationalGroup &&
  previous.operationalTeam === next.operationalTeam &&
  previous.operationalGroupColor === next.operationalGroupColor &&
  previous.collapsed === next.collapsed &&
  previous.shifts === next.shifts &&
  previous.assignmentIndex === next.assignmentIndex &&
  previous.resourceAssignments === next.resourceAssignments &&
  previous.allScheduleAssignments === next.allScheduleAssignments &&
  previous.assignmentById === next.assignmentById &&
  previous.guards === next.guards &&
  previous.guardOperationalMeta === next.guardOperationalMeta &&
  previous.guardOperationalMetaByShift === next.guardOperationalMetaByShift &&
  previous.serviceAdjustments === next.serviceAdjustments &&
  previous.movements === next.movements &&
  previous.availableForRedeployment === next.availableForRedeployment &&
  previous.redeploymentGroups === next.redeploymentGroups &&
  previous.selectedId === next.selectedId &&
  sameNumberList(previous.recentAssignmentIds, next.recentAssignmentIds) &&
  previous.copiedAssignment === next.copiedAssignment,
);
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
    [regularEndsAt] = useState(String(a?.regular_ends_at || "")),
    [assignmentStatus, setAssignmentStatus] = useState(String(pick.extension && a?.status === "overtime" ? "normal" : a?.status || "normal")),
    [extensionMode, setExtensionMode] = useState(Boolean(pick.extension)),
    [extensionStartsAt, setExtensionStartsAt] = useState(String(a?.regular_ends_at || `${data.date}T19:00`)),
    [extensionEndsAt, setExtensionEndsAt] = useState(String(a?.regular_ends_at ? a?.ends_at : `${data.date}T23:00`)),
      [extensionDestination, setExtensionDestination] = useState(`${pick.kind}:${pick.resource.id}`),
      [advancedOpen,setAdvancedOpen]=useState(Boolean(pick.extension||(a?.status&&a.status!=="normal")||Number(a?.is_reassigned)===1||a?.request_ref)),
      guard = data.guards.find((g) => String(g.id) === guardId);
  const [smartCandidates, setSmartCandidates] = useState<SmartEditorCandidate[]>([]);
  const tomorrow=new Date(`${data.date}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const tomorrowDate=tomorrow.toISOString().slice(0,10);
  useEffect(() => {
    if (!manualAdd && !fillingHole) {
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      date: data.date,
      shift: pick.shift,
      suggest: "1",
    });
    if (pick.kind === "post") params.set("postId", String(pick.resource.id));
    if (pick.kind === "vehicle") params.set("vehicleId", String(pick.resource.id));
    fetch(`/api/schedule?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value: {
        sameDayCandidates?: Array<{ guardId: number; name: string; origins?: string[]; assignmentIds?: number[]; availableForRedeployment?: boolean }>;
        suggestions?: Array<{ id: number; name: string; currentHeHours?: number; oppositeTeam?: boolean }>;
      }) => {
        const candidates: SmartEditorCandidate[] = [];
        for (const candidate of value.sameDayCandidates || []) {
          if (!candidate.availableForRedeployment) continue;
          candidates.push({
            guardId: Number(candidate.guardId),
            source: "redeploy",
            detail: `À disposição · ${(candidate.origins || []).join(" + ") || "aguardando destino"}`,
            assignmentIds: candidate.assignmentIds || [],
          });
        }
        for (const candidate of value.suggestions || []) {
          if (!candidate.oppositeTeam || candidates.some((item) => item.guardId === Number(candidate.id))) continue;
          candidates.push({
            guardId: Number(candidate.id),
            source: "overtime",
            detail: `HE · ${Number(candidate.currentHeHours || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h no mês · equipe oposta`,
          });
        }
        setSmartCandidates(candidates);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setSmartCandidates([]);
      });
    return () => controller.abort();
  }, [data.date, fillingHole, manualAdd, pick.kind, pick.resource.id, pick.shift]);
  const eligibleGuards = useMemo(() => {
    const q = guardQuery.toLowerCase().trim();
    const smartIds = new Set(smartCandidates.map((candidate) => candidate.guardId));
    const groupGuardIds = pick.groupId
      ? new Set((data.operationalGroupMembers || []).filter((member) => Number(member.group_id) === pick.groupId && String(member.resource_kind) === "guard").map((member) => Number(member.resource_id)))
      : null;
    return data.guards.filter((g) => {
      if ((manualAdd || fillingHole) && !smartIds.has(Number(g.id))) return false;
      if (groupGuardIds && !groupGuardIds.has(Number(g.id))) return false;
      if (!q) return true;
      return `${g.name || ""} ${g.registration || ""} ${g.platoon || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [data.guards, data.operationalGroupMembers, fillingHole, guardQuery, manualAdd, pick.groupId, smartCandidates]);
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
          <span>{pick.groupId ? "Escolha um integrante do mesmo grupamento em dia/equipe oposta para HE." : "Escolha somente um GM à disposição ou da equipe oposta para HE."}</span>
        </div>
      )}
      <input type="hidden" name="saveMode" value={extensionMode ? "split" : "single"}/>
      <input type="hidden" name="smartSource" value={smartCandidates.find((candidate) => candidate.guardId === Number(guardId))?.source || ""}/>
      <input type="hidden" name="smartAssignmentIds" value={smartCandidates.find((candidate) => candidate.guardId === Number(guardId))?.assignmentIds?.join(",") || ""}/>
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
                  {g.name} · {g.registration} · {smartCandidates.find((candidate) => candidate.guardId === Number(g.id))?.detail || g.platoon}
                </option>
              ))}
            </select>
          </label>
          {(manualAdd || fillingHole) && !eligibleGuards.length && (
            <p className="full-period-note">{pick.groupId ? "Nenhum integrante do mesmo grupamento em dia/equipe oposta está elegível para HE neste período." : "Nenhum GM à disposição ou da equipe oposta está elegível para este período."}</p>
          )}
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
      {!fillingHole&&<label>Horário pronto<select defaultValue="custom" onChange={event=>{const value=event.target.value;if(value==="day"){setShiftId("2");setStartsAt(`${data.date}T07:00`);setEndsAt(`${data.date}T19:00`)}if(value==="night"){setShiftId("4");setStartsAt(`${data.date}T19:00`);setEndsAt(`${tomorrowDate}T07:00`)}if(value==="weekly"){setShiftId("W");setStartsAt(`${data.date}T08:00`);setEndsAt(`${data.date}T17:00`)}}}><option value="custom">Manter / personalizado</option><option value="day">Diurno completo · 07h–19h</option><option value="night">Noturno completo · 19h–07h</option><option value="weekly">Semanal · 08h–17h</option></select></label>}
      <button type="button" className="advanced-toggle" aria-expanded={advancedOpen} onClick={()=>setAdvancedOpen(value=>!value)}>{advancedOpen?"Ocultar opções avançadas":"Mais opções · função, HE, BH e troca"}</button>
      {advancedOpen&&<div className="advanced-editor-fields">
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
      </div>}
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
      {!fillingHole&&!extensionMode&&<input name="regularEndsAt" type="hidden" value={assignmentStatus==="overtime"?regularEndsAt:""}/>}
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
function overtimeHoursLabel(a:Rec){const hours=Math.max(0,(Date.parse(String(a.ends_at))-Date.parse(String(a.starts_at)))/3600000);return `${String(Math.round(hours)).padStart(2,"0")} HE`}
function extensionShortcutAvailable(assignment:Rec,shift:string,date:string,assignments:Rec[]){
  if(!isDayShift(shift))return false;
  if(String(assignment.work_kind)==="overtime_extension")return false;
  if(String(assignment.status)==="overtime"&&assignment.regular_ends_at&&String(assignment.ends_at)>String(assignment.regular_ends_at))return false;
  const related=assignments.filter(item=>Number(item.guard_id)===Number(assignment.guard_id)&&String(item.work_kind)!=="overtime_extension"&&coveredOperationalShifts(item,date).some(id=>isDayShift(id)));
  const latest=related.reduce((value,item)=>{const end=String(item.regular_ends_at||item.ends_at);return end>value?end:value},String(assignment.regular_ends_at||assignment.ends_at));
  const window=operationalShiftWindow(date,shift);
  return window.start<latest&&window.end>=latest;
}
function earlyExtensionShortcutAvailable(assignment:Rec,shift:string,date:string){
  if(shift!=="4"||String(assignment.work_kind)==="overtime_extension")return false;
  return assignmentOverlapsShift(assignment,date,"4");
}
function fixedWeeklyOvertimeLabel(a:Rec){
  if(String(a.work_kind)!=="weekly"||!a.regular_ends_at)return "";
  const hours=Math.max(0,(Date.parse(String(a.ends_at))-Date.parse(String(a.regular_ends_at)))/3600000);
  if(!hours)return "";
  return `${Number(hours.toFixed(1))}HE`;
}
function assignmentDisplayInShift(a:Rec,date:string,shift:string){
  if(String(a.work_kind)==="weekly"&&(shift==="2"||shift==="3"))return weeklyDisplay(a);
  const window=operationalShiftWindow(date,shift),start=String(a.starts_at),end=String(a.ends_at);
  const segmentStart=start>window.start?start:window.start,segmentEnd=end<window.end?end:window.end;
  const range=`${segmentStart.slice(11,16)}–${segmentEnd.slice(11,16)}`;
  return statusInShift(a,date,shift)==="overtime"&&a.regular_ends_at?`Extensão HE ${range}`:range;
}
