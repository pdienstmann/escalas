"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ModuleLoading } from "./module-loading";
import { readClientCache, writeClientCache } from "./client-cache";
import { BackToSchedule } from "./schedule-nav";
import { useScheduleDate } from "./use-schedule-date";

type Item = Record<string, string | number | null>;
const noticesCacheKey = "gmnh:notices";
const noticesCacheTtl = 10 * 60_000;
function readNoticesCache() {
  const value = readClientCache<Item[]>(noticesCacheKey, noticesCacheTtl);
  return Array.isArray(value) ? value : null;
}

export function NoticesDashboard() {
  const { date } = useScheduleDate();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/notices?_=${Date.now()}`, { cache: "no-store" });
      const json = await response.json() as { items?: Item[]; error?: string };
      if (!response.ok) throw new Error(String(json.error || "Não foi possível carregar as alterações."));
      const nextItems = json.items || [];
      setItems(nextItems);
      writeClientCache(noticesCacheKey, nextItems);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar as alterações.");
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const cachedItems = readNoticesCache();
    if (cachedItems) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(cachedItems);
      setLoaded(true);
    }
    void load();
  }, [load]);

  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);

  async function act(body: Record<string, unknown>) {
    if (saving) return false;
    setSaving(true);
    try {
      const response = await fetch("/api/notices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json() as { message?: string; error?: string };
      setMessage(response.ok ? json.message || "Alteração atualizada." : json.error || "Não foi possível salvar.");
      if (!response.ok) return false;
      await load();
      return true;
    } catch {
      setMessage("A alteração não foi salva. Verifique a conexão e tente novamente.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await act({ ...Object.fromEntries(new FormData(form)), action: "create" })) form.reset();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (await act({ ...Object.fromEntries(new FormData(event.currentTarget)), action: "update", id: editing.id })) setEditing(null);
  }

  if (!loaded) return <ModuleLoading area="alteracoes" detail="Sincronizando lembretes operacionais..." />;

  if (busy) return <ModuleLoading area="alterações diversas" detail="Carregando lembretes operacionais…" />;

  return <main className="notices-page">
    <header><BackToSchedule date={date}/><div><span>LEMBRETES OPERACIONAIS</span><h1>Alterações diversas</h1><p>Registre uma mudança e ela será lembrada automaticamente na escala da data.</p></div></header>
    <section className="notices-summary"><b>{pending.length}</b><span>alterações pendentes de conferência</span></section>
    <div className="notices-layout">
      <form className="notice-form" onSubmit={create}>
        <h2>Nova alteração</h2>
        <label>Data<input name="effectiveDate" type="date" defaultValue={date} required /></label>
        <label>Título<input name="title" placeholder="Ex.: VTR 1337 em manutenção" required /></label>
        <label>Detalhes<textarea name="details" placeholder="Orientação que deve aparecer ao abrir a escala" /></label>
        <button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar lembrete"}</button>
        {message && <p role="status">{message}</p>}
      </form>
      <section className="notice-list">
        <h2>Registros</h2>
        {items.length === 0 ? <p>Nenhuma alteração registrada.</p> : items.map((item) => <article className={String(item.status)} key={String(item.id)}>
          <time>{new Date(`${item.effective_date}T12:00:00`).toLocaleDateString("pt-BR")}</time>
          <div><b>{item.title}</b><p>{item.details || "Sem observação adicional."}</p></div>
          <span>{item.status === "pending" ? "Pendente" : "Conferida"}</span>
          <footer>
            <button type="button" disabled={saving} onClick={() => void act({ action: item.status === "pending" ? "acknowledge" : "reopen", id: item.id })}>{item.status === "pending" ? "Marcar conferida" : "Reabrir"}</button>
            <button type="button" disabled={saving} onClick={() => setEditing(item)}>Editar</button>
            <button type="button" className="danger-link" disabled={saving} onClick={() => confirm("Excluir esta alteração?") && void act({ action: "delete", id: item.id })}>Excluir</button>
          </footer>
        </article>)}
      </section>
    </div>
    {editing && <NoticeEditor key={String(editing.id)} notice={editing} saving={saving} onClose={() => setEditing(null)} onSave={saveEdit} />}
  </main>;
}

function NoticeEditor({ notice, saving, onClose, onSave }: { notice: Item; saving: boolean; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="notice-editor-backdrop"><form className="notice-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-editor-title" onSubmit={onSave}>
    <header><div><small>EDITAR ALTERAÇÃO</small><h2 id="notice-editor-title">{notice.title}</h2><p>Atualize a data ou a orientação sem criar outro registro.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
    <label>Data<input name="effectiveDate" type="date" defaultValue={String(notice.effective_date || "")} required /></label>
    <label>Título<input name="title" defaultValue={String(notice.title || "")} required /></label>
    <label>Detalhes<textarea name="details" rows={5} defaultValue={String(notice.details || "")} /></label>
    <footer><button type="button" onClick={onClose}>Cancelar</button><button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar alteração"}</button></footer>
  </form></div>;
}
