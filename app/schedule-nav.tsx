"use client";

import { FullPageLink as Link } from "./full-page-link";
import { withScheduleDate } from "../lib/schedule-date";

const items = [
  { href: "/", label: "Escala", exact: true },
  { href: "/padroes", label: "Padrões 12x36" },
  { href: "/movimentacoes", label: "Movimentações" },
  { href: "/horas-extras", label: "Horas extras" },
  { href: "/alteracoes", label: "Alterações diversas" },
  { href: "/folgas", label: "Folgas mensais" },
  { href: "/viaturas", label: "Viaturas" },
  { href: "/cadastros", label: "Cadastros" },
  { href: "/historico", label: "Histórico" },
] as const;

export function ScheduleNav({
  date,
  active = "/",
}: {
  date: string;
  active?: string;
}) {
  return (
    <nav className="tabs" aria-label="Módulos da escala">
      {items.map((item) => {
        const href = withScheduleDate(item.href, date);
        const isActive =
          item.exact ? active === item.href : active.startsWith(item.href);
        return isActive ? (
          <b key={item.href}>{item.label}</b>
        ) : (
          <Link key={item.href} href={href}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BackToSchedule({ date, label = "← Voltar à escala" }: { date: string; label?: string }) {
  return <Link href={withScheduleDate("/", date)}>{label}</Link>;
}
