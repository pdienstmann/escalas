/** Keep a requirement readable inside a dense schedule card. */
export function compactRequestReference(value: unknown, max = 28) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}\u2026` : text;
}
