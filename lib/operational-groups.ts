export type OperationalResource = {
  name?: string | null;
  prefix?: string | null;
  zone?: string | null;
  group_name?: string | null;
};

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
