"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatHoursDuration } from "../lib/shift-rules";
import { ModuleLoading } from "./module-loading";
import { BackToSchedule } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";

type Rec = Record<string, string | number | null>;
type Data = { month: string; ranking: Rec[]; entries: Rec[]; suggestions: Rec[]; closure: Rec };
const overtimeCacheKey = (month: string) => `gmnh:overtime:${month}`;
function readOvertimeCache(month: string): Data | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(overtimeCacheKey(month));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: Data };
    return Date.now() - parsed.savedAt < 10 * 60_000 ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeOvertimeCache(data: Data) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(overtimeCacheKey(data.month), JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Cache is optional; the database remains the source of truth.
  }
}
function guardPatternCodes(guard: Rec) {
  const codes = String(guard.pattern_codes || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => ["D1", "D2", "N1", "N2"].includes(code));
  if (codes.length) return [...new Set(codes)];
  const fallback = String(guard.platoon || "").trim().toUpperCase();
  return ["D1", "D2", "N1", "N2"].includes(fallback) ? [fallback] : [];
}

export function OvertimeDashboard() {
  const { date } = useScheduleDate();
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const month = selectedMonth ?? date.slice(0, 7);
  const [data, setData] = useState<Data | null>(() => readOvertimeCache(date.slice(0, 7)));
  const [query, setQuery] = useState("");
  const [eligibility, setEligibility] = useState<"all" | "eligible" | "blocked">("all");
  const [teamFilter, setTeamFilter] = useState<"all" | "D1" | "D2" | "N1" | "N2" | "other">("all");
  const [rankingSort, setRankingSort] = useState<"priority" | "hours_desc" | "hours_asc" | "last_recent" | "last_oldest" | "name">("priority");
  const [guardEditing, setGuardEditing] = useState<Rec | null>(null);
  const [entryEditing, setEntryEditing] = useState<Rec | null>(null);
  const [manualOpen, setManualOpen] = useState<Rec | "blank" | null>(null);
  const [balanceEditing,setBalanceEditing]=useState<Rec|null>(null);
  const [closureDialog, setClosureDialog] = useState<"close" | "reopen" | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [hoursBand, setHoursBand] = useState<"all" | "zero" | "under12" | "over12">("all");

  const load = useCallback(async (background = false) => {
    const cached = readOvertimeCache(month);
    if (cached && !background) setData(cached);
    if (background) setSyncing(true);
    else setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/overtime?month=${month}&_=${Date.now()}`, {
        cache: "no-store",
      });
      const next = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(String(next.error || "Nao foi possivel carregar o livro de HE."));
      setData(next);
      writeOvertimeCache(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nao foi possivel carregar o livro de HE.");
      if (background) setMessage("A alteração foi salva, mas a lista ainda não foi sincronizada. Tente atualizar novamente.");
    } finally {
      if (background) setSyncing(false);
      else setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ranking = useMemo(() => {
    const value = query.toLowerCase().trim();
    const rows=(data?.ranking || []).filter((guard) => {
      const enabled = Number(guard.overtime_eligible) !== 0;
      if (eligibility === "eligible" && !enabled) return false;
      if (eligibility === "blocked" && enabled) return false;
      const patterns=guardPatternCodes(guard);
      if(teamFilter!=="all"&&teamFilter!=="other"&&!patterns.includes(teamFilter))return false;
      if(teamFilter==="other"&&patterns.length)return false;
      const hours = Number(guard.currentHours || 0);
      if (hoursBand === "zero" && hours !== 0) return false;
      if (hoursBand === "under12" && (hours === 0 || hours >= 12)) return false;
      if (hoursBand === "over12" && hours < 12) return false;
      return !value || `${guard.name} ${guard.registration} ${guard.platoon || ""} ${guard.pattern_codes || ""} ${guard.overtime_note || ""}`.toLowerCase().includes(value);
    });
    const dateValue=(guard:Rec)=>guard.lastOvertime?new Date(String(guard.lastOvertime).replace(" ","T")).getTime():0;
    if(rankingSort==="hours_desc")rows.sort((a,b)=>Number(b.currentHours)-Number(a.currentHours)||String(a.name).localeCompare(String(b.name),"pt-BR"));
    if(rankingSort==="hours_asc")rows.sort((a,b)=>Number(a.currentHours)-Number(b.currentHours)||String(a.name).localeCompare(String(b.name),"pt-BR"));
    if(rankingSort==="last_recent")rows.sort((a,b)=>dateValue(b)-dateValue(a));
    if(rankingSort==="last_oldest")rows.sort((a,b)=>dateValue(a)-dateValue(b));
    if(rankingSort==="name")rows.sort((a,b)=>String(a.name).localeCompare(String(b.name),"pt-BR"));
    return rows;
  }, [data, eligibility, hoursBand, query, rankingSort, teamFilter]);
  if (!data && loading)
    return <ModuleLoading area="horas extras" detail="Carregando livro mensal…" />;
  if (!data && loadError)
    return <main className="overtime-page manual-he-page"><section className="he-load-error" role="alert"><b>Nao foi possivel carregar o livro de horas extras.</b><span>{loadError}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></section></main>;
  if (!data) return <ModuleLoading area="horas extras" detail="Carregando livro mensal…" />;

  const eligible = data.ranking.filter((guard) => Number(guard.overtime_eligible) !== 0);
  const entries = data.entries;
  const total = eligible.reduce((sum, guard) => sum + Number(guard.currentHours), 0);
  const average = eligible.length ? total / eligible.length : 0;
  const maximum = Math.max(0, ...eligible.map((guard) => Number(guard.currentHours)));
  const minimum = eligible.length ? Math.min(...eligible.map((guard) => Number(guard.currentHours))) : 0;
  const pendingCount = data.suggestions.length;
  const monthMatches = data.month === month;
  const monthClosed = monthMatches && data.closure?.status === "closed";
  const missingRequestCount = entries.filter((entry) => !String(entry.request_ref || "").trim()).length;
  const adjustmentCount = entries.filter((entry) => entry.source === "adjustment").length;
  const unusualDurationCount = entries.filter((entry) => Math.abs(Number(entry.confirmed_minutes || 0)) > 12 * 60).length;
  const blockedCount = data.ranking.filter((guard) => Number(guard.overtime_eligible) === 0).length;
  const patternCounts = (["D1", "D2", "N1", "N2"] as const).map((code) => ({ code, count: data.ranking.filter((guard) => guardPatternCodes(guard).includes(code)).length }));
  const otherPatternCount = data.ranking.filter((guard) => guardPatternCodes(guard).length === 0).length;
  const isRefreshing = loading || syncing || !monthMatches;

  async function postAction(body: Record<string, unknown>) {
    if (saving) return false;
    setSaving(true);
    try {
      const response = await fetch("/api/overtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (response.ok) await load(true);
      return response.ok;
    } finally {
      setSaving(false);
    }
  }

  async function dismissSuggestion(item: Rec) {
    if (monthClosed || isRefreshing || saving) return;
    const guardName = String(item.guard_name || "este GM");
    const serviceDate = String(item.service_date || "").split("-").reverse().join("/");
    if (!window.confirm(`Dispensar a sugestão de HE de ${guardName} em ${serviceDate}?`)) return;
    await postAction({
      action: "suggestion_dismiss",
      assignmentId: Number(item.assignment_id),
      notes: "Sugestão dispensada no controle de HE.",
    });
  }

  async function saveGuardSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guardEditing) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (await postAction({ action: "guard_settings", guardId: guardEditing.id, eligible: form.eligible === "on", note: form.note }))
      setGuardEditing(null);
  }
  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entryEditing) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (await postAction({ ...form, action: "entry_review", id: entryEditing.id }))
      setEntryEditing(null);
  }
  async function createManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await postAction({ ...Object.fromEntries(new FormData(form)), action: "manual_create" })) {
      form.reset();
      setManualOpen(null);
    }
  }
  async function saveBalance(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!balanceEditing)return;
    const values=Object.fromEntries(new FormData(event.currentTarget));
    if(await postAction({...values,action:"balance_set",guardId:balanceEditing.id,month}))setBalanceEditing(null);
  }
  async function changeMonthStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!closureDialog) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const action = closureDialog === "close" ? "month_close" : "month_reopen";
    if (await postAction({ action, month, ...values })) setClosureDialog(null);
  }

  function exportCsv() {
    const rows = [
      ["Matrícula", "GM", "Pelotão", "HE confirmada", "HE pendente", "Mês anterior", "Realiza HE", "Aviso"],
      ...data.ranking.map((guard) => [guard.registration, guard.name, guard.platoon, guard.currentHours, guard.pendingHours, guard.previousHours, Number(guard.overtime_eligible) !== 0 ? "Sim" : "Não", guard.overtime_note || ""]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = `horas-extras-${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <main className="overtime-page manual-he-page" aria-busy={isRefreshing}>
    <header><BackToSchedule date={date}/><div><span>CONTROLE MANUAL E DISTRIBUIÇÃO</span><h1>Horas extras</h1><p>O saldo só muda quando a equipe responsável registra ou ajusta as horas.</p></div><span className={`he-month-state ${monthClosed?"closed":"open"}`}>{monthClosed?"Mês fechado":"Mês aberto"}</span>{isRefreshing&&<span className="he-refreshing" role="status">Atualizando {month}…</span>}<label>Mês<input type="month" value={month} onChange={(event)=>setSelectedMonth(event.target.value)}/></label><button disabled={monthClosed||isRefreshing} title={monthClosed?"Reabra o mês para lançar horas extras":""} onClick={()=>setManualOpen("blank")}>+ Lançar HE</button><button disabled={isRefreshing} onClick={()=>setClosureDialog(monthClosed?"reopen":"close")}>{monthClosed?"Reabrir mês":"Fechar mês"}</button><button disabled={isRefreshing} onClick={exportCsv}>Exportar CSV</button></header>
    {isRefreshing&&<div className="he-refresh-banner" role="status">Aguarde: carregando os dados de {month}. As ações ficam bloqueadas até a atualização terminar.</div>}
    {message&&<p className="he-message" role="status">{message}</p>}
    {monthClosed&&<section className="he-closed-banner" role="status"><b>Livro mensal fechado</b><span>Os totais estão protegidos contra alterações. Reabra com justificativa se precisar corrigir.</span>{data.closure.closed_at&&<small>Fechado em {new Date(String(data.closure.closed_at).replace(" ","T")+"Z").toLocaleString("pt-BR")}{data.closure.closure_note?` · ${data.closure.closure_note}`:""}</small>}</section>}
    {(pendingCount||missingRequestCount||unusualDurationCount||adjustmentCount)&&<section className="he-alerts" aria-label="Atenção operacional"><div className="he-alert-head"><div><b>Atenção operacional</b><span>Confira os itens antes de fechar o livro mensal.</span></div><strong>{pendingCount+missingRequestCount+unusualDurationCount+adjustmentCount}</strong></div><div className="he-alert-grid">{pendingCount>0&&<button type="button" className="he-alert-card pending" onClick={()=>document.getElementById("he-suggestions")?.scrollIntoView({behavior:"smooth",block:"start"})}><strong>{pendingCount}</strong><span>previsões da escala aguardando conferência</span></button>}{missingRequestCount>0&&<button type="button" className="he-alert-card request" onClick={()=>document.getElementById("he-history")?.scrollIntoView({behavior:"smooth",block:"start"})}><strong>{missingRequestCount}</strong><span>lançamentos sem requerimento</span></button>}{unusualDurationCount>0&&<button type="button" className="he-alert-card duration" onClick={()=>document.getElementById("he-history")?.scrollIntoView({behavior:"smooth",block:"start"})}><strong>{unusualDurationCount}</strong><span>lançamentos acima de 12h para verificar</span></button>}{adjustmentCount>0&&<button type="button" className="he-alert-card adjustment" onClick={()=>document.getElementById("he-history")?.scrollIntoView({behavior:"smooth",block:"start"})}><strong>{adjustmentCount}</strong><span>ajustes manuais auditáveis</span></button>}</div></section>}
    <section className="he-pattern-summary" aria-label="Resumo por padrão 12x36"><div><b>Padrão cadastrado</b><span>Os filtros usam os padrões D1, D2, N1 e N2 do cadastro 12x36.</span></div><div className="he-pattern-buttons">{patternCounts.map((item)=><button type="button" key={item.code} className={teamFilter===item.code?"active":""} onClick={()=>setTeamFilter(teamFilter===item.code?"all":item.code)}><b>{item.code}</b><span>{item.count} GMs</span></button>)}<button type="button" className={teamFilter==="other"?"active":""} onClick={()=>setTeamFilter(teamFilter==="other"?"all":"other")}><b>OUTROS</b><span>{otherPatternCount} GMs</span></button></div></section>
    <section className="he-stats"><article><b>{formatHoursDuration(total)}</b><span>Total lançado no mês</span></article><article><b>{entries.length}</b><span>Lançamentos registrados</span></article><article><b>{formatHoursDuration(average)}</b><span>Média por GM elegível</span></article><article><b>{formatHoursDuration(maximum-minimum)}</b><span>Diferença maior/menor</span></article><article><b>{blockedCount}</b><span>GMs sem participação</span></article></section>
    {data.suggestions.length>0&&<section id="he-suggestions" className="he-panel he-suggestions"><div className="he-head"><div><h2>Sugestões encontradas na escala</h2><p>Não alteram o saldo. Use “Lançar” somente quando souber que a HE foi realizada.</p></div><span>{data.suggestions.length}</span></div><div>{data.suggestions.slice(0,12).map(item=><article key={String(item.assignment_id)}><div><b>{item.guard_name}</b><small>{new Date(`${item.service_date}T12:00:00`).toLocaleDateString("pt-BR")} · {item.location}</small></div><strong>{formatHoursDuration(Number(item.planned_minutes)/60)}</strong><div className="he-suggestion-actions"><button type="button" disabled={monthClosed||isRefreshing} onClick={()=>setManualOpen(item)}>Lançar</button><button type="button" className="dismiss" disabled={monthClosed||isRefreshing} onClick={()=>void dismissSuggestion(item)}>Dispensar</button></div></article>)}</div></section>}
    <section className="he-panel he-spreadsheet"><div className="he-head"><div><h2>Distribuição por GM</h2><p>Use os botões da própria linha para lançar horas ou corrigir o total mensal.</p></div></div><div className="he-sheet-filters"><label>Equipe<select value={teamFilter} onChange={(event)=>setTeamFilter(event.target.value as typeof teamFilter)}><option value="all">Todas as equipes</option><option value="D1">Dia 1 · D1</option><option value="D2">Dia 2 · D2</option><option value="N1">Noite 1 · N1</option><option value="N2">Noite 2 · N2</option><option value="other">Semanal / outros</option></select></label><label>Ordenar por<select value={rankingSort} onChange={(event)=>setRankingSort(event.target.value as typeof rankingSort)}><option value="priority">Prioridade para próxima HE</option><option value="hours_desc">Mais horas primeiro</option><option value="hours_asc">Menos horas primeiro</option><option value="last_recent">HE mais recente</option><option value="last_oldest">Há mais tempo sem HE</option><option value="name">Nome do GM</option></select></label><label>Participação<select value={eligibility} onChange={(event)=>setEligibility(event.target.value as typeof eligibility)} aria-label="Filtrar elegibilidade"><option value="all">Todos</option><option value="eligible">Realizam HE</option><option value="blocked">Não realizam HE</option></select></label><label>Faixa de horas<select value={hoursBand} onChange={(event)=>setHoursBand(event.target.value as typeof hoursBand)}><option value="all">Qualquer total</option><option value="zero">Sem HE no mês</option><option value="under12">Até 12h</option><option value="over12">Acima de 12h</option></select></label><label className="he-sheet-search">Buscar<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="GM, matrícula ou aviso…"/></label></div>
      <table><thead><tr><th>Ordem</th><th>GM</th><th>Equipe</th><th>Total no mês</th><th>Mês anterior</th><th>Última HE</th><th>Participação / aviso</th><th>Ações</th></tr></thead><tbody>{ranking.map((guard,index)=>{const enabled=Number(guard.overtime_eligible)!==0;return <tr key={String(guard.id)} className={enabled?"":"he-disabled-row"}><td><strong className={enabled&&rankingSort==="priority"&&index<5?"priority":""}>{enabled?`${index+1}º`:"—"}</strong></td><td><b>{guard.name}</b><small>{guard.registration}</small></td><td><span className={`he-team ${String(guard.platoon||"other").toLowerCase()}`}>{guard.platoon||"Semanal"}</span></td><td><b>{formatHoursDuration(Number(guard.currentHours))}</b><div className="he-bar"><i style={{width:`${maximum?Number(guard.currentHours)/maximum*100:0}%`}}/></div></td><td>{formatHoursDuration(Number(guard.previousHours))}</td><td>{formatLastOvertime(guard.lastOvertime)}</td><td><button type="button" className={`he-setting ${enabled?"enabled":"blocked"}`} onClick={()=>setGuardEditing(guard)}><b>{enabled?"Realiza HE":"Não realiza HE"}</b><small>{guard.overtime_note||"Adicionar aviso ou observação"}</small></button></td><td><div className="he-row-actions"><button type="button" disabled={monthClosed||isRefreshing} onClick={()=>setManualOpen(guard)}>＋ Horas</button><button type="button" disabled={monthClosed||isRefreshing} onClick={()=>setBalanceEditing(guard)}>Ajustar total</button></div></td></tr>})}</tbody></table>
    </section>
    <section id="he-history" className="he-panel he-history"><div className="he-head"><div><h2>Histórico de lançamentos</h2><p>Registro simples das horas que efetivamente compõem o saldo.</p></div></div>{data.entries.length===0?<p className="he-empty">Nenhuma HE lançada neste mês.</p>:<div className="he-entry-table"><div className="he-entry-head"><span>Data / GM</span><span>Local</span><span>Horas</span><span>Origem</span><span>Observação</span><span>Ação</span></div>{data.entries.map(entry=><article key={String(entry.id)}><div><b>{entry.guard_name}</b><small>{new Date(`${entry.service_date}T12:00:00`).toLocaleDateString("pt-BR")}</small></div><div><span>{entry.location||"Sem local"}</span><small>{entry.request_ref||"Sem requerimento"}</small></div><b>{formatHoursDuration(Number(entry.confirmed_minutes||0)/60)}</b><span>{entry.source==="adjustment"?"Ajuste":entry.source==="manual"?"Manual":"Legado da escala"}</span><small>{entry.notes||"—"}</small><button type="button" disabled={monthClosed||isRefreshing||entry.source==="adjustment"} onClick={()=>setEntryEditing(entry)}>{entry.source==="adjustment"?"Ajuste":"Editar"}</button></article>)}</div>}</section>
    {guardEditing&&<div className="he-settings-backdrop"><form className="he-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="he-settings-title" onSubmit={saveGuardSettings}><header><div><small>PREFERÊNCIAS DE HE</small><h2 id="he-settings-title">{guardEditing.name}</h2><p>{guardEditing.registration} · {guardEditing.platoon||"Sem equipe"}</p></div><button type="button" onClick={()=>setGuardEditing(null)} aria-label="Fechar">×</button></header><div className="he-eligible-check"><input id="he-eligible" type="checkbox" name="eligible" defaultChecked={Number(guardEditing.overtime_eligible)!==0}/><label htmlFor="he-eligible"><b>Este GM realiza hora extra</b><small>Desmarque para removê-lo das sugestões automáticas.</small></label></div><label>Aviso ou observação<textarea name="note" defaultValue={String(guardEditing.overtime_note||"")} rows={4}/></label><footer><button type="button" onClick={()=>setGuardEditing(null)}>Cancelar</button><button className="save" disabled={saving}>{saving?"Salvando…":"Salvar preferência"}</button></footer></form></div>}
    {entryEditing&&<EntryEditDialog entry={entryEditing} saving={saving} onClose={()=>setEntryEditing(null)} onSave={saveEntry}/>}
    {manualOpen&&<ManualEntryDialog guards={data.ranking} month={month} initial={manualOpen==="blank"?null:manualOpen} saving={saving} onClose={()=>setManualOpen(null)} onSave={createManual}/>}
    {balanceEditing&&<BalanceDialog guard={balanceEditing} month={month} saving={saving} onClose={()=>setBalanceEditing(null)} onSave={saveBalance}/>}
    {closureDialog&&<MonthClosureDialog mode={closureDialog} month={month} pendingCount={pendingCount} saving={saving} closure={data.closure} onClose={()=>setClosureDialog(null)} onSave={changeMonthStatus}/>}
  </main>;
}

function EntryEditDialog({entry,saving,onClose,onSave}:{entry:Rec;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const planned=Number(entry.planned_minutes)/60;
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-review-title" onSubmit={onSave}><header><div><small>EDITAR LANÇAMENTO</small><h2 id="he-review-title">{entry.guard_name}</h2><p>{new Date(`${entry.service_date}T12:00:00`).toLocaleDateString("pt-BR")} · {entry.location}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><div className="he-review-summary"><span>Horas registradas</span><b>{formatHoursDuration(entry.confirmed_minutes==null?planned:Number(entry.confirmed_minutes)/60)}</b><small>Altere abaixo somente quando precisar corrigir o lançamento.</small></div><input type="hidden" name="status" value="confirmed"/><label>Quantidade de horas<input name="confirmedHours" type="number" min="0.25" max="24" step="0.25" defaultValue={entry.confirmed_minutes==null?planned:Number(entry.confirmed_minutes)/60}/></label><label>Requerimento<input name="requestRef" defaultValue={String(entry.request_ref||"")} placeholder="Número ou referência"/></label><label>Observação<textarea name="notes" defaultValue={String(entry.notes||"")} rows={3} placeholder="Motivo da correção ou informação do serviço"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Salvando…":"Salvar alteração"}</button></footer></form></div>;
}

function ManualEntryDialog({guards,month,initial,saving,onClose,onSave}:{guards:Rec[];month:string;initial:Rec|null;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const initialGuard=Number(initial?.guard_id||initial?.id||0),suggestedHours=initial?.planned_minutes?Number(initial.planned_minutes)/60:0;
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-manual-title" onSubmit={onSave}>{initial?.assignment_id&&<input type="hidden" name="assignmentId" value={String(initial.assignment_id)}/>}<header><div><small>LANÇAMENTO MANUAL</small><h2 id="he-manual-title">Adicionar horas realizadas</h2><p>Este lançamento entra imediatamente no saldo oficial.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>{initial?.assignment_id?<div className="he-review-summary"><span>GM sugerido pela escala</span><b>{initial.guard_name}</b><small>{initial.registration} · confirme somente se o serviço foi realizado.</small><input type="hidden" name="guardId" value={initialGuard}/></div>:<label>GM<select name="guardId" required defaultValue={initialGuard?String(initialGuard):""}><option value="">Selecione o GM</option>{guards.map((guard)=><option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}{Number(guard.overtime_eligible)===0?" · NÃO REALIZA HE":""}</option>)}</select></label>}<div className="he-time-pair"><label>Data<input name="serviceDate" type="date" required defaultValue={String(initial?.service_date||`${month}-01`)}/></label><label>Quantidade de HE<input name="hours" type="number" min="0.25" max="24" step="0.25" required defaultValue={suggestedHours||3}/></label></div><label>Local / operação<input name="location" defaultValue={String(initial?.location||"")} placeholder="Posto, VTR ou atividade"/></label><label>Requerimento<input name="requestRef" defaultValue={String(initial?.request_ref||"")} placeholder="Número ou referência"/></label><label>Observação<textarea name="notes" rows={3} placeholder="Informação opcional sobre o serviço"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Lançando…":"Adicionar ao saldo"}</button></footer></form></div>;
}

function BalanceDialog({guard,month,saving,onClose,onSave}:{guard:Rec;month:string;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-balance-title" onSubmit={onSave}><header><div><small>CORREÇÃO AUDITÁVEL</small><h2 id="he-balance-title">Ajustar total de {guard.name}</h2><p>{month} · saldo atual {formatHoursDuration(Number(guard.currentHours))}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><div className="he-review-summary"><span>Total atual</span><b>{formatHoursDuration(Number(guard.currentHours))}</b><small>O sistema registrará somente a diferença necessária.</small></div><label>Novo total do mês<input name="targetHours" type="number" min="0" max="500" step="0.25" required defaultValue={Number(guard.currentHours)}/></label><label>Motivo do ajuste<textarea name="notes" rows={3} required placeholder="Ex.: correção do controle anterior, lançamento duplicado…"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Ajustando…":"Salvar novo total"}</button></footer></form></div>;
}

function MonthClosureDialog({mode,month,pendingCount,saving,closure,onClose,onSave}:{mode:"close"|"reopen";month:string;pendingCount:number;saving:boolean;closure:Rec;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const closing=mode==="close";
  const label=new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-closure-title" onSubmit={onSave}><header><div><small>CONTROLE DO LIVRO MENSAL</small><h2 id="he-closure-title">{closing?"Fechar mês":"Reabrir mês"}</h2><p>{label}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>{closing?<><div className={`he-closure-check ${pendingCount?"blocked":"ready"}`}><b>{pendingCount?`${pendingCount} lançamentos ainda pendentes`:"Tudo pronto para o fechamento"}</b><span>{pendingCount?"Resolva os lançamentos pendentes antes de fechar.":"Depois de fechar, lançamentos e correções ficarão bloqueados."}</span></div><label>Observação do fechamento<textarea name="note" rows={3} placeholder="Opcional: referência do controle, folha ou responsável"/></label></>:<><div className="he-closure-check caution"><b>Alteração protegida por histórico</b><span>O mês voltará a aceitar lançamentos e correções.</span>{closure.closed_at&&<small>Fechado em {new Date(String(closure.closed_at).replace(" ","T")+"Z").toLocaleString("pt-BR")}</small>}</div><label>Justificativa da reabertura<textarea name="reason" rows={3} required placeholder="Descreva o motivo da correção"/></label></>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving||(closing&&pendingCount>0)}>{saving?"Salvando…":closing?"Confirmar fechamento":"Reabrir com justificativa"}</button></footer></form></div>;
}

function formatLastOvertime(value:unknown){if(!value)return"Nunca";return new Date(String(value).replace(" ","T")).toLocaleDateString("pt-BR")}
