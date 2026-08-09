"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatHoursDuration } from "../lib/shift-rules";
import { ModuleLoading } from "./module-loading";
import { BackToSchedule } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";

type Rec = Record<string, string | number | null>;
type Data = { month: string; ranking: Rec[]; entries: Rec[] };

export function OvertimeDashboard() {
  const { date } = useScheduleDate();
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const month = selectedMonth ?? date.slice(0, 7);
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [eligibility, setEligibility] = useState<"all" | "eligible" | "blocked">("all");
  const [editing, setEditing] = useState<Rec | null>(null);
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

  if (!data)
    return <ModuleLoading area="horas extras" detail="Carregando controle mensal…" />;

  const eligible = data.ranking.filter((guard) => Number(guard.overtime_eligible) !== 0);
  const total = eligible.reduce((sum, guard) => sum + Number(guard.currentHours), 0);
  const average = eligible.length ? total / eligible.length : 0;
  const maximum = Math.max(0, ...eligible.map((guard) => Number(guard.currentHours)));
  const minimum = Math.min(0, ...eligible.map((guard) => Number(guard.currentHours)));

  async function saveGuardSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    try {
      const response = await fetch("/api/overtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "guard_settings",
          guardId: editing.id,
          eligible: form.eligible === "on",
          note: form.note,
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (response.ok) {
        setData((current) =>
          current
            ? {
                ...current,
                ranking: current.ranking.map((guard) =>
                  Number(guard.id) === Number(result.guard.id)
                    ? { ...guard, ...result.guard }
                    : guard,
                ),
              }
            : current,
        );
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Matrícula", "GM", "Pelotão", "HE mês", "Mês anterior", "Realiza HE", "Aviso"],
      ...data.ranking.map((guard) => [
        guard.registration,
        guard.name,
        guard.platoon,
        guard.currentHours,
        guard.previousHours,
        Number(guard.overtime_eligible) !== 0 ? "Sim" : "Não",
        guard.overtime_note || "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    link.download = `horas-extras-${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="overtime-page">
      <header>
        <BackToSchedule date={date} />
        <div><span>CONTROLE E DISTRIBUIÇÃO</span><h1>Horas extras</h1><p>Classificação mensal e preferências individuais de participação.</p></div>
        <label>Mês<input type="month" value={month} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        <button onClick={exportCsv}>Exportar CSV</button>
      </header>
      {message && <p className="he-message" role="status">{message}</p>}
      <section className="he-stats">
        <article><b>{formatHoursDuration(total)}</b><span>Total no mês</span></article>
        <article><b>{formatHoursDuration(average)}</b><span>Média entre elegíveis</span></article>
        <article><b>{formatHoursDuration(maximum - minimum)}</b><span>Diferença maior/menor</span></article>
        <article><b>{data.ranking.length - eligible.length}</b><span>Não realizam HE</span></article>
      </section>
      <section className="he-panel">
        <div className="he-head">
          <div><h2>Distribuição e elegibilidade</h2><p>GMs marcados como “Não realiza HE” deixam de aparecer nas sugestões automáticas.</p></div>
          <div className="he-filters">
            <select value={eligibility} onChange={(event) => setEligibility(event.target.value as typeof eligibility)} aria-label="Filtrar elegibilidade"><option value="all">Todos</option><option value="eligible">Realizam HE</option><option value="blocked">Não realizam HE</option></select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar GM, matrícula ou aviso…" />
          </div>
        </div>
        <table><thead><tr><th>Prioridade</th><th>GM</th><th>Equipe</th><th>HE no mês</th><th>Mês anterior</th><th>Última HE</th><th>Participação / aviso</th></tr></thead>
          <tbody>{ranking.map((guard, index) => {
            const enabled = Number(guard.overtime_eligible) !== 0;
            return <tr key={String(guard.id)} className={enabled ? "" : "he-disabled-row"}>
              <td><strong className={enabled && index < 5 ? "priority" : ""}>{enabled ? `${index + 1}º` : "—"}</strong></td>
              <td><b>{guard.name}</b><small>{guard.registration}</small></td>
              <td>{guard.platoon || "—"}</td>
              <td><b>{formatHoursDuration(Number(guard.currentHours))}</b><div className="he-bar"><i style={{ width: `${maximum ? (Number(guard.currentHours) / maximum) * 100 : 0}%` }} /></div></td>
              <td>{formatHoursDuration(Number(guard.previousHours))}</td>
              <td>{guard.lastOvertime ? new Date(String(guard.lastOvertime)).toLocaleDateString("pt-BR") : "Sem registro"}</td>
              <td><button type="button" className={`he-setting ${enabled ? "enabled" : "blocked"}`} onClick={() => setEditing(guard)}><b>{enabled ? "Realiza HE" : "Não realiza HE"}</b><small>{guard.overtime_note || "Adicionar aviso ou observação"}</small></button></td>
            </tr>;
          })}</tbody>
        </table>
      </section>
      <section className="he-panel"><h2>Lançamentos previstos pela escala</h2><p className="he-transition-note">Nesta etapa, os lançamentos ainda refletem a escala. A próxima evolução adicionará conferência manual — realizada, parcial, não realizada ou cancelada — antes da contabilização oficial.</p>
        {data.entries.length === 0 ? <p>Nenhuma HE prevista neste mês.</p> : <div className="entry-grid">{data.entries.map((entry) => <article key={String(entry.id)}><b>{entry.guard_name}</b><span>{entry.location}</span><strong>{formatHoursDuration(Number(entry.hours))}</strong><small>{new Date(String(entry.starts_at)).toLocaleString("pt-BR")}</small></article>)}</div>}
      </section>
      {editing && <div className="he-settings-backdrop"><form className="he-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="he-settings-title" onSubmit={saveGuardSettings}>
        <header><div><small>PREFERÊNCIAS DE HE</small><h2 id="he-settings-title">{editing.name}</h2><p>{editing.registration} · {editing.platoon || "Sem equipe"}</p></div><button type="button" onClick={() => setEditing(null)} aria-label="Fechar">×</button></header>
        <div className="he-eligible-check"><input id="he-eligible" type="checkbox" name="eligible" defaultChecked={Number(editing.overtime_eligible) !== 0} /><label htmlFor="he-eligible"><b>Este GM realiza hora extra</b><small>Desmarque para removê-lo das sugestões automáticas.</small></label></div>
        <label>Aviso ou observação<textarea name="note" defaultValue={String(editing.overtime_note || "")} placeholder="Ex.: verificar disponibilidade antes de chamar…" rows={4} /></label>
        <footer><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar preferência"}</button></footer>
      </form></div>}
    </main>
  );
}
