import assert from "node:assert/strict";
import test from "node:test";
import {
  formatScheduleDate,
  isScheduleDate,
  resolveScheduleDate,
  todayScheduleDate,
  withScheduleDate,
} from "../lib/schedule-date.ts";
import { orderScheduleResources } from "../lib/schedule-sections.ts";
import { formatHoursDuration, fullPeriodWindow, fullPeriodShifts } from "../lib/shift-rules.ts";
import { rankGuardSuggestions, describeReasons } from "../lib/suggest-gm.ts";

test("resolveScheduleDate prefers URL date over storage and today", () => {
  assert.equal(isScheduleDate("2026-08-12"), true);
  assert.equal(isScheduleDate("2026-13-01"), false);
  assert.equal(resolveScheduleDate("2026-08-20"), "2026-08-20");
  assert.equal(resolveScheduleDate("invalid", "2026-08-08"), "2026-08-08");
  assert.match(todayScheduleDate(new Date("2026-08-08T15:00:00")), /^\d{4}-\d{2}-\d{2}$/);
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

test("formatHoursDuration renders 2h and 2h30 without decimals", () => {
  assert.equal(formatHoursDuration(2), "2h");
  assert.equal(formatHoursDuration(2.5), "2h30");
  assert.equal(formatHoursDuration(0), "0h");
  assert.equal(formatHoursDuration(0.25), "0h15");
  assert.equal(formatHoursDuration(6), "6h");
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
});