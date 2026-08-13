"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { formatHoursDuration, fullPeriodLabel } from "../lib/shift-rules";
import type { SuggestionPosition } from "../lib/suggestion-position";

type Suggested = {
  id: number;
  name: string;
  registration: string;
  platoon: string | null;
  workRegime: string | null;
  currentHeHours: number;
  lastOvertime: string | null;
  daysSinceLastHe: number | null;
  reasons: string[];
  rank: number;
  oppositeVehicle?: boolean;
  oppositeTeam?: boolean;
};

export type SameDayCandidate = {
  guardId: number;
  name: string;
  registration: string;
  assignmentIds: number[];
  origins: string[];
  roles: string[];
  startsAt: string;
  endsAt: string;
  compatibleRole: boolean;
  availableForRedeployment: boolean;
};

type State = {
  date: string;
  shift: string;
  postId: number | null;
  vehicleId: number | null;
  role: string | null;
  suggestions: Suggested[];
  sameDayCandidates: SameDayCandidate[];
  summary?: {
    blocked: number;
    scheduledToday: number;
    totalGuards: number;
    excludedNoHe?: number;
  };
};

type SuggestionMode = "redeploy" | "overtime";

export function HoleSuggestBox({
  date,
  shift,
  postId,
  vehicleId,
  role,
  resourceLabel,
  onPick,
  onRedeploy,
  onClose,
  busy,
  position,
}: {
  date: string;
  shift: string;
  postId: number | null;
  vehicleId: number | null;
  role: string | null;
  resourceLabel: string;
  onPick: (guardId: number, guardName: string) => void | Promise<void>;
  onRedeploy: (candidate: SameDayCandidate) => void | Promise<void>;
  onClose: () => void;
  busy: boolean;
  position?: SuggestionPosition | null;
}) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SuggestionMode>("redeploy");
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedRedeployId, setSelectedRedeployId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ date, shift, suggest: "1", _: String(Date.now()) });
    if (postId) params.set("postId", String(postId));
    if (vehicleId) params.set("vehicleId", String(vehicleId));
    if (role) params.set("role", role);
    fetch(`/api/schedule?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value: State) => {
        setData(value);
        if (!(value.sameDayCandidates || []).some((candidate) => candidate.availableForRedeployment)) {
          setMode("overtime");
        }
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError("Não foi possível carregar as sugestões.");
        }
      });
    return () => controller.abort();
  }, [date, shift, postId, vehicleId, role]);

  const filteredOvertime = useMemo(() => {
    const list = data?.suggestions || [];
    if (!query.trim()) return list;
    const normalizedQuery = query.toLocaleLowerCase("pt-BR");
    return list.filter((guard) =>
      `${guard.name} ${guard.registration} ${guard.platoon || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedQuery),
    );
  }, [data, query]);

  const availableCandidates = useMemo(() => {
    const list = (data?.sameDayCandidates || []).filter((candidate) => candidate.availableForRedeployment);
    if (!query.trim()) return list;
    const normalizedQuery = query.toLocaleLowerCase("pt-BR");
    return list.filter((candidate) =>
      `${candidate.name} ${candidate.registration} ${candidate.origins.join(" ")}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedQuery),
    );
  }, [data, query]);

  const visibleRedeploy = expanded || query.trim() ? availableCandidates : availableCandidates.slice(0, 3);
  const visibleOvertime = expanded || query.trim() ? filteredOvertime : filteredOvertime.slice(0, 3);
  const activeTotal = mode === "redeploy" ? availableCandidates.length : filteredOvertime.length;
  const effectiveSelectedId = visibleOvertime.some((guard) => guard.id === selectedId)
    ? selectedId
    : (visibleOvertime[0]?.id ?? null);

  function changeMode(nextMode: SuggestionMode) {
    setMode(nextMode);
    setExpanded(false);
    setQuery("");
    setSelectedId(null);
    setSelectedRedeployId(null);
  }

  const style = position
    ? { top: `${position.top}px`, left: `${position.left}px`, maxHeight: `${position.maxHeight}px` }
    : undefined;

  return (
    <div
      className="hole-suggest-card"
      data-placement={position?.placement || "bottom-sheet"}
      style={style as CSSProperties}
      role="dialog"
      aria-label="Preencher furo de escala"
    >
      <header>
        <div>
          <small>PREENCHER FURO</small>
          <strong>{resourceLabel} · {fullPeriodLabel(shift)}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </header>
      <div className="hole-suggest-body">
        {error && <p className="hole-suggest-error">{error}</p>}
        {!data && !error && <div className="hole-suggest-loading">Buscando as melhores opções…</div>}
        {data && (
          <>
            <div className="hole-suggest-modes" role="tablist" aria-label="Forma de preencher o furo">
              <button type="button" role="tab" aria-selected={mode === "redeploy"} className={mode === "redeploy" ? "active" : ""} onClick={() => changeMode("redeploy")}>
                <span>Remanejar alguém deste dia</span><b>{(data.sameDayCandidates || []).filter((candidate) => candidate.availableForRedeployment).length}</b>
              </button>
              <button type="button" role="tab" aria-selected={mode === "overtime"} className={mode === "overtime" ? "active" : ""} onClick={() => changeMode("overtime")}>
                <span>Chamar em HE</span><b>{data.suggestions.length}</b>
              </button>
            </div>
            <input
              className="hole-suggest-search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setExpanded(false); }}
              placeholder={mode === "redeploy" ? "Buscar entre os GMs à disposição…" : "Buscar na equipe oposta…"}
            />
            <div className="hole-suggest-results">
              {mode === "redeploy" && visibleRedeploy.length > 0 && (
                <section className="hole-suggest-group redeploy-suggestions available-suggestions">
                  <b>Melhores opções para remanejar</b>
                  <p>Somente GMs que já estão à disposição nesta escala.</p>
                  {visibleRedeploy.map((candidate) => (
                    <SameDayRow
                      key={candidate.guardId}
                      candidate={candidate}
                      selected={selectedRedeployId === candidate.guardId}
                      busy={busy}
                      onSelect={() => setSelectedRedeployId(candidate.guardId)}
                      onConfirm={() => onRedeploy(candidate)}
                    />
                  ))}
                </section>
              )}
              {mode === "redeploy" && !visibleRedeploy.length && (
                <p className="hole-suggest-empty">Nenhum GM está à disposição neste período. Use “Chamar em HE”.</p>
              )}
              {mode === "overtime" && visibleOvertime.length > 0 && (
                <section className="hole-suggest-group overtime-suggestions">
                  <b>Melhores opções para HE</b>
                  <p>Equipe do dia oposto, priorizando o mesmo tipo de posto e quem possui menos HE.</p>
                  {visibleOvertime.map((guard) => (
                    <SuggestionRow
                      key={guard.id}
                      guard={guard}
                      selected={effectiveSelectedId === guard.id}
                      onSelect={() => setSelectedId(guard.id)}
                      onConfirm={async () => { if (!busy) await onPick(guard.id, guard.name); }}
                      busy={busy}
                      highlight={Boolean(guard.oppositeVehicle)}
                    />
                  ))}
                </section>
              )}
              {mode === "overtime" && !visibleOvertime.length && (
                <p className="hole-suggest-empty">Nenhum GM da equipe oposta está elegível para HE neste período.</p>
              )}
              {activeTotal > 3 && !query.trim() && (
                <button type="button" className="hole-suggest-more" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? "Mostrar somente as 3 melhores" : `Ver todas (${activeTotal})`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {data && <footer><small>Mostramos primeiro as três melhores opções. Nada é alterado sem sua confirmação.</small></footer>}
    </div>
  );
}

function SameDayRow({ candidate, selected, busy, onSelect, onConfirm }: {
  candidate: SameDayCandidate;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article className={`hole-suggest-row same-day-row ${selected ? "is-selected" : ""}`}>
      <button type="button" className="hole-suggest-row-main" onClick={onSelect}>
        <div>
          <strong>{candidate.name}</strong>
          <span>{candidate.registration || "Sem matrícula"} · atualmente em {candidate.origins.join(" + ")}</span>
          <em>{candidate.compatibleRole ? "Função compatível" : "A função será ajustada no destino"}</em>
        </div>
        <aside className="same-day-time">
          <b>{candidate.startsAt.slice(11, 16)}–{candidate.endsAt.slice(11, 16)}</b>
          <small>{candidate.assignmentIds.length} horários vinculados</small>
        </aside>
      </button>
      {selected && (
        <div className="hole-suggest-confirm redeploy-confirm">
          <span>O GM sairá da área “À disposição” e ocupará este local, com aviso de remanejamento.</span>
          <button type="button" className="save" disabled={busy || confirming} onClick={async () => { setConfirming(true); try { await onConfirm(); } finally { setConfirming(false); } }}>
            {confirming ? "Movendo…" : `Remanejar ${candidate.name}`}
          </button>
        </div>
      )}
    </article>
  );
}

function SuggestionRow({ guard, selected, onSelect, onConfirm, busy, highlight }: {
  guard: Suggested;
  selected: boolean;
  onSelect: () => void;
  onConfirm: () => void | Promise<void>;
  busy: boolean;
  highlight?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const lastHeLabel = guard.lastOvertime
    ? new Date(String(guard.lastOvertime).replace(" ", "T")).toLocaleDateString("pt-BR")
    : "Sem HE registrada";
  return (
    <article className={`hole-suggest-row ${selected ? "is-selected" : ""} ${highlight ? "is-primary" : ""}`}>
      <button type="button" className="hole-suggest-row-main" onClick={onSelect}>
        <div>
          <strong>{guard.name}</strong>
          <span>{guard.registration || "Sem matrícula"} · {guard.platoon || "Sem equipe"}</span>
          {guard.reasons[0] && <em>{guard.reasons[0]}</em>}
          {guard.reasons.slice(1, 3).map((reason) => <small key={reason}>· {reason}</small>)}
        </div>
        <aside className="hole-suggest-row-stats">
          <b>{formatHoursDuration(guard.currentHeHours)}</b><span>HE no mês</span><small>Última: {lastHeLabel}</small>
        </aside>
      </button>
      {selected && (
        <div className="hole-suggest-confirm">
          <span>O GM será incluído no período inteiro como hora extra.</span>
          <button type="button" className="save" disabled={busy || confirming} onClick={async () => { setConfirming(true); try { await onConfirm(); } finally { setConfirming(false); } }}>
            {confirming ? "Confirmando…" : `Chamar ${guard.name} em HE`}
          </button>
        </div>
      )}
    </article>
  );
}
