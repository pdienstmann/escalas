import test from "node:test";
import assert from "node:assert/strict";
import { issuesForResource, validatePattern } from "../lib/pattern-validation.ts";

test("pattern validation identifies missing driver and patrol", () => {
  const issues = validatePattern([
    { id: 1, guard_id: 10, guard_name: "GM Teste", vehicle_id: 4, post_id: null, role: "third" },
  ]);
  assert.deepEqual(
    issuesForResource(issues, "vehicle:4").map((issue) => issue.message),
    ["Motorista ausente.", "Patrulheiro ausente."],
  );
});

test("pattern validation accepts a complete vehicle crew", () => {
  const issues = validatePattern([
    { id: 1, guard_id: 10, guard_name: "GM A", vehicle_id: 4, post_id: null, role: "driver" },
    { id: 2, guard_id: 11, guard_name: "GM B", vehicle_id: 4, post_id: null, role: "patrol" },
  ]);
  assert.equal(issues.length, 0);
});

test("pattern validation accepts a single motorcycle driver", () => {
  const issues = validatePattern(
    [{ id: 1, guard_id: 10, guard_name: "GM Moto", vehicle_id: 8, post_id: null, role: "driver" }],
    [{ id: 8, type: "moto" }],
  );
  assert.equal(issues.length, 0);
});

test("pattern validation reports duplicate guards and missing destinations", () => {
  const issues = validatePattern([
    { id: 1, guard_id: 10, guard_name: "GM A", vehicle_id: null, post_id: 2, role: "guard" },
    { id: 2, guard_id: 10, guard_name: "GM A", vehicle_id: null, post_id: null, role: "guard" },
  ]);
  assert.ok(issues.some((issue) => issue.kind === "duplicate"));
  assert.ok(issues.some((issue) => issue.kind === "destination"));
});
