type AssignmentLike = {
  status?: unknown;
  work_kind?: unknown;
};

/**
 * A successful paste always creates another non-overlapping time block. A
 * normal/weekly block copied to a different quadrant is therefore additional
 * service and must enter the HE review queue automatically. Existing BH/swap
 * markers remain intact; explicit HE blocks stay HE.
 */
export function copiedBlockStatus(source: AssignmentLike) {
  const status = String(source.status || "normal");
  const workKind = String(source.work_kind || "shift");
  if (status === "overtime" || workKind === "overtime_extension") return "overtime" as const;
  if (status === "normal") return "overtime" as const;
  if (status === "time_bank") return "time_bank" as const;
  if (status === "swap") return "swap" as const;
  return "normal" as const;
}
