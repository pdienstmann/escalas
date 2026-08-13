import { operationalShiftWindow } from "./shift-rules.ts";

type GroupMemberLike = Record<string, unknown>;

function minutes(value: unknown) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").slice(0, 5));
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function defaultOperationalGroupStart(period: unknown) {
  return String(period) === "night" ? "19:00" : "07:00";
}

export function timeAfterHours(start: string, hours = 12) {
  const startMinutes = minutes(start);
  if (startMinutes == null) return "";
  const total = (startMinutes + hours * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function operationalGroupDurationHours(start: unknown, end: unknown) {
  const startMinutes = minutes(start), endMinutes = minutes(end);
  if (startMinutes == null || endMinutes == null) return null;
  const duration = (endMinutes - startMinutes + 24 * 60) % (24 * 60);
  return duration / 60;
}

export function operationalGroupAnchorShift(start: unknown) {
  const value = minutes(start);
  if (value == null) return null;
  if (value >= 7 * 60 && value < 13 * 60) return "2";
  if (value >= 13 * 60 && value < 19 * 60) return "3";
  if (value >= 19 * 60 || value < 1 * 60) return "4";
  return "1";
}

export function operationalGroupInterval(date: string, period: unknown, start: unknown, end: unknown) {
  const startTime = String(start || "").slice(0, 5), endTime = String(end || "").slice(0, 5);
  const startMinutes = minutes(startTime), endMinutes = minutes(endTime);
  if (startMinutes == null || endMinutes == null) return null;
  const startsNextDay = String(period) === "night" && startMinutes < 7 * 60;
  const startDate = startsNextDay ? addDays(date, 1) : date;
  const endDate = endMinutes <= startMinutes ? addDays(startDate, 1) : startDate;
  return { start: `${startDate}T${startTime}`, end: `${endDate}T${endTime}` };
}

export function operationalGroupMemberCoversShift(member: GroupMemberLike, date: string, shift: string) {
  const custom = operationalGroupInterval(date, member.pattern_period, member.starts_at, member.ends_at);
  if (custom) {
    const window = operationalShiftWindow(date, shift);
    return custom.start < window.end && custom.end > window.start;
  }
  const configuredShift = String(member.shift || "");
  if (["1", "2", "3", "4"].includes(configuredShift)) return configuredShift === shift;
  const period = String(member.pattern_period || "");
  return period !== "day" && period !== "night" || period === "day" && ["2", "3"].includes(shift) || period === "night" && ["4", "1"].includes(shift);
}
