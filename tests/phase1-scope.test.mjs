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
import { orderAssignmentsInResourceCell } from "../lib/schedule-lanes.ts";
import { suggestionPosition } from "../lib/suggestion-position.ts";

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

test("weekly overtime extension is also visible in the night period", () => {
  const assignment = { shift: "W", starts_at: "2026-08-12T08:00", ends_at: "2026-08-12T23:00" };
  assert.deepEqual(coveredOperationalShifts(assignment, "2026-08-12"), ["2", "3", "4"]);
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
  assert.match(api, /sourceType:"available"\|"extension"\|"overtime"/);
  assert.match(api, /Uma das viaturas ficou indisponível ou já foi reservada/);
  assert.match(dashboard, /CRIAR MINI ESCALA/);
  assert.match(dashboard, /Primeiro: À disposição\. Depois: extensão e HE/);
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
