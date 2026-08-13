"use client";

import { useEffect, useState } from "react";

type Rec = Record<string, unknown>;
type Resource = Rec & { key: string; kind: string; label: string; required: number; available: number; holes: number; status: string; away?: Array<{ name: string; reason: string }>; outage?: { reason: string } | null };
type Section = Rec & { resources: Resource[] };
type Period = Rec & { code: string; expected: number; available: number; away: number; holes: number; sections: Section[] };
type Day = { date: string; weekday: number; pattern: { day: string; night: string }; source: string; status: string; day: Period; night: Period };
type PlanningData = { month: string; generatedAt: string; days: Day[]; simulation?: { active: boolean; events: Array<{ kind: string; startDate: string; endDate: string | null; category?: string; reason?: string }> }; summary: { totalExpected: number; totalAvailable: number; totalAway: number; totalHoles: number; criticalDays: number; attentionDays: number; absenceTotals: Record<string, number> } };

const weekdays = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function formatMonth(month: string) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function statusLabel(status: string) {
  return status === "critical" ? "FURO / DÉFICIT" : status === "attention" ? "ATENÇÃO" : "COBERTURA";
}

function periodText(period: Period) {
  const notes = [period.holes ? `${period.holes} furo(s)` : "", period.away ? `${period.away} impacto(s)` : ""].filter(Boolean);
  return `${period.available}/${period.expected}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
}

function attentionRows(data: PlanningData) {
  return data.days.flatMap((day) => ([['Diurno', day.day], ['Noturno', day.night]] as const).flatMap(([periodLabel, period]) => period.sections.flatMap((section) => section.resources.filter((resource) => resource.status !== "ok" || resource.holes > 0 || resource.outage).map((resource) => ({ date: day.date, periodLabel, resource })) )));
}

export function MonthlyPlanningPrint({ month, scenario }: { month: string; scenario: string }) {
  const [data, setData] = useState<PlanningData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const scenarioQuery = scenario ? `&scenario=${encodeURIComponent(scenario)}` : "";
    fetch(`/api/planning?month=${month}&detail=all${scenarioQuery}&_=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json() as PlanningData & { error?: string };
        if (!response.ok) throw new Error(value.error || "Não foi possível preparar o panorama.");
        return value;
      })
      .then((value) => setData(value))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível preparar o panorama."));
  }, [month, scenario]);

  if (error) return <main className="monthly-print-error">{error}</main>;
  if (!data) return <main className="monthly-print-loading">Preparando o panorama mensal…</main>;
  const attention = attentionRows(data);
  return <main className="monthly-print-shell">
    <div className="monthly-print-actions"><a href={`/planejamento?date=${data.days[0]?.date || `${month}-01`}`}>← Voltar ao planejamento</a><button type="button" onClick={() => window.print()}>Imprimir / salvar PDF</button></div>
    <article className="monthly-print-document">
      <header className="monthly-print-header"><div className="monthly-print-mark">GMNH</div><div><b>PREFEITURA MUNICIPAL DE NOVO HAMBURGO</b><span>SECRETARIA DE SEGURANÇA · DIRETORIA DA GUARDA MUNICIPAL</span><strong>PLANEJAMENTO MENSAL</strong></div><aside><b>{formatMonth(data.month)}</b><span>{data.simulation?.active ? "SIMULAÇÃO · NÃO PUBLICADA" : "PANORAMA OPERACIONAL"}</span></aside></header>
      {data.simulation?.active && <div className="monthly-print-warning">CENÁRIO TEMPORÁRIO — os impactos abaixo são apenas uma simulação e não alteram a escala oficial.</div>}
      <section className="monthly-print-summary"><div><b>{data.summary.totalExpected}</b><span>posições previstas</span></div><div><b>{data.summary.totalAvailable}</b><span>disponíveis sem HE</span></div><div><b>{data.summary.totalAway}</b><span>impactos de afastamento</span></div><div><b>{data.summary.totalHoles}</b><span>furos projetados</span></div><div><b>{data.summary.criticalDays}</b><span>dias críticos</span></div></section>
      <h2>Panorama diário</h2>
      <table className="monthly-print-table"><thead><tr><th>DATA</th><th>PADRÃO</th><th>DIURNO · 07h–19h</th><th>NOTURNO · 19h–07h</th><th>SITUAÇÃO</th><th>ORIGEM</th></tr></thead><tbody>{data.days.map((day) => <tr className={day.status} key={day.date}><td><b>{formatDate(day.date)}</b><small>{weekdays[day.weekday]}</small></td><td><b>{day.pattern.day}</b> · {day.pattern.night}</td><td>{periodText(day.day)}</td><td>{periodText(day.night)}</td><td><strong>{statusLabel(day.status)}</strong></td><td>{day.source}</td></tr>)}</tbody></table>
      <h2>Recursos para conferir</h2>
      {attention.length ? <table className="monthly-print-attention"><thead><tr><th>DATA</th><th>PERÍODO</th><th>POSTO / VTR / GRUPAMENTO</th><th>COBERTURA</th><th>OBSERVAÇÃO</th></tr></thead><tbody>{attention.map(({ date, periodLabel, resource }, index) => <tr key={`${date}-${periodLabel}-${resource.key}-${index}`}><td>{formatDate(date)}</td><td>{periodLabel}</td><td><b>{resource.label}</b><small>{resource.kind === "vehicle" ? "Viatura / zona" : resource.kind === "group" ? "Grupamento / equipe" : "Posto"}</small></td><td><strong>{resource.outage ? "FA" : `${resource.available}/${resource.required}`}</strong>{resource.holes ? <small>{resource.holes} furo(s)</small> : null}</td><td>{resource.outage ? String(resource.outage.reason || "Fora de operação") : resource.away?.length ? resource.away.slice(0, 3).map((item) => `${item.name} · ${item.reason}`).join("; ") : "Verificar remanejamento / composição"}</td></tr>)}</tbody></table> : <p className="monthly-print-ok">Nenhum recurso com déficit ou FA projetado no período.</p>}
      <footer>Gerado em {new Date(data.generatedAt).toLocaleString("pt-BR")} · Documento de apoio ao planejamento · A escala oficial permanece inalterada.</footer>
    </article>
  </main>;
}
