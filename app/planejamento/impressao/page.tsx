import { MonthlyPlanningPrint } from "../../monthly-planning-print";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function PlanejamentoImpressao({ searchParams }: { searchParams: Promise<{ month?: string; scenario?: string }> }) {
  const params = await searchParams;
  const month = params.month && monthPattern.test(params.month) ? params.month : new Date().toISOString().slice(0, 7);
  return <MonthlyPlanningPrint month={month} scenario={params.scenario || ""} />;
}
