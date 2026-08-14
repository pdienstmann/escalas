export type OperationalResource = {
  name?: string | null;
  prefix?: string | null;
  zone?: string | null;
  group_name?: string | null;
};

export type OperationalGroup = {
  id: number;
  name: string;
  short_name?: string | null;
  color?: string | null;
  sort_order: number;
  active?: number | boolean;
};

export type OperationalGroupMember = {
  id: number;
  group_id: number;
  resource_kind: "guard" | "post" | "vehicle" | string;
  resource_id: number;
  team_label?: string | null;
  group_name?: string | null;
  group_short_name?: string | null;
  group_color?: string | null;
  group_sort_order?: number;
  pattern_id?: number | null;
  vehicle_id?: number | null;
};

/** Vehicles owned by the applied group composition have one visual home. */
export function operationalGroupVehicleIds(members: OperationalGroupMember[]) {
  const ids = new Set<number>();
  for (const member of members) {
    if (String(member.resource_kind) === "vehicle" && Number(member.resource_id) > 0) {
      ids.add(Number(member.resource_id));
    }
    if (member.pattern_id != null && Number(member.vehicle_id) > 0) {
      ids.add(Number(member.vehicle_id));
    }
  }
  return ids;
}

/**
 * A daily remanejamento may put a group GM in a different vehicle than the
 * one stored in the ideal pattern.  Hide that vehicle from the conventional
 * section only when every regular occupant belongs to the applied group.
 * This keeps a shared conventional crew visible while preventing empty,
 * duplicated motorcycle rows after a group-only remanejamento.
 */
export function operationalGroupDailyVehicleIds(
  members: OperationalGroupMember[],
  assignments: Array<{ guard_id?: unknown; vehicle_id?: unknown; work_kind?: unknown }>,
) {
  const groupGuardIds = new Set(
    members
      .filter((member) => member.pattern_id != null && String(member.resource_kind) === "guard")
      .map((member) => Number(member.resource_id))
      .filter(Boolean),
  );
  const occupants = new Map<number, Set<number>>();
  for (const assignment of assignments) {
    if (assignment.vehicle_id == null || String(assignment.work_kind || "shift") === "overtime_extension") continue;
    const vehicleId = Number(assignment.vehicle_id), guardId = Number(assignment.guard_id);
    if (!vehicleId || !guardId) continue;
    const guards = occupants.get(vehicleId) || new Set<number>();
    guards.add(guardId);
    occupants.set(vehicleId, guards);
  }
  return new Set(
    [...occupants.entries()]
      .filter(([, guardIds]) => guardIds.size > 0 && [...guardIds].every((guardId) => groupGuardIds.has(guardId)))
      .map(([vehicleId]) => vehicleId),
  );
}

export const OPERATIONAL_GROUP_DEFAULTS = [
  { name: "GESCOM", short_name: "GESCOM", color: "#1769aa", sort_order: 10 },
  { name: "CANIL", short_name: "CANIL", color: "#6a1b9a", sort_order: 20 },
  { name: "ROMU", short_name: "ROMU", color: "#c62828", sort_order: 30 },
  { name: "AMBIENTAL", short_name: "AMBIENTAL", color: "#2e7d32", sort_order: 40 },
  { name: "PATRULHA RURAL", short_name: "RURAL", color: "#8d6e63", sort_order: 50 },
] as const;

export const OPERATIONAL_TEAM_OPTIONS = ["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT"] as const;

const GROUPS = [
  "GESCOM",
  "CANIL",
  "ROMU",
  "AMBIENTAL",
  "PATRULHA RURAL",
] as const;

const TEAMS = ["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT"] as const;

function normalized(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function resourceText(resource: OperationalResource) {
  return normalized([
    resource.group_name,
    resource.name,
    resource.prefix,
    resource.zone,
  ].filter(Boolean).join(" "));
}

export function operationalGroupLabel(resource: OperationalResource) {
  const text = resourceText(resource);
  return GROUPS.find((group) => text.includes(group)) || null;
}

export function operationalTeamLabel(resource: OperationalResource) {
  const text = resourceText(resource);
  return TEAMS.find((team) => new RegExp(`(?:^|[\\s/_-])${team}(?:$|[\\s/_-])`).test(text)) || null;
}

export function operationalGroupOrder(resource: OperationalResource) {
  const label = operationalGroupLabel(resource);
  return label ? GROUPS.indexOf(label) : GROUPS.length;
}

export function operationalTeamOrder(resource: OperationalResource) {
  const label = operationalTeamLabel(resource);
  return label ? TEAMS.indexOf(label) : TEAMS.length;
}
