"use client";

import { useEffect, useMemo, useState } from "react";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { ScheduleNav } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";
import { formatScheduleDate } from "../lib/schedule-date";
import { isMotorcycleType } from "../lib/crew-rules";

type Rec = Record<string, string | number | null>;
type ValidationIssue = {
  id: string;
  severity: "critical" | "warning";
  kind: "coverage" | "role" | "conflict";
  label: string;
  detail: string;
  resourceKind?: "post" | "vehicle";
  resourceId?: number;
  shift?: string;
};
type Data = {
  schedule: Rec;
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  date: string;
};

function normalizeIssues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue, index) => {
    if (typeof issue === "string") {
      return [{ id: `legacy-${index}`, severity: "critical" as const, kind: "coverage" as const, label: issue, detail: "Furo que precisa ser conferido antes de publicar." }];
    }
    if (!issue || typeof issue !== "object") return [];
    const item = issue as Partial<ValidationIssue>;
    if (!item.label) return [];
    return [{
      id: String(item.id || `issue-${index}`),
      severity: item.severity === "warning" ? "warning" : "critical",
      kind: item.kind === "role" || item.kind === "conflict" ? item.kind : "coverage",
      label: String(item.label),
      detail: String(item.detail || "Confira esta pendência na escala."),
      resourceKind: item.resourceKind,
      resourceId: item.resourceId,
      shift: item.shift,
    }];
  });
}

export function ValidateSchedule() {
  const { date, hrefFor } = useScheduleDate();
  const [data, setData] = useState<Data | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [visibleIssues, setVisibleIssues] = useState(40);
  const [period, setPeriod] = useState<"all" | "day" | "night">("all");

  useEffect(() => {
    // A new date starts in an explicit checking state; the asynchronous
    // callbacks below replace it with the real validation result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChecking(true);
    fetch(`/api/schedule?date=${date}&_=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        const nextData = payload as Data;
        setData(nextData);
        return fetch(`/api/publish?scheduleId=${nextData.schedule.id}&_=${Date.now()}`, { cache: "no-store" });
      })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(String(payload.error || "Não foi possível conferir as pendências."));
        setIssues(normalizeIssues(payload.issues));
        setMessage("");
        setChecking(false);
      })
      .catch(() => {
        setMessage("Não foi possível carregar a validação.");
        setChecking(false);
      });
  }, [date]);

  async function publish() {
    if (!data || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduleId: data.schedule.id }),
      });
      const payload = await response.json() as { issues?: unknown; error?: string };
      const nextIssues = normalizeIssues(payload.issues);
      setIssues(nextIssues);
      setMessage(response.ok ? "Escala validada e publicada." : payload.error || "Não foi possível publicar a escala.");
    } catch {
      setMessage("A validação não foi concluída. Verifique a conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  // Keep the previous response in memory while switching dates, but never
  // render it for the newly selected date. This avoids a stale flash without
  // forcing a synchronous state update from the effect.
  const currentData = data?.date === date ? data : null;
  const criticalIssues = useMemo(() => issues.filter((issue) => issue.severity === "critical"), [issues]);
  const warningIssues = useMemo(() => issues.filter((issue) => issue.severity === "warning"), [issues]);
  const issuesForPeriod = issues.filter((issue) => period === "all" || issuePeriod(issue) === period);
  const dayIssues = issues.filter((issue) => issuePeriod(issue) === "day");
  const nightIssues = issues.filter((issue) => issuePeriod(issue) === "night");
  const shownIssues = issuesForPeriod.slice(0, visibleIssues);

  if (!currentData) {
    return (
      <ModuleLoading
        area="validação operacional"
        detail={message || `Conferindo a escala de ${formatScheduleDate(date)}…`}
      />
    );
  }

  const expected = (currentData.posts.length * 4) + currentData.vehicles.reduce((total, vehicle) => total + (isMotorcycleType(vehicle.type) ? 1 : 2) * 4, 0);
  const filled = currentData.assignments.length;

  return (
    <main className="validation-page">
      <Link href={hrefFor("/escala")}>← Voltar à escala</Link>
      <header>
        <span>VALIDAÇÃO OPERACIONAL</span>
        <h1>Conferência antes da publicação</h1>
        <p>{formatScheduleDate(currentData.date)} · escala {String(currentData.schedule.status || "rascunho")}</p>
      </header>
      <ScheduleNav date={date} active="/validacao" />
      <div className="validation-stats">
        <article>
          <b>{filled}</b>
          <span>posições preenchidas</span>
        </article>
        <article>
          <b>{expected}</b>
          <span>posições previstas</span>
        </article>
        <article className={filled < expected ? "bad" : "good"}>
          <b>{Math.max(0, expected - filled)}</b>
          <span>diferença de cobertura</span>
        </article>
      </div>
      <div className="validation-severity-summary" aria-live="polite">
        <article className={checking ? "" : criticalIssues.length ? "bad" : "good"}><b>{checking ? "…" : criticalIssues.length}</b><span>pendências críticas</span><small>{checking ? "conferindo a escala" : "bloqueiam a publicação"}</small></article>
        <article className={checking ? "" : warningIssues.length ? "warning" : "good"}><b>{checking ? "…" : warningIssues.length}</b><span>alertas</span><small>{checking ? "conferindo a escala" : "exigem conferência"}</small></article>
      </div>
      <nav className="validation-period-tabs" aria-label="Filtrar pendências por período">
        <button type="button" className={period === "all" ? "active" : ""} onClick={() => { setPeriod("all"); setVisibleIssues(40); }}>Todas <b>{issues.length}</b></button>
        <button type="button" className={period === "day" ? "active" : ""} onClick={() => { setPeriod("day"); setVisibleIssues(40); }}>☀ Diurno <b>{dayIssues.length}</b><small>2º e 3º</small></button>
        <button type="button" className={period === "night" ? "active" : ""} onClick={() => { setPeriod("night"); setVisibleIssues(40); }}>☾ Noturno <b>{nightIssues.length}</b><small>4º e 1º</small></button>
      </nav>
      <p className="validation-preview-note">Conferência automática atualizada ao abrir esta página. O botão abaixo repete a validação antes de publicar.</p>
      <section>
        <h2>Verificações automáticas</h2>
        <ul>
          <li>Conflitos de horário são bloqueados ao salvar e também na publicação.</li>
          <li>Guardas afastados, postos excluídos e viaturas em FA não entram como pendência.</li>
          <li>Viaturas ativas exigem motorista e patrulheiro em cada turno; motos exigem apenas um condutor.</li>
          <li>Postos ativos exigem ao menos um GM em cada turno.</li>
        </ul>
      </section>
      {message && (
        <p className={criticalIssues.length ? "validation-message bad" : "validation-message good"} role="status">
          {message}
        </p>
      )}
      {issues.length > 0 && (
        <section className="validation-issues">
          <header>
            <div><small>PENDÊNCIAS ENCONTRADAS</small><h2>{period === "all" ? "O que precisa ser conferido" : period === "day" ? "Pendências do diurno" : "Pendências do noturno"}</h2></div>
            <Link href={hrefFor("/escala")}>Abrir escala</Link>
          </header>
          <div className="issue-grid">
            {shownIssues.map((issue) => (
              <article className={`validation-issue ${issue.severity}`} key={issue.id}>
                <header><span>{issue.severity === "critical" ? "CRÍTICO" : "ALERTA"}</span><b>{issue.label}</b></header>
                <p>{issue.detail}</p>
                {issue.kind === "conflict" && <small>Abra a escala para mover um dos quadrantes ou retirar a duplicidade.</small>}
              </article>
            ))}
          </div>
          {visibleIssues < issuesForPeriod.length && <button type="button" className="validation-show-more" onClick={() => setVisibleIssues((value) => value + 40)}>Mostrar mais pendências ({issuesForPeriod.length - visibleIssues} restantes)</button>}
        </section>
      )}
      <button className="publish-button" disabled={busy} onClick={() => void publish()}>
        {busy ? "Conferindo…" : "Validar e publicar escala"}
      </button>
    </main>
  );
}

function issuePeriod(issue: ValidationIssue): "day" | "night" | "other" {
  return ["2", "3"].includes(String(issue.shift || "")) ? "day" : ["1", "4"].includes(String(issue.shift || "")) ? "night" : "other";
}
