import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const BASE_URL = process.env.STRESS_BASE_URL || "https://escalas.pietrodienstmann.workers.dev";
const MONTH = process.env.STRESS_MONTH || "2031-11";
const TAG = process.env.STRESS_TAG || "STRESS-GMNH-203111";
const RACE_DATE = process.env.STRESS_RACE_DATE || "2032-01-15";
const mode = process.argv[2] || "run";
const outputDir = resolve("outputs");

function isoDay(day) {
  return `${MONTH}-${String(day).padStart(2, "0")}`;
}

function dayOfWeek(day) {
  return new Date(`${isoDay(day)}T12:00:00Z`).getUTCDay();
}

const weekdays = Array.from({ length: 18 }, (_, index) => index + 1).filter((day) => ![0, 6].includes(dayOfWeek(day)));
const weekends = Array.from({ length: 18 }, (_, index) => index + 1).filter((day) => [0, 6].includes(dayOfWeek(day)));

async function timedFetch(path, options = {}) {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const elapsedMs = performance.now() - started;
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { ok: response.ok, status: response.status, elapsedMs, body };
}

async function loadAdmin() {
  const result = await timedFetch(`/api/admin?date=${MONTH}-01&stress=${Date.now()}`);
  if (!result.ok) throw new Error(`Falha ao carregar catálogo: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return { ...result, guards: result.body.guards || [], choices: result.body.choices || [] };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.elapsedMs);
  return {
    requests: samples.length,
    successful: samples.filter((sample) => sample.ok).length,
    failed: samples.filter((sample) => !sample.ok).length,
    averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)),
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    maxMs: Math.round(Math.max(0, ...durations)),
    statuses: samples.reduce((all, sample) => ({ ...all, [sample.status]: (all[sample.status] || 0) + 1 }), {}),
  };
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function seed() {
  const catalog = await loadAdmin();
  if (catalog.choices.length) throw new Error(`O mês ${MONTH} já contém ${catalog.choices.length} folga(s). Escolha outro STRESS_MONTH para manter o teste isolado.`);
  const guards = catalog.guards.filter((guard) => guard.active !== 0).slice(0, 200);
  if (guards.length < 100) throw new Error(`Efetivo insuficiente para o teste: ${guards.length} GMs ativos.`);

  const leaveRows = guards.flatMap((guard, index) => [
    { guardId: Number(guard.id), guardName: guard.name, date: isoDay(weekdays[index % weekdays.length]), shift: String(guard.base_shift || "").toLowerCase().includes("noite") ? "night" : "day" },
    { guardId: Number(guard.id), guardName: guard.name, date: isoDay(weekends[index % weekends.length]), shift: String(guard.base_shift || "").toLowerCase().includes("noite") ? "night" : "day" },
  ]);
  const leaveImport = await timedFetch("/api/admin", {
    method: "POST",
    body: JSON.stringify({ action: "leave_import", month: MONTH, rows: leaveRows, newGuards: [] }),
  });
  if (!leaveImport.ok) throw new Error(`Importação de folgas falhou: HTTP ${leaveImport.status} ${JSON.stringify(leaveImport.body)}`);

  const movementTypes = ["vacation", "course", "medical_leave", "other_leave", "technical_reserve"];
  const movementGuards = guards.slice(0, 150);
  const movementResults = await mapLimit(movementGuards, 10, async (guard, index) => {
    const type = movementTypes[index % movementTypes.length];
    const startDay = 20 + (index % 7);
    const duration = type === "vacation" ? 3 : type === "course" ? 2 : 1;
    const endDay = Math.min(30, startDay + duration - 1);
    return timedFetch("/api/admin", {
      method: "POST",
      body: JSON.stringify({
        action: "movement",
        guardId: Number(guard.id),
        type,
        startsAt: isoDay(startDay),
        endsAt: isoDay(endDay),
        requestRef: `${TAG}-${String(index + 1).padStart(4, "0")}`,
        notes: `DADO FICTÍCIO · teste de estresse · ${type}`,
      }),
    });
  });

  return {
    catalogLoadMs: Math.round(catalog.elapsedMs),
    activeGuards: guards.length,
    leavesRequested: leaveRows.length,
    leaveImport: { status: leaveImport.status, elapsedMs: Math.round(leaveImport.elapsedMs), ...leaveImport.body },
    movementsRequested: movementResults.length,
    movements: summarize(movementResults),
    movementErrors: movementResults.filter((result) => !result.ok).slice(0, 20).map((result) => ({ status: result.status, body: result.body })),
  };
}

async function loadTest(path, concurrency, total) {
  const samples = await mapLimit(Array.from({ length: total }), concurrency, (_, index) => timedFetch(`${path}${path.includes("?") ? "&" : "?"}stress=${Date.now()}-${index}`, { headers: { accept: path.startsWith("/api/") ? "application/json" : "text/html" } }));
  return summarize(samples);
}

async function probe() {
  const scenarios = [
    ["adminApi", `/api/admin?date=${MONTH}-15`, 10, 40],
    ["planningApi", `/api/planning?month=${MONTH}`, 10, 40],
    ["dashboardPage", `/?date=${MONTH}-15`, 10, 30],
    ["planningPage", `/planejamento?month=${MONTH}`, 10, 30],
    ["leavesPage", `/folgas?date=${MONTH}-15`, 10, 30],
    ["scheduleApi", `/api/schedule?date=${MONTH}-15`, 10, 40],
  ];
  const results = {};
  for (const [name, path, concurrency, total] of scenarios) results[name] = await loadTest(path, concurrency, total);
  return results;
}

async function verify() {
  const admin = await loadAdmin();
  const planning = await timedFetch(`/api/planning?month=${MONTH}&verify=${Date.now()}`);
  const stressMovements = (admin.body.movements || []).filter((movement) => String(movement.request_ref || "").startsWith(TAG));
  return {
    adminStatus: admin.status,
    adminElapsedMs: Math.round(admin.elapsedMs),
    guards: admin.guards.length,
    leaves: admin.choices.length,
    leaveDay: admin.choices.filter((choice) => !String(choice.base_shift || "").toLowerCase().includes("noite")).length,
    leaveNight: admin.choices.filter((choice) => String(choice.base_shift || "").toLowerCase().includes("noite")).length,
    visibleStressMovements: stressMovements.length,
    movementTypes: stressMovements.reduce((all, movement) => ({ ...all, [movement.type]: (all[movement.type] || 0) + 1 }), {}),
    planningStatus: planning.status,
    planningElapsedMs: Math.round(planning.elapsedMs),
    planningDays: Array.isArray(planning.body?.days) ? planning.body.days.length : 0,
  };
}

async function race() {
  const samples = await mapLimit(Array.from({ length: 50 }), 50, (_, index) => timedFetch(`/api/schedule?date=${RACE_DATE}&race=${Date.now()}-${index}`));
  return { date: RACE_DATE, ...summarize(samples), errors: samples.filter((sample) => !sample.ok).slice(0, 10).map((sample) => ({ status: sample.status, body: sample.body })) };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const report = { tag: TAG, month: MONTH, baseUrl: BASE_URL, mode, startedAt };
  if (mode === "seed" || mode === "run") report.seed = await seed();
  if (mode === "probe" || mode === "run") report.probes = await probe();
  if (mode === "race") report.race = await race();
  if (mode === "verify" || mode === "run") report.verify = await verify();
  report.finishedAt = new Date().toISOString();
  const target = resolve(outputDir, `stress-report-${TAG.toLowerCase()}-${mode}-${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report: target, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
