export const SHIFT_DEFS = [
  { id: "2", label: "2º TURNO", time: "07:00–13:00", period: "day" as const },
  { id: "3", label: "3º TURNO", time: "13:00–19:00", period: "day" as const },
  { id: "4", label: "4º TURNO", time: "19:00–01:00", period: "night" as const },
  { id: "1", label: "1º TURNO", time: "01:00–07:00", period: "night" as const },
];

/** When filling a hole, cover the full operational block of that period. */
export function fullPeriodShifts(shift: string): string[] {
  if (shift === "2" || shift === "3") return ["2", "3"];
  if (shift === "4" || shift === "1") return ["4", "1"];
  return [shift];
}

export function isDayShift(shift: string) {
  return shift === "2" || shift === "3";
}

export function isNightShift(shift: string) {
  return shift === "4" || shift === "1";
}

export function shiftTimes(date: string, shift: string) {
  const values: Record<string, [string, string]> = {
    "2": ["07:00", "13:00"],
    "3": ["13:00", "19:00"],
    "4": ["19:00", "01:00"],
    "1": ["01:00", "07:00"],
  };
  const tomorrow = new Date(`${date}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const [start, end] = values[shift] || ["07:00", "13:00"];
  // shift 1 ends same calendar morning; shift 4 crosses midnight
  const resolvedEndDate = shift === "4" ? tomorrow.toISOString().slice(0, 10) : date;
  return {
    start: `${date}T${start}`,
    end: `${shift === "4" ? resolvedEndDate : date}T${end}`,
  };
}

function nextDate(date: string) {
  const tomorrow = new Date(`${date}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

/** Real chronological window represented by each column of an operational date. */
export function operationalShiftWindow(date: string, shift: string) {
  const tomorrow = nextDate(date);
  const windows: Record<string, { start: string; end: string }> = {
    "2": { start: `${date}T07:00`, end: `${date}T13:00` },
    "3": { start: `${date}T13:00`, end: `${date}T19:00` },
    "4": { start: `${date}T19:00`, end: `${tomorrow}T01:00` },
    "1": { start: `${tomorrow}T01:00`, end: `${tomorrow}T07:00` },
  };
  return windows[shift] || shiftTimes(date, shift);
}

export function assignmentOverlapsShift(
  assignment: { shift?: unknown; starts_at?: unknown; ends_at?: unknown },
  date: string,
  shift: string,
) {
  if (String(assignment.shift) === shift) return true;
  const start = Date.parse(String(assignment.starts_at || ""));
  const end = Date.parse(String(assignment.ends_at || ""));
  const window = operationalShiftWindow(date, shift);
  const windowStart = Date.parse(window.start);
  const windowEnd = Date.parse(window.end);
  return [start, end, windowStart, windowEnd].every(Number.isFinite) && start < windowEnd && end > windowStart;
}

export function coveredOperationalShifts(
  assignment: { shift?: unknown; starts_at?: unknown; ends_at?: unknown },
  date: string,
) {
  return SHIFT_DEFS.filter((shift) => assignmentOverlapsShift(assignment, date, shift.id)).map((shift) => shift.id);
}

export function fullPeriodLabel(shift: string) {
  if (isDayShift(shift)) return "Turno inteiro diurno · 07:00–19:00";
  if (isNightShift(shift)) return "Turno inteiro noturno · 19:00–07:00";
  return "Turno selecionado";
}

export function fullPeriodWindow(date: string, shift: string) {
  if (isDayShift(shift)) {
    return { start: `${date}T07:00`, end: `${date}T19:00` };
  }
  if (isNightShift(shift)) {
    const tomorrow = new Date(`${date}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return {
      start: `${date}T19:00`,
      end: `${tomorrow.toISOString().slice(0, 10)}T07:00`,
    };
  }
  return shiftTimes(date, shift);
}

export function formatHoursDuration(totalHours: number) {
  if (!Number.isFinite(totalHours)) return "0h";
  const sign = totalHours < 0 ? "-" : "";
  const abs = Math.abs(totalHours);
  const hours = Math.floor(abs + 1e-9);
  const minutes = Math.round((abs - hours) * 60);
  if (minutes === 0) return `${sign}${hours}h`;
  if (minutes === 60) return `${sign}${hours + 1}h`;
  return `${sign}${hours}h${String(minutes).padStart(2, "0")}`;
}

export function splitExtensionWindow(
  regularStart: string,
  regularEnd: string,
  extensionStart: string,
  extensionEnd: string,
) {
  const values = [regularStart, regularEnd, extensionStart, extensionEnd].map(Date.parse);
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (values[1] <= values[0] || values[3] <= values[2] || values[2] < values[1]) return null;
  return {
    regular: { start: regularStart, end: regularEnd },
    extension: { start: extensionStart, end: extensionEnd },
  };
}
