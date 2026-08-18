export type IntegrityRecord = Record<string, unknown>;

export type IntegrityIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  assignmentIds?: number[];
};

function interval(record: IntegrityRecord) {
  const start = Date.parse(String(record.starts_at || ""));
  const end = Date.parse(String(record.ends_at || ""));
  return { start, end };
}

/**
 * Read-only consistency audit used by tests and by the multi-date probe.
 * It deliberately checks business invariants rather than the rendered DOM.
 */
export function auditScheduleIntegrity(payload: {
  date?: string;
  guards?: IntegrityRecord[];
  assignments?: IntegrityRecord[];
}) {
  const issues: IntegrityIssue[] = [];
  const assignments = payload.assignments || [];
  const guards = new Map((payload.guards || []).map((guard) => [Number(guard.id), guard]));

  for (const assignment of assignments) {
    const id = Number(assignment.id);
    const { start, end } = interval(assignment);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      issues.push({
        level: "error",
        code: "invalid_interval",
        message: `${String(assignment.guard_name || "GM")} possui horário inválido.`,
        assignmentIds: [id],
      });
    }
    if (!assignment.post_id && !assignment.vehicle_id && String(assignment.work_kind || "shift") !== "time_bank_positive") {
      issues.push({
        level: "warning",
        code: "without_destination",
        message: `${String(assignment.guard_name || "GM")} está sem posto ou viatura.`,
        assignmentIds: [id],
      });
    }
    const guard = guards.get(Number(assignment.guard_id));
    if (guard && String(guard.work_regime || "12x36") === "weekly") {
      const kind = String(assignment.work_kind || "shift");
      if (!["weekly", "overtime_extension", "time_bank_positive"].includes(kind)) {
        issues.push({
          level: "error",
          code: "weekly_in_12x36",
          message: `${String(assignment.guard_name || guard.name || "GM semanal")} ainda possui bloco regular 12x36.`,
          assignmentIds: [id],
        });
      }
    }
  }

  const byGuard = new Map<number, IntegrityRecord[]>();
  for (const assignment of assignments) {
    const guardId = Number(assignment.guard_id);
    if (!guardId) continue;
    byGuard.set(guardId, [...(byGuard.get(guardId) || []), assignment]);
  }
  for (const rows of byGuard.values()) {
    const ordered = [...rows].sort((a, b) => interval(a).start - interval(b).start);
    for (let index = 0; index < ordered.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < ordered.length; nextIndex += 1) {
        const current = interval(ordered[index]);
        const next = interval(ordered[nextIndex]);
        if (next.start >= current.end) break;
        const sameRow = Number(ordered[index].id) === Number(ordered[nextIndex].id);
        if (sameRow) continue;
        issues.push({
          level: "error",
          code: "guard_overlap",
          message: `${String(ordered[index].guard_name || ordered[nextIndex].guard_name || "GM")} está em dois locais no mesmo horário.`,
          assignmentIds: [Number(ordered[index].id), Number(ordered[nextIndex].id)],
        });
      }
    }
  }

  return {
    date: payload.date || "",
    errors: issues.filter((issue) => issue.level === "error"),
    warnings: issues.filter((issue) => issue.level === "warning"),
    issues,
  };
}
