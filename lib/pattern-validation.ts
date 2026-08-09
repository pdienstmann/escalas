export type PatternValue = Record<string, string | number | null>;

export type PatternIssue = {
  kind: "duplicate" | "hole" | "role" | "destination";
  resourceKey?: string;
  message: string;
};

export function patternResourceKey(slot: PatternValue) {
  if (Number(slot.vehicle_id)) return `vehicle:${slot.vehicle_id}`;
  if (Number(slot.post_id)) return `post:${slot.post_id}`;
  return "unassigned";
}

export function validatePattern(slots: PatternValue[]) {
  const issues: PatternIssue[] = [];
  const guardCount = new Map<number, number>();
  const resources = new Map<string, PatternValue[]>();

  for (const slot of slots) {
    const guardId = Number(slot.guard_id);
    guardCount.set(guardId, (guardCount.get(guardId) || 0) + 1);
    const key = patternResourceKey(slot);
    if (key === "unassigned") {
      issues.push({ kind: "destination", message: `${slot.guard_name || "GM"} está sem destino.` });
      continue;
    }
    resources.set(key, [...(resources.get(key) || []), slot]);
  }

  for (const [guardId, count] of guardCount) {
    if (count > 1) {
      const slot = slots.find((item) => Number(item.guard_id) === guardId);
      issues.push({ kind: "duplicate", message: `${slot?.guard_name || "GM"} aparece ${count} vezes no padrão.` });
    }
  }

  for (const [key, members] of resources) {
    if (!key.startsWith("vehicle:")) continue;
    const drivers = members.filter((member) => member.role === "driver").length;
    const patrols = members.filter((member) => member.role === "patrol").length;
    if (!drivers) issues.push({ kind: "hole", resourceKey: key, message: "Motorista ausente." });
    if (!patrols) issues.push({ kind: "hole", resourceKey: key, message: "Patrulheiro ausente." });
    if (drivers > 1) issues.push({ kind: "role", resourceKey: key, message: `${drivers} motoristas definidos.` });
    if (patrols > 1) issues.push({ kind: "role", resourceKey: key, message: `${patrols} patrulheiros definidos.` });
  }

  return issues;
}

export function issuesForResource(issues: PatternIssue[], resourceKey: string) {
  return issues.filter((issue) => issue.resourceKey === resourceKey);
}
