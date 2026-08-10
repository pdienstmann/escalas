export type LaneAssignment = Record<string, string | number | null>;

function isIndependentOvertime(assignment: LaneAssignment) {
  return String(assignment.work_kind || "shift") === "overtime_extension";
}

function roleRank(role: unknown) {
  if (role === "driver") return 0;
  if (role === "patrol") return 1;
  if (role === "third") return 2;
  return 3;
}

/**
 * Returns one stable lane per GM for a resource.  A lane order saved on any
 * regular assignment wins; legacy rows without it fall back to role/name so
 * the first render is deterministic.  Independent HE blocks are deliberately
 * ignored because they can belong to another post or viatura.
 */
export function orderedResourceGuardIds(
  resourceAssignments: LaneAssignment[],
  kind: "post" | "vehicle",
) {
  const regularByGuard = new Map<number, LaneAssignment[]>();
  for (const assignment of resourceAssignments) {
    if (isIndependentOvertime(assignment)) continue;
    const guardId = Number(assignment.guard_id);
    const current = regularByGuard.get(guardId) || [];
    current.push(assignment);
    regularByGuard.set(guardId, current);
  }
  const lanes = [...regularByGuard.entries()]
    .map(([guardId, assignments]) => {
      const savedOrders = assignments
        .map((assignment) => Number(assignment.lane_order))
        .filter((value) => Number.isFinite(value));
      const role = kind === "vehicle"
        ? Math.min(...assignments.map((assignment) => roleRank(assignment.role)))
        : 0;
      return {
        guardId,
        laneOrder: savedOrders.length ? Math.min(...savedOrders) : null,
        role,
        name: String(assignments[0]?.guard_name || ""),
      };
    });
  // A GM moved from another post/VTR may carry the old lane_order for one
  // render.  Treat a partial lane map as legacy data and fall back to the
  // deterministic role/name order until the destination is explicitly
  // normalized.  This prevents a remanejamento from jumping to the last row.
  const hasCompleteLaneMap = lanes.length > 0 &&
    lanes.every((item) => item.laneOrder !== null) &&
    new Set(lanes.map((item) => item.laneOrder)).size === lanes.length;
  return lanes
    .sort((a, b) => {
      if (hasCompleteLaneMap) {
        if (a.laneOrder === null) return 1;
        if (b.laneOrder === null) return -1;
        if (a.laneOrder !== b.laneOrder) return a.laneOrder - b.laneOrder;
      }
      return a.role - b.role || a.name.localeCompare(b.name, "pt-BR") || a.guardId - b.guardId;
    })
    .map((item) => item.guardId);
}

/**
 * Keeps regular GMs in one stable visual lane across the four shift columns of
 * the same resource. Independent overtime is deliberately kept outside those
 * lanes because it may belong to a different operational block.
 */
export function orderAssignmentsInResourceCell(
  cellAssignments: LaneAssignment[],
  resourceAssignments: LaneAssignment[],
  kind: "post" | "vehicle",
) {
  const laneOrder = new Map(
    orderedResourceGuardIds(resourceAssignments, kind).map((guardId, index) => [guardId, index]),
  );

  return [...cellAssignments].sort((a, b) => {
    const independentA = isIndependentOvertime(a);
    const independentB = isIndependentOvertime(b);
    if (independentA !== independentB) return Number(independentA) - Number(independentB);
    if (!independentA) {
      return (
        (laneOrder.get(Number(a.guard_id)) ?? Number.MAX_SAFE_INTEGER) -
          (laneOrder.get(Number(b.guard_id)) ?? Number.MAX_SAFE_INTEGER) ||
        Number(a.id) - Number(b.id)
      );
    }
    return (
      String(a.starts_at).localeCompare(String(b.starts_at)) ||
      String(a.guard_name || "").localeCompare(String(b.guard_name || ""), "pt-BR") ||
      Number(a.id) - Number(b.id)
    );
  });
}
