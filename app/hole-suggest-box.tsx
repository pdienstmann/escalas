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

export function HoleSuggestBox({
  date,
  shift,
  postId,
  vehicleId,
  role,
  resourceLabel,
  onPick,
  onRedeploy,
  onManual,
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
  onManual: () => void;
  onClose: () => void;
  busy: boolean;
  position?: SuggestionPosition | null;
}) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedRedeployId, setSelectedRedeployId] = useState<number | null>(null);
  const [showOppositeTeam, setShowOppositeTeam] = useState(false);
  const [oppositeSort, setOppositeSort] = useState<"priority" | "most_he" | "last_he">("priority");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      date,
      shift,
      suggest: "1",
      _: String(Date.now()),
    });
    if (postId) params.set("postId", String(postId));
    if (vehicleId) params.set("vehicleId", String(vehicleId));
    if (role) params.set("role", role);
    fetch(`/api/schedule?${params}`, { cache: "no-store", signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((value) => {
        setData(value);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError("Não foi possível carregar as sugestões.");
        }
      });
    return () => controller.abort();
  }, [date, shift, postId, vehicleId, role]);

  const filtered = useMemo(() => {
    const list = data?.suggestions || [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((s) =>
      `${s.name} ${s.registration} ${s.platoon || ""}`.toLowerCase().includes(q),
    );
  }, [data, query]);

  const effectiveSelectedId = filtered.some((guard) => guard.id === selectedId)
    ? selectedId
    : (filtered[0]?.id ?? null);
  const filteredSameDay = useMemo(() => {
    const list = data?.sameDayCandidates || [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((candidate) =>
      `${candidate.name} ${candidate.registration} ${candidate.origins.join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [data, query]);
  const availableCandidates = filteredSameDay.filter((candidate) => candidate.availableForRedeployment);
  const assignedCandidates = filteredSameDay.filter((candidate) => !candidate.availableForRedeployment);

  function confirmSuggestion(guard: Suggested) {
    return async () => {
      if (busy) return;
      await onPick(guard.id, guard.name);
    };
  }

  function separateByPriority(list: Suggested[]) {
    const primary = list.filter((s) =>
      s.reasons.some((r: string) => r.toLowerCase().includes("dia oposto") || r.toLowerCase().includes("equipe do")),
    );
    const others = list.filter(
      (s) =>
        !s.reasons.some((r: string) => r.toLowerCase().includes("dia oposto") || r.toLowerCase().includes("equipe do")),
    );
    return { primary, others };
  }

  const shown = filtered.slice(0, 6);
  const { primary, others } = separateByPriority(shown);
  const oppositeTeam = useMemo(() => {
    const list = (data?.suggestions || []).filter((guard) => guard.oppositeTeam);
    return [...list].sort((a, b) => {
      if (oppositeSort === "most_he") return b.currentHeHours - a.currentHeHours || a.name.localeCompare(b.name, "pt-BR");
      if (oppositeSort === "last_he") return String(b.lastOvertime || "").localeCompare(String(a.lastOvertime || "")) || a.name.localeCompare(b.name, "pt-BR");
      return Number(b.oppositeVehicle) - Number(a.oppositeVehicle) || a.rank - b.rank;
    });
  }, [data?.suggestions, oppositeSort]);

  const style = position
    ? {
        top: `${position.top}px`,
        left: `${position.left}px`,
        maxHeight: `${position.maxHeight}px`,
      }
    : undefined;

  return (
    <>
    <div
      className="hole-suggest-card"
      data-placement={position?.placement || "bottom-sheet"}
      style={style as CSSProperties}
      role="dialog"
      aria-label="Sugestões de GM para o furo"
    >
      <header>
        <div>
          <small>SUGESTÃO INTELIGENTE</small>
          <strong>
            {resourceLabel} · {fullPeriodLabel(shift)}
          </strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </header>
      <div className="hole-suggest-body">
        {error && <p className="hole-suggest-error">{error}</p>}
        {!data && !error && (
          <div className="hole-suggest-loading">Carregando sugestões…</div>
        )}
        {data && (
          <>
          <input
            className="hole-suggest-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar GM, matrícula ou equipe…"
          />
          {data.summary && (
            <p className="hole-suggest-summary">
              {filtered.length} elegíveis · {data.summary.scheduledToday} já escalados hoje ·{" "}
              {data.summary.blocked} indisponíveis por afastamento
              {data.summary.excludedNoHe
                ? ` · ${data.summary.excludedNoHe} não realizam HE`
                : ""}.
            </p>
          )}
          <div className="hole-suggest-results">
            {availableCandidates.length > 0 && (
              <section className="hole-suggest-group redeploy-suggestions available-suggestions">
                <b>À disposição para escala</b>
                <p>Estes GMs já estão aguardando destino e podem ser colocados diretamente neste local.</p>
                {availableCandidates.map((candidate) => (
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
            {assignedCandidates.length > 0 && (
              <section className="hole-suggest-group redeploy-suggestions">
                <b>Remanejar nesta escala</b>
                <p>Move o período do GM de outro posto e marca automaticamente “Avisar remanejamento”.</p>
                {assignedCandidates.map((candidate) => (
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
            <section className="hole-suggest-group overtime-suggestions">
              <b>Chamar GM para hora extra</b>
              <p>Prioriza equipe do dia oposto e menor quantidade de HE confirmada.</p>
            </section>
            {!filtered.length && (
              <p className="hole-suggest-empty">
                Nenhum GM elegível para este furo com os filtros atuais. Use seleção manual.
              </p>
            )}
            {primary.length > 0 && (
              <section className="hole-suggest-group primary">
              <b>Equipe do dia oposto</b>
              {primary.map((guard) => (
                <SuggestionRow
                  key={guard.id}
                  guard={guard}
                  selected={effectiveSelectedId === guard.id}
                  onSelect={() => setSelectedId(guard.id)}
                  onConfirm={confirmSuggestion(guard)}
                  busy={busy}
                  highlight
                />
              ))}
              </section>
            )}
            {others.length > 0 && (
              <section className="hole-suggest-group">
              <b>{primary.length > 0 ? "Outras sugestões" : "Sugestões ordenadas por HE"}</b>
              {others.map((guard) => (
                <SuggestionRow
                  key={guard.id}
                  guard={guard}
                  selected={effectiveSelectedId === guard.id}
                  onSelect={() => setSelectedId(guard.id)}
                  onConfirm={confirmSuggestion(guard)}
                  busy={busy}
                />
              ))}
              </section>
            )}
          </div>
          </>
        )}
      </div>
      {data && <footer>
        <button type="button" className="hole-suggest-manual" onClick={() => setShowOppositeTeam(true)}>
          Ver equipe do dia oposto ({oppositeTeam.length})
        </button>
        <button type="button" className="hole-suggest-manual secondary" onClick={onManual}>Seleção manual completa</button>
        <small>A sugestão nunca é aplicada sem confirmação.</small>
      </footer>}
    </div>
    {showOppositeTeam && <div className="opposite-team-backdrop">
      <section className="opposite-team-dialog" role="dialog" aria-modal="true" aria-labelledby="opposite-team-title">
        <header><div><small>HORA EXTRA · SOMENTE DIA OPOSTO</small><h2 id="opposite-team-title">Escolher GM</h2><p>{fullPeriodLabel(shift)} · {resourceLabel}</p></div><button type="button" onClick={() => setShowOppositeTeam(false)} aria-label="Fechar">×</button></header>
        <div className="opposite-team-filters" role="group" aria-label="Ordenar GMs">
          <button type="button" className={oppositeSort === "priority" ? "active" : ""} onClick={() => setOppositeSort("priority")}>Viaturas primeiro</button>
          <button type="button" className={oppositeSort === "most_he" ? "active" : ""} onClick={() => setOppositeSort("most_he")}>Mais HE</button>
          <button type="button" className={oppositeSort === "last_he" ? "active" : ""} onClick={() => setOppositeSort("last_he")}>Última HE</button>
        </div>
        <div className="opposite-team-list">
          {oppositeTeam.length ? oppositeTeam.map((guard) => <SuggestionRow key={guard.id} guard={guard} selected={selectedId === guard.id} onSelect={() => setSelectedId(guard.id)} onConfirm={confirmSuggestion(guard)} busy={busy} highlight={Boolean(guard.oppositeVehicle)} />) : <p className="hole-suggest-empty">Nenhum GM da equipe oposta está elegível para HE neste período.</p>}
        </div>
      </section>
    </div>}
    </>
  );
}

function SameDayRow({
  candidate,
  selected,
  busy,
  onSelect,
  onConfirm,
}: {
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
          <span>{candidate.registration} · atualmente em {candidate.origins.join(" + ")}</span>
          <em>{candidate.compatibleRole ? "Função compatível" : "Função será ajustada no destino"}</em>
        </div>
        <aside className="same-day-time">
          <b>{candidate.startsAt.slice(11, 16)}–{candidate.endsAt.slice(11, 16)}</b>
          <small>{candidate.assignmentIds.length} horários vinculados</small>
        </aside>
      </button>
      {selected && (
        <div className="hole-suggest-confirm redeploy-confirm">
          <span>{candidate.availableForRedeployment ? "O GM sairá da bandeja À disposição e ocupará este local." : "O local de origem ficará com uma nova pendência para conferência."}</span>
          <button
            type="button"
            className="save"
            disabled={busy || confirming}
            onClick={async () => {
              setConfirming(true);
              try { await onConfirm(); } finally { setConfirming(false); }
            }}
          >
            {confirming ? "Movendo…" : candidate.availableForRedeployment ? `Escalar ${candidate.name} aqui` : `Remanejar ${candidate.name}`}
          </button>
        </div>
      )}
    </article>
  );
}

function SuggestionRow({
  guard,
  selected,
  onSelect,
  onConfirm,
  busy,
  highlight,
}: {
  guard: Suggested;
  selected: boolean;
  onSelect: () => void;
  onConfirm: () => void | Promise<void>;
  busy: boolean;
  highlight?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const primaryReason = guard.reasons[0];
  const lastHeLabel = guard.lastOvertime
    ? new Date(String(guard.lastOvertime).replace(" ", "T")).toLocaleDateString("pt-BR")
    : "Sem HE registrada";

  return (
    <article className={`hole-suggest-row ${selected ? "is-selected" : ""} ${highlight ? "is-primary" : ""}`}>
      <button type="button" className="hole-suggest-row-main" onClick={onSelect}>
        <div>
          <strong>{guard.name}</strong>
          <span>
            {guard.registration} · {guard.platoon || "Sem equipe"}
          </span>
          {primaryReason && <em>{primaryReason}</em>}
          {guard.reasons.slice(1, 3).map((r) => (
            <small key={r}>· {r}</small>
          ))}
        </div>
        <aside className="hole-suggest-row-stats">
          <b>{formatHoursDuration(guard.currentHeHours)}</b>
          <span>HE no mês</span>
          <small>Última HE: {lastHeLabel}</small>
        </aside>
      </button>
      {selected && (
        <div className="hole-suggest-confirm">
          <button
            type="button"
            className="save"
            disabled={busy || confirming}
            onClick={async () => {
              setConfirming(true);
              try {
                await onConfirm();
              } finally {
                setConfirming(false);
              }
            }}
          >
            {confirming ? "Confirmando…" : `Confirmar ${guard.name}`}
          </button>
          <span>Confirma o GM escalado no turno inteiro como HE.</span>
        </div>
      )}
    </article>
  );
}
