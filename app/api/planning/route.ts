import { env } from "cloudflare:workers";
import { permitted } from "../../../lib/access";
import { ensurePatterns } from "../../../lib/pattern-engine";
import { ensureOperationalGroups } from "../../../lib/operational-groups-db";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type PeriodKey = "day" | "night";
type ResourceKind = "post" | "vehicle";
type PlanningScenario = {
  kind: "guard" | "vehicle";
  startDate: string;
  endDate: string | null;
  guardId?: number;
  vehicleId?: number;
  category?: string;
  reason?: string;
};

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const shiftWindows: Record<string, [string, string, PeriodKey]> = {
  "2": ["07:00", "13:00", "day"],
  "3": ["13:00", "19:00", "day"],
  "4": ["19:00", "01:00", "night"],
  "1": ["01:00", "07:00", "night"],
  W: ["08:00", "17:00", "day"],
};

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return {
    days: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startAt: `${start.toISOString().slice(0, 10)}T00:00:00`,
    endAt: `${end.toISOString().slice(0, 10)}T00:00:00`,
  };
}

function dateValue(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function overlap(startA: string, endA: string, startB: string, endB: string) {
  return Date.parse(startA) < Date.parse(endB) && Date.parse(endA) > Date.parse(startB);
}

function interval(date: string, shift: string, startsAt?: string, endsAt?: string) {
  if (startsAt && endsAt) {
    const start = `${date}T${startsAt}`;
    const endsNextDay = endsAt <= startsAt;
    return { start, end: `${endsNextDay ? addDays(date, 1) : date}T${endsAt}` };
  }
  const window = shiftWindows[shift] || shiftWindows.W;
  return { start: `${date}T${window[0]}`, end: `${window[2] === "night" && window[1] < window[0] ? addDays(date, 1) : date}T${window[1]}` };
}

function absenceLabel(type: string) {
  return ({
    day_off: "Folga",
    vacation: "Férias",
    course: "Curso",
    medical_leave: "Atestado/licença",
    technical_reserve: "Reserva técnica",
    time_bank: "Banco de horas",
    negative_full: "BH- integral",
    negative_late: "BH- entrada tardia",
    negative_early: "BH- saída antecipada",
  } as Record<string, string>)[type] || type;
}

function statusFor(holes: number, away: number, hasOutage: boolean) {
  if (holes > 0) return "critical";
  if (away > 0 || hasOutage) return "attention";
  return "ok";
}

function emptyCounts() {
  return {
    folga: 0,
    vacation: 0,
    course: 0,
    medical_leave: 0,
    technical_reserve: 0,
    time_bank: 0,
    negative_full: 0,
    negative_late: 0,
    negative_early: 0,
    other: 0,
  };
}

function resourceKey(kind: string, id: unknown) {
  return `${kind}:${Number(id)}`;
}

function parseScenario(request: Request, bounds: ReturnType<typeof monthBounds>) {
  const raw = new URL(request.url).searchParams.get("scenario");
  if (!raw) return [] as PlanningScenario[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [] as PlanningScenario[];
    const allowedCategories = new Set(["folga", "vacation", "course", "medical_leave", "negative_full", "negative_late", "negative_early"]);
    return parsed.slice(0, 40).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const kind = value.kind === "vehicle" ? "vehicle" : value.kind === "guard" ? "guard" : null;
      const startDate = String(value.startDate || "");
      const endDate = value.endDate ? String(value.endDate) : null;
      if (!kind || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < bounds.start || startDate >= bounds.end || (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate || endDate >= bounds.end))) return [];
      const scenario: PlanningScenario = { kind, startDate, endDate, reason: String(value.reason || "Simulação").slice(0, 100) };
      if (kind === "guard") {
        const guardId = Number(value.guardId);
        if (!Number.isInteger(guardId) || guardId <= 0) return [];
        scenario.guardId = guardId;
        scenario.category = allowedCategories.has(String(value.category)) ? String(value.category) : "medical_leave";
      } else {
        const vehicleId = Number(value.vehicleId);
        if (!Number.isInteger(vehicleId) || vehicleId <= 0) return [];
        scenario.vehicleId = vehicleId;
      }
      return [scenario];
    });
  } catch {
    return [] as PlanningScenario[];
  }
}

export async function GET(request: Request) {
  if (!permitted(request)) return Response.json({ error: "Não autorizado" }, { status: 401 });
  const requestUrl = new URL(request.url);
  const requested = requestUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  if (!monthPattern.test(requested)) return Response.json({ error: "Mês inválido." }, { status: 400 });
  const bounds = monthBounds(requested);
  const requestedDetail = requestUrl.searchParams.get("detail");
  const detailDate = requestedDetail === "all"
    ? "all"
    : requestedDetail && /^\d{4}-\d{2}-\d{2}$/.test(requestedDetail) && requestedDetail >= bounds.start && requestedDetail < bounds.end
      ? requestedDetail
      : null;
  const scenario = parseScenario(request, bounds);
  await ensurePatterns(env.DB);
  await ensureOperationalGroups(env.DB);

  const [patterns, patternSlots, weeklySlots, guards, catalogVehicles, movements, leaves, schedules, assignments, outages, adjustments, groups, groupMembers, patternGroupMembers] = await Promise.all([
    env.DB.prepare("SELECT id,code,name,period,parity,anchor_date FROM shift_patterns WHERE active=1 ORDER BY period,parity").all<Row>(),
    env.DB.prepare(`SELECT s.id,s.pattern_id,s.guard_id,s.post_id,s.vehicle_id,s.shift,s.role,p.code pattern_code,p.period pattern_period,g.name guard_name,g.registration,po.name post_name,po.group_name post_group_name,v.prefix vehicle_prefix,v.zone vehicle_zone
      FROM pattern_slots s JOIN shift_patterns p ON p.id=s.pattern_id JOIN guards g ON g.id=s.guard_id
      LEFT JOIN posts po ON po.id=s.post_id LEFT JOIN vehicles v ON v.id=s.vehicle_id
      WHERE p.active=1 AND g.active=1`).all<Row>(),
    env.DB.prepare(`SELECT w.id,w.guard_id,w.post_id,w.vehicle_id,w.role,w.weekdays,w.starts_at,w.regular_end,w.overtime_end,g.name guard_name,g.registration,po.name post_name,po.group_name post_group_name,v.prefix vehicle_prefix,v.zone vehicle_zone
      FROM weekly_slots w JOIN guards g ON g.id=w.guard_id AND g.active=1
      LEFT JOIN posts po ON po.id=w.post_id LEFT JOIN vehicles v ON v.id=w.vehicle_id WHERE w.active=1`).all<Row>(),
    env.DB.prepare("SELECT id,name,registration,platoon,base_shift,work_regime,overtime_eligible FROM guards WHERE active=1 ORDER BY name").all<Row>(),
    env.DB.prepare("SELECT id,prefix,zone,type FROM vehicles WHERE active=1 ORDER BY prefix").all<Row>(),
    env.DB.prepare("SELECT m.*,g.name guard_name FROM movements m JOIN guards g ON g.id=m.guard_id WHERE m.status='approved' AND m.starts_at<? AND m.ends_at>? ").bind(bounds.endAt, bounds.startAt).all<Row>(),
    env.DB.prepare(`SELECT c.guard_id,c.date,c.category,c.status,g.name guard_name FROM leave_choices c JOIN guards g ON g.id=c.guard_id WHERE c.status='confirmed' AND c.date>=? AND c.date<?`).bind(bounds.start,bounds.end).all<Row>(),
    env.DB.prepare("SELECT id,date,status FROM schedules WHERE date>=? AND date<?").bind(bounds.start,bounds.end).all<Row>(),
    env.DB.prepare(`SELECT a.*,s.date schedule_date,g.name guard_name,g.registration,p.name post_name,p.group_name post_group_name,v.prefix vehicle_prefix,v.zone vehicle_zone
      FROM assignments a JOIN schedules s ON s.id=a.schedule_id JOIN guards g ON g.id=a.guard_id
      LEFT JOIN posts p ON p.id=a.post_id LEFT JOIN vehicles v ON v.id=a.vehicle_id
      WHERE s.date>=? AND s.date<?`).bind(bounds.start,bounds.end).all<Row>(),
    env.DB.prepare("SELECT o.*,v.prefix,v.type,v.zone FROM vehicle_outages o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.active=1 AND o.starts_on<? AND (o.ends_on IS NULL OR o.ends_on>=?)").bind(bounds.end,bounds.start).all<Row>(),
    env.DB.prepare("SELECT * FROM service_adjustments WHERE status='active' AND ((service_date>=? AND service_date<?) OR (counterpart_service_date>=? AND counterpart_service_date<?))").bind(bounds.start,bounds.end,bounds.start,bounds.end).all<Row>(),
    env.DB.prepare("SELECT id,name,short_name,color,sort_order FROM operational_groups WHERE active=1 ORDER BY sort_order,name").all<Row>(),
    env.DB.prepare("SELECT group_id,resource_kind,resource_id,team_label FROM operational_group_members").all<Row>(),
    env.DB.prepare("SELECT pattern_id,group_id,resource_kind,resource_id,team_label FROM pattern_operational_group_members").all<Row>(),
  ]);

  const guardById = new Map(guards.results.map((guard) => [Number(guard.id), guard]));
  const scenarioGuardById = new Map<number, PlanningScenario[]>();
  const scenarioVehicleById = new Map<number, PlanningScenario[]>();
  for (const event of scenario) {
    const id = event.kind === "guard" ? event.guardId : event.vehicleId;
    if (!id) continue;
    const target = event.kind === "guard" ? scenarioGuardById : scenarioVehicleById;
    target.set(id, [...(target.get(id) || []), event]);
  }
  // Ignore stale IDs in a copied URL so a simulation can never make an
  // unknown person or vehicle appear as a real resource.
  const activeGuardIds = new Set(guards.results.map((guard) => Number(guard.id)));
  const activeVehicleIds = new Set(catalogVehicles.results.map((vehicle) => Number(vehicle.id)));
  for (const id of [...scenarioGuardById.keys()]) if (!activeGuardIds.has(id)) scenarioGuardById.delete(id);
  for (const id of [...scenarioVehicleById.keys()]) if (!activeVehicleIds.has(id)) scenarioVehicleById.delete(id);
  const effectiveScenario = scenario.filter((event) => event.kind === "guard" ? activeGuardIds.has(Number(event.guardId)) : activeVehicleIds.has(Number(event.vehicleId)));
  const scenarioActive = effectiveScenario.length > 0;
  const patternByCode = new Map(patterns.results.map((pattern) => [String(pattern.code), pattern]));
  const slotsByCode = new Map<string, Row[]>();
  for (const slot of patternSlots.results) slotsByCode.set(String(slot.pattern_code), [...(slotsByCode.get(String(slot.pattern_code)) || []), slot]);
  const weeklyByWeekday = new Map<number, Row[]>();
  for (const slot of weeklySlots.results) {
    for (const weekday of String(slot.weekdays || "").split(",").map(Number).filter(Number.isInteger)) weeklyByWeekday.set(weekday, [...(weeklyByWeekday.get(weekday) || []), slot]);
  }
  const movementByGuard = new Map<number, Row[]>();
  for (const movement of movements.results) movementByGuard.set(Number(movement.guard_id), [...(movementByGuard.get(Number(movement.guard_id)) || []), movement]);
  const leaveByGuardDate = new Map<string, Row[]>();
  for (const leave of leaves.results) leaveByGuardDate.set(`${Number(leave.guard_id)}:${String(leave.date)}`, [...(leaveByGuardDate.get(`${Number(leave.guard_id)}:${String(leave.date)}`) || []), { ...leave, type: "day_off" }]);
  const adjustmentByGuard = new Map<number, Row[]>();
  for (const adjustment of adjustments.results) {
    const subtype = String(adjustment.subtype || "");
    if (!["negative_full", "negative_late", "negative_early"].includes(subtype)) continue;
    adjustmentByGuard.set(Number(adjustment.guard_id), [...(adjustmentByGuard.get(Number(adjustment.guard_id)) || []), { ...adjustment, type: subtype }]);
  }
  const scheduleDates = new Set(schedules.results.map((schedule) => String(schedule.date)));
  const assignmentsByDate = new Map<string, Row[]>();
  for (const assignment of assignments.results) assignmentsByDate.set(String(assignment.schedule_date), [...(assignmentsByDate.get(String(assignment.schedule_date)) || []), assignment]);
  const outagesByVehicle = new Map<number, Row[]>();
  for (const outage of outages.results) outagesByVehicle.set(Number(outage.vehicle_id), [...(outagesByVehicle.get(Number(outage.vehicle_id)) || []), outage]);
  const groupById = new Map(groups.results.map((group) => [Number(group.id), group]));
  const globalLinks = new Map<string, Row[]>();
  const patternLinks = new Map<string, Row[]>();
  for (const link of groupMembers.results) globalLinks.set(resourceKey(String(link.resource_kind), link.resource_id), [...(globalLinks.get(resourceKey(String(link.resource_kind), link.resource_id)) || []), link]);
  for (const link of patternGroupMembers.results) patternLinks.set(`${Number(link.pattern_id)}:${resourceKey(String(link.resource_kind), link.resource_id)}`, [...(patternLinks.get(`${Number(link.pattern_id)}:${resourceKey(String(link.resource_kind), link.resource_id)}`) || []), link]);
  const anchor = String(patternByCode.get("D1")?.anchor_date || "2026-08-12");

  function patternCode(date: string, period: PeriodKey) {
    const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / 86400000);
    const parity = ((diff % 2) + 2) % 2;
    return period === "day" ? (parity === 0 ? "D1" : "D2") : (parity === 0 ? "N1" : "N2");
  }
  function outageFor(vehicleId: number, date: string) {
    const simulated = (scenarioVehicleById.get(vehicleId) || []).find((event) => event.startDate <= date && (!event.endDate || event.endDate >= date));
    if (simulated) return { reason: `Simulação · ${simulated.reason || "FA"}`, starts_on: simulated.startDate, ends_on: simulated.endDate, simulated: true };
    return (outagesByVehicle.get(vehicleId) || []).find((outage) => String(outage.starts_on) <= date && (!outage.ends_on || String(outage.ends_on) >= date));
  }
  function absenceFor(guardId: number, date: string, start: string, end: string) {
    const records: Row[] = [...(leaveByGuardDate.get(`${guardId}:${date}`) || [])];
    for (const movement of movementByGuard.get(guardId) || []) if (overlap(String(movement.starts_at), String(movement.ends_at), start, end)) records.push(movement);
    for (const adjustment of adjustmentByGuard.get(guardId) || []) if (String(adjustment.service_date) === date && overlap(String(adjustment.starts_at), String(adjustment.ends_at), start, end)) records.push(adjustment);
    for (const event of scenarioGuardById.get(guardId) || []) {
      const eventEnd = event.endDate ? `${addDays(event.endDate, 1)}T00:00:00` : bounds.endAt;
      if (event.startDate <= date && overlap(`${event.startDate}T00:00:00`, eventEnd, start, end)) records.push({ type: event.category || "medical_leave", guard_name: String(guardById.get(guardId)?.name || "GM"), simulated: true, reason: event.reason || "Simulação" });
    }
    return [...new Map(records.map((record) => [String(record.type), record])).values()];
  }
  function basePositions(date: string, period: PeriodKey) {
    const code = patternCode(date, period);
    const pattern = patternByCode.get(code);
    const positions: Array<Row & { period: PeriodKey; shift: string; start: string; end: string; resource_kind: ResourceKind | null; resource_id: number | null; resource_label: string; section: string; pattern_id: number | null }> = [];
    for (const slot of slotsByCode.get(code) || []) {
      const shifts = slot.shift && (period === "day" ? ["2", "3"] : ["4", "1"]).includes(String(slot.shift)) ? [String(slot.shift)] : period === "day" ? ["2", "3"] : ["4", "1"];
      for (const shift of shifts) {
        const window = interval(date, shift);
        const kind = slot.vehicle_id ? "vehicle" : slot.post_id ? "post" : null;
        const id = kind === "vehicle" ? Number(slot.vehicle_id) : kind === "post" ? Number(slot.post_id) : null;
        positions.push({ ...slot, period, shift, start: window.start, end: window.end, resource_kind: kind, resource_id: id, resource_label: kind === "vehicle" ? String(slot.vehicle_prefix || "VTR sem nome") : String(slot.post_name || "Posto sem nome"), section: kind === "vehicle" ? "VIATURAS E ZONAS" : String(slot.post_group_name || "POSTOS"), pattern_id: Number(pattern?.id || slot.pattern_id || 0) });
      }
    }
    if (period === "day") {
      for (const slot of weeklyByWeekday.get(dayOfWeek(date)) || []) {
        const window = interval(date, "W", String(slot.starts_at || "08:00"), String(slot.overtime_end || slot.regular_end || "17:00"));
        const kind = slot.vehicle_id ? "vehicle" : slot.post_id ? "post" : null;
        const id = kind === "vehicle" ? Number(slot.vehicle_id) : kind === "post" ? Number(slot.post_id) : null;
        positions.push({ ...slot, period, shift: "W", start: window.start, end: window.end, resource_kind: kind, resource_id: id, resource_label: kind === "vehicle" ? String(slot.vehicle_prefix || "VTR sem nome") : String(slot.post_name || "Posto sem nome"), section: kind === "vehicle" ? "VIATURAS E ZONAS" : String(slot.post_group_name || "POSTOS"), pattern_id: null, source: "weekly" });
      }
    }
    return positions;
  }

  function actualPositions(date: string, period: PeriodKey) {
    const shifts = period === "day" ? new Set(["2", "3", "W"]) : new Set(["4", "1"]);
    return (assignmentsByDate.get(date) || [])
      .filter((assignment) => shifts.has(String(assignment.shift)) && String(assignment.work_kind || "shift") !== "overtime_extension")
      .map((assignment) => {
        const kind: ResourceKind | null = assignment.vehicle_id ? "vehicle" : assignment.post_id ? "post" : null;
        const id = kind === "vehicle" ? Number(assignment.vehicle_id) : kind === "post" ? Number(assignment.post_id) : null;
        const fallback = interval(date, String(assignment.shift || ""));
        return {
          ...assignment,
          period,
          shift: String(assignment.shift || ""),
          start: String(assignment.starts_at || fallback.start),
          end: String(assignment.ends_at || fallback.end),
          resource_kind: kind,
          resource_id: id,
          resource_label: kind === "vehicle" ? String(assignment.vehicle_prefix || "VTR sem nome") : String(assignment.post_name || "Posto sem nome"),
          section: kind === "vehicle" ? "VIATURAS E ZONAS" : kind === "post" ? String(assignment.post_group_name || "POSTOS") : "DISPONÍVEIS",
          pattern_id: null,
          __actual: true,
          __required: false,
        } as Row;
      });
  }

  function slotKey(position: Row) {
    if (!position.resource_kind || !position.resource_id) return null;
    return `${String(position.resource_kind)}:${Number(position.resource_id)}:${String(position.shift)}:${String(position.role || "guard")}`;
  }

  function effectivePositions(date: string, period: PeriodKey) {
    const baseline = basePositions(date, period);
    const actual = actualPositions(date, period);
    // Dias without a saved scale remain a pure projection from the patterns.
    if (!actual.length) return baseline.map((position) => ({ ...position, __actual: true, __required: true } as Row));

    const actualBySlot = new Map<string, Row[]>();
    for (const position of actual) {
      const key = slotKey(position);
      if (!key) continue;
      actualBySlot.set(key, [...(actualBySlot.get(key) || []), position]);
    }
    const consumed = new Set<number>();
    const result: Row[] = [];
    for (const position of baseline) {
      const key = slotKey(position);
      const candidate = key ? (actualBySlot.get(key) || []).find((item) => !consumed.has(Number(item.id))) : undefined;
      if (candidate) consumed.add(Number(candidate.id));
      // Keep the pattern metadata for group links and the expected lane, while
      // taking the edited GM, time and status from the saved daily assignment.
      result.push(candidate
        ? { ...position, ...candidate, pattern_id: position.pattern_id, section: position.section, resource_kind: position.resource_kind, resource_id: position.resource_id, resource_label: position.resource_label, __actual: true, __required: true, __baselineGuardId: position.guard_id }
        : { ...position, __actual: false, __required: true, __baselineGuardId: position.guard_id });
    }
    for (const position of actual) if (!consumed.has(Number(position.id))) result.push(position);
    return result;
  }

  const days: Row[] = [];
  let totalExpected = 0, totalAvailable = 0, totalAway = 0, totalHoles = 0, criticalDays = 0, attentionDays = 0;
  const absenceTotals = emptyCounts();
  const [year, monthNumber] = requested.split("-").map(Number);
  for (let dayNumber = 1; dayNumber <= bounds.days; dayNumber++) {
    const date = dateValue(year, monthNumber, dayNumber);
    const fleetByType = new Map<string, { type: string; availablePrefixes: string[]; outagePrefixes: string[] }>();
    for (const vehicle of catalogVehicles.results) {
      const type = String(vehicle.type || "other").toLowerCase();
      const current = fleetByType.get(type) || { type, availablePrefixes: [], outagePrefixes: [] };
      const prefix = String(vehicle.prefix || "VTR sem prefixo");
      if (outageFor(vehicle.id, date)) current.outagePrefixes.push(prefix);
      else current.availablePrefixes.push(prefix);
      fleetByType.set(type, current);
    }
    const dayPeriods: Record<PeriodKey, Row> = {} as Record<PeriodKey, Row>;
    for (const period of ["day", "night"] as PeriodKey[]) {
      const positions = effectivePositions(date, period);
      const resourceMap = new Map<string, Row>();
      const expectedGuardIds = new Set<number>(), availableGuardIds = new Set<number>(), awayGuardIds = new Set<number>();
      const countedAbsences = new Set<string>();
      const counts = emptyCounts();
      const groupMap = new Map<number, Row>();
      for (const position of positions) {
        const guardId = Number(position.guard_id || position.__baselineGuardId || 0);
        const absences = absenceFor(guardId, date, position.start, position.end);
        const isAway = absences.length > 0;
        const isActual = position.__actual !== false;
        if (guardId) expectedGuardIds.add(guardId);
        if (isAway) awayGuardIds.add(guardId);
        else if (isActual && guardId) availableGuardIds.add(guardId);
        for (const absence of absences) {
          const rawType = String(absence.type || "other");
          const type = (rawType === "day_off" ? "folga" : rawType === "other_leave" ? "other" : rawType) as keyof ReturnType<typeof emptyCounts>;
          const absenceKey = `${type}:${guardId}`;
          if (countedAbsences.has(absenceKey)) continue;
          countedAbsences.add(absenceKey);
          counts[type] = Number(counts[type] || 0) + 1;
          if (type in absenceTotals) absenceTotals[type] += 1;
        }
        if (position.resource_kind && position.resource_id) {
          const key = resourceKey(position.resource_kind, position.resource_id);
          const outage = position.resource_kind === "vehicle" ? outageFor(position.resource_id, date) : null;
          const current = resourceMap.get(key) || { key, kind: position.resource_kind, id: position.resource_id, label: position.resource_label, section: position.section, planned: 0, required: 0, available: 0, holes: 0, away: [], roles: {}, status: "ok", outage: null };
          const isRequired = position.__required !== false;
          current.planned += isRequired ? 1 : 0;
          if (isRequired && !outage) current.required += 1;
          if (isActual && guardId && !isAway && !outage) current.available += 1;
          if (isAway && !outage) current.away = [...current.away, { name: String(position.guard_name || guardById.get(guardId)?.name || "GM"), reason: absences.map((item) => absenceLabel(String(item.type))).join(" / ") }];
          const role = position.vehicle_id ? String(position.role || "guard") : "guard";
          current.roles[role] = Number(current.roles[role] || 0) + 1;
          current.outage = outage ? { reason: String(outage.reason || "FA"), startsOn: String(outage.starts_on), endsOn: outage.ends_on ? String(outage.ends_on) : null } : current.outage;
          current.holes = Math.max(0, Number(current.required) - Number(current.available));
          current.status = outage ? "fa" : statusFor(Number(current.holes), current.away.length, false);
          resourceMap.set(key, current);
          const links = [...(globalLinks.get(key) || []), ...(position.pattern_id ? patternLinks.get(`${position.pattern_id}:${key}`) || [] : [])];
          if (position.guard_id) links.push(...(globalLinks.get(resourceKey("guard", position.guard_id)) || []), ...(position.pattern_id ? patternLinks.get(`${position.pattern_id}:${resourceKey("guard", position.guard_id)}`) || [] : []));
          for (const link of links) {
            const groupId = Number(link.group_id), group = groupById.get(groupId);
            if (!group) continue;
            const groupCurrent = groupMap.get(groupId) || { key: `group:${groupId}`, kind: "group", id: groupId, label: String(group.name), section: "GRUPAMENTOS E EQUIPES", planned: 0, required: 0, available: 0, holes: 0, away: [], teams: {}, status: "ok", _seen: new Set<string>() };
            const seenKey = `${position.id}:${position.shift}`;
            if (!groupCurrent._seen.has(seenKey)) {
              const isRequired = position.__required !== false;
              groupCurrent._seen.add(seenKey); groupCurrent.planned += isRequired ? 1 : 0; groupCurrent.required += isRequired ? 1 : 0;
              if (isActual && guardId && !isAway) groupCurrent.available += 1; else if (isAway) groupCurrent.away = [...groupCurrent.away, { name: String(position.guard_name || guardById.get(guardId)?.name || "GM"), reason: absences.map((item) => absenceLabel(String(item.type))).join(" / ") }];
              const team = String(link.team_label || "Geral"); groupCurrent.teams[team] = Number(groupCurrent.teams[team] || 0) + 1;
            }
            groupCurrent.holes = Math.max(0, Number(groupCurrent.required) - Number(groupCurrent.available));
            groupCurrent.status = statusFor(Number(groupCurrent.holes), groupCurrent.away.length, false);
            groupMap.set(groupId, groupCurrent);
          }
        }
      }
      const resources = [...resourceMap.values(), ...[...groupMap.values()].map((item) => { const safe = { ...item }; Reflect.deleteProperty(safe, "_seen"); return safe; })];
      const requiredPositions = resources.filter((item) => item.kind !== "group").reduce((sum, item) => sum + Number(item.required || 0), 0);
      const availablePositions = resources.filter((item) => item.kind !== "group").reduce((sum, item) => sum + Number(item.available || 0), 0);
      const holes = resources.filter((item) => item.kind !== "group").reduce((sum, item) => sum + Number(item.holes || 0), 0);
      const status = statusFor(holes, awayGuardIds.size, resources.some((item) => item.status === "fa"));
      const sectionMap = new Map<string, Row>();
      for (const item of resources) {
        const section = String(item.section);
        const current = sectionMap.get(section) || { key: section, label: section, required: 0, available: 0, holes: 0, resources: [], status: "ok" };
        current.required += Number(item.required || 0); current.available += Number(item.available || 0); current.holes += Number(item.holes || 0); current.resources = [...current.resources, item];
        current.status = current.status === "critical" || item.status === "critical" ? "critical" : current.status === "attention" || ["attention", "fa"].includes(String(item.status)) ? "attention" : "ok";
        sectionMap.set(section, current);
      }
      const byAbsence = Object.fromEntries(Object.entries(counts).filter(([, value]) => Number(value) > 0));
      dayPeriods[period] = { period, code: patternCode(date, period), expected: expectedGuardIds.size, available: availableGuardIds.size, away: awayGuardIds.size, required: requiredPositions, availablePositions, holes, status, absenceCounts: byAbsence, sections: [...sectionMap.values()] };
      totalExpected += expectedGuardIds.size; totalAvailable += availableGuardIds.size; totalAway += awayGuardIds.size; totalHoles += holes;
    }
    const dayStatus = dayPeriods.day.status === "critical" || dayPeriods.night.status === "critical" ? "critical" : dayPeriods.day.status === "attention" || dayPeriods.night.status === "attention" ? "attention" : "ok";
    if (dayStatus === "critical") criticalDays++; else if (dayStatus === "attention") attentionDays++;
    const savedAssignments = (assignmentsByDate.get(date) || []).length > 0;
    const baseSource = savedAssignments ? "escala existente" : scheduleDates.has(date) ? "escala aberta · padrão" : "projeção pelo padrão";
    days.push({
      date,
      weekday: dayOfWeek(date),
      pattern: { day: dayPeriods.day.code, night: dayPeriods.night.code },
      source: scenarioActive ? `simulação · ${baseSource}` : baseSource,
      status: dayStatus,
      day: dayPeriods.day,
      night: dayPeriods.night,
      fleet: [...fleetByType.values()].sort((left, right) => left.type.localeCompare(right.type)),
    });
  }
  const responseDays = detailDate === "all" ? days : days.map((day) => {
    if (detailDate && String(day.date) === detailDate) return day;
    return {
      ...day,
      day: { ...(day.day as Row), sections: [] },
      night: { ...(day.night as Row), sections: [] },
    };
  });
  return Response.json({ month: requested, anchorDate: anchor, detailDate: detailDate === "all" ? null : detailDate, days: responseDays, catalog: { guards: guards.results.map(({ id, name, registration, platoon }) => ({ id, name, registration, platoon })), vehicles: catalogVehicles.results }, simulation: { active: scenarioActive, events: effectiveScenario }, summary: { days: bounds.days, totalExpected, totalAvailable, totalAway, totalHoles, criticalDays, attentionDays, absenceTotals, overtimeNeeded: totalHoles }, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
