import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  formatScheduleDate,
  isScheduleDate,
  resolveScheduleDate,
  todayScheduleDate,
  withScheduleDate,
} from "../lib/schedule-date.ts";
import { orderScheduleResources } from "../lib/schedule-sections.ts";
import { assignmentOverlapsShift, coveredOperationalShifts, formatHoursDuration, fullPeriodWindow, fullPeriodShifts, splitExtensionWindow } from "../lib/shift-rules.ts";
import { rankGuardSuggestions, describeReasons } from "../lib/suggest-gm.ts";
import { groupRedeploymentAssignments, mergeScheduleAssignments } from "../lib/schedule-state.ts";
import { orderAssignmentsInResourceCell, orderedResourceGuardIds } from "../lib/schedule-lanes.ts";
import { suggestionPosition } from "../lib/suggestion-position.ts";
import { compactRequestReference } from "../lib/request-reference.ts";
import { copiedBlockStatus } from "../lib/copy-rules.ts";
import { operationalGroupLabel, operationalGroupOrder, operationalTeamLabel } from "../lib/operational-groups.ts";

test("request references stay compact and visible in the schedule and PDF", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/request-reference.css"), "utf8");
  assert.equal(compactRequestReference("  REQ-123   operação centro  "), "REQ-123 operação centro");
  assert.equal(compactRequestReference("123456789012345678901234567890"), "123456789012345678901234567\u2026");
  assert.match(schedule, /className="request-reference"/);
  assert.match(print, /className="request-reference"/);
  assert.match(styles, /#b21f2d/);
});

test("resolveScheduleDate prefers URL date over storage and today", () => {
  assert.equal(isScheduleDate("2026-08-12"), true);
  assert.equal(isScheduleDate("2026-13-01"), false);
  assert.equal(resolveScheduleDate("2026-08-20"), "2026-08-20");
  assert.equal(resolveScheduleDate("invalid", "2026-08-08"), "2026-08-08");
  assert.match(todayScheduleDate(new Date("2026-08-08T15:00:00")), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayScheduleDate(new Date("2026-08-09T02:36:57Z")), "2026-08-08");
  assert.equal(formatScheduleDate("2026-08-12"), "12/08/2026");
});

test("withScheduleDate preserves path and injects date query", () => {
  assert.equal(withScheduleDate("/padroes", "2026-08-15"), "/padroes?date=2026-08-15");
  assert.equal(
    withScheduleDate("/validacao?foo=1", "2026-08-15"),
    "/validacao?foo=1&date=2026-08-15",
  );
  assert.equal(withScheduleDate("/impressao", "bad"), "/impressao");
});

test("orderScheduleResources uses shared section order for schedule and PDF", () => {
  const ordered = orderScheduleResources(
    [
      { id: 1, prefix: "VTR 1", zone: "Zona A" },
      { id: 2, prefix: "VTR 2", zone: "Zona B" },
    ],
    [
      { id: 10, name: "Sala", group_name: "SEDE DA GM" },
      { id: 11, name: "RodoviÃ¡ria", group_name: "POSTOS DIVERSOS" },
    ],
    [
      { section_key: "POST:POSTOS DIVERSOS", label: "POSTOS DIVERSOS", sort_order: 1 },
      { section_key: "VEHICLES", label: "VIATURAS E ZONAS", sort_order: 2 },
      { section_key: "POST:SEDE DA GM", label: "SEDE DA GM", sort_order: 3 },
    ],
  );

  assert.deepEqual(
    ordered.map((item) => `${item.kind}:${item.r.id}:${item.section}`),
    [
      "post:11:POSTOS DIVERSOS",
      "vehicle:1:VIATURAS E ZONAS",
      "vehicle:2:VIATURAS E ZONAS",
      "post:10:SEDE DA GM",
    ],
  );
});

test("operational groups stay compact and recognizable in the schedule", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.equal(operationalGroupLabel({ name: "Base GESCOM", group_name: "POSTOS DIVERSOS" }), "GESCOM");
  assert.equal(operationalGroupLabel({ name: "Canil Municipal" }), "CANIL");
  assert.equal(operationalTeamLabel({ name: "Motos Alfa" }), "ALFA");
  assert.equal(operationalGroupOrder({ name: "ROMU" }) < operationalGroupOrder({ name: "Outro" }), true);
  assert.match(schedule, /className="operational-group-heading"/);
  assert.match(schedule, /resource-unit-tags/);
  assert.match(density, /\.app\.compact \.schedule tbody tr\.post-row/);
  assert.match(density, /\.operational-group-heading/);
});

test("operational groups are editable and can classify existing resources", () => {
  const admin = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const catalog = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(admin, /operational_group_create/);
  assert.match(admin, /operational_group_update/);
  assert.match(admin, /operational_group_member_set/);
  assert.match(admin, /DELETE FROM operational_group_members/);
  assert.match(catalog, /Grupamentos e equipes/);
  assert.match(catalog, /Vincular recurso/);
  assert.match(readFileSync(resolve("app/live-schedule.tsx"), "utf8"), /Filtrar por grupamento operacional/);
});

test("redeployment visibility rule keeps crew when vehicle leaves active set", () => {
  const blocked = new Set([99]);
  const visibleVehicleIds = new Set([1]);
  const visiblePostIds = new Set([10]);
  const awaitingRedeploy = (a) => {
    if (blocked.has(Number(a.guard_id))) return false;
    const hasVehicle = Boolean(a.vehicle_id);
    const hasPost = Boolean(a.post_id);
    if (!hasVehicle && !hasPost) return true;
    if (hasVehicle && !visibleVehicleIds.has(Number(a.vehicle_id))) return true;
    if (hasPost && !visiblePostIds.has(Number(a.post_id))) return true;
    return false;
  };

  const assignments = [
    { id: 1, guard_id: 1, vehicle_id: 1, post_id: null },
    { id: 2, guard_id: 2, vehicle_id: 9, post_id: null },
    { id: 3, guard_id: 3, vehicle_id: null, post_id: null },
    { id: 4, guard_id: 99, vehicle_id: 9, post_id: null },
    { id: 5, guard_id: 5, vehicle_id: null, post_id: 10 },
  ];

  const active = assignments.filter((a) => !blocked.has(Number(a.guard_id)) && !awaitingRedeploy(a));
  const pool = assignments.filter((a) => awaitingRedeploy(a));

  assert.deepEqual(
    active.map((a) => a.id),
    [1, 5],
  );
  assert.deepEqual(
    pool.map((a) => a.id),
    [2, 3],
  );
});


test("fullPeriodWindow covers 07h-19h for day shifts and 19h-07h for night", () => {
  const day = fullPeriodWindow("2026-08-12", "2");
  assert.equal(day.start, "2026-08-12T07:00");
  assert.equal(day.end, "2026-08-12T19:00");
  const night = fullPeriodWindow("2026-08-12", "4");
  assert.equal(night.start, "2026-08-12T19:00");
  assert.equal(night.end, "2026-08-13T07:00");
  assert.deepEqual(fullPeriodShifts("3"), ["2", "3"]);
  assert.deepEqual(fullPeriodShifts("1"), ["4", "1"]);
});

test("cross-turn assignment appears in every operational column it covers", () => {
  const assignment = { shift: "3", starts_at: "2026-08-12T13:00", ends_at: "2026-08-13T01:00" };
  assert.deepEqual(coveredOperationalShifts(assignment, "2026-08-12"), ["3", "4"]);
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "2"), false);
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "1"), false);
});

test("shortened 3rd-turn assignment is not rendered as a 13h-13h card in the 2nd turn", () => {
  const assignment = { shift: "2", starts_at: "2026-08-12T13:00", ends_at: "2026-08-12T16:00" };
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "2"), false);
  assert.equal(assignmentOverlapsShift(assignment, "2026-08-12", "3"), true);
});

test("weekly overtime extension is also visible in the night period", () => {
  const assignment = { shift: "W", starts_at: "2026-08-12T08:00", ends_at: "2026-08-12T23:00" };
  assert.deepEqual(coveredOperationalShifts(assignment, "2026-08-12"), ["2", "3", "4"]);
});

test("overtime shortcut lives inside the GM card and stays distinct from add actions", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(schedule, /className={`live-person-card/);
  assert.match(schedule, /<span aria-hidden="true">◷<\/span>\+HE/);
  assert.doesNotMatch(schedule, />＋ HE depois<\/button>/);
  assert.match(density, /\.live-person-card \.inline-he-extension/);
  assert.match(density, /border-top:2px solid/);
  assert.match(density, /border-bottom:4px solid/);
});

test("schedule rows are memoized so shell feedback does not repaint the full matrix", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /<MemoizedRow/);
  assert.match(schedule, /const MemoizedRow = memo\(Row/);
  assert.match(schedule, /previous\.assignmentIndex === next\.assignmentIndex/);
  assert.match(schedule, /sameNumberList\(previous\.recentAssignmentIds, next\.recentAssignmentIds\)/);
});

test("the operational toolbar can jump directly to a visible section", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /className="section-jump"/);
  assert.match(schedule, /function jumpToSection\(section: string\)/);
  assert.match(schedule, /wrapper\.scrollBy\(\{ top:/);
  assert.match(schedule, /onSectionRef=\{/);
  assert.match(usability, /\.section-jump select/);
});

test("selected GM cards expose a direct move flow with available resources", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /className="quick-move-trigger"/);
  assert.match(schedule, /moveChoices\.map/);
  assert.match(schedule, /void onMove\(assignment, destination\.kind, destination\.resource, shift, shift\)/);
  assert.match(schedule, /Escolher posto ou viatura/);
  assert.match(usability, /\.inline-move-picker/);
});

test("selected regular GM cards expose an explicit lane-position picker", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /className="quick-position-trigger"/);
  assert.match(schedule, /inline-position-picker/);
  assert.match(schedule, /void onMove\(a,kind,resource,s\.id,s\.id,Number\(target\.id\)\)/);
  assert.match(schedule, /const sameShift = sourceShift \? sourceShift === shift/);
  assert.match(schedule, /Colocar no final/);
  assert.match(usability, /\.inline-position-picker/);
});

test("copying a regular block into another quadrant is automatically classified as HE", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  assert.equal(copiedBlockStatus({ status: "normal", work_kind: "weekly" }), "overtime");
  assert.equal(copiedBlockStatus({ status: "overtime", work_kind: "shift" }), "overtime");
  assert.equal(copiedBlockStatus({ status: "time_bank", work_kind: "time_bank_positive" }), "time_bank");
  assert.match(api, /const targetStatus=copiedBlockStatus\(source\)/);
  assert.match(api, /automaticOvertime/);
  assert.match(schedule, /a cópia será marcada como HE/);
});

test("completed cells expose a quick available-GM picker before the advanced editor", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /className="cell-add-member"/);
  assert.match(schedule, /quickAddCandidates\.map/);
  assert.match(schedule, /onQuickAdd\(Number\(guard\.id\), kind, resource, s\.id\)/);
  assert.match(schedule, /serviceAdjustmentBlockedIds/);
  assert.match(schedule, /movements\.some\(\(movement\) => Number\(movement\.guard_id\)/);
  assert.match(schedule, /quickAddAvailableIds\.has\(Number\(guard\.id\)\)/);
  assert.match(schedule, /previous\.movements === next\.movements/);
  assert.match(schedule, /className="quick-add-advanced"/);
  assert.match(usability, /\.quick-add-picker/);
});

test("holes use the same inline picker and redeploy available GMs without duplicating their pool rows", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const usability = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /quickPicker\(true\)/);
  assert.match(schedule, /className="quick-add-smart"/);
  assert.match(schedule, /action: "redeploy_group"/);
  assert.match(schedule, /poolGroup\.map\(\(assignment\) => Number\(assignment\.id\)\)/);
  assert.match(schedule, /status: hasOtherBlock \? "overtime" : "normal"/);
  assert.match(api, /if \(b\.action === "redeploy_group"\)/);
  assert.match(usability, /\.quick-add-smart/);
});

test("the inline X removes only the selected schedule segment", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/segment-remove.css"), "utf8");
  assert.match(schedule, /className="live-person-remove"/);
  assert.match(schedule, /action: "delete_shift_segment"/);
  assert.match(api, /if \(b\.action === "delete_shift_segment"\)/);
  assert.match(api, /UPDATE assignments SET starts_at=\?,ends_at=\?/);
  assert.match(api, /INSERT INTO assignments \(schedule_id,guard_id,post_id,vehicle_id/);
  assert.match(styles, /\.live-person-card \.live-person-remove/);
  assert.match(styles, /@media print\{\.live-person-card \.live-person-remove\{display:none/);
});

test("formatHoursDuration renders 2h and 2h30 without decimals", () => {
  assert.equal(formatHoursDuration(2), "2h");
  assert.equal(formatHoursDuration(2.5), "2h30");
  assert.equal(formatHoursDuration(0), "0h");
  assert.equal(formatHoursDuration(0.25), "0h15");
  assert.equal(formatHoursDuration(6), "6h");
});

test("splitExtensionWindow keeps regular duty and overtime in independent blocks", () => {
  assert.deepEqual(
    splitExtensionWindow("2026-08-12T13:00", "2026-08-12T19:00", "2026-08-12T19:00", "2026-08-13T01:00"),
    {
      regular: { start: "2026-08-12T13:00", end: "2026-08-12T19:00" },
      extension: { start: "2026-08-12T19:00", end: "2026-08-13T01:00" },
    },
  );
  assert.equal(splitExtensionWindow("2026-08-12T13:00", "2026-08-12T19:00", "2026-08-12T18:00", "2026-08-12T23:00"), null);
});

test("rankGuardSuggestions prioritizes opposite-team GM from same spot", () => {
  const guards = [
    { id: 1, name: "ALMEIDA", registration: "F001", platoon: "D1", base_shift: "12x36 dia", work_regime: "12x36" },
    { id: 2, name: "SANTOS", registration: "F002", platoon: "D2", base_shift: "12x36 dia", work_regime: "12x36" },
    { id: 3, name: "BORGES", registration: "F003", platoon: "N1", base_shift: "12x36 noite", work_regime: "12x36" },
    { id: 4, name: "WEEKLY", registration: "F004", platoon: null, base_shift: "Semanal", work_regime: "weekly" },
  ];
  const ctx = { date: "2026-08-12", shift: "2", postId: null, vehicleId: 1, role: "driver" };
  const assignmentsByGuard = new Map([
    [1, [{ post_id: null, vehicle_id: 1, role: "driver" }]],
    [2, [{ post_id: null, vehicle_id: 1, role: "driver" }]],
    [3, [{ post_id: null, vehicle_id: 2, role: "driver" }]],
  ]);
  const ranked = rankGuardSuggestions(
    guards,
    ctx,
    {
      blockedGuardIds: new Set([3]),
      scheduledGuardIds: new Set(),
      guardHeHours: new Map([[1, 6], [2, 1.5]]),
      guardLastHe: new Map([[1, "2026-08-01"], [2, "2026-08-08"]]),
      guardAssignmentsByGuard: assignmentsByGuard,
      appliedDayCodes: new Set(["D1"]),
      appliedNightCodes: new Set(["N1"]),
    },
  );
  // GM 4 (weekly) filtered out
  assert.equal(ranked.find((g) => g.id === 4), undefined);
  // GM 2 (D2, opposite team, same spot) ranks before GM 1 (D1, today's team).
  assert.ok(ranked[0].id === 2, `expected SANTOS first, got ${ranked[0]?.name}`);
  assert.ok(ranked[0].reasons.includes("opposite_day"));
  const labels = describeReasons(ranked[0].reasons, ranked[0]);
  assert.ok(labels.some((l) => /dia oposto/.test(l)));
  assert.equal(ranked.find((g) => g.id === 1).reasons.includes("opposite_day"), false);
});

test("rankGuardSuggestions orders otherwise equal GMs by the lowest monthly HE", () => {
  const guards = [
    { id: 1, name: "MAIOR HE", registration: "F001", platoon: "D2", base_shift: "12x36 dia", work_regime: "12x36" },
    { id: 2, name: "MENOR HE", registration: "F002", platoon: "D2", base_shift: "12x36 dia", work_regime: "12x36" },
  ];
  const ranked = rankGuardSuggestions(
    guards,
    { date: "2026-08-12", shift: "2", postId: 10, vehicleId: null, role: "guard" },
    {
      guardHeHours: new Map([[1, 24], [2, 4]]),
      appliedDayCodes: new Set(["D1"]),
    },
  );
  assert.equal(ranked[0].id, 2);
  assert.equal(ranked[0].currentHeHours, 4);
});

test("mergeScheduleAssignments updates both shifts without reloading the schedule", () => {
  const current = [
    { id: 1, guard_id: 10, post_id: 1, vehicle_id: null, shift: "2" },
    { id: 2, guard_id: 11, post_id: 2, vehicle_id: null, shift: "4" },
  ];
  const incoming = [
    { id: 3, guard_id: 20, post_id: 1, vehicle_id: null, shift: "2" },
    { id: 4, guard_id: 20, post_id: 1, vehicle_id: null, shift: "3" },
  ];
  const merged = mergeScheduleAssignments(current, [], incoming);
  assert.deepEqual(merged.assignments.map((item) => item.id), [1, 2, 3, 4]);
  assert.equal(merged.availableForRedeployment.length, 0);
});

test("mergeScheduleAssignments removes and preserves redeployment records locally", () => {
  const active = [{ id: 1, guard_id: 10, post_id: 1, vehicle_id: null }];
  const available = [{ id: 2, guard_id: 11, post_id: null, vehicle_id: null }];
  const moved = [{ id: 1, guard_id: 10, post_id: null, vehicle_id: null }];
  const merged = mergeScheduleAssignments(active, available, moved);
  assert.equal(merged.assignments.length, 0);
  assert.deepEqual(merged.availableForRedeployment.map((item) => item.id), [2, 1]);
  const removed = mergeScheduleAssignments(
    merged.assignments,
    merged.availableForRedeployment,
    [],
    2,
  );
  assert.deepEqual(removed.availableForRedeployment.map((item) => item.id), [1]);
});

test("suggestionPosition keeps the suggestion panel inside the available viewport", () => {
  const below = suggestionPosition(
    { top: 100, bottom: 130, left: 900, right: 980 },
    { width: 1100, height: 800 },
  );
  assert.equal(below?.placement, "below");
  assert.ok((below?.left || 0) <= 712);
  assert.ok((below?.top || 0) + (below?.maxHeight || 0) <= 792);

  const above = suggestionPosition(
    { top: 650, bottom: 680, left: 40, right: 120 },
    { width: 1100, height: 720 },
  );
  assert.equal(above?.placement, "above");
  assert.ok((above?.top || 0) >= 8);
  assert.equal(
    suggestionPosition(
      { top: 10, bottom: 40, left: 5, right: 80 },
      { width: 600, height: 700 },
    ),
    null,
  );
});

test("groupRedeploymentAssignments joins both halves of each operational period", () => {
  const grouped = groupRedeploymentAssignments([
    { id: 2, guard_id: 8, guard_name: "ALMEIDA", shift: "3", starts_at: "2026-08-12T13:00", ends_at: "2026-08-12T19:00" },
    { id: 1, guard_id: 8, guard_name: "ALMEIDA", shift: "2", starts_at: "2026-08-12T07:00", ends_at: "2026-08-12T13:00" },
    { id: 4, guard_id: 9, guard_name: "VIEIRA", shift: "1", starts_at: "2026-08-13T01:00", ends_at: "2026-08-13T07:00" },
    { id: 3, guard_id: 9, guard_name: "VIEIRA", shift: "4", starts_at: "2026-08-12T19:00", ends_at: "2026-08-13T01:00" },
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].assignments.map((item) => item.shift), ["2", "3"]);
  assert.deepEqual(grouped[1].assignments.map((item) => item.shift), ["4", "1"]);
});

test("regular GMs keep the same visual order across shifts of one post", () => {
  const shift2 = [
    { id: 1, guard_id: 2, guard_name: "BRUNO", role: "guard", work_kind: "shift" },
    { id: 2, guard_id: 1, guard_name: "ALMEIDA", role: "guard", work_kind: "shift" },
  ];
  const shift3 = [
    { id: 3, guard_id: 1, guard_name: "ALMEIDA", role: "guard", work_kind: "shift" },
    { id: 4, guard_id: 2, guard_name: "BRUNO", role: "guard", work_kind: "shift" },
  ];
  const all = [...shift2, ...shift3];
  assert.deepEqual(orderAssignmentsInResourceCell(shift2, all, "post").map((item) => item.guard_name), ["ALMEIDA", "BRUNO"]);
  assert.deepEqual(orderAssignmentsInResourceCell(shift3, all, "post").map((item) => item.guard_name), ["ALMEIDA", "BRUNO"]);
});

test("independent overtime stays outside regular alignment lanes", () => {
  const regular = { id: 1, guard_id: 2, guard_name: "BRUNO", role: "guard", work_kind: "shift", starts_at: "2026-08-12T13:00" };
  const extension = { id: 2, guard_id: 1, guard_name: "ALMEIDA", role: "guard", work_kind: "overtime_extension", starts_at: "2026-08-12T19:00" };
  const ordered = orderAssignmentsInResourceCell([extension, regular], [extension, regular], "post");
  assert.deepEqual(ordered.map((item) => item.id), [1, 2]);
});

test("saved resource lane order aligns regular GMs and ignores independent overtime", () => {
  const rows = [
    { id: 1, guard_id: 10, guard_name: "ALFA", role: "guard", work_kind: "shift", lane_order: 1 },
    { id: 2, guard_id: 20, guard_name: "BRAVO", role: "guard", work_kind: "shift", lane_order: 0 },
    { id: 3, guard_id: 30, guard_name: "HE", role: "guard", work_kind: "overtime_extension", lane_order: 0 },
  ];
  assert.deepEqual(orderedResourceGuardIds(rows, "post"), [20, 10]);
  assert.deepEqual(orderAssignmentsInResourceCell(rows, rows, "post").map((item) => item.id), [2, 1, 3]);
});

test("partial lane metadata does not drag a remanejamento to the last row", () => {
  const rows = [
    { id: 1, guard_id: 10, guard_name: "ALMEIDA", role: "guard", work_kind: "shift", lane_order: 8 },
    { id: 2, guard_id: 20, guard_name: "BRUNO", role: "guard", work_kind: "shift" },
  ];
  assert.deepEqual(orderAssignmentsInResourceCell(rows, rows, "post").map((item) => item.guard_name), ["ALMEIDA", "BRUNO"]);
});

test("schedule moves reset destination lane metadata and offer HE for a third vehicle member", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const density = readFileSync(resolve("app/schedule-density.css"), "utf8");
  assert.match(schedule, /const regularCrew = list\.filter/);
  assert.match(schedule, /: "third"/);
  assert.match(schedule, /quickPicker\(kind === "vehicle"\)/);
  assert.match(api, /lane_order=CASE WHEN COALESCE\(post_id,0\)/);
  assert.match(api, /post_id=\?,vehicle_id=\?,lane_order=NULL/);
  assert.match(density, /has-he-action \.live-person\{padding-right:54px\}/);
  assert.match(density, /inline-he-extension\{top:50%/);
  assert.match(density, /vehicle-row \.resource>div>small/);
  assert.match(density, /\.cell-quick-actions\{display:flex!important/);
});

test("every expanded schedule section ends with an inline resource action", () => {
  const source = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(source, /last && !isCollapsed/);
  assert.match(source, /className="resource-section-footer"/);
  assert.match(source, /initialSection:kind==="post"\?section:undefined/);
  assert.match(source, /selectableResources=kind==="post"&&initialSection/);
});

test("schedule editor distinguishes day and night without changing the PDF", () => {
  const source = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(source, /period-day-head/);
  assert.match(source, /period-night-head period-night-start/);
  assert.match(source, /drop-cell period-\$\{s\.period\}/);
  assert.match(source, /reorder_resource_assignments/);
  assert.match(source, /beforeAssignmentId/);
  assert.match(source, /overtime_extension/);
  assert.match(styles, /@media screen\{/);
  assert.match(styles, /td\.period-day:not\(\.furo\)/);
  assert.match(styles, /td\.period-night:not\(\.furo\)/);
});

test("same-day hole suggestions only expose guards already awaiting redeployment", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const dialog = readFileSync(resolve("app/hole-suggest-box.tsx"), "utf8");
  assert.match(api, /Number\(assignment\.awaiting_redeploy\) !== 1\) continue/);
  assert.doesNotMatch(dialog, /assignedCandidates/);
  assert.doesNotMatch(dialog, /Move o período do GM de outro posto/);
});

test("daily operations have an isolated workflow, crew slots and PDF annex", () => {
  const migration = readFileSync(resolve("drizzle/0011_daily_operations.sql"), "utf8");
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `operations`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `operation_slots`/);
  assert.match(api, /sourceType:"available"\|"redeployment"\|"extension"\|"overtime"/);
  assert.match(api, /Uma das viaturas ficou indisponível ou já foi reservada/);
  assert.match(dashboard, /CRIAR MINI ESCALA/);
  assert.match(dashboard, /Remanejar da escala/);
  assert.match(dashboard, /Extensão e hora extra/);
  assert.match(print, /ANEXO · OPERAÇÕES/);
});

test("monthly leave compilation is reviewed before one bulk confirmation", () => {
  const migration = readFileSync(resolve("drizzle/0012_leave_import.sql"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(migration, /idx_leave_choices_campaign_guard_date/);
  assert.match(api, /body\.action === "leave_import"/);
  assert.match(api, /await syncConfirmedLeaves\(\)/);
  assert.match(dashboard, /Revisar antes de incluir/);
  assert.match(dashboard, /Confirmar importação geral/);
  assert.match(dashboard, /GM não encontrado/);
});

test("monthly leave panorama highlights shift, roles, vehicle risks and links to the day", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /function buildLeaveOverview/);
  assert.match(api, /vehicleRisks/);
  assert.match(api, /pattern_role/);
  assert.match(api, /criticalThreshold/);
  assert.match(api, /vehicleTotal/);
  assert.match(dashboard, /Risco de efetivo nas folgas/);
  assert.match(dashboard, /Motoristas/);
  assert.match(dashboard, /Abrir escala/);
  assert.match(dashboard, /\?date=\$\{day\.date\}/);
  assert.match(dashboard, /média empírica/);
  assert.doesNotMatch(dashboard, /Abrir escala do dia mais carregado/);
});

test("monthly leave import can register an unknown GM during the review", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /newGuards/);
  assert.match(api, /normalizeImportName/);
  assert.match(api, /createdGuards/);
  assert.match(dashboard, /Informe a matrícula/);
  assert.match(dashboard, /Será cadastrado após informar a matrícula/);
});

test("pattern editor can create contextual posts and vehicles without duplicate fleet rows", () => {
  const api = readFileSync(resolve("app/api/patterns/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/pattern-resource-actions.css"), "utf8");
  assert.match(api, /body\.action === "add_post"/);
  assert.match(api, /body\.action === "add_vehicle"/);
  assert.match(api, /SELECT id,active FROM vehicles/);
  assert.match(api, /UPDATE vehicles SET type=\?,zone=\?,active=1/);
  assert.match(dashboard, /PatternResourceForm/);
  assert.match(dashboard, /onAddResource/);
  assert.match(dashboard, /Adicionar posto/);
  assert.match(dashboard, /Viatura \/ zona/);
  assert.match(dashboard, /Adicionar GM neste local/);
  assert.match(styles, /@media\(max-width:700px\)/);
});

test("schedule edits reject stale versions and refresh the visible scale", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(api, /function isStaleVersion/);
  assert.match(api, /expectedUpdatedAt/);
  assert.match(api, /expectedUpdatedAts/);
  assert.match(api, /alterada por outra pessoa/);
  assert.match(api, /an edit of an existing cell/);
  assert.match(api, /duplicateRows/);
  assert.match(schedule, /expectedUpdatedAt: pick\.assignment\?\.updated_at/);
  assert.match(schedule, /expectedUpdatedAts/);
  assert.match(schedule, /r\.status === 409 && j\.conflict/);
  assert.match(schedule, /await load\(\)/);
  assert.match(schedule, /const currentDateRef=useRef\(date\)/);
  assert.match(schedule, /const mutationDate=data\?\.date\|\|date/);
  assert.match(schedule, /currentDateRef\.current!==mutationDate/);
});

test("operation redeployment preserves and restores every source assignment", () => {
  const migration = readFileSync(resolve("drizzle/0013_operation_redeployments.sql"), "utf8");
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `operation_slot_origins`/);
  assert.match(api, /sourceType="redeployment"/);
  assert.match(api, /AVISAR REMANEJAMENTO/);
  assert.match(api, /async function restoreSlot/);
  assert.match(api, /async function restoreOperation/);
  assert.match(dashboard, /Remanejar da escala/);
  assert.match(dashboard, /Horários parcialmente sobrepostos não são remanejados automaticamente/);
  assert.match(dashboard, /useScheduleDate\(initialDate\)/);
  assert.match(dashboard, /detail="Preparando a escala operacional…"/);
});

test("confirmed operations must be explicitly reopened before editing slots", () => {
  const api = readFileSync(resolve("app/api/operations/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/operations-dashboard.tsx"), "utf8");
  assert.match(api, /body\.action==="reopen"/);
  assert.match(api, /o\.status='draft'/);
  assert.match(api, /Reabra a operação antes de alterar suas vagas/);
  assert.match(dashboard, /Reabrir edição/);
  assert.match(dashboard, /bloqueada para evitar alterações acidentais/);
});

test("general service adjustments expose BH-, BH+ and service swaps in schedule and PDF", () => {
  const api = readFileSync(resolve("app/api/schedule/route.ts"), "utf8");
  const admin = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const print = readFileSync(resolve("app/print-schedule.tsx"), "utf8");
  const nav = readFileSync(resolve("app/schedule-nav.tsx"), "utf8");
  const migration = readFileSync(resolve("drizzle/0014_service_adjustments.sql"), "utf8");
  const history = readFileSync(resolve("app/api/history/route.ts"), "utf8");
  assert.match(api, /create_service_adjustment/);
  assert.match(api, /reorder_resource_assignments/);
  assert.match(api, /cancel_service_adjustment/);
  assert.match(api, /time_bank_positive/);
  assert.match(api, /negative_late/);
  assert.match(api, /counterpartServiceDate/);
  assert.match(api, /counterpart_service_date/);
  assert.match(api, /negativeHours/);
  assert.match(api, /settlementEnabled/);
  assert.match(api, /settlementDate! <= serviceDate/);
  assert.match(api, /createdSettlementAssignmentId/);
  assert.match(api, /settlement_date/);
  assert.match(api, /subtype === "swap"/);
  assert.match(api, /serviceAdjustments/);
  assert.match(admin, /service_adjustments/);
  assert.match(admin, /Trocas entre dias devem ser registradas/);
  assert.match(dashboard, /Banco de horas e trocas/);
  assert.match(dashboard, /BH\+ · pagar banco em dia extra/);
  assert.match(dashboard, /Pagar este BH- com BH\+ em outro dia/);
  assert.match(dashboard, /Quantidade do BH- \(horas\)/);
  assert.match(schedule, /service-adjustment-bottom/);
  assert.match(schedule, /liveServiceAdjustmentCode/);
  assert.match(schedule, /settlement_date/);
  assert.match(print, /print-service-adjustments/);
  assert.match(print, /printServiceAdjustmentCode/);
  assert.match(print, /settlement/);
  assert.match(nav, /\/bancos/);
  assert.match(migration, /idx_service_adjustments_date/);
  assert.match(migration, /idx_service_adjustments_settlement_date/);
  const laneMigration = readFileSync(resolve("drizzle/0015_assignment_lane_order.sql"), "utf8");
  assert.match(laneMigration, /lane_order/);
  assert.match(history, /assignment_lane/);
  });

test("manual overtime dashboard exposes actionable alerts, safe refresh state and an hours-band filter", () => {
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/overtime-enhancements.css"), "utf8");
  assert.match(dashboard, /const pendingCount = data\.suggestions\.length/);
  assert.match(dashboard, /className="he-alerts"/);
  assert.match(dashboard, /missingRequestCount/);
  assert.match(dashboard, /hoursBand/);
  assert.match(dashboard, /value="over12"/);
  assert.match(dashboard, /isRefreshing/);
  assert.match(dashboard, /Tentar novamente/);
  assert.match(styles, /\.he-alert-grid/);
  assert.match(styles, /\.he-load-error/);
});

test("management modules reuse a date-scoped cache while synchronizing D1 silently", () => {
  const source = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(source, /escala-admin-cache/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /writeAdminCache\(date, next\)/);
  assert.match(source, /Nao foi possivel sincronizar os dados operacionais/);
});

test("pattern editor reuses the current date cache and refreshes it after synchronization", () => {
  const source = readFileSync(resolve("app/patterns-dashboard.tsx"), "utf8");
  assert.match(source, /escala-patterns-cache/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /useState<Data \| null>\(\(\) => readPatternCache\(date\)\)/);
  assert.match(source, /void load\(Boolean\(readPatternCache\(date\)\)\)/);
  assert.match(source, /writePatternCache\(date, json\)/);
});

test("operational notices can be edited in place with an auditable API action", () => {
  const api = readFileSync(resolve("app/api/notices/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/notices-dashboard.tsx"), "utf8");
  const styles = readFileSync(resolve("app/notices.css"), "utf8");
  assert.match(api, /action==="create"\|\|action==="update"/);
  assert.match(api, /UPDATE operational_notices SET effective_date/);
  assert.match(api, /Editou o lembrete/);
  assert.match(dashboard, /action: "update"/);
  assert.match(dashboard, /NoticeEditor/);
  assert.match(dashboard, />Editar<\/button>/);
  assert.match(styles, /\.notice-editor-backdrop/);
});

test("fleet panorama prevents duplicate status actions while a change is saving", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(dashboard, /function activeVehicleOutages\(outages:Item\[\],date:string\)/);
  assert.match(dashboard, /const activeOutages=useMemo\(\(\)=>activeVehicleOutages\(outages,date\)/);
  assert.match(dashboard, /className="fleet-status" aria-busy=\{saving\}/);
  assert.match(dashboard, /<select name="vehicleId" required defaultValue="" disabled=\{saving\}/);
  assert.match(dashboard, /<FleetPanorama[\s\S]*saving=\{saving\}/);
  assert.match(dashboard, /function FleetPanorama\(\{date,vehicles,outages,crews,saving/);
  assert.match(dashboard, /<button disabled=\{saving\} onClick=\{\(\)=>onEdit\(vehicle\)\}>Editar<\/button>/);
  assert.match(dashboard, /className="available" disabled=\{saving\} onClick=\{\(\)=>onClearOutage\(outage\.id\)\}/);
  assert.match(dashboard, /className="outage" disabled=\{saving\} onClick=\{\(\)=>onQuickOutage\(vehicle\)\}/);
  assert.match(styles, /fleet-card-actions button:disabled/);
});

test("catalog edits and ordering share the saving guard", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(dashboard, /if \(!editing \|\| saving\) return;/);
  assert.match(dashboard, /action: "catalog_update"/);
  assert.match(dashboard, /action: "catalog_deactivate"/);
  assert.match(dashboard, /action: "post_reorder"/);
  assert.match(dashboard, /function CatalogEditor\(\{[\s\S]*saving/);
  assert.match(dashboard, /disabled=\{saving\}>\{saving \? "Salvando…" : "Salvar mudanças"\}/);
  assert.match(dashboard, /function Record\(\{[\s\S]*saving/);
});

test("new catalog records update the local management view without a full reload", () => {
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(dashboard, /const catalogKey = action === "guard" \? "guards"/);
  assert.match(dashboard, /if \(catalogKey && j\.entity\)/);
  assert.match(dashboard, /writeAdminCache\(date, next\)/);
  assert.match(dashboard, /const sectionKey = `POST:\$\{String\(body\.groupName/);
  assert.match(dashboard, /return;\n\s*}\n\s*if \(action === "movement"/);
});

test("daily scale exposes contextual post editing without a full reload", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const styles = readFileSync(resolve("app/workforce.css"), "utf8");
  assert.match(schedule, /\[postEdit, setPostEdit\] = useState<Rec \| null>\(null\)/);
  assert.match(schedule, /async function savePostQuick/);
  assert.match(schedule, /action: "catalog_update"/);
  assert.match(schedule, /entity: "post"/);
  assert.match(schedule, /onEditPost=\{setPostEdit\}/);
  assert.match(schedule, /function PostQuickEditor/);
  assert.match(schedule, /className="resource-quick-button"/);
  assert.match(api, /const sortOrder = Number\.isFinite\(Number\(body\.sortOrder\)\)/);
  assert.match(styles, /\.resource-quick-button/);
});

test("daily scale exposes contextual section editing", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(schedule, /\[sectionEdit, setSectionEdit\] = useState/);
  assert.match(schedule, /async function saveSectionQuick/);
  assert.match(schedule, /action: "section_update"/);
  assert.match(schedule, /onEditSection=\{\(sectionKey, label\) => setSectionEdit/);
  assert.match(schedule, /function SectionQuickEditor/);
  assert.match(schedule, /className="section-inline-edit"/);
  assert.match(styles, /\.section-inline-edit/);
});

test("selected GM cards expose a quick adjustment dialog before the advanced editor", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/simple-ux.css"), "utf8");
  assert.match(schedule, /\[quickEdit, setQuickEdit\] = useState/);
  assert.match(schedule, /async function saveQuickAssignment/);
  assert.match(schedule, /function QuickAssignmentEditor/);
  assert.match(schedule, /className="quick-inline-edit"/);
  assert.match(schedule, /onQuickEdit=\{setQuickEdit\}/);
  assert.match(schedule, /expectedUpdatedAt: assignment\.updated_at/);
  assert.match(styles, /\.quick-inline-edit/);
});

test("dragging a GM highlights compatible and blocked schedule destinations", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/drag-edit.css"), "utf8");
  assert.match(schedule, /\[draggingAssignmentId,setDraggingAssignmentId\]=useState/);
  assert.match(schedule, /function canReceiveDrag/);
  assert.match(schedule, /className=\{`\$\{missingRoles\.length/);
  assert.match(schedule, /drag-drop-ready/);
  assert.match(schedule, /onDragStart\(a\)/);
  assert.match(schedule, /onDragEnd=\{onDragEnd\}/);
  assert.match(styles, /\.drop-cell\.drag-drop-ready/);
  assert.match(styles, /\.drop-cell\.drag-drop-blocked/);
});

test("schedule collaboration exposes refresh time and conflict recovery", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/usability.css"), "utf8");
  assert.match(schedule, /\[conflictNotice, setConflictNotice\] = useState/);
  assert.match(schedule, /\[lastSyncedAt, setLastSyncedAt\] = useState/);
  assert.match(schedule, /setInterval\(\(\) =>/);
  assert.match(schedule, /60_000/);
  assert.match(schedule, /className="schedule-conflict-notice"/);
  assert.match(schedule, /className="sync-refresh"/);
  assert.match(styles, /\.schedule-conflict-notice/);
  assert.match(styles, /\.sync-refresh/);
});

test("schedule cells support keyboard navigation and contextual activation", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/drag-edit.css"), "utf8");
  assert.match(schedule, /KeyboardEvent as ReactKeyboardEvent/);
  assert.match(schedule, /function navigateCell/);
  assert.match(schedule, /event\.key === "ArrowLeft"/);
  assert.match(schedule, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(schedule, /tabIndex=\{0\}/);
  assert.match(schedule, /className="keyboard-help"/);
  assert.match(styles, /\.drop-cell:focus-visible/);
});

test("schedule keeps a small queue of recent undoable changes", () => {
  const schedule = readFileSync(resolve("app/live-schedule.tsx"), "utf8");
  assert.match(schedule, /\[undoEvents, setUndoEvents\] = useState<UndoState\[\]>\(\[\]\)/);
  assert.match(schedule, /function registerUndo\(event: UndoState\)/);
  assert.match(schedule, /setUndoEvents\(\(current\) => \[event, \.\.\.current\.filter\(\(item\) => item\.id !== event\.id\)\]\.slice\(0, 5\)\)/);
  assert.match(schedule, /undoEvents\.length>0/);
  assert.match(schedule, /undoEvents\.length>1/);
});

test("overtime dashboard reuses a month cache while refreshing the live book", () => {
  const dashboard = readFileSync(resolve("app/overtime-dashboard.tsx"), "utf8");
  assert.match(dashboard, /const overtimeCacheKey = \(month: string\)/);
  assert.match(dashboard, /function readOvertimeCache\(month: string\): Data \| null/);
  assert.match(dashboard, /function writeOvertimeCache\(data: Data\)/);
  assert.match(dashboard, /useState<Data \| null>\(\(\) => readOvertimeCache\(date\.slice\(0, 7\)\)\)/);
  assert.match(dashboard, /const cached = readOvertimeCache\(month\)/);
  assert.match(dashboard, /writeOvertimeCache\(next\)/);
  assert.match(dashboard, /const isRefreshing = loading \|\| !monthMatches/);
});

test("publication validation respects FA resources and reports actionable critical issues", () => {
  const api = readFileSync(resolve("app/api/publish/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/validate-schedule.tsx"), "utf8");
  const styles = readFileSync(resolve("app/validation.css"), "utf8");
  assert.match(api, /schedule_resource_exclusions/);
  assert.match(api, /vehicle_outages/);
  assert.match(api, /vehicle_return_reconciliations/);
  assert.match(api, /missingRoles/);
  assert.match(api, /overlapping/);
  assert.match(api, /severity: "critical"/);
  assert.match(dashboard, /normalizeIssues/);
  assert.match(dashboard, /pendências críticas/);
  assert.match(dashboard, /Abrir escala/);
  assert.match(dashboard, /validation-issue/);
  assert.match(styles, /validation-severity-summary/);
  assert.match(styles, /validation-issue\.warning/);
});

test("cancelling a confirmed leave promotes the next waitlisted GM and syncs the scale", () => {
  const api = readFileSync(resolve("app/api/admin/route.ts"), "utf8");
  const dashboard = readFileSync(resolve("app/gestao-client.tsx"), "utf8");
  assert.match(api, /promoteNextWaitlistedLeave/);
  assert.match(api, /normalizeWaitlistPositions/);
  assert.match(api, /status='waitlist'/);
  assert.match(api, /promotedGuardName/);
  assert.match(api, /syncConfirmedLeaves\(Number\(next\.id\)\)/);
  assert.match(dashboard, /foi promovido\(a\) automaticamente da lista de espera/);
  assert.match(dashboard, /posição \$\{item\.position\}/);
});
