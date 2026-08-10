"use client";
import { useEffect, useState } from "react";
import { FullPageLink as Link } from "./full-page-link";
import { ModuleLoading } from "./module-loading";
import { useScheduleDate } from "./use-schedule-date";
import { formatScheduleDate } from "../lib/schedule-date";

type Rec = Record<string, string | number | null>;
type Data = {
  schedule: Rec;
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  date: string;
};

export function ValidateSchedule() {
  const { date, hrefFor } = useScheduleDate();
  const [data, setData] = useState<Data | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/schedule?date=${date}&_=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setMessage("Não foi possível carregar a validação."));
  }, [date]);

  async function publish() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduleId: data.schedule.id }),
      });
      const j = await r.json();
      setIssues(j.issues || []);
      setMessage(r.ok ? "Escala validada e publicada." : j.error);
    } finally {
      setBusy(false);
    }
  }

  // Keep the previous response in memory while switching dates, but never
  // render it for the newly selected date. This avoids a stale flash without
  // forcing a synchronous state update from the effect.
  const currentData = data?.date === date ? data : null;

  if (!currentData) {
    return (
      <ModuleLoading
        area="validação operacional"
        detail={message || `Conferindo a escala de ${formatScheduleDate(date)}…`}
      />
    );
  }

  const expected = (currentData.posts.length + currentData.vehicles.length * 2) * 4;
  const filled = currentData.assignments.length;

  return (
    <main className="validation-page">
      <Link href={hrefFor("/")}>← Voltar à escala</Link>
      <header>
        <span>VALIDAÇÃO OPERACIONAL</span>
        <h1>Conferência antes da publicação</h1>
        <p>{formatScheduleDate(currentData.date)}</p>
      </header>
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
          <span>pendências estimadas</span>
        </article>
      </div>
      <section>
        <h2>Verificações automáticas</h2>
        <ul>
          <li>Conflitos de horário são bloqueados ao salvar.</li>
          <li>Guardas afastados são retirados automaticamente.</li>
          <li>Viaturas exigem motorista e patrulheiro em cada turno.</li>
          <li>Postos exigem ao menos um GM em cada turno.</li>
        </ul>
      </section>
      {message && (
        <p className={issues.length ? "validation-message bad" : "validation-message good"}>
          {message}
        </p>
      )}
      {issues.length > 0 && (
        <section>
          <h2>Furos encontrados</h2>
          <div className="issue-grid">
            {issues.map((i) => (
              <span key={i}>{i}</span>
            ))}
          </div>
        </section>
      )}
      <button className="publish-button" disabled={busy} onClick={() => void publish()}>
        {busy ? "Publicando…" : "Validar e publicar escala"}
      </button>
    </main>
  );
}
