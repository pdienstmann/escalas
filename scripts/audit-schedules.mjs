import { auditScheduleIntegrity } from "../lib/schedule-integrity.ts";

const baseUrl = process.env.SCHEDULE_BASE_URL || "http://127.0.0.1:3000";
const dates = process.argv.slice(2).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
if (!dates.length) {
  console.error("Uso: npm run audit:schedules -- 2026-08-12 2026-08-13");
  process.exit(2);
}

let totalErrors = 0;
for (const date of dates) {
  const response = await fetch(`${baseUrl}/api/schedule?date=${date}`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    console.error(`${date}: HTTP ${response.status}`);
    totalErrors += 1;
    continue;
  }
  const data = await response.json();
  const result = auditScheduleIntegrity({ date, guards: data.guards, assignments: data.assignments });
  totalErrors += result.errors.length;
  console.log(`${date}: ${data.assignments?.length || 0} blocos · ${result.errors.length} erros · ${result.warnings.length} avisos`);
  for (const issue of result.issues) console.log(`  ${issue.level === "error" ? "ERRO" : "AVISO"} ${issue.code}: ${issue.message}`);
}
process.exitCode = totalErrors ? 1 : 0;
