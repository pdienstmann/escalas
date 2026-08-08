type AssignmentRecord = Record<string, string | number | null>;

function hasDestination(assignment: AssignmentRecord) {
  return assignment.post_id != null || assignment.vehicle_id != null;
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
