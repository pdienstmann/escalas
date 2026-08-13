"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackToSchedule, ScheduleNav } from "./schedule-nav";
import { ModuleLoading } from "./module-loading";
import { readClientCache, writeClientCache } from "./client-cache";
import { useModuleUiState } from "./use-module-ui-state";

type Rec = Record<string, unknown>;
type Period = Rec & { code: string; expected: number; available: number; away: number; required: number; availablePositions: number; holes: number; status: string; sections: Section[]; absenceCounts?: Record<string, number> };
type Section = Rec & { key: string; label: string; required: number; available: number; holes: number; status: string; resources: Resource[] };
type Resource = Rec & { key: string; kind: string; label: string; planned: number; required: number; available: number; holes: number; status: string; away?: Array<{ name: string; reason: string }>; outage?: { reason: string; startsOn: string; endsOn: string | null } | null; teams?: Record<string, number> };
type PlanningDay = Rec & { date: string; pattern: { day: string; night: string }; source: string; status: string; day: Period; night: Period };
type CatalogGuard = { id: number; name: string; registration?: string; platoon?: string };
type CatalogVehicle = { id: number; prefix: string; zone?: string; type?: string };
type SimulationEvent = { id: string; kind: "guard" | "vehicle"; startDate: string; endDate: string | null; guardId?: number; vehicleId?: number; category?: string; reason?: string };
type PlanningData = { month: string; anchorDate: string; detailDate?: string | null; days: PlanningDay[]; catalog?: { guards: CatalogGuard[]; vehicles: CatalogVehicle[] }; simulation?: { active: boolean; events: SimulationEvent[] }; summary: Rec & { days: number; totalExpected: number; totalAvailable: number; totalAway: number; totalHoles: number; criticalDays: number; attentionDays: number; absenceTotals: Record<string, number>; overtimeNeeded: number } };
type PlanningFilter = "all" | "critical" | "attention" | "affected" | "day" | "night";

const planningCacheKey = (month: string) => `gmnh:monthly-planning:${month}`;
const planningCacheTtl = 5 * 60_000;
const monthFromDate = (date: string) => date.slice(0, 7);
const dateFromMonth = (month: string) => `${month}-01`;
const dayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function readPlanningCache(month: string) {
  const value = readClientCache<PlanningData>(planningCacheKey(month), planningCacheTtl);
  return value && value.month === month && Array.isArray(value.days) ? value : null;
}

function formatMonth(month: string) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function statusLabel(status: string) {
  return status === "critical" ? "Furo / déficit" : status === "attention" ? "Atenção" : status === "fa" ? "Em FA" : "Cobertura completa";
}

function statusIcon(status: string) {
  return status === "critical" ? "!" : status === "attention" ? "•" : status === "fa" ? "×" : "✓";
}

function absenceLabel(key: string) {
  return ({ folga: "Folgas", vacation: "Férias", course: "Cursos", medical_leave: "Atestados/licenças", technical_reserve: "Reserva técnica", time_bank: "Banco de horas", negative_full: "BH- integral", negative_late: "BH- entrada tardia", negative_early: "BH- saída antecipada", other: "Outros" } as Record<string, string>)[key] || key;
}

function simulationResourceLabel(event: SimulationEvent, data: PlanningData | null) {
  if (event.kind === "guard") return data?.catalog?.guards.find((guard) => guard.id === event.guardId)?.name || "GM não localizado";
  return data?.catalog?.vehicles.find((vehicle) => vehicle.id === event.vehicleId)?.prefix || "VTR não localizada";
}

function simulationKindLabel(event: SimulationEvent) {
  return event.kind === "guard" ? absenceLabel(event.category || "medical_leave") : "Viatura em FA";
}

export function MonthlyPlanning({ initialDate }: { initialDate: string }) {
  const [month, setMonth] = useState(monthFromDate(initialDate));
  const [data, setData] = useState<PlanningData | null>(null);
  const [baselineData, setBaselineData] = useState<PlanningData | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate.startsWith(month) ? initialDate : dateFromMonth(month));
  const [ui, setUi] = useModuleUiState("planejamento", initialDate, { filter: "all" as PlanningFilter, resourceFilter: "all" as "all" | "vehicle" | "post" | "group" });
  const filter = ui.filter;
  const resourceFilter = ui.resourceFilter;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [simulationEvents, setSimulationEvents] = useState<SimulationEvent[]>([]);
  const loadSequence = useRef(0);

  const load = useCallback(async (requestedMonth: string, requestedSimulation: SimulationEvent[] = [], requestedDetail = "") => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const simulationQuery = requestedSimulation.length ? `&scenario=${encodeURIComponent(JSON.stringify(requestedSimulation))}` : "";
      const detailQuery = requestedDetail ? `&detail=${encodeURIComponent(requestedDetail)}` : "";
      const response = await fetch(`/api/planning?month=${requestedMonth}${simulationQuery}${detailQuery}&_=${Date.now()}`, { cache: "no-store" });
      const value = await response.json() as PlanningData & { error?: string };
      if (!response.ok) throw new Error(value.error || "Não foi possível calcular o planejamento mensal.");
      if (sequence !== loadSequence.current) return;
      setData(value); setError("");
      if (!requestedSimulation.length) { setBaselineData(value); writeClientCache(planningCacheKey(requestedMonth), value); }
      setSelectedDate((current) => current.startsWith(requestedMonth) ? current : value.days[0]?.date || dateFromMonth(requestedMonth));
    } catch (reason) {
      if (sequence !== loadSequence.current) return;
      setError(reason instanceof Error ? reason.message : "Não foi possível calcular o planejamento mensal.");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const cached = readPlanningCache(month);
    // Keep a cached month visible while the fresh aggregate is requested.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(cached);
    setBaselineData(cached);
    setSimulationEvents([]);
    const detailDate = initialDate.startsWith(month) ? initialDate : dateFromMonth(month);
    setSelectedDate(detailDate);
    void load(month, [], detailDate);
  }, [initialDate, load, month]);

  const selected = data?.days.find((day) => day.date === selectedDate) || data?.days[0] || null;
  const visibleDays = useMemo(() => (data?.days || []).filter((day) => {
    if (filter === "all") return true;
    if (filter === "critical") return day.status === "critical";
    if (filter === "attention") return day.status === "attention";
    if (filter === "affected") return day.status !== "ok" || day.day.away > 0 || day.night.away > 0;
    return day[filter].status === "critical" || day[filter].holes > 0;
  }), [data, filter]);
  const priorityPeriods = useMemo(() => {
    const days = data?.days || [];
    const rank = (kind: "day" | "night") => days
      .filter((day) => Number(day[kind].holes || 0) > 0 || Number(day[kind].away || 0) > 0 || day[kind].status === "attention")
      .sort((a, b) => {
        const first = a[kind], second = b[kind];
        const firstWeight = Number(first.holes || 0) * 12 + Number(first.away || 0) * 3;
        const secondWeight = Number(second.holes || 0) * 12 + Number(second.away || 0) * 3;
        return secondWeight - firstWeight || a.date.localeCompare(b.date);
      }).slice(0, 5);
    return { day: rank("day"), night: rank("night") };
  }, [data]);
  const activeDate = selected?.date || dateFromMonth(month);
  const printHref = `/planejamento/impressao?month=${month}${simulationEvents.length ? `&scenario=${encodeURIComponent(JSON.stringify(simulationEvents))}` : ""}`;

  function selectPlanningDay(date: string) {
    setUi((current) => ({ ...current, filter: "all" }));
    setSelectedDate(date);
    if (data?.detailDate !== date) void load(month, simulationEvents, date);
    window.requestAnimationFrame(() => document.getElementById("planning-day-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (loading && !data) return <ModuleLoading area="planejamento mensal" detail="Calculando disponibilidade, afastamentos e cobertura dos recursos…" />;
  return <main className="monthly-planning-page">
    <header className="monthly-planning-top">
      <BackToSchedule date={activeDate} />
      <div><span>VISÃO DE PLANEJAMENTO</span><h1>Planejamento mensal</h1><p>Projeção do efetivo disponível sem contar hora extra.</p></div>
      <div className="monthly-planning-actions"><label>Mês<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" onClick={() => void load(month, simulationEvents, selectedDate)} disabled={loading}>{loading ? "Atualizando…" : "Atualizar"}</button><a className="monthly-planning-print-link" href={printHref} target="_blank" rel="noreferrer">PDF panorama</a></div>
    </header>
    <ScheduleNav date={activeDate} active="/planejamento" />
    {error && <section className="planning-error" role="alert"><b>{error}</b><button type="button" onClick={() => void load(month, simulationEvents, selectedDate)}>Tentar novamente</button></section>}
    {data && <>
      <section className="planning-heading"><div><small>PANORAMA DO MÊS</small><h2>{formatMonth(data.month)}</h2><p>Os dias são calculados pelos padrões D1/D2/N1/N2, escala semanal e afastamentos já lançados.</p></div><span className={`planning-source ${data.simulation?.active ? "simulation" : ""}`}>{data.simulation?.active ? "Simulação ativa · não publicada" : data.days.some((day) => day.source.includes("escala existente")) ? "Há dias com escala ajustada" : "Projeção pelo padrão"}</span></section>
      <PlanningSimulationPanel key={data.month} data={data} baseline={baselineData} events={simulationEvents} onApply={(next) => { setSimulationEvents(next); void load(month, next, selectedDate); }} onClear={() => { setSimulationEvents([]); void load(month, [], selectedDate); }} loading={loading} />
      <PlanningSummary days={data.days} summary={data.summary} baseline={data.simulation?.active ? baselineData?.summary : null} />
      {(priorityPeriods.day.length > 0 || priorityPeriods.night.length > 0) && <PlanningPriority periods={priorityPeriods} onSelect={selectPlanningDay} />}
      <section className="planning-controls" aria-label="Filtros do planejamento"><div className="planning-filter-group"><span>Mostrar</span>{([['all', "Todos"], ['critical', "Críticos"], ['attention', "Atenção"], ['affected', "Com impacto"], ['day', "Diurno"], ['night', "Noturno"]] as const).map(([key, label]) => <button type="button" className={filter === key ? "active" : ""} aria-pressed={filter === key} key={key} onClick={() => setUi((current) => ({ ...current, filter: key }))}>{label}</button>)}</div><div className="planning-legend"><span><i className="ok" /> Cobertura</span><span><i className="attention" /> Atenção</span><span><i className="critical" /> Déficit</span><span><i className="fa" /> FA</span></div></section>
      <section className="planning-calendar" aria-label={`Dias do planejamento de ${formatMonth(data.month)}`}>
        {visibleDays.map((day) => <PlanningDayCard key={day.date} day={day} selected={day.date === selected?.date} onSelect={() => selectPlanningDay(day.date)} />)}
        {!visibleDays.length && <div className="planning-empty"><b>Nenhum dia corresponde ao filtro.</b><button type="button" onClick={() => setUi((current) => ({ ...current, filter: "all" }))}>Mostrar todos</button></div>}
      </section>
      {selected && (data.detailDate === selected.date ? <PlanningDayDetail day={selected} resourceFilter={resourceFilter} setResourceFilter={(resourceFilter) => setUi((current) => ({ ...current, resourceFilter }))} /> : <section id="planning-day-detail" className="planning-detail-loading" role="status"><span className="route-transition-spinner" aria-hidden="true"/><b>Carregando os recursos de {formatDay(selected.date)}…</b><small>O panorama mensal continua disponível acima.</small></section>)}
    </>}
  </main>;
}

function PlanningSimulationPanel({ data, baseline, events, onApply, onClear, loading }: { data: PlanningData; baseline: PlanningData | null; events: SimulationEvent[]; onApply: (events: SimulationEvent[]) => void; onClear: () => void; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SimulationEvent["kind"]>("guard");
  const [guardId, setGuardId] = useState<number>(data.catalog?.guards[0]?.id || 0);
  const [vehicleId, setVehicleId] = useState<number>(data.catalog?.vehicles[0]?.id || 0);
  const [category, setCategory] = useState("medical_leave");
  const [startDate, setStartDate] = useState(data.days[0]?.date || "");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const firstDate = data.days[0]?.date || "";
  const lastDate = data.days[data.days.length - 1]?.date || firstDate;
  const guardOptions = (data.catalog?.guards || []).filter((guard) => !search || `${guard.name} ${guard.registration || ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 80);
  const vehicleOptions = (data.catalog?.vehicles || []).filter((vehicle) => !search || `${vehicle.prefix} ${vehicle.zone || ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 80);

  function addImpact() {
    const targetId = kind === "guard" ? guardId : vehicleId;
    if (!targetId || !startDate) return;
    const next: SimulationEvent = { id: `simulation-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind, startDate, endDate: endDate || null, ...(kind === "guard" ? { guardId, category } : { vehicleId }), reason: reason.trim() || "Simulação" };
    onApply([...events, next]);
    setReason("");
    setSearch("");
  }

  return <section className={`planning-simulation ${events.length ? "active" : ""}`}>
    <header className="planning-simulation-head"><div><b>Simulação rápida</b><small>Teste afastamentos e FA sem alterar a escala oficial.</small></div><div className="planning-simulation-actions"><button type="button" onClick={() => setOpen((value) => !value)}>{open ? "Fechar" : "Adicionar impacto"}</button>{events.length > 0 && <button type="button" className="quiet" onClick={onClear}>Limpar simulação</button>}</div></header>
    {events.length > 0 && <div className="planning-simulation-list">{events.map((event) => <div className="planning-simulation-chip" key={event.id}><span><b>{simulationResourceLabel(event, data)}</b><small>{simulationKindLabel(event)} · {event.startDate}{event.endDate ? ` até ${event.endDate}` : " até o fim do mês"}</small></span><button type="button" aria-label={`Remover simulação de ${simulationResourceLabel(event, data)}`} onClick={() => onApply(events.filter((item) => item.id !== event.id))}>×</button></div>)}</div>}
    {events.length > 0 && baseline && <div className="planning-simulation-comparison"><b>Comparação com o panorama atual</b><span>{baseline.summary.totalAvailable} disponíveis → <strong>{data.summary.totalAvailable}</strong></span><span>{baseline.summary.totalHoles} furos → <strong>{data.summary.totalHoles}</strong></span><span>{baseline.summary.criticalDays} dias críticos → <strong>{data.summary.criticalDays}</strong></span></div>}
    {open && <div className="planning-simulation-form"><div className="planning-simulation-type"><span>Simular</span><button type="button" className={kind === "guard" ? "active" : ""} onClick={() => { setKind("guard"); setSearch(""); }}>Afastamento de GM</button><button type="button" className={kind === "vehicle" ? "active" : ""} onClick={() => { setKind("vehicle"); setSearch(""); }}>FA de viatura</button></div><div className="planning-simulation-fields"><label>Buscar recurso<input type="search" placeholder={kind === "guard" ? "Nome ou matrícula" : "VTR ou zona"} value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>{kind === "guard" ? "GM" : "Viatura"}<select value={kind === "guard" ? guardId : vehicleId} onChange={(event) => (kind === "guard" ? setGuardId(Number(event.target.value)) : setVehicleId(Number(event.target.value)))}>{kind === "guard" ? guardOptions.map((guard) => <option key={guard.id} value={guard.id}>{guard.name}{guard.registration ? ` · ${guard.registration}` : ""}</option>) : vehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.prefix}{vehicle.zone ? ` · ${vehicle.zone}` : ""}</option>)}</select></label>{kind === "guard" && <label>Tipo<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="folga">Folga</option><option value="vacation">Férias</option><option value="course">Curso</option><option value="medical_leave">Atestado/licença</option><option value="negative_full">BH- integral</option><option value="negative_late">BH- entrada tardia</option><option value="negative_early">BH- saída antecipada</option></select></label>}<label>Início<input type="date" min={firstDate} max={lastDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Fim <small>(opcional)</small><input type="date" min={startDate || firstDate} max={lastDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label className="wide">Observação <small>(opcional)</small><input value={reason} maxLength={100} placeholder="Ex.: possível afastamento" onChange={(event) => setReason(event.target.value)} /></label></div><div className="planning-simulation-form-footer"><span>{loading ? "Recalculando o mês…" : "O cenário é temporário e não gera lançamento."}</span><button type="button" className="primary" disabled={loading || !(kind === "guard" ? guardId : vehicleId) || !startDate} onClick={addImpact}>Adicionar e recalcular</button></div></div>}
  </section>;
}

function PlanningPriority({ periods, onSelect }: { periods: { day: PlanningDay[]; night: PlanningDay[] }; onSelect: (date: string) => void }) {
  const panel = (kind: "day" | "night", label: string, detail: string) => <section className={`planning-priority-period ${kind}`}>
    <header><div><small>{kind === "day" ? "☀" : "☾"}</small><span><b>{label}</b><em>{detail}</em></span></div><strong>{periods[kind].length}</strong></header>
    <div>{periods[kind].length ? periods[kind].map((day) => {
      const period = day[kind];
      const holes = Number(period.holes || 0), away = Number(period.away || 0);
      return <button type="button" key={day.date} className={period.status} onClick={() => onSelect(day.date)}>
        <span><b>{formatDay(day.date)}</b><small>{dayNames[Number(day.weekday)]} · {kind === "day" ? day.pattern.day : day.pattern.night}</small></span>
        <strong>{holes ? `${holes} furo${holes === 1 ? "" : "s"}` : `${away} afastamento${away === 1 ? "" : "s"}`}</strong>
      </button>;
    }) : <p>Sem impacto projetado neste período.</p>}</div>
  </section>;
  return <section className="planning-priority" aria-label="Prioridades separadas por período">
    <header><div><small>ATENÇÃO OPERACIONAL</small><b>Prioridades por período</b></div><span>Furos e afastamentos não são somados entre dia e noite.</span></header>
    <div className="planning-priority-list">{panel("day", "Diurno", "2º + 3º turno")}{panel("night", "Noturno", "4º + 1º turno")}</div>
  </section>;
}

function PlanningSummary({ days, summary, baseline }: { days: PlanningDay[]; summary: PlanningData["summary"]; baseline: PlanningData["summary"] | null }) {
  const absence = Object.entries(summary.absenceTotals || {}).filter(([, value]) => Number(value) > 0);
  const stats = (kind: "day" | "night") => { const periods = days.map((day) => day[kind]); return { average: days.length ? Math.round(periods.reduce((sum, period) => sum + period.available, 0) / days.length) : 0, leaves: periods.reduce((sum, period) => sum + Number(period.absenceCounts?.folga || 0), 0), away: periods.reduce((sum, period) => sum + period.away, 0), holes: periods.reduce((sum, period) => sum + period.holes, 0), critical: periods.filter((period) => period.status === "critical").length }; };
  const day = stats("day"), night = stats("night");
  return <section className="planning-summary planning-period-summary" aria-label="Resumo mensal separado por período"><PlanningMonthPeriod label="Diurno" code="2º + 3º turno" kind="day" stats={day} /><PlanningMonthPeriod label="Noturno" code="4º + 1º turno" kind="night" stats={night} /><div className="planning-absence-pills"><small>{baseline ? "Outros impactos no mês · cenário" : "Outros impactos no mês"}</small>{absence.filter(([key]) => key !== "folga").length ? absence.filter(([key]) => key !== "folga").map(([key, value]) => <span key={key}>{absenceLabel(key)} <b>{value}</b></span>) : <span>Nenhum outro afastamento lançado</span>}</div></section>;
}

function PlanningMonthPeriod({ label, code, kind, stats }: { label: string; code: string; kind: "day" | "night"; stats: { average: number; leaves: number; away: number; holes: number; critical: number } }) {
  return <article className={`planning-month-period ${kind}`}><header><div><small>{kind === "day" ? "☀" : "☾"}</small><span><b>{label}</b><em>{code}</em></span></div><strong>{stats.average}<small> GMs/dia</small></strong></header><div><span><b>{stats.leaves}</b> folgas</span><span><b>{stats.away}</b> afastamentos</span><span className={stats.holes ? "danger" : "ok"}><b>{stats.holes}</b> furos</span><span><b>{stats.critical}</b> dias críticos</span></div></article>;
}

function PlanningDayCard({ day, selected, onSelect }: { day: PlanningDay; selected: boolean; onSelect: () => void }) {
  return <article className={`planning-day-card ${day.status} ${selected ? "selected" : ""}`}>
    <button type="button" className="planning-day-head" onClick={onSelect}><span><b>{formatDay(day.date)}</b><small>{dayNames[Number(day.weekday)]}</small></span><span className="planning-day-status"><i>{statusIcon(day.status)}</i>{statusLabel(day.status)}</span></button>
    <div className="planning-day-pattern"><span>{day.pattern.day} · {day.pattern.night}</span><small>{day.source}</small></div>
    <div className="planning-periods"><PlanningPeriodChip label="Diurno" period={day.day} /><PlanningPeriodChip label="Noturno" period={day.night} /></div>
    <a className="planning-open-day" href={`/escala?date=${day.date}`}>Abrir escala do dia →</a>
  </article>;
}

function PlanningPeriodChip({ label, period }: { label: string; period: Period }) {
  const leaves = Number(period.absenceCounts?.folga || 0);
  const away = Object.entries(period.absenceCounts || {}).filter(([key,value])=>key!=="folga"&&Number(value)>0);
  return <div className={`planning-period-chip ${period.status} ${label === "Diurno" ? "period-day" : "period-night"}`}><header><b>{label}</b><span>{period.code}</span></header><strong>{period.available}<small> GMs disponíveis</small></strong><p><b>{leaves}</b> folga{leaves === 1 ? "" : "s"}{period.holes ? ` · ${period.holes} furo${period.holes === 1 ? "" : "s"}` : ""}</p><small className="planning-absence-mini">{away.length?away.map(([key,value])=>`${absenceLabel(key)} ${value}`).join(" · "):"Sem outros afastamentos"}</small></div>;
}

function PlanningDayDetail({ day, resourceFilter, setResourceFilter }: { day: PlanningDay; resourceFilter: "all" | "vehicle" | "post" | "group"; setResourceFilter: (value: "all" | "vehicle" | "post" | "group") => void }) {
  const resourcesFor=(period:Period,periodLabel:"Diurno"|"Noturno")=>period.sections.flatMap((section)=>section.resources.map((resource)=>({...resource,periodLabel,sectionLabel:section.key}))).filter((resource,index,list)=>list.findIndex((item)=>`${item.kind}:${item.key}:${item.periodLabel}`===`${resource.kind}:${resource.key}:${resource.periodLabel}`)===index);
  const dayResources=resourcesFor(day.day,"Diurno"),nightResources=resourcesFor(day.night,"Noturno");
  const allResources = [...dayResources,...nightResources];
  const visible = resourceFilter === "all" ? allResources : allResources.filter((resource) => String(resource.kind) === resourceFilter);
  const dayVehicles=dayResources.filter(resource=>resource.kind==="vehicle"),nightVehicles=nightResources.filter(resource=>resource.kind==="vehicle");
  return <section id="planning-day-detail" className="planning-detail" tabIndex={-1}><header className="planning-detail-head"><div><small>DETALHE DO DIA</small><h2>{new Date(`${day.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</h2><p>{day.pattern.day} no diurno · {day.pattern.night} no noturno · {day.source}</p></div><a className="primary" href={`/escala?date=${day.date}`}>Abrir escala completa</a></header><div className="planning-detail-periods"><DetailPeriod label="Diurno" period={day.day} /><DetailPeriod label="Noturno" period={day.night} /></div><section className="planning-vehicle-focus"><header><small>PRIORIDADE DE COBERTURA</small><h3>Viaturas para conferir</h3><p>Guarnições e FA separadas por período operacional.</p></header><div><VehiclePeriod label="Diurno" code="2º + 3º turno" items={dayVehicles}/><VehiclePeriod label="Noturno" code="4º + 1º turno" items={nightVehicles}/></div></section><div className="planning-resource-toolbar"><span>Demais recursos para conferir</span>{([['all', "Todos"], ['vehicle', "Viaturas"], ['group', "Grupamentos"], ['post', "Postos"]] as const).map(([key, label]) => <button type="button" className={resourceFilter === key ? "active" : ""} aria-pressed={resourceFilter === key} key={key} onClick={() => setResourceFilter(key)}>{label}</button>)}</div><div className="planning-resource-list">{visible.map((resource, index) => <PlanningResource key={`${resource.key}-${resource.periodLabel}-${index}`} resource={resource} />)}{!visible.length && <p className="planning-empty">Nenhum recurso encontrado neste filtro.</p>}</div></section>;
}

function VehiclePeriod({label,code,items}:{label:"Diurno"|"Noturno";code:string;items:Array<Resource&{periodLabel?:string}>}){
  const pending=items.filter(item=>item.status!=="ok").length;
  return <section className={`planning-vehicle-period ${label==="Diurno"?"day":"night"} ${pending?"attention":"covered"}`}><header><div><b>{label}</b><small>{code}</small></div><span className={pending?"attention":"ok"}>{pending?`${pending} para conferir`:"Tudo coberto"}</span></header><div>{items.length?items.map((resource,index)=><PlanningResource key={`${resource.key}-${index}`} resource={resource}/>):<p>Nenhuma viatura prevista neste período.</p>}</div></section>
}

function DetailPeriod({ label, period }: { label: string; period: Period }) {
  return <div className={`planning-detail-period ${period.status}`}><span>{label} · {period.code}</span><b>{period.available} disponíveis</b><small>{period.required} posições necessárias · {period.holes} furos</small></div>;
}

function PlanningResource({ resource }: { resource: Resource & { periodLabel?: string } }) {
  const away = Array.isArray(resource.away) ? resource.away : [];
  return <article className={`planning-resource ${resource.status}`}><div className="planning-resource-main"><i className="planning-resource-icon">{resource.kind === "vehicle" ? "VTR" : resource.kind === "group" ? "◆" : "POSTO"}</i><div><b>{String(resource.label)}</b><small>{resource.kind === "vehicle" ? "Viatura / zona" : resource.kind === "group" ? "Grupamento / equipe" : "Posto"}{resource.outage ? ` · ${String(resource.outage.reason || "FA")}` : ""}</small></div></div><div className="planning-resource-count"><strong>{resource.outage ? "FA" : `${resource.available}/${resource.required}`}</strong><span>{resource.outage ? "fora de operação" : resource.holes ? `${resource.holes} furo${resource.holes === 1 ? "" : "s"}` : "coberto"}</span></div>{away.length > 0 && <div className="planning-resource-away">{away.slice(0, 4).map((item) => <span key={`${item.name}-${item.reason}`}>{item.name} · {item.reason}</span>)}{away.length > 4 && <span>+ {away.length - 4} outros</span>}</div>}{resource.kind === "group" && resource.teams && <div className="planning-resource-teams">{Object.entries(resource.teams).map(([team, count]) => <span key={team}>{team}: {count}</span>)}</div>}</article>;
}
