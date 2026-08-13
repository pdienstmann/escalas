import assert from "node:assert/strict";
import test from "node:test";
import { hasRequiredVehicleCrew, hasUniqueCrewMembers, isMotorcycleType } from "../lib/crew-rules.ts";

test("new vehicles require a driver and patrol officer", () => {
  assert.equal(hasRequiredVehicleCrew([], ["driver", "patrol"]), true);
  assert.equal(hasRequiredVehicleCrew([], ["driver", "third"]), false);
});

test("existing complete crews can receive third and additional members", () => {
  assert.equal(hasRequiredVehicleCrew(["driver", "patrol"], ["third", "third"]), true);
});

test("motorcycles require only one driver and never a patrol officer", () => {
  assert.equal(isMotorcycleType("moto"), true);
  assert.equal(hasRequiredVehicleCrew([], ["driver"], "moto"), true);
  assert.equal(hasRequiredVehicleCrew([], [], "moto"), false);
});

test("the same GM cannot occupy two positions in the crew builder", () => {
  assert.equal(hasUniqueCrewMembers([{ guardId: 1 }, { guardId: 2 }, { guardId: 3 }]), true);
  assert.equal(hasUniqueCrewMembers([{ guardId: 1 }, { guardId: 1 }]), false);
});
