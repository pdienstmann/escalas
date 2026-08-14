type AssignmentRecord = Record<string, string | number | null>;

export type RedeploymentGroup = {
  key: string;
  guardId: number;
  guardName: string;
  period: "day" | "night";
  assignments: AssignmentRecord[];
};

function assignmentPeriod(assignment: AssignmentRecord): "day" | "night" {
  const shift = String(assignment.shift);
  if (shift === "2" || shift === "3") return "day";
  if (shift === "4" || shift === "1") return "night";
  const hour = Number(String(assignment.starts_at || "00:00").slice(11, 13));
  return hour >= 7 && hour < 19 ? "day" : "night";
}

export function groupRedeploymentAssignments(
  assignments: AssignmentRecord[],
): RedeploymentGroup[] {
  const groups = new Map<string, RedeploymentGroup>();
  for (const assignment of assignments) {
    const period = assignmentPeriod(assignment);
    const key = `${Number(assignment.guard_id)}:${period}`;
    const group = groups.get(key) || {
      key,
      guardId: Number(assignment.guard_id),
      guardName: String(assignment.guard_name || "GM"),
      period,
      assignments: [],
    };
    group.assignments.push(assignment);
    groups.set(key, group);
  }
  const order = { "2": 0, "3": 1, "4": 0, "1": 1, W: 0 };
  return [...groups.values()]
    .map((group) => ({
      ...group,
      assignments: group.assignments.sort(
        (a, b) =>
          (order[String(a.shift) as keyof typeof order] ?? 9) -
          (order[String(b.shift) as keyof typeof order] ?? 9),
      ),
    }))
    .sort((a, b) => a.guardName.localeCompare(b.guardName));
}

function hasDestination(assignment: AssignmentRecord) {
  return assignment.post_id != null || assignment.vehicle_id != null;
}

export function dailyScheduleResourceKeys(
  assignments: AssignmentRecord[],
  operationalGroupMembers: AssignmentRecord[],
) {
  const keys = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.post_id != null) keys.add(`post:${Number(assignment.post_id)}`);
    if (assignment.vehicle_id != null) keys.add(`vehicle:${Number(assignment.vehicle_id)}`);
  }
  for (const member of operationalGroupMembers) {
    const kind = String(member.resource_kind || "");
    if (["post", "vehicle"].includes(kind) && Number(member.resource_id) > 0) {
      keys.add(`${kind}:${Number(member.resource_id)}`);
    }
    if (member.pattern_id != null && Number(member.vehicle_id) > 0) {
      keys.add(`vehicle:${Number(member.vehicle_id)}`);
    }
  }
  return keys;
}

export function mergeScheduleAssignments(
  active: AssignmentRecord[],
  availableForRedeployment: AssignmentRecord[],
  incoming: AssignmentRecord[],
  deletedId?: number | null,
) {
  const changedIds = new Set(incoming.map((assignment) => Number(assignment.id)));
  if (deletedId) changedIds.add(Number(deletedId));

  const unchangedActive = active.filter(
    (assignment) => !changedIds.has(Number(assignment.id)),
  );
  const unchangedAvailable = availableForRedeployment.filter(
    (assignment) => !changedIds.has(Number(assignment.id)),
  );

  return {
    assignments: [
      ...unchangedActive,
      ...incoming.filter(hasDestination),
    ],
    availableForRedeployment: [
      ...unchangedAvailable,
      ...incoming.filter((assignment) => !hasDestination(assignment)),
    ],
  };
}
