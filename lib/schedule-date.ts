const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STORAGE_KEY = "escala-gmnh-last-date";

export function isScheduleDate(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function todayScheduleDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function readStoredScheduleDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isScheduleDate(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeScheduleDate(date: string) {
  if (!isScheduleDate(date) || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, date);
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveScheduleDate(
  preferred?: string | null,
  fallback = todayScheduleDate(),
): string {
  if (isScheduleDate(preferred)) return preferred;
  const stored = readStoredScheduleDate();
  if (stored) return stored;
  return isScheduleDate(fallback) ? fallback : todayScheduleDate();
}

export function readScheduleDateFromSearch(
  search = typeof window !== "undefined" ? window.location.search : "",
): string | null {
  const value = new URLSearchParams(search).get("date");
  return isScheduleDate(value) ? value : null;
}

export function withScheduleDate(href: string, date: string): string {
  if (!isScheduleDate(date)) return href;
  try {
    const url = new URL(href, "http://local.invalid");
    url.searchParams.set("date", date);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const join = href.includes("?") ? "&" : "?";
    return `${href}${join}date=${date}`;
  }
}

export function formatScheduleDate(date: string): string {
  if (!isScheduleDate(date)) return date;
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR");
}
