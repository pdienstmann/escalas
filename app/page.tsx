import type { Metadata } from "next";
import { ManagementDashboard } from "./management-dashboard";
import { isScheduleDate, todayScheduleDate } from "../lib/schedule-date";

export const metadata: Metadata = {
  title: "Escala GMNH",
  description: "Gestão diária de efetivo, viaturas, afastamentos e horas extras.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  return <ManagementDashboard initialDate={isScheduleDate(params.date) ? params.date : todayScheduleDate()} />;
}
