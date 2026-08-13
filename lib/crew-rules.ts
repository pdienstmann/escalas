/**
 * Motos operam com um único GM (o condutor). O cadastro historicamente usa
 * `driver` para o papel da pessoa na viatura, portanto não exigimos um papel
 * de patrulheiro quando o recurso é uma moto.
 */
export function isMotorcycleType(type: unknown) {
  return String(type || "").trim().toLowerCase() === "moto";
}

export function vehicleRequiresPair(type?: unknown) {
  return !isMotorcycleType(type);
}

export function hasRequiredVehicleCrew(existingRoles: string[], incomingRoles: string[], vehicleType?: unknown) {
  const roles = new Set([...existingRoles, ...incomingRoles]);
  if (isMotorcycleType(vehicleType)) return roles.size > 0;
  return roles.has("driver") && roles.has("patrol");
}

export function hasUniqueCrewMembers(members: Array<{ guardId: number }>) {
  return new Set(members.map((member) => member.guardId)).size === members.length;
}
