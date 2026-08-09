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
 * Keeps regular GMs in one stable visual lane across the four shift columns of
 * the same resource. Independent overtime is deliberately kept outside those
 * lanes because it may belong to a different operational block.
 */
export function orderAssignmentsInResourceCell(
  cellAssignments: LaneAssignment[],
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

  const laneOrder = new Map(
    [...regularByGuard.entries()]
      .sort(([guardA, assignmentsA], [guardB, assignmentsB]) => {
        const roleA = kind === "vehicle"
          ? Math.min(...assignmentsA.map((assignment) => roleRank(assignment.role)))
          : 0;
        const roleB = kind === "vehicle"
          ? Math.min(...assignmentsB.map((assignment) => roleRank(assignment.role)))
          : 0;
        const nameA = String(assignmentsA[0]?.guard_name || "");
        const nameB = String(assignmentsB[0]?.guard_name || "");
        return roleA - roleB || nameA.localeCompare(nameB, "pt-BR") || guardA - guardB;
      })
      .map(([guardId], index) => [guardId, index]),
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
