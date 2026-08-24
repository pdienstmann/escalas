import test from "node:test";
import assert from "node:assert/strict";
import { auditScheduleIntegrity } from "../lib/schedule-integrity.ts";
import { operationalGroupVehicleIdsForShifts } from "../lib/print-schedule-model.ts";

test("accepts contiguous weekly blocks", () => {
  const result = auditScheduleIntegrity({
    date: "2026-08-18",
    guards: [{ id: 1, name: "NUNES", work_regime: "weekly" }],
    assignments: [
      { id: 1, guard_id: 1, guard_name: "NUNES", post_id: 1, work_kind: "weekly", starts_at: "2026-08-18T08:00", ends_at: "2026-08-18T12:00" },
      { id: 2, guard_id: 1, guard_name: "NUNES", post_id: 1, work_kind: "weekly", starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T19:00" },
    ],
  });
  assert.equal(result.errors.length, 0);
});

test("detects weekly residue, invalid interval and overlapping locations", () => {
  const result = auditScheduleIntegrity({
    guards: [{ id: 1, name: "NUNES", work_regime: "weekly" }],
    assignments: [
      { id: 1, guard_id: 1, guard_name: "NUNES", post_id: 1, work_kind: "shift", starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T19:00" },
      { id: 2, guard_id: 1, guard_name: "NUNES", vehicle_id: 2, work_kind: "weekly", starts_at: "2026-08-18T15:00", ends_at: "2026-08-18T18:00" },
      { id: 3, guard_id: 2, guard_name: "ERRO", post_id: 1, starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T13:00" },
    ],
  });
  assert.ok(result.errors.some((item) => item.code === "weekly_in_12x36"));
  assert.ok(result.errors.some((item) => item.code === "guard_overlap"));
  assert.ok(result.errors.some((item) => item.code === "invalid_interval"));
});

test("accepts distinct posts, a 13h-01h journey and an independent contiguous HE extension", () => {
  const result = auditScheduleIntegrity({
    date: "2026-08-18",
    guards: [
      { id: 1, name: "ALFA", work_regime: "12x36" },
      { id: 2, name: "BRAVO", work_regime: "12x36" },
    ],
    assignments: [
      { id: 11, guard_id: 1, guard_name: "ALFA", post_id: 1, starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T19:00" },
      { id: 12, guard_id: 1, guard_name: "ALFA", post_id: 2, starts_at: "2026-08-18T19:00", ends_at: "2026-08-19T01:00", status: "overtime", work_kind: "overtime_extension" },
      { id: 13, guard_id: 2, guard_name: "BRAVO", post_id: 3, starts_at: "2026-08-18T07:00", ends_at: "2026-08-18T13:00" },
      { id: 14, guard_id: 2, guard_name: "BRAVO", post_id: 3, starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T19:00" },
    ],
  });
  assert.equal(result.errors.length, 0);
});

test("detects overlapping regular and HE blocks across different resources", () => {
  const result = auditScheduleIntegrity({
    assignments: [
      { id: 21, guard_id: 1, guard_name: "ALFA", post_id: 1, starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T19:00" },
      { id: 22, guard_id: 1, guard_name: "ALFA", vehicle_id: 8, starts_at: "2026-08-18T18:00", ends_at: "2026-08-19T01:00", status: "overtime" },
    ],
  });
  assert.ok(result.errors.some((item) => item.code === "guard_overlap"));
});

test("allows one motorcycle rider and rejects two simultaneous riders", () => {
  const base = {
    vehicles: [{ id: 7, prefix: "MT 643", type: "moto" }],
    assignments: [{ id: 31, guard_id: 1, guard_name: "ALFA", vehicle_id: 7, starts_at: "2026-08-18T07:00", ends_at: "2026-08-18T19:00" }],
  };
  assert.equal(auditScheduleIntegrity(base).errors.length, 0);
  const duplicate = auditScheduleIntegrity({
    ...base,
    assignments: [...base.assignments, { id: 32, guard_id: 2, guard_name: "BRAVO", vehicle_id: 7, starts_at: "2026-08-18T13:00", ends_at: "2026-08-18T19:00" }],
  });
  assert.ok(duplicate.errors.some((item) => item.code === "motorcycle_multiple_riders"));
});

test("PDF assigns a group motorcycle only to the group period", () => {
  const input = {
    date: "2026-08-18",
    members: [{ id: 1, pattern_id: 10, pattern_period: "day", group_id: 2, resource_kind: "guard", resource_id: 20, vehicle_id: 643, starts_at: "07:00", ends_at: "19:00" }],
    assignments: [{ id: 51, guard_id: 20, vehicle_id: 643, starts_at: "2026-08-18T07:00", ends_at: "2026-08-18T19:00" }],
  };
  assert.deepEqual([...operationalGroupVehicleIdsForShifts({ ...input, shiftIds: ["2", "3"] })], [643]);
  assert.deepEqual([...operationalGroupVehicleIdsForShifts({ ...input, shiftIds: ["4", "1"] })], []);
});

test("PDF also recognizes a vehicle selected only in the daily group assignment", () => {
  const ids = operationalGroupVehicleIdsForShifts({
    date: "2026-08-18",
    shiftIds: ["4", "1"],
    members: [{ id: 1, pattern_id: -99, pattern_period: "night", resource_kind: "guard", resource_id: 30, starts_at: "19:00", ends_at: "07:00" }],
    assignments: [{ id: 61, guard_id: 30, vehicle_id: 701, starts_at: "2026-08-18T19:00", ends_at: "2026-08-19T07:00" }],
  });
  assert.deepEqual([...ids], [701]);
});

test("a day-specific group remanejamento replaces the planned vehicle in the PDF", () => {
  const ids = operationalGroupVehicleIdsForShifts({
    date: "2026-08-18",
    shiftIds: ["2", "3"],
    members: [{ id: 1, pattern_id: 10, pattern_period: "day", resource_kind: "guard", resource_id: 40, vehicle_id: 100, starts_at: "07:00", ends_at: "19:00" }],
    assignments: [{ id: 71, guard_id: 40, vehicle_id: 200, starts_at: "2026-08-18T07:00", ends_at: "2026-08-18T19:00", is_reassigned: 1 }],
  });
  assert.deepEqual([...ids], [200]);
});
