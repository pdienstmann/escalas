"use client";
import { FullPageLink as Link } from "./full-page-link";
import {
  DragEvent,
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
type Rec = Record<string, string | number | null>;
type State = {
  date: string;
  schedule: Rec;
  guards: Rec[];
  posts: Rec[];
  vehicles: Rec[];
  assignments: Rec[];
  removed: Rec[];
  movements: Rec[];
  notices: Rec[];
};
type Pick = {
  kind: "post" | "vehicle";
  resource: Rec;
  shift: string;
  assignment?: Rec;
};
const shifts = [
  { id: "2", label: "2º TURNO", time: "07:00–13:00" },
  { id: "3", label: "3º TURNO", time: "13:00–19:00" },
  { id: "4", label: "4º TURNO", time: "19:00–01:00" },
  { id: "1", label: "1º TURNO", time: "01:00–07:00" },
];
function times(date: string, shift: string) {
  const s = shifts.find((x) => x.id === shift)!;
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start: `${date}T${s.time.slice(0, 5)}`,
    end: `${shift === "4" ? next.toISOString().slice(0, 10) : date}T${s.time.slice(6, 11)}`,
  };
}
export function LiveSchedule() {
  const [data, setData] = useState<State | null>(null),
    [pick, setPick] = useState<Pick | null>(null),
    [message, setMessage] = useState(""),
    [date, setDate] = useState("2026-08-12"),
    [query, setQuery] = useState(""),
    [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      setPick(null);
      const r = await fetch(`/api/schedule?date=${date}`);
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setMessage(
        "Não foi possível consultar a escala. Recarregue a página para tentar novamente.",
      );
    }
  }, [date]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const resources = useMemo(() => {
    if (!data) return [];
    const all = [
      ...data.vehicles.map((r) => ({
        kind: "vehicle" as const,
        r,
        section: "VIATURAS E ZONAS",
      })),
      ...data.posts.map((r) => ({
        kind: "post" as const,
        r,
        section: String(r.group_name || "POSTOS"),
      })),
    ];
    return all.filter((x) =>
      `${x.r.name || ""} ${x.r.prefix || ""} ${x.r.zone || ""} ${x.r.group_name || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  }, [data, query]);
  async function postAssignment(body: Record<string, unknown>) {
    if (saving) return false;
    setSaving(true);
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setMessage(r.ok ? "Alteração salva e já exibida na escala." : j.error);
      if (r.ok) {
        setData((current) =>
          current
            ? {
                ...current,
                assignments: j.deletedId
                  ? current.assignments.filter((a) => a.id !== j.deletedId)
                  : j.assignment
                    ? [
                        ...current.assignments.filter(
                          (a) => a.id !== j.assignment.id,
                        ),
                        j.assignment,
                      ]
                    : current.assignments,
              }
            : current,
        );
        setPick(null);
      }
      return r.ok;
    } finally {
      setSaving(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !pick) return;
    const body = Object.fromEntries(new FormData(e.currentTarget)),
      [destination, id] = String(body.destination).split(":");
    await postAssignment({
      ...body,
      id: pick.assignment?.id || null,
      scheduleId: data.schedule.id,
      postId: destination === "post" ? Number(id) : null,
      vehicleId: destination === "vehicle" ? Number(id) : null,
    });
  }
  async function remove() {
    if (pick?.assignment)
      await postAssignment({ action: "delete", id: pick.assignment.id });
  }
  async function move(
    assignment: Rec,
    kind: "post" | "vehicle",
    resource: Rec,
    shift: string,
  ) {
    if (!data) return;
    const t = times(data.date, shift),
      currentCount = data.assignments.filter(
        (a) =>
          (kind === "post"
            ? a.post_id === resource.id
            : a.vehicle_id === resource.id) && a.shift === shift,
      ).length;
    await postAssignment({
      id: assignment.id,
      scheduleId: data.schedule.id,
      guardId: assignment.guard_id,
      postId: kind === "post" ? resource.id : null,
      vehicleId: kind === "vehicle" ? resource.id : null,
      shift,
      role:
        kind === "post" ? "guard" : currentCount === 0 ? "driver" : "patrol",
      startsAt: t.start,
      endsAt: t.end,
      status: assignment.status,
      requestRef: assignment.request_ref || null,
    });
  }
  if (!data)
    return (
      <main className="live-loading">
        {message || "Preparando a escala operacional…"}
      </main>
    );
  const holes = resources.reduce(
    (sum, x) =>
      sum +
      shifts.filter(
        (s) =>
          data.assignments.filter(
            (a) =>
              (x.kind === "post"
                ? a.post_id === x.r.id
                : a.vehicle_id === x.r.id) && a.shift === s.id,
          ).length < (x.kind === "vehicle" ? 2 : 1),
      ).length,
    0,
  );
  return (
    <main className="app compact">
      <header className="topbar">
        <div className="brand">
          <span className="crest">GM</span>
          <div>
            <b>Escala diária</b>
            <small>Guarda Municipal de Novo Hamburgo</small>
          </div>
        </div>
        <div className="date">
          <input
            aria-label="Data da escala"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="stats">
          <span>
            <b>{data.assignments.length}</b> escalados
          </span>
          <span className="warn">
            <b>{data.removed.length}</b> afastados
          </span>
          <span className="danger">
            <b>{holes}</b> furos
          </span>
        </div>
        <Link className="primary top-action" href={`/validacao?date=${date}`}>
          Validar e publicar
        </Link>
      </header>
      <nav className="tabs">
        <b>Escala</b>
        <Link href="/padroes">Padrões 12x36</Link>
        <Link href="/movimentacoes">Movimentações</Link>
        <Link href="/horas-extras">Horas extras</Link>
        <Link href="/alteracoes">Alterações diversas</Link>
        <Link href="/folgas">Folgas mensais</Link>
        <Link href="/cadastros">Cadastros</Link>
      </nav>
      <section className="toolbar">
        <strong>Dados reais</strong>
        <span className="sync">● sincronizado</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar posto, viatura ou zona…"
        />
        <Link className="toolbar-link" href={`/impressao?date=${date}`}>
          Gerar PDF
        </Link>
      </section>
      {data.notices?.length > 0 && (
        <section className="daily-notices">
          <b>Alterações previstas para esta data</b>
          {data.notices.map((n) => (
            <span key={n.id}>{n.title}</span>
          ))}
          <Link href="/alteracoes">Conferir</Link>
        </section>
      )}
      {message && (
        <div className="schedule-toast" role="status">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      <div className="workspace">
        <section className="schedule-wrap">
          <div className="drag-help">
            Arraste um GM para outra célula ou clique para editar todos os
            campos.
          </div>
          <table className="schedule">
            <thead>
              <tr>
                <th rowSpan={2}>POSTO / RECURSO</th>
                <th colSpan={2}>DIURNO</th>
                <th colSpan={2}>NOTURNO</th>
              </tr>
              <tr>
                {shifts.map((s) => (
                  <th key={s.id}>
                    {s.label} · {s.time}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map(({ kind, r, section }, index) => (
                <Row
                  key={`${kind}-${r.id}`}
                  kind={kind}
                  resource={r}
                  assignments={data.assignments}
                  section={section}
                  first={
                    index === 0 || resources[index - 1].section !== section
                  }
                  selectedId={Number(pick?.assignment?.id || 0)}
                  onPick={setPick}
                  onMove={move}
                />
              ))}
            </tbody>
          </table>
          <section className="movement-grid">
            <h2>Efetivo retirado automaticamente</h2>
            <p>
              Movimentações aprovadas não aparecem nos postos e deixam o furo
              visível.
            </p>
            <div>
              {data.movements.length ? (
                data.movements.map((m) => (
                  <article key={m.id}>
                    <b>{m.guard_name}</b>
                    <strong>{labelStatus(String(m.type))}</strong>
                    <small>{movementDetail(m)}</small>
                    {m.request_ref && <em>Req. {m.request_ref}</em>}
                  </article>
                ))
              ) : (
                <p>Nenhum afastamento nesta data.</p>
              )}
            </div>
          </section>
        </section>
        <aside className={`editor ${pick ? "editor-active" : ""}`}>
          {pick ? (
            <Editor
              key={String(
                pick.assignment?.id ||
                  `${pick.kind}-${pick.resource.id}-${pick.shift}`,
              )}
              pick={pick}
              data={data}
              saving={saving}
              onClose={() => setPick(null)}
              onSave={save}
              onRemove={remove}
            />
          ) : (
            <div className="empty">
              <h2>Edição rápida</h2>
              <p>
                Selecione um GM ou uma vaga. Também é possível arrastar um nome
                para outro posto ou turno.
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function movementDetail(m: Rec) {
  const start = new Date(String(m.starts_at));
  const end = new Date(String(m.ends_at));
  const date = (value: Date) => value.toLocaleDateString("pt-BR");
  const time = (value: Date) =>
    value.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (m.type === "medical_leave") return `Afastado até ${date(end)}`;
  if (m.type === "vacation" || m.type === "course")
    return `Período: ${date(start)} a ${date(end)}`;
  if (m.type === "day_off" || m.type === "technical_reserve")
    return `Dia ${date(start)}`;
  return `${date(start)} · ${time(start)}–${time(end)}`;
}
function Row({
  kind,
  resource,
  assignments,
  section,
  first,
  selectedId,
  onPick,
  onMove,
}: {
  kind: "post" | "vehicle";
  resource: Rec;
  assignments: Rec[];
  section: string;
  first: boolean;
  selectedId: number;
  onPick: (p: Pick) => void;
  onMove: (a: Rec, k: "post" | "vehicle", r: Rec, s: string) => void;
}) {
  function drop(e: DragEvent, shift: string) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/assignment")),
      assignment = assignments.find((a) => a.id === id);
    if (assignment) void onMove(assignment, kind, resource, shift);
  }
  return (
    <Fragment>
      {first && (
        <tr
          className={`group ${section === "SEDE DA GM" ? "headquarters" : ""}`}
        >
          <td colSpan={5}>
            {kind === "vehicle" ? "▰" : "◆"} {section}
          </td>
        </tr>
      )}
      <tr>
        <td className="resource">
          <span className="vehicle">
            {kind === "vehicle" ? vehicleIcon(String(resource.type)) : ""}
          </span>
          <div>
            <b>{kind === "vehicle" ? resource.prefix : resource.name}</b>
            <small>
              {kind === "vehicle"
                ? `⌖ ${resource.zone || "Zona não definida"}`
                : resource.group_name}
            </small>
          </div>
        </td>
        {shifts.map((s) => {
          const list = assignments.filter(
              (a) =>
                (kind === "post"
                  ? a.post_id === resource.id
                  : a.vehicle_id === resource.id) && a.shift === s.id,
            ),
            need = kind === "vehicle" ? 2 : 1;
          return (
            <td
              key={s.id}
              className={`${list.length < need ? "furo" : ""} drop-cell`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, s.id)}
            >
              {list.map((a) => (
                <button
                  draggable
                  className={`live-person ${a.status} ${Number(a.id) === selectedId ? "is-selected" : ""}`}
                  key={a.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/assignment", String(a.id));
                  }}
                  onClick={() =>
                    onPick({ kind, resource, shift: s.id, assignment: a })
                  }
                >
                  {kind === "vehicle" && (
                    <span className="role">
                      {a.role === "driver" ? "M" : "P"}
                    </span>
                  )}
                  <b>{a.guard_name}</b>
                  {a.status !== "normal" && (
                    <span className={`badge ${statusClass(String(a.status))}`}>
                      {statusShort(String(a.status))}
                    </span>
                  )}
                  <small>
                    {String(a.starts_at).slice(11, 16)}–
                    {String(a.ends_at).slice(11, 16)}
                  </small>
                </button>
              ))}
              {list.length < need && (
                <button
                  className="live-hole"
                  onClick={() => onPick({ kind, resource, shift: s.id })}
                >
                  <span>FURO</span>＋ Selecionar{" "}
                  {kind === "vehicle"
                    ? list.length === 0
                      ? "motorista"
                      : "patrulheiro"
                    : "GM"}
                </button>
              )}
            </td>
          );
        })}
      </tr>
    </Fragment>
  );
}
function Editor({
  pick,
  data,
  saving,
  onClose,
  onSave,
  onRemove,
}: {
  pick: Pick;
  data: State;
  saving: boolean;
  onClose: () => void;
  onSave: (e: FormEvent<HTMLFormElement>) => void;
  onRemove: () => void;
}) {
  const a = pick.assignment,
    t = times(data.date, pick.shift),
    [guardId, setGuardId] = useState(String(a?.guard_id || "")),
    guard = data.guards.find((g) => String(g.id) === guardId);
  return (
    <form onSubmit={onSave}>
      <div className="editor-head">
        <div>
          <span className="editing-pill">
            {a ? "EDITANDO GM" : "PREENCHENDO VAGA"}
          </span>
          <h2 aria-live="polite">{guard?.name || "Selecione um GM"}</h2>
          <p>
            {pick.kind === "vehicle"
              ? pick.resource.prefix
              : pick.resource.name}{" "}
            · {shifts.find((s) => s.id === pick.shift)?.label}
          </p>
        </div>
        <button
          className="editor-close"
          type="button"
          onClick={onClose}
          aria-label="Fechar editor"
        >
          ×
        </button>
      </div>
      <div className="editing-alert">
        <b>Confira antes de salvar:</b>
        <span>{guard?.name || "nenhum GM selecionado"}</span>
      </div>
      <label>
        Guarda
        <select
          name="guardId"
          value={guardId}
          onChange={(e) => setGuardId(e.target.value)}
          required
        >
          <option value="">Selecionar GM</option>
          {data.guards.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {g.name} · {g.platoon}
            </option>
          ))}
        </select>
      </label>
      <label>
        Destino
        <select
          name="destination"
          defaultValue={`${pick.kind}:${pick.resource.id}`}
        >
          {data.vehicles.map((v) => (
            <option key={`v${v.id}`} value={`vehicle:${v.id}`}>
              {v.prefix} · {v.zone}
            </option>
          ))}
          {data.posts.map((p) => (
            <option key={`p${p.id}`} value={`post:${p.id}`}>
              {p.group_name} · {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Turno
        <select name="shift" defaultValue={pick.shift}>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.time}
            </option>
          ))}
        </select>
      </label>
      <label>
        Função
        <select
          name="role"
          defaultValue={String(
            a?.role ||
              (pick.kind === "vehicle"
                ? data.assignments.filter(
                    (x) =>
                      x.vehicle_id === pick.resource.id &&
                      x.shift === pick.shift,
                  ).length
                  ? "patrol"
                  : "driver"
                : "guard"),
          )}
        >
          <option value="guard">GM do posto</option>
          <option value="driver">M — Motorista</option>
          <option value="patrol">P — Patrulheiro</option>
          <option value="third">3º integrante</option>
        </select>
      </label>
      <div className="two">
        <label>
          Entrada
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={String(a?.starts_at || t.start)}
            required
          />
        </label>
        <label>
          Saída
          <input
            name="endsAt"
            type="datetime-local"
            defaultValue={String(a?.ends_at || t.end)}
            required
          />
        </label>
      </div>
      <label>
        Situação
        <select name="status" defaultValue={String(a?.status || "normal")}>
          <option value="normal">Normal</option>
          <option value="overtime">Hora extra</option>
          <option value="time_bank">Banco de horas</option>
          <option value="swap">Troca de serviço</option>
        </select>
      </label>
      <label>
        Requerimento
        <input
          name="requestRef"
          defaultValue={String(a?.request_ref || "")}
          placeholder="Número ou referência"
        />
      </label>
      <button className="save" disabled={saving}>
        {saving ? "Salvando…" : "Salvar alteração"}
      </button>
      {a && (
        <button
          type="button"
          className="remove"
          disabled={saving}
          onClick={onRemove}
        >
          Remover da escala
        </button>
      )}
    </form>
  );
}
const vehicleIcon = (t: string) =>
  t === "moto" ? "◉" : t === "pickup" ? "▰" : t === "van" ? "▣" : "▱";
const statusClass = (s: string) =>
  s === "overtime" ? "he" : s === "time_bank" ? "bh" : "troca";
const statusShort = (s: string) =>
  s === "overtime" ? "HE" : s === "time_bank" ? "BH" : "TROCA";
const labelStatus = (s: string) =>
  ({
    day_off: "Folga",
    vacation: "Férias",
    course: "Curso",
    medical_leave: "Licença",
    time_bank: "Banco de horas",
    swap: "Troca",
  })[s] || s;
