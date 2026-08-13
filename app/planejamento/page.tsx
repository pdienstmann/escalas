import { MonthlyPlanning } from "../monthly-planning";
import { isScheduleDate, todayScheduleDate } from "../../lib/schedule-date";

export default async function Planejamento({ searchParams }: { searchParams: Promise<{ date?: string; month?: string }> }) {
  const params = await searchParams;
  const monthDate = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.month || "")) ? `${params.month}-01` : null;
  return <MonthlyPlanning initialDate={isScheduleDate(params.date) ? params.date : monthDate || todayScheduleDate()} />;
}
