"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatHoursDuration } from "../lib/shift-rules";
import { fullPeriodLabel } from "../lib/shift-rules";

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
};

type State = {
  date: string;
  shift: string;
  postId: number | null;
  vehicleId: number | null;
  role: string | null;
  suggestions: Suggested[];
  summary?: { blocked: number; scheduledToday: number; totalGuards: number };
};

export function HoleSuggestBox({
  date,
  shift,
  postId,
  vehicleId,
  role,
  resourceLabel,
  onPick,
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
  onManual: () => void;
  onClose: () => void;
  busy: boolean;
  position?: { top: number; left: number } | null;
}) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    const params = new URLSearchParams({
      date,
      shift,
      suggest: "1",
      _: String(Date.now()),
    });
    if (postId) params.set("postId", String(postId));
    if (vehicleId) params.set("vehicleId", String(vehicleId));
    if (role) params.set("role", role);
    fetch(`/api/schedule?${params}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar as sugestões.");
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, postId, vehicleId, role]);

  const filtered = useMemo(() => {
    const list = data?.suggestions || [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((s) =>
      `${s.name} ${s.registration} ${s.platoon || ""}`.toLowerCase().includes(q),
    );
  }, [data, query]);

  useEffect(() => {
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered]);

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

  const style = position
    ? { top: `${position.top}px`, left: `${position.left}px` }
    : undefined;

  return (
    <div
      className="hole-suggest-card"
      ref={cardRef}
      style={style as React.CSSProperties}
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
              {data.summary.blocked} indisponíveis por afastamento.
            </p>
          )}
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
                  selected={selectedId === guard.id}
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
                  selected={selectedId === guard.id}
                  onSelect={() => setSelectedId(guard.id)}
                  onConfirm={confirmSuggestion(guard)}
                  busy={busy}
                />
              ))}
            </section>
          )}
          <footer>
            <button type="button" className="hole-suggest-manual" onClick={onManual}>
              Ver todos os GMs (manual)
            </button>
            <small>A sugestão nunca é aplicada sem confirmação.</small>
          </footer>
        </>
      )}
    </div>
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