import { operationalGroupMemberCoversShift } from "./operational-group-schedule.ts";
import { assignmentOverlapsShift } from "./shift-rules.ts";

type PrintRecord = Record<string, unknown>;

/**
 * Viaturas conduzidas por um grupamento pertencem à seção do grupamento no
 * período. Mantê-las também na grade convencional produz um furo artificial.
 */
export function operationalGroupVehicleIdsForShifts(input: {
  date: string;
  shiftIds: string[];
  members?: PrintRecord[];
  assignments?: PrintRecord[];
}) {
  const ids = new Set<number>();
  for (const member of input.members || []) {
    if (String(member.resource_kind) !== "guard" || member.pattern_id == null) continue;
    const coveredShiftIds = input.shiftIds.filter((shiftId) =>
      operationalGroupMemberCoversShift(member, input.date, shiftId),
    );
    if (!coveredShiftIds.length) continue;
    const currentAssignments = (input.assignments || []).filter((assignment) =>
      Number(assignment.guard_id) === Number(member.resource_id) &&
      assignment.vehicle_id != null &&
      coveredShiftIds.some((shiftId) => assignmentOverlapsShift(assignment, input.date, shiftId)),
    );
    if (currentAssignments.length) {
      for (const assignment of currentAssignments) ids.add(Number(assignment.vehicle_id));
    } else if (member.vehicle_id != null) {
      // A VTR do padrão é somente o plano B quando o dia ainda não recebeu
      // uma alteração específica. Assim um remanejamento não esconde a VTR antiga.
      ids.add(Number(member.vehicle_id));
    }
  }
  return ids;
}

export function vehicleHasAssignmentInShifts(input: {
  date: string;
  shiftIds: string[];
  vehicleId: number;
  assignments?: PrintRecord[];
}) {
  return (input.assignments || []).some((assignment) =>
    Number(assignment.vehicle_id) === input.vehicleId &&
    input.shiftIds.some((shiftId) => assignmentOverlapsShift(assignment, input.date, shiftId)),
  );
}
