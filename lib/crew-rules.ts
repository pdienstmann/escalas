export function hasRequiredVehicleCrew(existingRoles: string[], incomingRoles: string[]) {
  const roles = new Set([...existingRoles, ...incomingRoles]);
  return roles.has("driver") && roles.has("patrol");
}

export function hasUniqueCrewMembers(members: Array<{ guardId: number }>) {
  return new Set(members.map((member) => member.guardId)).size === members.length;
}
