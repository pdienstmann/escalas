import { formatHoursDuration } from "./shift-rules.ts";

export type SuggestionContext = {
  date: string;
  shift: string;
  postId?: number | null;
  vehicleId?: number | null;
  role?: string | null;
};

export type SuggestedGM = {
  id: number;
  name: string;
  registration: string;
  platoon: string | null;
  workRegime: string | null;
  currentHeHours: number;
  lastOvertime: string | null;
  daysSinceLastHe: number | null;
  /**
   * "opposite_day" — GM from the opposite 12x36 team of the same day/night block,
   *                  normally works the same post/vehicle and is off that day.
   * "fewest_he"    — GM with the smallest HE load this month.
   * "longest_gap" — GM with the longest interval since last HE.
   * "function_fit"— Same function (driver/patrol) usually assigned.
   */
  reasons: string[];
  rank: number;
};

function sameResource(
  guardAssignments: { post_id: number | null; vehicle_id: number | null; role: string | null }[],
  ctx: SuggestionContext,
) {
  if (ctx.postId) {
    return guardAssignments.some((a) => Number(a.post_id) === ctx.postId);
  }
  if (ctx.vehicleId) {
    const roleMatch = ctx.role ? (a: { role: string | null }) => a.role === ctx.role : () => true;
    return guardAssignments.some((a) => Number(a.vehicle_id) === ctx.vehicleId && roleMatch(a));
  }
  return false;
}

export function rankGuardSuggestions(
  guards: {
    id: number;
    name: string;
    registration: string;
    platoon: string | null;
    base_shift: string | null;
    work_regime: string | null;
  }[],
  ctx: SuggestionContext,
  options: {
    blockedGuardIds?: Set<number>;
    scheduledGuardIds?: Set<number>;
    guardHeHours?: Map<number, number>;
    guardLastHe?: Map<number, string | null>;
    guardAssignmentsByGuard?: Map<number, { post_id: number | null; vehicle_id: number | null; role: string | null }[]>;
    appliedDayCodes?: Set<string>;
    appliedNightCodes?: Set<string>;
  } = {},
): SuggestedGM[] {
  const period = ctx.shift === "2" || ctx.shift === "3" ? "day" : "night";
  const blocked = options.blockedGuardIds || new Set<number>();
  const scheduled = options.scheduledGuardIds || new Set<number>();
  const heHours = options.guardHeHours || new Map<number, number>();
  const lastHe = options.guardLastHe || new Map<number, string | null>();
  const assignmentsByGuard = options.guardAssignmentsByGuard || new Map();
  const dayCodes = options.appliedDayCodes || new Set<string>();
  const nightCodes = options.appliedNightCodes || new Set<string>();

  const eligible: SuggestedGM[] = [];
  const now = new Date(`${ctx.date}T12:00:00Z`).getTime();
  const targetRole = ctx.role || null;

  for (const g of guards) {
    if (blocked.has(g.id)) continue;
    if (scheduled.has(g.id)) continue;

    const reasons: string[] = [];
    const guardHistory = assignmentsByGuard.get(g.id) || [];

    // Prefer 12x36 GMs for fill-in HE (NOT weekly regime).
    if (g.work_regime && g.work_regime !== "12x36") continue;

    const isOffToday = (() => {
      if (period === "day") {
        // GM is "off" today if his day-team is the opposite of today's applied day pattern.
        if (g.platoon?.startsWith("D")) {
          const opposite = g.platoon === "D1" ? "D2" : "D1";
          if (dayCodes.size && !dayCodes.has(g.platoon) && dayCodes.has(opposite)) return true;
          if (dayCodes.has(g.platoon)) return false;
        }
        // Night shift workers are usually resting during the day.
        if (g.platoon?.startsWith("N") && nightCodes.has(g.platoon)) return true;
      } else {
        if (g.platoon?.startsWith("N")) {
          const opposite = g.platoon === "N1" ? "N2" : "N1";
          if (nightCodes.size && !nightCodes.has(g.platoon) && nightCodes.has(opposite)) return true;
          if (nightCodes.has(g.platoon)) return false;
        }
        if (g.platoon?.startsWith("D") && dayCodes.has(g.platoon)) return true;
      }
      return false;
    })();

    const sameSpot = sameResource(guardHistory, ctx);
    if (isOffToday && sameSpot) {
      // Strongest signal: actually off today and normally works at this resource.
      reasons.push("opposite_day");
    }
    if (isOffToday) reasons.push("off_today");

    if (targetRole) {
      const hasRole = guardHistory.some((a) => a.role === targetRole);
      if (hasRole) reasons.push("function_fit");
    }

    const currentHe = Number(heHours.get(g.id) ?? 0);
    const last = lastHe.get(g.id) || null;
    const daysSince = last
      ? Math.round((now - new Date(`${String(last).slice(0, 10)}T12:00:00Z`).getTime()) / 86400000)
      : null;

    reasons.push("fewest_he");
    if (daysSince !== null && daysSince >= 14) reasons.push("longest_gap");

    eligible.push({
      id: g.id,
      name: g.name,
      registration: g.registration,
      platoon: g.platoon,
      workRegime: g.work_regime,
      currentHeHours: currentHe,
      lastOvertime: last,
      daysSinceLastHe: daysSince,
      reasons,
      rank: 0,
    });
  }

  eligible.sort((a, b) => {
    const signal = (item: SuggestedGM, reason: string) =>
      item.reasons.includes(reason) ? 0 : 1;
    return (
      signal(a, "opposite_day") - signal(b, "opposite_day") ||
      signal(a, "off_today") - signal(b, "off_today") ||
      signal(a, "function_fit") - signal(b, "function_fit") ||
      a.currentHeHours - b.currentHeHours ||
      (b.daysSinceLastHe ?? Number.MAX_SAFE_INTEGER) -
        (a.daysSinceLastHe ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name, "pt-BR")
    );
  });
  eligible.forEach((item, index) => (item.rank = index + 1));
  return eligible.slice(0, 8);
}

export function describeReasons(reasons: string[], guard: SuggestedGM) {
  const labels: string[] = [];
  if (reasons.includes("opposite_day"))
    labels.push("Equipe do dia oposto — costuma trabalhar neste posto/viatura");
  if (reasons.includes("off_today")) labels.push("De folga nesta data (regime 12x36)");
  if (reasons.includes("function_fit")) labels.push("Compatível com a função necessária");
  if (reasons.includes("fewest_he"))
    labels.push(`Menor HE no mês (${formatHoursDuration(guard.currentHeHours)})`);
  if (reasons.includes("longest_gap") && guard.daysSinceLastHe !== null)
    labels.push(`Última HE há ${guard.daysSinceLastHe} dias`);
  return labels;
}
