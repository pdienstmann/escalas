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
  const endDate =
    shift === "4" || (shift === "1" && end < start)
      ? tomorrow.toISOString().slice(0, 10)
      : shift === "1"
        ? date
        : date;
  // shift 1 ends same calendar morning; shift 4 crosses midnight
  const resolvedEndDate = shift === "4" ? tomorrow.toISOString().slice(0, 10) : date;
  return {
    start: `${date}T${start}`,
    end: `${shift === "4" ? resolvedEndDate : date}T${end}`,
  };
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
