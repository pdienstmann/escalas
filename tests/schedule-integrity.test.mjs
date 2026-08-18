import test from "node:test";
import assert from "node:assert/strict";
import { auditScheduleIntegrity } from "../lib/schedule-integrity.ts";

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
