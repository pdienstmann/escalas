"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { readClientCache, writeClientCache } from "./client-cache";
import { ModuleBusyOverlay, ModuleLoading } from "./module-loading";
import { BackToSchedule, ScheduleNav } from "./schedule-nav";
import { useModuleUiState } from "./use-module-ui-state";
import { useScheduleDate } from "./use-schedule-date";

type Item = Record<string, string | number | null>;
type Data = {
  items: Item[];
  actor: { id: string; email: string; name: string };
  meta?: { page: number; pageSize: number; total: number };
};

const entityLabels: Record<string, string> = {
  assignment: "Escala", schedule: "Publicação", movement: "Movimentação", leave_choice: "Folga",
  guard: "GM", guard_import: "Importação de GMs", post: "Posto", section: "Seção", vehicle: "Viatura",
  vehicle_outage: "FA de viatura", vehicle_return_reconciliation: "Retorno de viatura", weekly_slot: "Padrão semanal",
  pattern_slot: "Padrão 12x36", pattern_config: "Configuração 12x36", schedule_pattern: "Aplicação de padrão", notice: "Alteração diversa",
};
const historyCacheTtl = 2 * 60_000;
const historyCacheKey = (entity: string, query: string, page: number) => `gmnh:history:${entity || "all"}:${query.trim().toLowerCase() || "all"}:${page}`;

function readHistoryCache(entity: string, query: string, page: number) {
  const value = readClientCache<Data>(historyCacheKey(entity, query, page), historyCacheTtl);
  return value && Array.isArray(value.items) && value.actor ? value : null;
}

export function HistoryDashboard() {
  const { date } = useScheduleDate();
  const [filters, setFilters] = useModuleUiState("historico", date, { entity: "", query: "", page: 1 });
  const { entity, query, page } = filters;
  const deferredQuery = useDeferredValue(query);
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const updateFilters = (next: Partial<typeof filters>) => setFilters((current) => ({ ...current, ...next }));
  const load = useCallback(async (background = false) => {
    const cached = readHistoryCache(entity, deferredQuery, page);
    if (cached && !background) setData(cached);
    if (background) setSyncing(true); else setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ _: String(Date.now()), page: String(page), pageSize: "40" });
      if (entity) params.set("entity", entity);
      if (deferredQuery) params.set("q", deferredQuery);
      const response = await fetch(`/api/history?${params}`, { cache: "no-store" });
      const next = await response.json() as Data & { error?: string };
      if (!response.ok || !Array.isArray(next.items)) throw new Error(String(next.error || "Não foi possível carregar o histórico."));
      setData(next);
      writeClientCache(historyCacheKey(entity, deferredQuery, page), next);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Não foi possível carregar o histórico.";
      if (background && cached) setMessage("O histórico continua visível enquanto a sincronização é repetida.");
      else setLoadError(text);
    } finally {
      if (background) setSyncing(false); else setLoading(false);
    }
  }, [deferredQuery, entity, page]);

  useEffect(() => {
    // The asynchronous loader owns the state transition; this only subscribes
    // the page to its current filter key.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(Boolean(readHistoryCache(entity, deferredQuery, page)));
  }, [deferredQuery, entity, page, load]);

  const grouped = useMemo(() => {
    const result: { label: string; items: Item[] }[] = [];
    for (const item of data?.items || []) {
      const label = new Date(String(item.created_at).replace(" ", "T") + "Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
      const group = result.find((entry) => entry.label === label);
      if (group) group.items.push(item); else result.push({ label, items: [item] });
    }
    return result;
  }, [data]);

  async function undo(item: Item) {
    if (!confirm(`Desfazer esta alteração?\n\n${item.summary}`)) return;
    setBusyId(Number(item.id)); setMessage("");
    try {
      const response = await fetch("/api/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", id: item.id }) });
      const result = await response.json() as { message?: string; error?: string };
      setMessage(response.ok ? String(result.message || "Alteração desfeita.") : String(result.error || "Não foi possível desfazer."));
      if (response.ok) await load(true);
    } catch { setMessage("Não foi possível desfazer agora. Tente novamente."); }
    finally { setBusyId(null); }
  }

  if (!data && loading) return <ModuleLoading area="histórico" detail="Carregando a trilha de auditoria..." />;
  if (!data) return <main className="history-page"><p className="history-empty">{loadError || "Não foi possível carregar o histórico."}</p><button onClick={() => void load()}>Tentar novamente</button></main>;
  const total = Number(data.meta?.total || data.items.length);
  const pageSize = Number(data.meta?.pageSize || 40);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return <main className="history-page">
    <ModuleBusyOverlay area="histórico" active={syncing || (loading && Boolean(data))} />
    <header><BackToSchedule date={date}/><div><span>RASTREABILIDADE OPERACIONAL</span><h1>Histórico de alterações</h1><p>{`Responsável atual: ${data.actor.name || data.actor.email}`}</p></div></header>
    <ScheduleNav date={date} active="/historico" />
    <section className="history-tools">
      <input value={query} onChange={(event) => updateFilters({ query: event.target.value, page: 1 })} placeholder="Buscar ação ou responsável..." />
      <select value={entity} onChange={(event) => updateFilters({ entity: event.target.value, page: 1 })}><option value="">Todos os módulos</option>{Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button onClick={() => void load()}>Atualizar</button>
      {(query || entity) && <button type="button" className="history-clear-filters" onClick={() => setFilters({ entity: "", query: "", page: 1 })}>Limpar filtros</button>}
    </section>
    {message && <p className="history-message" role="status">{message}</p>}
    {loadError && <p className="history-message" role="alert">{loadError}</p>}
    {grouped.length === 0 ? <p className="history-empty">Nenhuma alteração encontrada.</p> : <div className="history-groups">{grouped.map((group) => <section key={group.label}><h2>{group.label}</h2>{group.items.map((item) => <article className={item.undone_at ? "undone" : ""} key={String(item.id)}><div className="history-icon">{icon(String(item.entity_type))}</div><div className="history-copy"><b>{item.summary}</b><small>{entityLabels[String(item.entity_type)] || item.entity_type} · {time(item.created_at)}</small><span>Por {item.actor_name || item.actor_email}</span>{item.undone_at && <em>Desfeita por {item.undone_by_email} em {dateTime(item.undone_at)}</em>}<details><summary>Ver detalhes</summary><pre>{details(item)}</pre></details></div>{Number(item.undoable) === 1 && !item.undone_at && <button className="undo-button" disabled={busyId === Number(item.id)} onClick={() => void undo(item)}>{busyId === Number(item.id) ? "Desfazendo..." : "↶ Desfazer"}</button>}</article>)}</section>)}</div>}
    {total > pageSize && <nav className="history-pagination" aria-label="Páginas do histórico"><span>{total} alterações · página {page} de {totalPages}</span><button type="button" disabled={page <= 1 || syncing} onClick={() => updateFilters({ page: page - 1 })}>Anterior</button><button type="button" disabled={page >= totalPages || syncing} onClick={() => updateFilters({ page: page + 1 })}>Próxima</button></nav>}
  </main>;
}

const icon = (type: string) => type === "assignment" ? "▪" : type === "movement" ? "⇄" : type === "leave_choice" ? "✓" : type === "vehicle" ? "◈" : "✎";
const time = (value: Item[string]) => new Date(String(value).replace(" ", "T") + "Z").toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dateTime = (value: Item[string]) => new Date(String(value).replace(" ", "T") + "Z").toLocaleString("pt-BR");
function details(item: Item) {
  const parse = (value: Item[string]) => { if (!value) return null; try { return JSON.parse(String(value)); } catch { return String(value); } };
  return JSON.stringify({ antes: clean(parse(item.before_json)), depois: clean(parse(item.after_json)) }, null, 2);
}
function clean(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return value; const hidden = new Set(["created_at", "updated_at"]); return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.has(key))); }
