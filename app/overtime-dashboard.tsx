"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatHoursDuration } from "../lib/shift-rules";
import { ModuleLoading } from "./module-loading";
import { BackToSchedule } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";

type Rec = Record<string, string | number | null>;
type Data = { month: string; ranking: Rec[]; entries: Rec[]; closure: Rec };

export function OvertimeDashboard() {
  const { date } = useScheduleDate();
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const month = selectedMonth ?? date.slice(0, 7);
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [eligibility, setEligibility] = useState<"all" | "eligible" | "blocked">("all");
  const [entryFilter, setEntryFilter] = useState<"all" | "pending" | "reviewed">("pending");
  const [guardEditing, setGuardEditing] = useState<Rec | null>(null);
  const [entryEditing, setEntryEditing] = useState<Rec | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [closureDialog, setClosureDialog] = useState<"close" | "reopen" | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/overtime?month=${month}&_=${Date.now()}`, {
      cache: "no-store",
    });
    setData(await response.json());
  }, [month]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ranking = useMemo(() => {
    const value = query.toLowerCase().trim();
    return (data?.ranking || []).filter((guard) => {
      const enabled = Number(guard.overtime_eligible) !== 0;
      if (eligibility === "eligible" && !enabled) return false;
      if (eligibility === "blocked" && enabled) return false;
      return !value || `${guard.name} ${guard.registration} ${guard.platoon || ""} ${guard.overtime_note || ""}`.toLowerCase().includes(value);
    });
  }, [data, eligibility, query]);
  const entries = useMemo(
    () =>
      (data?.entries || []).filter((entry) =>
        entryFilter === "all"
          ? true
          : entryFilter === "pending"
            ? entry.status === "pending"
            : entry.status !== "pending",
      ),
    [data, entryFilter],
  );

  if (!data)
    return <ModuleLoading area="horas extras" detail="Carregando livro mensal…" />;

  const eligible = data.ranking.filter((guard) => Number(guard.overtime_eligible) !== 0);
  const total = eligible.reduce((sum, guard) => sum + Number(guard.currentHours), 0);
  const pending = eligible.reduce((sum, guard) => sum + Number(guard.pendingHours), 0);
  const average = eligible.length ? total / eligible.length : 0;
  const maximum = Math.max(0, ...eligible.map((guard) => Number(guard.currentHours)));
  const minimum = eligible.length ? Math.min(...eligible.map((guard) => Number(guard.currentHours))) : 0;
  const pendingCount = data.entries.filter((entry) => entry.status === "pending").length;
  const monthClosed = data.closure?.status === "closed";

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
      if (response.ok) await load();
      return response.ok;
    } finally {
      setSaving(false);
    }
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
    if (await postAction({ ...Object.fromEntries(new FormData(form)), action: "manual_create", confirmNow: new FormData(form).get("confirmNow") === "on" })) {
      form.reset();
      setManualOpen(false);
    }
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

  return <main className="overtime-page">
    <header><BackToSchedule date={date}/><div><span>LIVRO MENSAL E DISTRIBUIÇÃO</span><h1>Horas extras</h1><p>Somente horas conferidas entram no total oficial.</p></div><span className={`he-month-state ${monthClosed?"closed":"open"}`}>{monthClosed?"Mês fechado":"Mês aberto"}</span><label>Mês<input type="month" value={month} onChange={(event)=>setSelectedMonth(event.target.value)}/></label><button disabled={monthClosed} title={monthClosed?"Reabra o mês para lançar horas extras":""} onClick={()=>setManualOpen(true)}>+ Lançar HE</button><button onClick={()=>setClosureDialog(monthClosed?"reopen":"close")}>{monthClosed?"Reabrir mês":"Fechar mês"}</button><button onClick={exportCsv}>Exportar CSV</button></header>
    {message&&<p className="he-message" role="status">{message}</p>}
    {monthClosed&&<section className="he-closed-banner" role="status"><b>Livro mensal fechado</b><span>Os totais estão protegidos contra alterações. Reabra com justificativa se precisar corrigir.</span>{data.closure.closed_at&&<small>Fechado em {new Date(String(data.closure.closed_at).replace(" ","T")+"Z").toLocaleString("pt-BR")}{data.closure.closure_note?` · ${data.closure.closure_note}`:""}</small>}</section>}
    <section className="he-stats"><article><b>{formatHoursDuration(total)}</b><span>Confirmadas no mês</span></article><article className={pendingCount?"he-stat-warning":""}><b>{formatHoursDuration(pending)}</b><span>{pendingCount} pendentes</span></article><article><b>{formatHoursDuration(average)}</b><span>Média confirmada</span></article><article><b>{formatHoursDuration(maximum-minimum)}</b><span>Diferença maior/menor</span></article></section>
    <section className="he-panel he-ledger"><div className="he-head"><div><h2>Conferência dos serviços</h2><p>Confira o que foi efetivamente realizado antes de contabilizar.</p></div><div className="he-filters"><select value={entryFilter} onChange={(event)=>setEntryFilter(event.target.value as typeof entryFilter)} aria-label="Filtrar lançamentos"><option value="pending">Pendentes ({pendingCount})</option><option value="reviewed">Já conferidos</option><option value="all">Todos</option></select></div></div>
      {entries.length===0?<p className="he-empty">Nenhum lançamento neste filtro.</p>:<div className="he-entry-table"><div className="he-entry-head"><span>Data / GM</span><span>Local e horário</span><span>Prevista</span><span>Realizada</span><span>Situação</span><span>Ação</span></div>{entries.map((entry)=><article key={String(entry.id)}><div><b>{entry.guard_name}</b><small>{new Date(`${entry.service_date}T12:00:00`).toLocaleDateString("pt-BR")} · {entry.source==="manual"?"Manual":"Escala"}</small></div><div><span>{entry.location||"Sem local"}</span><small>{timeRange(entry)}</small></div><b>{formatHoursDuration(Number(entry.planned_minutes)/60)}</b><b>{entry.confirmed_minutes==null?"—":formatHoursDuration(Number(entry.confirmed_minutes)/60)}</b><span className={`he-status ${entry.status}`}>{statusLabel(String(entry.status))}</span><button type="button" disabled={monthClosed} title={monthClosed?"Mês fechado":""} onClick={()=>setEntryEditing(entry)}>{monthClosed?"Fechado":entry.status==="pending"?"Conferir":"Editar"}</button></article>)}</div>}
    </section>
    <section className="he-panel"><div className="he-head"><div><h2>Distribuição por GM</h2><p>Pendências contam como carga comprometida nas sugestões, mas não no total oficial.</p></div><div className="he-filters"><select value={eligibility} onChange={(event)=>setEligibility(event.target.value as typeof eligibility)} aria-label="Filtrar elegibilidade"><option value="all">Todos</option><option value="eligible">Realizam HE</option><option value="blocked">Não realizam HE</option></select><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar GM, matrícula ou aviso…"/></div></div>
      <table><thead><tr><th>Prioridade</th><th>GM</th><th>Equipe</th><th>Confirmada</th><th>Pendente</th><th>Mês anterior</th><th>Participação / aviso</th></tr></thead><tbody>{ranking.map((guard,index)=>{const enabled=Number(guard.overtime_eligible)!==0;return <tr key={String(guard.id)} className={enabled?"":"he-disabled-row"}><td><strong className={enabled&&index<5?"priority":""}>{enabled?`${index+1}º`:"—"}</strong></td><td><b>{guard.name}</b><small>{guard.registration}</small></td><td>{guard.platoon||"—"}</td><td><b>{formatHoursDuration(Number(guard.currentHours))}</b><div className="he-bar"><i style={{width:`${maximum?Number(guard.currentHours)/maximum*100:0}%`}}/></div></td><td>{formatHoursDuration(Number(guard.pendingHours))}</td><td>{formatHoursDuration(Number(guard.previousHours))}</td><td><button type="button" className={`he-setting ${enabled?"enabled":"blocked"}`} onClick={()=>setGuardEditing(guard)}><b>{enabled?"Realiza HE":"Não realiza HE"}</b><small>{guard.overtime_note||"Adicionar aviso ou observação"}</small></button></td></tr>})}</tbody></table>
    </section>
    {guardEditing&&<div className="he-settings-backdrop"><form className="he-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="he-settings-title" onSubmit={saveGuardSettings}><header><div><small>PREFERÊNCIAS DE HE</small><h2 id="he-settings-title">{guardEditing.name}</h2><p>{guardEditing.registration} · {guardEditing.platoon||"Sem equipe"}</p></div><button type="button" onClick={()=>setGuardEditing(null)} aria-label="Fechar">×</button></header><div className="he-eligible-check"><input id="he-eligible" type="checkbox" name="eligible" defaultChecked={Number(guardEditing.overtime_eligible)!==0}/><label htmlFor="he-eligible"><b>Este GM realiza hora extra</b><small>Desmarque para removê-lo das sugestões automáticas.</small></label></div><label>Aviso ou observação<textarea name="note" defaultValue={String(guardEditing.overtime_note||"")} rows={4}/></label><footer><button type="button" onClick={()=>setGuardEditing(null)}>Cancelar</button><button className="save" disabled={saving}>{saving?"Salvando…":"Salvar preferência"}</button></footer></form></div>}
    {entryEditing&&<EntryReviewDialog entry={entryEditing} saving={saving} onClose={()=>setEntryEditing(null)} onSave={saveEntry}/>}
    {manualOpen&&<ManualEntryDialog guards={data.ranking} month={month} saving={saving} onClose={()=>setManualOpen(false)} onSave={createManual}/>}
    {closureDialog&&<MonthClosureDialog mode={closureDialog} month={month} pendingCount={pendingCount} saving={saving} closure={data.closure} onClose={()=>setClosureDialog(null)} onSave={changeMonthStatus}/>}
  </main>;
}

function EntryReviewDialog({entry,saving,onClose,onSave}:{entry:Rec;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const planned=Number(entry.planned_minutes)/60;
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-review-title" onSubmit={onSave}><header><div><small>CONFERÊNCIA DO SERVIÇO</small><h2 id="he-review-title">{entry.guard_name}</h2><p>{new Date(`${entry.service_date}T12:00:00`).toLocaleDateString("pt-BR")} · {entry.location}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><div className="he-review-summary"><span>Previsto</span><b>{formatHoursDuration(planned)}</b><small>{timeRange(entry)}</small></div><label>Resultado<select name="status" defaultValue={String(entry.status)}><option value="pending">Pendente</option><option value="confirmed">Realizada integralmente</option><option value="partial">Realizada parcialmente</option><option value="not_performed">Não realizada / falta</option><option value="cancelled">Cancelada</option></select></label><label>Horas efetivamente realizadas<input name="confirmedHours" type="number" min="0" max="24" step="0.25" defaultValue={entry.confirmed_minutes==null?planned:Number(entry.confirmed_minutes)/60}/></label><label>Requerimento<input name="requestRef" defaultValue={String(entry.request_ref||"")} placeholder="Número ou referência"/></label><label>Observação<textarea name="notes" defaultValue={String(entry.notes||"")} rows={3} placeholder="Falta, saída antecipada, ajuste…"/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Salvando…":"Salvar conferência"}</button></footer></form></div>;
}

function ManualEntryDialog({guards,month,saving,onClose,onSave}:{guards:Rec[];month:string;saving:boolean;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-manual-title" onSubmit={onSave}><header><div><small>NOVO LANÇAMENTO</small><h2 id="he-manual-title">Lançar HE manual</h2><p>Para serviços que não nasceram da escala.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><label>GM<select name="guardId" required defaultValue=""><option value="">Selecione o GM</option>{guards.map((guard)=><option key={String(guard.id)} value={String(guard.id)}>{guard.name} · {guard.registration}{Number(guard.overtime_eligible)===0?" · NÃO REALIZA HE":""}</option>)}</select></label><div className="he-time-pair"><label>Início<input name="startsAt" type="datetime-local" required defaultValue={`${month}-01T07:00`}/></label><label>Fim<input name="endsAt" type="datetime-local" required defaultValue={`${month}-01T19:00`}/></label></div><label>Local / operação<input name="location" placeholder="Posto, VTR ou atividade"/></label><label>Requerimento<input name="requestRef" placeholder="Número ou referência"/></label><label>Observação<textarea name="notes" rows={3}/></label><div className="he-eligible-check"><input id="he-confirm-now" type="checkbox" name="confirmNow"/><label htmlFor="he-confirm-now"><b>Já lançar como realizada</b><small>Se desmarcado, ficará pendente de conferência.</small></label></div><footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving?"Lançando…":"Criar lançamento"}</button></footer></form></div>;
}

function MonthClosureDialog({mode,month,pendingCount,saving,closure,onClose,onSave}:{mode:"close"|"reopen";month:string;pendingCount:number;saving:boolean;closure:Rec;onClose:()=>void;onSave:(event:FormEvent<HTMLFormElement>)=>void}){
  const closing=mode==="close";
  const label=new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  return <div className="he-settings-backdrop"><form className="he-settings-dialog he-review-dialog" role="dialog" aria-modal="true" aria-labelledby="he-closure-title" onSubmit={onSave}><header><div><small>CONTROLE DO LIVRO MENSAL</small><h2 id="he-closure-title">{closing?"Fechar mês":"Reabrir mês"}</h2><p>{label}</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>{closing?<><div className={`he-closure-check ${pendingCount?"blocked":"ready"}`}><b>{pendingCount?`${pendingCount} lançamentos ainda pendentes`:"Tudo pronto para o fechamento"}</b><span>{pendingCount?"Confira os serviços pendentes antes de fechar.":"Depois de fechar, lançamentos e conferências ficarão bloqueados."}</span></div><label>Observação do fechamento<textarea name="note" rows={3} placeholder="Opcional: referência da conferência, folha ou responsável"/></label></>:<><div className="he-closure-check caution"><b>Alteração protegida por histórico</b><span>O mês voltará a aceitar lançamentos e correções.</span>{closure.closed_at&&<small>Fechado em {new Date(String(closure.closed_at).replace(" ","T")+"Z").toLocaleString("pt-BR")}</small>}</div><label>Justificativa da reabertura<textarea name="reason" rows={3} required placeholder="Descreva o motivo da correção"/></label></>}<footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving||(closing&&pendingCount>0)}>{saving?"Salvando…":closing?"Confirmar fechamento":"Reabrir com justificativa"}</button></footer></form></div>;
}

function timeRange(entry:Rec){return `${String(entry.starts_at).slice(11,16)}–${String(entry.ends_at).slice(11,16)}`}
function statusLabel(status:string){return status==="confirmed"?"Realizada":status==="partial"?"Parcial":status==="not_performed"?"Não realizada":status==="cancelled"?"Cancelada":"Pendente"}
