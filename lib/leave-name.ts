export type NamedRecord = { name?: string | null };

export function normalizeLeaveDisplayName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export function normalizeLeaveName(value: string) {
  return normalizeLeaveDisplayName(value).replace(/\s+/g, "");
}

export function preferredLeaveNameMatch<T extends NamedRecord>(input: string, records: T[]) {
  const exact = normalizeLeaveDisplayName(input);
  const exactMatch = exact.includes(" ") ? records.find((record) => normalizeLeaveDisplayName(String(record.name || "")) === exact) : undefined;
  if (exactMatch) return exactMatch;
  const compact = normalizeLeaveName(input);
  return records.filter((record) => normalizeLeaveName(String(record.name || "")) === compact).sort((left, right) => normalizeLeaveDisplayName(String(right.name || "")).split(" ").length - normalizeLeaveDisplayName(String(left.name || "")).split(" ").length || String(left.name || "").localeCompare(String(right.name || ""), "pt-BR"))[0];
}
