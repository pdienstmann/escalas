"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { readClientCache, writeClientCache } from "./client-cache";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { ScheduleNav } from "./schedule-nav";

type Period = {
  code: string;
  expected: number;
  available: number;
  away: number;
  holes: number;
  status: string;
  absenceCounts?: Record<string, number>;
  sections: Array<{ resources: Array<{ key: string; status: string }> }>;
};
type PlanningDay = {
  date: string;
  weekday: number;
  pattern: { day: string; night: string };
  source: string;
  status: string;
  day: Period;
  night: Period;
};
type PlanningData = {
  month: string;
  generatedAt: string;
  days: PlanningDay[];
  summary: {
    totalExpected: number;
    totalAvailable: number;
    totalAway: number;
    totalHoles: number;
    criticalDays: number;
    attentionDays: number;
    absenceTotals: Record<string, number>;
  };
};
type Notice = {
  id: number;
  effective_date: string;
  title: string;
  details?: string | null;
  status: "pending" | "acknowledged";
};

const planningCacheTtl = 5 * 60_000;
const dashboardCacheTtl = 2 * 60_000;
const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatMonth(month: string) {
  const label = new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatLongDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

function folgas(period: Period) {
  return Number(period.absenceCounts?.folga || 0);
}

type PeriodPriority = {
  day: PlanningDay;
  period: Period;
  leaves: number;
  aboveAverage: boolean;
};

function periodPriorities(days: PlanningDay[], kind: "day" | "night") {
  const averageLeaves = days.length
    ? days.reduce((sum, item) => sum + folgas(item[kind]), 0) / days.length
    : 0;
  return days
    .map((day): PeriodPriority => {
      const period = day[kind];
      const leaves = folgas(period);
      return { day, period, leaves, aboveAverage: leaves > averageLeaves && leaves > 0 };
    })
    .filter((item) => item.period.holes > 0 || item.aboveAverage || item.period.status !== "ok")
    .sort((left, right) =>
      right.period.holes - left.period.holes ||
      right.leaves - left.leaves ||
      left.day.date.localeCompare(right.day.date),
    )
    .slice(0, 6);
}

function dashboardKey(month: string) {
  return `gmnh:management-dashboard:${month}`;
}

function planningKey(month: string) {
  return `gmnh:monthly-planning:${month}`;
}

function readDashboardCache(month: string) {
  const value = readClientCache<{ planning: PlanningData; notices: Notice[] }>(dashboardKey(month), dashboardCacheTtl);
  if (value?.planning?.month === month && Array.isArray(value.planning.days)) return value;
  const planning = readClientCache<PlanningData>(planningKey(month), planningCacheTtl);
  return planning?.month === month ? { planning, notices: [] } : null;
}

export function ManagementDashboard({ initialDate }: { initialDate: string }) {
  const initialMonth = initialDate.slice(0, 7);
  const [month, setMonth] = useState(initialMonth);
  const [planning, setPlanning] = useState<PlanningData | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (requestedMonth: string, quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const stamp = Date.now();
      const [planningResponse, noticesResponse] = await Promise.all([
        fetch(`/api/planning?month=${requestedMonth}&_=${stamp}`, { cache: "no-store" }),
        fetch(`/api/notices?month=${requestedMonth}&_=${stamp}`, { cache: "no-store" }),
      ]);
      const nextPlanning = await planningResponse.json() as PlanningData & { error?: string };
      const noticePayload = await noticesResponse.json() as { items?: Notice[]; error?: string };
      if (!planningResponse.ok) throw new Error(nextPlanning.error || "Não foi possível montar o panorama mensal.");
      if (!noticesResponse.ok) throw new Error(noticePayload.error || "Não foi possível carregar as observações do mês.");
      const nextNotices = noticePayload.items || [];
      setPlanning(nextPlanning);
      setNotices(nextNotices);
      setError("");
      setSelectedDate((current) => current.startsWith(requestedMonth) ? current : nextPlanning.days[0]?.date || `${requestedMonth}-01`);
      writeClientCache(planningKey(requestedMonth), nextPlanning);
      writeClientCache(dashboardKey(requestedMonth), { planning: nextPlanning, notices: nextNotices });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o Dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const monthCache = readDashboardCache(month);
    // Mantém o mês em cache visível enquanto os números são atualizados.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlanning(monthCache?.planning || null);
    setNotices(monthCache?.notices || []);
    void load(month, Boolean(monthCache));
  }, [load, month]);

  const noticesByDate = useMemo(() => {
    const map = new Map<string, Notice[]>();
    for (const notice of notices) map.set(notice.effective_date, [...(map.get(notice.effective_date) || []), notice]);
    return map;
  }, [notices]);
  const selected = planning?.days.find((day) => day.date === selectedDate) || planning?.days[0] || null;
  const selectedNotices = selected ? noticesByDate.get(selected.date) || [] : [];
  const metrics = useMemo(() => {
    const days = planning?.days || [];
    const totalFolgasDay = days.reduce((sum, day) => sum + folgas(day.day), 0);
    const totalFolgasNight = days.reduce((sum, day) => sum + folgas(day.night), 0);
    const averageAvailableDay = days.length ? Math.round(days.reduce((sum, day) => sum + day.day.available, 0) / days.length) : 0;
    const averageAvailableNight = days.length ? Math.round(days.reduce((sum, day) => sum + day.night.available, 0) / days.length) : 0;
    const holesDay = days.reduce((sum, day) => sum + day.day.holes, 0);
    const holesNight = days.reduce((sum, day) => sum + day.night.holes, 0);
    const daysWithNotes = new Set(notices.map((notice) => notice.effective_date)).size;
    return { totalFolgasDay, totalFolgasNight, totalFolgas: totalFolgasDay + totalFolgasNight, averageAvailableDay, averageAvailableNight, holesDay, holesNight, daysWithNotes };
  }, [notices, planning]);
  const priorities = useMemo(() => {
    const days = planning?.days || [];
    return { day: periodPriorities(days, "day"), night: periodPriorities(days, "night") };
  }, [planning]);

  async function noticeAction(body: Record<string, unknown>) {
    if (saving) return false;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/notices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a observação.");
      setMessage(payload.message || "Observação salva.");
      await load(month, true);
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível salvar a observação.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (await noticeAction({ action: "create", effectiveDate: selected.date, title: values.title, details: values.details })) form.reset();
  }

  if (loading && !planning) return <ModuleLoading area="Dashboard de gestão" detail="Calculando efetivo, folgas e alertas do mês…" />;

  return <main className="management-home">
    <header className="management-home-top">
      <div className="management-home-brand"><span aria-hidden="true">GM</span><div><small>GUARDA MUNICIPAL DE NOVO HAMBURGO</small><h1>Dashboard de gestão</h1><p>Panorama mensal do efetivo e das escalas operacionais.</p></div></div>
      <div className="management-home-controls"><label>Mês<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" onClick={() => void load(month, true)} disabled={refreshing}>{refreshing ? "Atualizando…" : "Atualizar dados"}</button><Link className="dashboard-open-scale" href={`/escala?date=${selected?.date || initialDate}`}>Abrir escala</Link></div>
    </header>
    <ScheduleNav date={selected?.date || initialDate} active="/" />
    {error && <section className="dashboard-error" role="alert"><b>{error}</b><button type="button" onClick={() => void load(month)}>Tentar novamente</button></section>}
    {planning && <div className="management-home-content">
      <section className="dashboard-intro"><div><small>VISÃO DO MÊS</small><h2>{formatMonth(planning.month)}</h2><p>Efetivo disponível sem hora extra, afastamentos confirmados e cobertura projetada.</p></div><span className="dashboard-updated">{refreshing ? "Sincronizando…" : `Atualizado às ${new Date(planning.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}</span></section>
      <section className="dashboard-period-overview" aria-label="Efetivo mensal separado por período">
        <DashboardPeriodOverview kind="day" label="Diurno" schedule="2º + 3º turno" average={metrics.averageAvailableDay} leaves={metrics.totalFolgasDay} holes={metrics.holesDay} />
        <DashboardPeriodOverview kind="night" label="Noturno" schedule="4º + 1º turno" average={metrics.averageAvailableNight} leaves={metrics.totalFolgasNight} holes={metrics.holesNight} />
        <article className="dashboard-month-alert"><small>ATENÇÃO DO MÊS</small><strong>{planning.summary.criticalDays}</strong><span>dias críticos</span><p>{metrics.daysWithNotes} dias possuem observações</p></article>
      </section>
      <section className="dashboard-main-grid">
        <div className="dashboard-calendar-panel">
          <header><div><small>ESCALAS DO MÊS</small><h3>Efetivo por dia</h3></div><div className="dashboard-legend"><span><i className="ok" />Regular</span><span><i className="attention" />Atenção</span><span><i className="critical" />Crítico</span></div></header>
          <div className="dashboard-calendar-weekdays">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="dashboard-calendar">
            {Array.from({ length: planning.days[0]?.weekday || 0 }, (_, index) => <span className="dashboard-calendar-empty" key={`empty-${index}`} />)}
            {planning.days.map((day) => <DashboardDay key={day.date} day={day} selected={selected?.date === day.date} noteCount={(noticesByDate.get(day.date) || []).length} onSelect={() => setSelectedDate(day.date)} />)}
          </div>
        </div>
        <aside className="dashboard-day-panel">
          {selected && <>
            <header><div><small>DIA SELECIONADO</small><h3>{formatLongDate(selected.date)}</h3><p>{selected.pattern.day} diurno · {selected.pattern.night} noturno</p></div><Link href={`/escala?date=${selected.date}`}>Abrir escala →</Link></header>
            <div className="dashboard-selected-periods"><PeriodSummary label="Diurno" period={selected.day} /><PeriodSummary label="Noturno" period={selected.night} /></div>
            <section className="dashboard-notes"><header><div><small>OBSERVAÇÕES DO DIA</small><b>{selectedNotices.length ? `${selectedNotices.length} registro${selectedNotices.length === 1 ? "" : "s"}` : "Sem observações"}</b></div><Link href={`/alteracoes?date=${selected.date}`}>Ver todas</Link></header>
              <div className="dashboard-note-list">{selectedNotices.map((notice) => <article className={notice.status} key={notice.id}><div><b>{notice.title}</b>{notice.details && <p>{notice.details}</p>}</div><button type="button" disabled={saving} title="Excluir observação" aria-label={`Excluir ${notice.title}`} onClick={() => window.confirm("Excluir esta observação?") && void noticeAction({ action: "delete", id: notice.id })}>×</button></article>)}</div>
              <form className="dashboard-note-form" onSubmit={createNotice}><label>Título<input name="title" required maxLength={100} placeholder="Ex.: Reforçar efetivo do evento" /></label><label>Detalhes<textarea name="details" rows={3} placeholder="Orientação ou informação relevante para este dia" /></label><button className="primary" disabled={saving}>{saving ? "Salvando…" : "+ Adicionar observação"}</button>{message && <p role="status">{message}</p>}</form>
            </section>
          </>}
        </aside>
      </section>
      <section className="dashboard-bottom-grid">
        <div className="dashboard-alerts"><header><div><small>PRIORIDADES</small><h3>Furos projetados por período</h3></div><Link href={`/planejamento?date=${selected?.date || initialDate}`}>Planejamento completo</Link></header><div className="dashboard-priority-columns"><PriorityPeriod kind="day" label="Diurno" items={priorities.day} onSelect={setSelectedDate} /><PriorityPeriod kind="night" label="Noturno" items={priorities.night} onSelect={setSelectedDate} /></div></div>
        <div className="dashboard-shortcuts"><header><small>ACESSO RÁPIDO</small><h3>Rotinas da gestão</h3></header><div><Link href={`/folgas?date=${selected?.date || initialDate}`}><span>F</span><b>Folgas mensais</b><small>Importar e revisar solicitações</small></Link><Link href={`/movimentacoes?date=${selected?.date || initialDate}`}><span>P</span><b>Pendências</b><small>Férias, cursos e afastamentos</small></Link><Link href={`/horas-extras?date=${selected?.date || initialDate}`}><span>HE</span><b>Horas extras</b><small>Lançamentos e distribuição</small></Link><Link href={`/viaturas?date=${selected?.date || initialDate}`}><span>V</span><b>Viaturas</b><small>Disponíveis e em FA</small></Link></div></div>
      </section>
    </div>}
  </main>;
}

function PriorityPeriod({ kind, label, items, onSelect }: { kind: "day" | "night"; label: string; items: PeriodPriority[]; onSelect: (date: string) => void }) {
  return <section className={`dashboard-priority-period ${kind}`}><header><div><span aria-hidden="true">{kind === "day" ? "☀" : "☾"}</span><b>{label}</b></div><small>{kind === "day" ? "2º + 3º turno" : "4º + 1º turno"}</small></header>{items.length ? <div>{items.map(({ day, period, leaves, aboveAverage }) => <button type="button" key={`${kind}-${day.date}`} onClick={() => onSelect(day.date)}><time><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</b><small>{weekDays[day.weekday]}</small></time><span><b>{period.holes ? `${period.holes} furo${period.holes === 1 ? "" : "s"} projetado${period.holes === 1 ? "" : "s"}` : "Atenção ao efetivo"}</b><small>{leaves} folga{leaves === 1 ? "" : "s"}{aboveAverage ? " · acima da média" : ""}</small></span><em className={period.status}>{period.status === "critical" ? "Crítico" : "Atenção"}</em></button>)}</div> : <p className="dashboard-all-clear">Sem prioridades neste período.</p>}</section>;
}

function DashboardPeriodOverview({ kind, label, schedule, average, leaves, holes }: { kind: "day" | "night"; label: string; schedule: string; average: number; leaves: number; holes: number }) {
  return <article className={`dashboard-period-overview-card ${kind}`}><header><div><small>{kind === "day" ? "☀" : "☾"}</small><span><b>{label}</b><em>{schedule}</em></span></div><strong>{average}<small> GMs/dia</small></strong></header><footer><span><b>{leaves}</b> folgas com impacto</span><span className={holes ? "danger" : "ok"}><b>{holes}</b> furos projetados</span></footer></article>;
}

function DashboardDay({ day, selected, noteCount, onSelect }: { day: PlanningDay; selected: boolean; noteCount: number; onSelect: () => void }) {
  const dayFolgas = folgas(day.day), nightFolgas = folgas(day.night);
  return <button type="button" className={`dashboard-day ${day.status} ${selected ? "selected" : ""}`} onClick={onSelect} aria-pressed={selected} aria-label={`${formatLongDate(day.date)}: diurno ${day.day.available} GMs, noturno ${day.night.available} GMs`}><header><b>{Number(day.date.slice(-2))}</b><span>{weekDays[day.weekday]} · {day.pattern.day}/{day.pattern.night}</span></header><div className="dashboard-day-period day"><span><b>D</b> Diurno</span><strong>{day.day.available}<small> GMs</small></strong><em>{dayFolgas} folga{dayFolgas === 1 ? "" : "s"}{day.day.holes ? ` · ${day.day.holes} furos` : ""}</em></div><div className="dashboard-day-period night"><span><b>N</b> Noturno</span><strong>{day.night.available}<small> GMs</small></strong><em>{nightFolgas} folga{nightFolgas === 1 ? "" : "s"}{day.night.holes ? ` · ${day.night.holes} furos` : ""}</em></div>{noteCount > 0 && <i title={`${noteCount} observação(ões)`}>{noteCount}</i>}</button>;
}

function PeriodSummary({ label, period }: { label: string; period: Period }) {
  return <article className={`${period.status} ${label === "Diurno" ? "period-day" : "period-night"}`}><header><b>{label}</b><span>{period.code}</span></header><strong>{period.available}<small> GMs disponíveis</small></strong><p><b>{folgas(period)}</b> folga{folgas(period) === 1 ? "" : "s"} · {period.away} afastado{period.away === 1 ? "" : "s"}</p>{period.holes > 0 && <em>{period.holes} furo{period.holes === 1 ? "" : "s"}</em>}</article>;
}
