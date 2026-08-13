"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ModuleBusyOverlay, ModuleLoading } from "./module-loading";
import { BackToSchedule, ScheduleNav } from "./schedule-nav";
import { normalizeLeaveDisplayName, normalizeLeaveName, preferredLeaveNameMatch } from "../lib/leave-name";
import { useScheduleDate } from "./use-schedule-date";
type Item = Record<string, string | number | null>;
type LeaveOverviewDay = {
  date: string;
  total: number;
  day: number;
  night: number;
  vehicleTotal: number;
  roles: Record<"driver" | "patrol" | "third" | "guard" | "unassigned", number>;
  patterns: string[];
  vehicleRisks: Array<{vehicle:string;members:Array<{name:string;role:string}>}>;
  severity: "critical" | "attention" | "normal";
};
type LeaveOverview = {
  month: string;
  totalLeaves: number;
  average: number;
  criticalThreshold: number;
  criticalDays: number;
  attentionDays: number;
  vehicleLeaves: number;
  days: LeaveOverviewDay[];
};
type Data = {
  guards: Item[];
  posts: Item[];
  vehicles: Item[];
  movements: Item[];
  campaign: Item | null;
  days: Item[];
  choices: Item[];
  vehicleOutages: Item[];
  vehicleCrews: Item[];
  sections: Item[];
  vehicleReturnImpacts: Item[];
  serviceAdjustments: Item[];
  leaveOverview: LeaveOverview | null;
  operationalGroups: Item[];
  operationalGroupMembers: Item[];
};
const empty: Data = {
  guards: [],
  posts: [],
  vehicles: [],
  movements: [],
  campaign: null,
  days: [],
  choices: [],
  vehicleOutages: [],
  vehicleCrews: [],
  sections: [],
  vehicleReturnImpacts: [],
  serviceAdjustments: [],
  leaveOverview: null,
  operationalGroups: [],
  operationalGroupMembers: [],
};

const adminCachePrefix = "escala-admin-cache:";
function readAdminCache(date: string): Data | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${adminCachePrefix}${date}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<Data>;
    if (!Array.isArray(cached.guards) || !Array.isArray(cached.posts) || !Array.isArray(cached.vehicles)) return null;
    return { ...empty, ...cached } as Data;
  } catch {
    return null;
  }
}
function writeAdminCache(date: string, value: Data) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${adminCachePrefix}${date}`, JSON.stringify(value));
  } catch {
    // A full or unavailable session storage must never block the operational screen.
  }
}

const modeLabel = {
  cadastros: "cadastros operacionais",
  viaturas: "gestão de viaturas",
  folgas: "folgas mensais",
  movimentos: "movimentações do efetivo",
  ajustes: "banco de horas e trocas",
} as const;
const displayRegistration=(value:unknown)=>{const text=String(value||"");return /^SEM-MATRICULA-/i.test(text)?"":text};

export function GestaoClient({
  mode,
}: {
  mode: "cadastros" | "viaturas" | "folgas" | "movimentos" | "ajustes";
}) {
  const { date } = useScheduleDate();
  const [data, setData] = useState<Data>(empty),
    [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState(""),
    [adjustmentSubtype, setAdjustmentSubtype] = useState("negative_early"),
    [negativeHoursInput, setNegativeHoursInput] = useState("2"),
    [settleNegative, setSettleNegative] = useState(false),
    [movementEditing,setMovementEditing]=useState<Item|null>(null),
    [returningOutage,setReturningOutage]=useState<Item|null>(null),
    [returnPreview,setReturnPreview]=useState<{outage:Item;impacts:Item[]}|null>(null),
    [sectionEditor, setSectionEditor] = useState<Item | null>(null),
    [editing, setEditing] = useState<{
      kind: "guard" | "post" | "vehicle";
      item: Item;
    } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin?date=${date}&_=${Date.now()}`, { cache: "no-store" });
      const next = await r.json() as Data & { error?: string };
      if (!r.ok) throw new Error(String(next.error || "Nao foi possivel sincronizar os dados operacionais."));
      setData(next);
      writeAdminCache(date, next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel sincronizar os dados operacionais.");
    } finally {
      setBusy(false);
    }
  }, [date]);
  useEffect(() => {
    const cached = readAdminCache(date);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(cached);
      setBusy(false);
    }
    // The first request synchronizes this client view with the durable D1 state.
    void load();
  }, [date, load]);
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const keepAdding = action === "movement" && submitter?.value === "continue";
    const repeatValues = keepAdding ? { type: String(body.type || "vacation"), startsAt: String(body.startsAt || date), endsAt: String(body.endsAt || date) } : null;
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, action }),
      });
      const j = await r.json();
      setMessage(
        r.ok
          ? j.status === "waitlist"
            ? "Limite atingido: solicitação incluída na lista de espera."
            : j.message || "Registro salvo com sucesso."
          : j.error,
      );
      if (r.ok) {
        form.reset();
        if (repeatValues) {
          const setValue = (name: string, value: string) => { const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null; if (field) field.value = value; };
          setValue("type", repeatValues.type);
          setValue("startsAt", repeatValues.startsAt);
          setValue("endsAt", repeatValues.endsAt);
          window.setTimeout(() => (form.elements.namedItem("guardId") as HTMLSelectElement | null)?.focus(), 0);
          setMessage("Afastamento incluído. Selecione o próximo GM; tipo e período foram mantidos.");
        }
        const catalogKey = action === "guard" ? "guards" : action === "post" ? "posts" : action === "vehicle" ? "vehicles" : null;
        if (catalogKey && j.entity) {
          setData((current) => {
            const items = [...current[catalogKey], j.entity as Item];
            items.sort((a, b) => {
              if (catalogKey === "posts") return Number(a.sort_order || 99) - Number(b.sort_order || 99) || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
              return String(a[catalogKey === "vehicles" ? "prefix" : "name"] || "").localeCompare(String(b[catalogKey === "vehicles" ? "prefix" : "name"] || ""), "pt-BR");
            });
            const next = { ...current, [catalogKey]: items } as Data;
            if (action === "post") {
              const sectionKey = `POST:${String(body.groupName || "").trim()}`;
              if (sectionKey !== "POST:" && !next.sections.some((section) => String(section.section_key) === sectionKey)) {
                next.sections = [...next.sections, { section_key: sectionKey, label: String(body.groupName), sort_order: Number(body.sortOrder || 99) }].sort((a, b) => Number(a.sort_order || 99) - Number(b.sort_order || 99));
              }
            }
            writeAdminCache(date, next);
            return next;
          });
          return;
        }
        if (action === "movement" && j.movement) {
          setData((current) => ({
            ...current,
            movements: [j.movement, ...current.movements].slice(0, 30),
          }));
          return;
        }
        if (action === "leave") {
          const leaveDate = String(body.date);
          const guard = data.guards.find(
            (item) => Number(item.id) === Number(body.guardId),
          );
          setData((current) => ({
            ...current,
            choices: [
              ...current.choices,
              {
                id: Number(j.choiceId),
                guard_id: Number(body.guardId),
                guard_name: String(guard?.name || "GM"),
                date: leaveDate,
                category: String(body.category),
                status: String(j.status),
              },
            ],
            days: current.days.map((day) =>
              day.date === leaveDate && j.status === "confirmed"
                ? { ...day, used: Number(day.used) + 1 }
                : day,
            ),
          }));
          return;
        }
        await load();
      }
    } finally {
      setSaving(false);
    }
  }
  async function catalogSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || saving) return;
    setSaving(true); setMessage("");
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          id: editing.item.id,
          entity: editing.kind,
          action: "catalog_update",
        }),
      });
      const j = await r.json();
      setMessage(r.ok ? "Cadastro atualizado com sucesso." : j.error);
      if (r.ok) {
        setEditing(null);
        await load();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o cadastro.");
    } finally {
      setSaving(false);
    }
  }
  // Kept as a compatibility handler for old admin links; the visible editor
  // now lives in the Padrões module.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function operationalGroupAction(body: Record<string, string | number | null>) {
    if (saving) return false;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { message?: string; error?: string };
      setMessage(response.ok ? String(result.message || "Grupamento atualizado.") : String(result.error || "Não foi possível atualizar o grupamento."));
      if (response.ok) await load();
      return response.ok;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o grupamento.");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function deactivate(kind: "guard" | "post" | "vehicle", item: Item) {
    if (!confirm(`Desativar ${String(item.name || item.prefix)}?`)) return;
    if (saving) return;
    setSaving(true); setMessage("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "catalog_deactivate",
          entity: kind,
          id: item.id,
        }),
      });
      const j = await r.json();
      setMessage(r.ok ? "Cadastro desativado." : j.error);
      if (r.ok) await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível desativar o cadastro.");
    } finally {
      setSaving(false);
    }
  }
  async function reorderPost(item: Item, direction: "up" | "down") {
    if (saving) return;
    setSaving(true); setMessage("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "post_reorder", id: item.id, direction }),
      });
      const j = await r.json();
      setMessage(r.ok ? "Ordem da escala atualizada." : j.error);
      if (r.ok) await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a ordem.");
    } finally {
      setSaving(false);
    }
  }
  async function reorderSection(sectionKey: string, direction: "up" | "down") {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "section_reorder", sectionKey, direction }),
      });
      const j = await r.json();
      setMessage(r.ok ? "Ordem das seções atualizada na escala e no PDF." : j.error);
      if (r.ok) await load();
    } finally {
      setSaving(false);
    }
  }
  async function saveSection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sectionEditor || saving) return;
    setSaving(true);
    setMessage("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "section_update",
          sectionKey: sectionEditor.section_key,
          label: String(body.label || "").trim(),
        }),
      });
      const j = await r.json();
      setMessage(r.ok ? "Seção renomeada. A ordem vale para a escala e o PDF." : j.error);
      if (r.ok) {
        setSectionEditor(null);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }
  async function importGuards(rows: Array<{ registration: string; name: string; platoon: string; baseShift: string }>) {
    setMessage("");
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "guard_import", rows }),
    });
    const j = await r.json();
    setMessage(r.ok ? `${j.count} GMs importados ou atualizados.` : j.error);
    if (r.ok) await load();
  }
  async function importLeaves(month:string,rows:Array<{guardId?:number;guardName?:string;date:string;shift?:"day"|"night"}>,newGuards:Array<{name:string;registration?:string;platoon?:string;baseShift?:string}>) {
    if(saving)return;
    setSaving(true);setMessage("Importando folgas: preparando registros e conferindo GMs...");
    try{
      const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"leave_import",month,rows,newGuards})});
      const j=await r.json();setMessage(r.ok?j.message:j.error||"A importação não foi concluída.");
      if(r.ok)await load();
      return r.ok;
    }catch(error){setMessage(error instanceof Error?`Importação interrompida: ${error.message}`:"Importação interrompida. Tente novamente.");return false}
    finally{setSaving(false)}
  }
  async function choiceAction(
    action: "leave_approve" | "leave_cancel",
    id: Item["id"],
  ) {
    setMessage("");
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id }),
    });
    const j = await r.json();
    setMessage(
      r.ok
        ? action === "leave_approve"
          ? "Folga aprovada e integrada à escala."
          : j.promotedGuardName
            ? `Solicitação cancelada. ${j.promotedGuardName} foi promovido(a) automaticamente da lista de espera.`
            : "Solicitação cancelada."
        : j.error,
    );
    if (r.ok) await load();
  }
  async function previewVehicleReturn(returnOn:string){
    if(!returningOutage)return;setSaving(true);setMessage("");
    try{const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"vehicle_outage_return_preview",id:returningOutage.id,returnOn})});const j=await r.json();if(r.ok)setReturnPreview(j);else setMessage(j.error)}finally{setSaving(false)}
  }
  async function confirmVehicleReturn(returnOn:string){
    if(!returningOutage)return;setSaving(true);setMessage("");
    try{const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"vehicle_outage_return",id:returningOutage.id,returnOn})});const j=await r.json();setMessage(r.ok?j.message:j.error);if(r.ok){setReturningOutage(null);setReturnPreview(null);await load()}}finally{setSaving(false)}
  }
  async function reconcileVehicleReturn(id:Item["id"],decision:"keep"|"show"|"restore"){
    setSaving(true);setMessage("");
    try{const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"vehicle_return_reconcile",id,decision})});const j=await r.json();setMessage(r.ok?j.message:j.error);if(r.ok)await load()}finally{setSaving(false)}
  }
  async function quickOutage(vehicle:Item){
    if(!confirm(`Marcar ${String(vehicle.prefix)} em FA por prazo indeterminado a partir de hoje?`))return;
    setSaving(true);setMessage("");
    try{const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"vehicle_outage",vehicleId:vehicle.id,reason:"FA por prazo indeterminado"})});const j=await r.json();setMessage(r.ok?j.message:j.error);if(r.ok)await load()}finally{setSaving(false)}
  }
  async function movementAction(action:"movement_update"|"movement_delete",body:Record<string,string|number|null>) {
    if(action==="movement_delete"&&!confirm("Remover esta movimentação? A escala será recalculada imediatamente."))return;
    setMessage("");
    const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,action})});
    const j=await r.json();
    setMessage(r.ok?(action==="movement_delete"?"Movimentação removida.":"Movimentação atualizada."):j.error);
    if(r.ok){setMovementEditing(null);await load()}
  }
  async function saveServiceAdjustment(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (String(values.subtype) === "negative_full" && !confirm("Confirmar retirada integral deste GM da escala na data informada?")) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create_service_adjustment", ...values }),
      });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (response.ok) { form.reset(); setAdjustmentSubtype("negative_early"); setNegativeHoursInput("2"); setSettleNegative(false); await load(); }
    } finally { setSaving(false); }
  }
  async function cancelServiceAdjustment(item:Item) {
    if (!confirm(`Cancelar o lançamento de ${String(item.guard_name)} e restaurar a escala?`)) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/schedule", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"cancel_service_adjustment",id:item.id}) });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error);
      if (response.ok) await load();
    } finally { setSaving(false); }
  }
  if (busy)
    return <ModuleLoading area={modeLabel[mode]} detail="Sincronizando cadastros e regras operacionais…" />;
  if (mode === "cadastros")
    return (
      <Module
        date={date}
        title="Cadastros operacionais"
        subtitle="Pessoas, postos e viaturas alimentam a mesma escala diária."
        active="/cadastros"
        busy={saving}
       busyArea={saving&&mode==="folgas"?"importação das folgas":modeLabel[mode]}
      >
        <div className="forms-grid">
          <Form title="Novo GM" onSubmit={(e) => submit(e, "guard")}>
            <input name="registration" placeholder="Matrícula" required />
            <input name="name" placeholder="Nome de escala" required />
            <input name="platoon" placeholder="Pelotão" />
            <select name="baseShift">
              <option>12x36 dia</option>
              <option>12x36 noite</option>
              <option>Semanal</option>
            </select>
            <select name="workRegime"><option value="12x36">Plantão 12x36</option><option value="weekly">Semanal</option></select>
          </Form>
          <Form title="Novo posto" onSubmit={(e) => submit(e, "post")}>
            <input name="name" placeholder="Nome do posto" required />
            <input
              name="groupName"
              placeholder="Seção / grupo"
              defaultValue="SEDE DA GM"
              required
            />
            <input name="sortOrder" type="number" placeholder="Ordem" />
          </Form>
        </div>
        <p className="catalog-groups-handoff">A composição de grupamentos e equipes foi movida para <b>Padrões 12x36</b>, onde o vínculo pode ser definido por D1, D2, N1, N2 ou para todos os padrões.</p>
        <div className="catalog-tools">
          <SectionOrder sections={data.sections} onReorder={(key, direction) => void reorderSection(key, direction)} onRename={setSectionEditor} />
          <GuardImport onImport={(rows) => void importGuards(rows)} />
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {sectionEditor && (
          <div className="catalog-backdrop section-editor-backdrop">
            <form className="catalog-editor section-editor" onSubmit={(e) => void saveSection(e)}>
              <header>
                <div>
                  <small>ORDEM NA ESCALA E NO PDF</small>
                  <h3>Editar seção</h3>
                </div>
                <button type="button" className="editor-close" onClick={() => setSectionEditor(null)} aria-label="Fechar">×</button>
              </header>
              <label>
                Nome exibido
                <input name="label" defaultValue={String(sectionEditor.label || "")} required />
              </label>
              <p className="section-editor-help">Essa ordem e o nome valem tanto na escala operacional quanto no PDF impresso.</p>
              <button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar seção"}</button>
            </form>
          </div>
        )}

        <div className="records">
          <Record
            kind="guard"
            title="Guardas"
            items={data.guards}
            main="name"
            detail="registration"
            saving={saving}
            onEdit={(item) => setEditing({ kind: "guard", item })}
            onDeactivate={deactivate}
          />
          <Record
            kind="post"
            title="Postos e seções"
            items={data.posts}
            main="name"
            detail="group_name"
            saving={saving}
            onEdit={(item) => setEditing({ kind: "post", item })}
            onDeactivate={deactivate}
            onReorder={reorderPost}
          />
        </div>
        {editing && (
          <CatalogEditor
            editing={editing}
            saving={saving}
            onClose={() => setEditing(null)}
            onSubmit={catalogSubmit}
          />
        )}
      </Module>
    );
  if (mode === "viaturas")
    return (
      <Module
        date={date}
        title="Viaturas"
        subtitle={`Panorama operacional da frota em ${new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR")}.`}
        active="/viaturas"
        busy={saving}
        busyArea={modeLabel[mode]}
      >
        <FleetPanorama
          date={date}
          vehicles={data.vehicles}
          outages={data.vehicleOutages}
          crews={data.vehicleCrews}
          saving={saving}
          onEdit={(item) => setEditing({ kind: "vehicle", item })}
          onQuickOutage={(item)=>void quickOutage(item)}
          onClearOutage={(id)=>{const outage=data.vehicleOutages.find(item=>Number(item.id)===Number(id));if(outage){setReturningOutage(outage);setReturnPreview(null)}}}
        />
        {data.vehicleReturnImpacts.length>0&&<VehicleReturnPending items={data.vehicleReturnImpacts} saving={saving} onDecision={(id,decision)=>void reconcileVehicleReturn(id,decision)}/>}
        <div className="fleet-admin-grid">
          <Form title="Nova viatura" onSubmit={(e) => submit(e, "vehicle")}>
            <input name="prefix" placeholder="VTR 0000" required />
            <select name="type">
              <option value="sedan">Sedan</option>
              <option value="pickup">Caminhonete</option>
              <option value="van">Furgão</option>
              <option value="moto">Moto</option>
              <option value="suv">SUV</option>
            </select>
            <input name="zone" placeholder="Zona de atuação" />
          </Form>
          <FleetAvailability
            date={date}
          vehicles={data.vehicles}
          outages={data.vehicleOutages}
          saving={saving}
          onSubmit={(e) => submit(e, "vehicle_outage")}
            onDelete={(id) => {const outage=data.vehicleOutages.find(item=>Number(item.id)===Number(id));if(outage){setReturningOutage(outage);setReturnPreview(null)}}}
          />
        </div>
        {message && <p className="notice" role="status">{message}</p>}
        <Record
          kind="vehicle"
          title="Cadastro da frota"
          items={data.vehicles}
          main="prefix"
          detail="zone"
          saving={saving}
          onEdit={(item) => setEditing({ kind: "vehicle", item })}
          onDeactivate={deactivate}
        />
        {editing && (
          <CatalogEditor
            editing={editing}
            saving={saving}
            onClose={() => setEditing(null)}
            onSubmit={catalogSubmit}
          />
        )}
        {returningOutage&&<VehicleReturnDialog outage={returningOutage} preview={returnPreview} saving={saving} onClose={()=>{setReturningOutage(null);setReturnPreview(null)}} onPreview={(returnOn)=>void previewVehicleReturn(returnOn)} onConfirm={(returnOn)=>void confirmVehicleReturn(returnOn)}/>}
      </Module>
    );
  if (mode === "movimentos")
    return (
      <Module
        date={date}
        title="Movimentações do efetivo"
        subtitle="Afastamentos aprovados retiram o GM da escala e abrem o furo correspondente."
        active="/movimentacoes"
        busy={saving}
        busyArea={modeLabel[mode]}
      >
        <Form
          title="Novo afastamento / indisponibilidade"
          onSubmit={(e) => submit(e, "movement")}
          submitLabel="Salvar e concluir"
        >
          <div className="field-caption"><span>GM</span><GuardSelect guards={data.guards} /></div>
          <label className="field-caption">Tipo de registro<select name="type" defaultValue="vacation">
            <option value="day_off">Folga</option>
            <option value="vacation">Férias</option>
            <option value="course">Curso</option>
            <option value="medical_leave">Atestado / licença</option>
            <option value="technical_reserve">Reserva técnica</option>
            <option value="time_bank">Banco de horas</option>
            <option value="other_leave">Outro afastamento</option>
          </select></label>
          <div className="two movement-date-fields">
            <label className="field-caption">Início<input name="startsAt" type="date" defaultValue={date} required /></label>
            <label className="field-caption">Retorno (inclusive)<input name="endsAt" type="date" defaultValue={date} required /></label>
          </div>
          <small className="form-hint">Use o mesmo dia nos dois campos para um afastamento de um dia. O retorno é aplicado automaticamente à escala.</small>
          <label className="field-caption">Nº do requerimento<input name="requestRef" placeholder="Opcional" /></label>
          <label className="field-caption">Observação / destino<input name="notes" placeholder="Opcional" /></label>
          <div className="movement-submit-actions"><button type="submit" name="movementSubmit" value="continue">Salvar e adicionar outro</button><small>Mantém tipo e datas para lançamentos em sequência.</small></div>
        </Form>
        {message && <p className="notice">{message}</p>}
        <MovementRecords
          title="Afastamentos registrados"
          items={data.movements}
          saving={saving}
          onEdit={setMovementEditing}
          onDelete={(item)=>void movementAction("movement_delete",{id:item.id})}
        />
        {movementEditing&&<MovementEditor item={movementEditing} guards={data.guards} onClose={()=>setMovementEditing(null)} onSubmit={(body)=>void movementAction("movement_update",body)}/>}
      </Module>
    );
  if (mode === "ajustes")
    return (
      <Module
        date={date}
        title="Banco de horas e trocas"
        subtitle="Registre o requerimento uma vez e aplique o ajuste automaticamente na escala da data."
        active="/bancos"
        busy={saving}
        busyArea={modeLabel[mode]}
      >
        <div className="service-adjustment-layout">
          <Form title="Novo banco ou troca" onSubmit={(e) => void saveServiceAdjustment(e)}>
            <select name="subtype" required value={adjustmentSubtype} onChange={(event) => { const value = event.target.value; setAdjustmentSubtype(value); setNegativeHoursInput(value === "negative_full" ? "12" : "2"); setSettleNegative(false); }}>
              <option value="negative_early">BH- · sair mais cedo</option>
              <option value="negative_late">BH- · iniciar mais tarde</option>
              <option value="negative_full">BH- · retirar o dia inteiro</option>
              <option value="positive">BH+ · pagar banco em dia extra</option>
              <option value="swap">Troca de serviço · dois GMs</option>
            </select>
            <div className="field-caption"><span>GM que assume o primeiro serviço</span><GuardSelect guards={data.guards} /></div>
            <label className="field-caption" hidden={adjustmentSubtype !== "swap"}>GM que assume o segundo serviço (somente troca)
              <select name="counterpartGuardId" defaultValue="">
                <option value="">Selecione o segundo GM</option>
                {data.guards.map((guard) => <option key={guard.id} value={String(guard.id)}>{guard.name}</option>)}
              </select>
            </label>
            <div className="two">
              <label className="field-caption">Dia do primeiro serviço<input name="serviceDate" type="date" defaultValue={date} required /></label>
              <label className="field-caption" hidden={adjustmentSubtype !== "swap"}>Dia do segundo serviço (troca)<input name="counterpartServiceDate" type="date" defaultValue={date} /></label>
            </div>
            <div className="two">
              <label className="field-caption" hidden={adjustmentSubtype === "negative_full"}>Início do primeiro serviço<input name="startsAt" type="datetime-local" defaultValue={`${date}T07:00`} required={adjustmentSubtype !== "negative_full"} /></label>
              <label className="field-caption" hidden={adjustmentSubtype === "negative_full"}>Fim do primeiro serviço<input name="endsAt" type="datetime-local" defaultValue={`${date}T19:00`} required={adjustmentSubtype !== "negative_full"} /></label>
            </div>
            <div className="two">
              <label className="field-caption" hidden={adjustmentSubtype !== "swap"}>Início do segundo serviço<input name="counterpartStartsAt" type="datetime-local" defaultValue={`${date}T07:00`} /></label>
              <label className="field-caption" hidden={adjustmentSubtype !== "swap"}>Fim do segundo serviço<input name="counterpartEndsAt" type="datetime-local" defaultValue={`${date}T19:00`} /></label>
            </div>
            {adjustmentSubtype.startsWith("negative_") && <>
              <label className="field-caption adjustment-hours-field">Quantidade do BH- (horas)<input name="negativeHours" type="number" min="0.5" max="24" step="0.5" value={adjustmentSubtype === "negative_full" ? "12" : negativeHoursInput} onChange={(event) => setNegativeHoursInput(event.target.value)} readOnly={adjustmentSubtype === "negative_full"} required /></label>
              <label className="settlement-toggle"><input name="settlementEnabled" value="1" type="checkbox" checked={settleNegative} onChange={(event) => setSettleNegative(event.target.checked)} /> Pagar este BH- com BH+ em outro dia</label>
              {settleNegative && <div className="settlement-fields">
                <strong>Pagamento do BH+ (mesma quantidade de horas)</strong>
                <div className="two">
                  <label className="field-caption">Dia do BH+<input name="settlementDate" type="date" min={nextDateValue(date)} defaultValue={nextDateValue(date)} /></label>
                  <label className="field-caption">Início do BH+<input key={`settlement-start-${adjustmentSubtype}`} name="settlementStartsAt" type="datetime-local" defaultValue={`${nextDateValue(date)}T07:00`} /></label>
                  <label className="field-caption">Fim do BH+<input key={`settlement-end-${adjustmentSubtype}`} name="settlementEndsAt" type="datetime-local" defaultValue={`${nextDateValue(date)}T${adjustmentSubtype === "negative_full" ? "19:00" : "09:00"}`} /></label>
                </div>
                <small>O GM ficará à disposição no dia escolhido. O intervalo do BH+ deve corresponder exatamente à quantidade de horas informada. Depois, ele poderá ser colocado em um posto ou viatura.</small>
              </div>}
            </>}
            <input name="requestRef" placeholder="Nº do requerimento" required />
            <input name="notes" placeholder="Observação ou motivo" />
            <small className="service-adjustment-help">Na troca, o primeiro dia é o serviço originalmente do segundo GM; o segundo dia é o serviço originalmente do primeiro GM. BH- de entrada tardia usa o intervalo entre o início previsto e o horário em que o GM realmente começa.</small>
          </Form>
          <section className="service-adjustment-guide">
            <h3>Como cada opção funciona</h3>
            <p><b>BH- parcial:</b> encurta o horário e destaca o quadradinho.</p>
            <p><b>BH- entrada tardia:</b> desloca o início do card para o horário informado.</p>
            <p><b>BH- + BH+:</b> informe a quantidade de horas e marque o pagamento em outro dia; o mesmo requerimento cria o GM à disposição para o BH+.</p>
            <p><b>BH- integral:</b> remove o GM do dia, sem apagar o cadastro.</p>
            <p><b>BH+:</b> coloca o GM à disposição; ao escalar, o requerimento acompanha o card.</p>
            <p><b>Troca:</b> use dois dias: o GM selecionado assume o serviço do segundo GM no primeiro dia, e o segundo GM assume o serviço do selecionado no segundo dia.</p>
          </section>
        </div>
        {message && <p className="notice" role="status">{message}</p>}
        <section className="service-adjustment-records">
          <header><div><small>LANÇAMENTOS ATIVOS DO MÊS</small><h3>Banco de horas e trocas aplicados</h3></div><span>{data.serviceAdjustments.length}</span></header>
          {data.serviceAdjustments.length ? data.serviceAdjustments.map((item) => (
            <article key={String(item.id)} className={`service-adjustment-card ${String(item.subtype)}`}>
              <div><b>{String(item.guard_name)}</b>{item.counterpart_guard_name && <span> ⇄ {String(item.counterpart_guard_name)}</span>}<small>{serviceAdjustmentRangeWithSettlement(item)}</small></div>
              <div><strong>{item.request_ref ? `Req. ${item.request_ref}` : "Sem requerimento"}</strong>{item.notes && <small>{String(item.notes)}</small>}</div>
              <button type="button" className="danger-link" onClick={() => void cancelServiceAdjustment(item)}>Cancelar e restaurar</button>
            </article>
          )) : <p>Nenhum banco ou troca ativo neste mês.</p>}
        </section>
      </Module>
    );
  const campaign = data.campaign;
  // O status histórico continua disponível para auditoria, mas nunca trava
  // a edição da tela de folgas.
  const campaignLocked = false;
  const leaveDaysByDate = [...new Map(data.days.map((day) => [String(day.date), day])).keys()].map((dateKey) => data.days.find((day) => String(day.date) === dateKey && !String(day.platoon || "").trim()) || data.days.find((day) => String(day.date) === dateKey)!).filter(Boolean);
  const leavePlatoons = [...new Set(data.guards.map((guard) => String(guard.platoon || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return (
    <Module
      date={date}
      title={String(campaign?.title || "Folgas mensais")}
      subtitle="Cada GM escolhe uma data útil e uma data de fim de semana. A capacidade é atualizada automaticamente."
      active="/folgas"
      busy={saving}
      busyArea={modeLabel[mode]}
    >
      <p className="leave-editing-note" role="status">Edição livre: importe, ajuste ou remova folgas a qualquer momento. As alterações são aplicadas às escalas automaticamente.</p>
      <LeaveMonthOverview overview={data.leaveOverview} />
      <LeaveImport
        guards={data.guards}
        choices={data.choices}
        defaultMonth={String(campaign?.month||date.slice(0,7))}
        saving={saving}
        locked={campaignLocked}
        onImport={importLeaves}
      />
      <section className="leave-limit-panel">
        <header>
          <div><small>CAPACIDADE DA CAMPANHA</small><h3>Limite por dia, equipe e turno</h3><p>Use o limite geral ou crie uma regra para equipe/pelotão, turno diurno/noturno ou os dois. A regra mais específica tem prioridade.</p></div>
        </header>
        <form onSubmit={(event) => void submit(event, "leave_limit_set")}>
          <input type="hidden" name="campaignId" value={String(campaign?.id || "")} />
          <label>Dia<select name="date" required disabled={campaignLocked} defaultValue={String(leaveDaysByDate[0]?.date || "")}>
            <option value="">Selecione uma data</option>
            {leaveDaysByDate.map((day) => <option key={String(day.date)} value={String(day.date)}>{formatDate(day.date)}</option>)}
          </select></label>
          <label>Escopo<select name="platoon" disabled={campaignLocked} defaultValue="">
            <option value="">Limite geral do dia</option>
            {leavePlatoons.map((platoon) => <option key={platoon} value={platoon}>Equipe / pelotão {platoon}</option>)}
          </select></label>
          <label>Turno<select name="shift" disabled={campaignLocked} defaultValue="">
            <option value="">Todos os turnos</option>
            <option value="day">Diurno (2º + 3º)</option>
            <option value="night">Noturno (4º + 1º)</option>
          </select></label>
          <label>Máximo de folgas<input name="capacity" type="number" min="0" max="500" step="1" defaultValue="3" disabled={campaignLocked} required /></label>
          <button className="save" disabled={saving||campaignLocked}>Salvar limite</button>
        </form>
      </section>
      <div className="leave-layout">
        <Form title="Registrar escolha" disabled={campaignLocked} onSubmit={(e) => submit(e, "leave")}>
          <input
            type="hidden"
            name="campaignId"
            value={String(campaign?.id || "")}
          />
          <GuardSelect guards={data.guards} />
          <select name="category">
            <option value="weekday">Folga durante a semana</option>
            <option value="weekend">Folga no fim de semana</option>
          </select>
          <select name="date" required>
            <option value="">Selecione uma data</option>
            {leaveDaysByDate.map((d) => (
              <option key={String(d.date)} value={String(d.date)}>
                {formatDate(d.date)} · {Number(d.capacity) - Number(d.used)}{" "}
                vagas
              </option>
            ))}
          </select>
        </Form>
        <section className="capacity">
          <h3>Capacidade por dia</h3>
          {data.days.map((d) => (
            <div key={`${String(d.date)}:${String(d.platoon || "geral")}`}>
              <span>{formatDate(d.date)}{d.platoon ? ` · ${String(d.platoon)}` : " · geral"}{d.shift ? ` · ${String(d.shift) === "night" ? "noite" : "dia"}` : ""}</span>
              <progress value={Number(d.used)} max={Math.max(1, Number(d.capacity))} />
              <b>
                {d.used}/{d.capacity}
              </b>
            </div>
          ))}
        </section>
      </div>
      {message && <p className="notice">{message}</p>}
      <LeaveRecords
        items={data.choices}
        onAction={(action, id) => void choiceAction(action, id)}
      />
    </Module>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function OperationalGroupsPanel({
  groups,
  members,
  guards,
  posts,
  vehicles,
  saving,
  onAction,
}: {
  groups: Item[];
  members: Item[];
  guards: Item[];
  posts: Item[];
  vehicles: Item[];
  saving: boolean;
  onAction: (body: Record<string, string | number | null>) => Promise<boolean>;
}) {
  const [resourceKind, setResourceKind] = useState<"guard" | "post" | "vehicle">("guard");
  const [resourceId, setResourceId] = useState("");
  const [groupId, setGroupId] = useState("");
  const resourceOptions = resourceKind === "guard"
    ? guards.map((item) => ({ id: item.id, label: `${item.name}${displayRegistration(item.registration) ? ` · ${displayRegistration(item.registration)}` : " · sem matrícula"}` }))
    : resourceKind === "post"
      ? posts.map((item) => ({ id: item.id, label: `${item.name} · ${item.group_name || "Posto"}` }))
      : vehicles.map((item) => ({ id: item.id, label: `${item.prefix} · ${item.zone || "Zona não definida"}` }));
  const resourceLabel = (member: Item) => {
    const source = member.resource_kind === "guard" ? guards : member.resource_kind === "post" ? posts : vehicles;
    const item = source.find((candidate) => Number(candidate.id) === Number(member.resource_id));
    return item ? String(item.name || item.prefix) : `Recurso ${member.resource_id}`;
  };
  const submit = async (event: FormEvent<HTMLFormElement>, action: string, extra: Record<string, string | number | null> = {}) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string | number | null>;
    await onAction({ ...values, ...extra, action });
  };
  return <section className="operational-groups-panel">
    <header>
      <div><small>ORGANIZAÇÃO DO EFETIVO</small><h2>Grupamentos e equipes</h2><p>Cadastre ou edite GESCOM, CANIL, ROMU, Ambiental, Patrulha Rural e outros. Um vínculo pode ter uma equipe Alfa, Bravo, Charlie ou outra identificação.</p></div>
      <span>{groups.length} grupamentos</span>
    </header>
    <div className="operational-groups-layout">
      <form className="operational-group-create" onSubmit={(event) => void submit(event, "operational_group_create")}>
        <h3>Novo grupamento</h3>
        <label>Nome exibido<input name="name" placeholder="Ex.: ROMU" required /></label>
        <label>Sigla curta<input name="shortName" placeholder="Ex.: ROMU" /></label>
        <div className="two"><label>Cor<input name="color" type="color" defaultValue="#1769aa" /></label><label>Ordem<input name="sortOrder" type="number" defaultValue="99" min="0" /></label></div>
        <button className="save" disabled={saving}>＋ Criar grupamento</button>
      </form>
      <form className="operational-group-link" onSubmit={(event) => void submit(event, "operational_group_member_set")}>
        <h3>Vincular recurso</h3>
        <p>Escolha um cadastro já existente. Ao trocar de grupamento, o vínculo anterior é substituído.</p>
        <label>Tipo<select value={resourceKind} onChange={(event) => { setResourceKind(event.target.value as typeof resourceKind); setResourceId(""); }}><option value="guard">GM</option><option value="post">Posto</option><option value="vehicle">Viatura</option></select></label>
        <label>Recurso<select name="resourceId" value={resourceId} onChange={(event) => setResourceId(event.target.value)} required><option value="">Selecione</option>{resourceOptions.map((option) => <option key={String(option.id)} value={String(option.id)}>{option.label}</option>)}</select></label>
        <label>Grupamento<select name="groupId" value={groupId} onChange={(event) => setGroupId(event.target.value)} required><option value="">Selecione</option>{groups.map((group) => <option key={String(group.id)} value={String(group.id)}>{group.name}</option>)}</select></label>
        <label>Equipe interna (opcional)<input name="teamLabel" list="operational-team-options" placeholder="Alfa, Bravo, Charlie…" /><datalist id="operational-team-options"><option value="ALFA"/><option value="BRAVO"/><option value="CHARLIE"/><option value="DELTA"/><option value="ECHO"/><option value="FOXTROT"/></datalist></label>
        <input type="hidden" name="resourceKind" value={resourceKind} />
        <button className="save" disabled={saving || !resourceId || !groupId}>Vincular ao grupamento</button>
      </form>
    </div>
    <div className="operational-group-list">
      {groups.map((group) => {
        const groupMembers = members.filter((member) => Number(member.group_id) === Number(group.id));
        return <article key={String(group.id)} className="operational-group-card" style={{ borderTopColor: String(group.color || "#1769aa") }}>
          <form onSubmit={(event) => void submit(event, "operational_group_update", { id: group.id })}>
            <div className="operational-group-card-head"><span className="operational-group-swatch" style={{ background: String(group.color || "#1769aa") }} /><input name="name" defaultValue={String(group.name || "")} aria-label="Nome do grupamento" required /><span className="operational-group-count">{groupMembers.length} vínculos</span></div>
            <div className="operational-group-edit-fields"><input name="shortName" defaultValue={String(group.short_name || "")} aria-label="Sigla curta" placeholder="Sigla curta" /><input name="color" type="color" defaultValue={String(group.color || "#1769aa")} aria-label="Cor" /><input name="sortOrder" type="number" defaultValue={String(group.sort_order || 99)} aria-label="Ordem" min="0" /><button disabled={saving}>Salvar</button><button type="button" className="danger-link" disabled={saving} onClick={() => { if (confirm(`Remover o grupamento ${String(group.name)}? Os cadastros não serão apagados.`)) void onAction({ action: "operational_group_delete", id: group.id }); }}>Remover</button></div>
          </form>
          {groupMembers.length ? <div className="operational-group-members">{groupMembers.map((member) => <span key={String(member.id)}><b>{resourceLabel(member)}</b><small>{member.resource_kind === "guard" ? "GM" : member.resource_kind === "post" ? "Posto" : "VTR"}{member.team_label ? ` · Equipe ${member.team_label}` : ""}</small><button type="button" aria-label={`Remover ${resourceLabel(member)} do grupamento`} disabled={saving} onClick={() => void onAction({ action: "operational_group_member_remove", resourceKind: String(member.resource_kind), resourceId: Number(member.resource_id) })}>×</button></span>)}</div> : <p className="operational-group-empty">Nenhum GM, posto ou viatura vinculado ainda.</p>}
        </article>;
      })}
    </div>
  </section>;
}

function SectionOrder({sections,onReorder,onRename}:{sections:Item[];onReorder:(key:string,direction:"up"|"down")=>void;onRename:(section:Item)=>void}) {
  return <section className="section-order">
    <header><div><small>ORDEM NA ESCALA E NO PDF</small><h3>Seções operacionais</h3></div><span>{sections.length}</span></header>
    <p>A mesma lista ordenada alimenta a escala operacional e o documento impresso. Use Editar para renomear em painel.</p>
    <div className="section-order-list">{sections.map((section,index)=><div key={String(section.section_key)}>
      <b><span>{index+1}</span>{String(section.label)}</b>
      <span className="record-actions">
        <button type="button" className="section-edit-btn" aria-label={`Renomear ${section.label}`} onClick={()=>onRename(section)}>Editar</button>
        <button type="button" disabled={index===0} aria-label={`Mover ${section.label} para cima`} onClick={()=>onReorder(String(section.section_key),"up")}>↑</button>
        <button type="button" disabled={index===sections.length-1} aria-label={`Mover ${section.label} para baixo`} onClick={()=>onReorder(String(section.section_key),"down")}>↓</button>
      </span>
    </div>)}</div>
  </section>
}

function GuardImport({onImport}:{onImport:(rows:Array<{registration:string;name:string;platoon:string;baseShift:string}>)=>Promise<void>|void}) {
  const [raw,setRaw]=useState("");
  const [sending,setSending]=useState(false);
  const rows=useMemo(()=>raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,index)=>{
    const parts=(line.includes("\t")?line.split("\t"):line.split(/[;,]/)).map(value=>value.trim());
    return {registration:parts[0]||"",name:parts[1]||"",platoon:parts[2]||"",baseShift:parts[3]||"12x36 dia",index};
  }).filter((row,index)=>!(index===0&&/matr[ií]cula|registro/i.test(`${row.registration} ${row.name}`))).filter(row=>row.registration&&row.name),[raw]);
  async function send(){if(!rows.length)return;setSending(true);await onImport(rows.map(({registration,name,platoon,baseShift})=>({registration,name,platoon,baseShift})));setSending(false);setRaw("")}
  return <section className="import-panel">
    <header><div><small>SUBSTITUIÇÃO GRADUAL DOS DADOS</small><h3>Importar GMs</h3></div><span>{rows.length} válidos</span></header>
    <p>Cole diretamente do Excel ou Google Planilhas: matrícula, nome, equipe e regime. A matrícula identifica e atualiza um cadastro existente.</p>
    <textarea value={raw} onChange={event=>setRaw(event.target.value)} rows={6} placeholder={"Matrícula\tNome de escala\tEquipe\t12x36 dia\n12345\tSILVA\tD1\t12x36 dia"}/>
    {rows.length>0&&<div className="import-preview"><b>Pré-visualização</b>{rows.slice(0,3).map(row=><span key={`${row.registration}-${row.index}`}><strong>{row.registration}</strong>{row.name}<small>{row.platoon||"Sem equipe"} · {row.baseShift}</small></span>)}{rows.length>3&&<em>+ {rows.length-3} linhas</em>}</div>}
    <button className="save" disabled={!rows.length||sending} onClick={()=>void send()}>{sending?"Importando…":`Confirmar importação${rows.length?` (${rows.length})`:""}`}</button>
  </section>
}
type ParsedLeave={line:number;shift:string;guardId:number|null;guardName:string;dates:string[];problems:string[]};
function splitLeaveImportRecords(raw:string){
  const withoutMarkers=raw.replace(/\[(?:\d+)\]/g," ");
  const normalized=withoutMarkers.replace(/\r?\n/g," ").replace(/\s+/g," ").trim();
  if(!normalized)return [] as Array<{source:string;shift:string;line:number}>;
  const starts=[...normalized.matchAll(/\b(DIA|NOITE)\b/gi)].map(match=>({index:match.index??0,shift:String(match[1]).toUpperCase()}));
  if(!starts.length)return withoutMarkers.split(/\r?\n/).map((source,index)=>({source:source.trim().replace(/\s+/g," "),shift:"",line:index+1})).filter(item=>item.source);
  return starts.map((start,index)=>({source:normalized.slice(start.index,starts[index+1]?.index??normalized.length).trim(),shift:start.shift,line:index+1}));
}
function parseLeaveImport(raw:string,guards:Item[],month:string):ParsedLeave[]{
  const [year,monthNumber]=month.split("-").map(Number),exactByName=new Map(guards.map(guard=>[normalizeLeaveDisplayName(String(guard.name)),guard])),compactCandidates=new Map<string,Item[]>();
  guards.forEach(guard=>{const key=normalizeLeaveName(String(guard.name));compactCandidates.set(key,[...(compactCandidates.get(key)||[]),guard])});
  return splitLeaveImportRecords(raw).filter(item=>item.source&&!/^\s*(?:DIA|NOITE)\s+GM\b/i.test(item.source)).map(({source,line,shift})=>{
    const matches=[...source.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)];
    const prefix=(matches.length?source.slice(0,matches[0].index):source).replace(/^\s*(DIA|NOITE)\s+/i,"").replace(/\t/g," ").trim();
    const displayPrefix=normalizeLeaveDisplayName(prefix),guard=(displayPrefix.includes(" ")?exactByName.get(displayPrefix):undefined)||preferredLeaveNameMatch(prefix,compactCandidates.get(normalizeLeaveName(prefix))||[]);
    const problems:string[]=[];
    if(!guard)problems.push(`GM não encontrado: ${prefix||"linha sem nome"}`);
    if(!matches.length)problems.push("Nenhuma data reconhecida");
    const dates=[...new Set(matches.flatMap(match=>{
      const day=Number(match[1]),candidateMonth=Number(match[2]),candidateYear=match[3]?Number(match[3].length===2?`20${match[3]}`:match[3]):year;
      const candidate=new Date(Date.UTC(candidateYear,candidateMonth-1,day));
      if(candidate.getUTCFullYear()!==candidateYear||candidate.getUTCMonth()!==candidateMonth-1||candidate.getUTCDate()!==day){problems.push(`Data inválida: ${match[0]}`);return []}
      if(candidateYear!==year||candidateMonth!==monthNumber){problems.push(`Data fora de ${month}: ${match[0]}`);return []}
      return [`${candidateYear}-${String(candidateMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`];
    }))];
    return {line,shift,guardId:guard?Number(guard.id):null,guardName:String(guard?.name||prefix||"GM não identificado"),dates,problems};
  });
}
type LeaveImportRow={guardId?:number;guardName?:string;date:string;shift?:"day"|"night"};
function LeaveImport({guards,choices,defaultMonth,saving,locked=false,onImport}:{guards:Item[];choices:Item[];defaultMonth:string;saving:boolean;locked?:boolean;onImport:(month:string,rows:LeaveImportRow[],newGuards:Array<{name:string;registration?:string;platoon?:string;baseShift?:string}>)=>Promise<boolean|undefined>}){
  const [raw,setRaw]=useState(""),[month,setMonth]=useState(defaultMonth),[reviewing,setReviewing]=useState(false),[newRegistrations,setNewRegistrations]=useState<Record<string,string>>({}),[newNames,setNewNames]=useState<Record<string,string>>({}),[confirmedNewGuards,setConfirmedNewGuards]=useState<Record<string,boolean>>({});
  const parsed=useMemo(()=>parseLeaveImport(raw,guards,month),[raw,guards,month]);
  const existing=new Set(choices.map(choice=>`${Number(choice.guard_id)}:${String(choice.date)}`));
  const unknownNames=[...new Map(parsed.filter(row=>!row.guardId&&row.guardName).map(row=>[normalizeLeaveName(row.guardName),row.guardName])).values()];
  const unknownShifts=new Map<string,Set<string>>();
  parsed.filter(row=>!row.guardId&&row.guardName).forEach(row=>{const key=normalizeLeaveName(row.guardName);unknownShifts.set(key,new Set([...(unknownShifts.get(key)||new Set<string>()),row.shift]))});
  const proposedName=(name:string)=>normalizeLeaveDisplayName(newNames[normalizeLeaveName(name)]||name);
  const newGuards=unknownNames.map(name=>({name:proposedName(name),registration:String(newRegistrations[normalizeLeaveName(name)]||"").trim(),baseShift:unknownShifts.get(normalizeLeaveName(name))?.has("NOITE")&&!unknownShifts.get(normalizeLeaveName(name))?.has("DIA")?"12x36 noite":"12x36 dia"}));
  const missingConfirmations=newGuards.filter(guard=>!confirmedNewGuards[normalizeLeaveName(guard.name)]).length;
  const unresolvedProblems=parsed.reduce((total,row)=>total+row.problems.filter(problem=>!problem.startsWith("GM não encontrado")).length,0);
  const validRows=parsed.flatMap(row=>row.dates.filter(date=>row.guardId? !existing.has(`${row.guardId}:${date}`):Boolean(confirmedNewGuards[normalizeLeaveName(row.guardName)])).map(date=>row.guardId?{guardId:Number(row.guardId),date,shift:row.shift==="NOITE"?"night":"day" as const}:{guardName:proposedName(row.guardName),date,shift:row.shift==="NOITE"?"night":"day" as const}));
  const problems=unresolvedProblems+missingConfirmations,recognized=parsed.reduce((total,row)=>total+row.dates.length,0);
  const recognizedDay=parsed.filter(row=>row.shift==="DIA").reduce((total,row)=>total+row.dates.length,0),recognizedNight=parsed.filter(row=>row.shift==="NOITE").reduce((total,row)=>total+row.dates.length,0);
  function rowHasProblem(row:ParsedLeave){return row.problems.some(problem=>!problem.startsWith("GM não encontrado"))||(!row.guardId&&!newRegistrations[normalizeLeaveName(row.guardName)]?.trim())}
  async function confirmImport(){if(locked||!validRows.length||problems||saving)return;const ok=await onImport(month,validRows,newGuards.filter(guard=>confirmedNewGuards[normalizeLeaveName(guard.name)]));if(ok){setRaw("");setReviewing(false);setNewRegistrations({});setNewNames({});setConfirmedNewGuards({})}}
  const reviewContent=reviewing?<div className="leave-import-review-v2"><header><div><small>ETAPA 2 DE 3 · CONFERÊNCIA</small><h3>Revise antes de incluir</h3><p>Nenhum dado foi salvo. Confira período, nome do GM e datas reconhecidas.</p></div><strong className={problems?"warning":"ready"}>{problems?`${problems} pendência(s)`:"Pronto para incluir"}</strong></header><div className="leave-review-period-summary"><span className="day"><b>DIA</b><strong>{recognizedDay}</strong><small>folgas reconhecidas</small></span><span className="night"><b>NOITE</b><strong>{recognizedNight}</strong><small>folgas reconhecidas</small></span><span><b>GMs</b><strong>{parsed.length}</strong><small>nomes encontrados</small></span></div><div className="leave-import-list">{parsed.map(row=><article key={`${row.line}-${row.guardName}`} className={`${!row.guardId&&!confirmedNewGuards[normalizeLeaveName(row.guardName)]?"invalid":""} ${row.shift.toLowerCase()}`}><span className={`leave-shift ${row.shift.toLowerCase()}`}>{row.shift||"-"}</span><div><b>{row.guardName}</b><small>Linha {row.line}</small>{!row.guardId&&<div className="leave-new-guard"><label className="leave-new-guard-confirm"><input type="checkbox" checked={Boolean(confirmedNewGuards[normalizeLeaveName(row.guardName)])} onChange={event=>setConfirmedNewGuards(current=>({...current,[normalizeLeaveName(row.guardName)]:event.target.checked}))}/><span>Confirmo cadastrar este GM</span></label><input value={newRegistrations[normalizeLeaveName(row.guardName)]||""} onChange={event=>setNewRegistrations(current=>({...current,[normalizeLeaveName(row.guardName)]:event.target.value}))} placeholder="Matrícula (opcional)"/><small>Sem matrícula: o cadastro ficará identificado dessa forma.</small></div>}</div><div className="leave-date-tags">{row.dates.map(date=><span key={date} className={row.guardId&&existing.has(`${row.guardId}:${date}`)?"existing":""}>{formatDate(date)}{row.guardId&&existing.has(`${row.guardId}:${date}`)?" · já incluída":""}</span>)}{row.problems.filter(problem=>!problem.startsWith("GM não encontrado")).map(problem=><em key={problem}>{problem}</em>)}{!row.guardId&&!confirmedNewGuards[normalizeLeaveName(row.guardName)]&&<em className="new-guard-note">Confirmação obrigatória antes de incluir</em>}</div></article>)}</div><footer><button type="button" onClick={()=>setReviewing(false)}>← Voltar e corrigir</button><button type="button" className="save" disabled={!validRows.length||Boolean(problems)||saving} onClick={()=>void confirmImport()}>{saving?"Importando...":`Incluir ${validRows.length} folgas confirmadas`}</button></footer></div>:null;
  return <section className="leave-import" aria-busy={saving}><fieldset disabled={locked}>
    <header><div><small>IMPORTAÇÃO DO COMPILADO MENSAL</small><h2>Importar folgas por copiar e colar</h2><p>Um fluxo seguro em três etapas. O sistema separa DIA e NOITE e só grava após sua confirmação.</p></div><label>Mês da importação<input type="month" value={month} disabled={locked} onChange={event=>{setMonth(event.target.value);setReviewing(false)}}/></label></header>
    <ol className="leave-import-steps"><li className={!reviewing?"active":"done"}><b>1</b><span><strong>Colar compilado</strong><small>Copie diretamente da planilha</small></span></li><li className={reviewing?"active":""}><b>2</b><span><strong>Conferir</strong><small>Dia, noite, nomes e datas</small></span></li><li><b>3</b><span><strong>Incluir</strong><small>Confirmação única e segura</small></span></li></ol>
    <div className="leave-import-paste"><label><span>Conteúdo copiado da planilha</span><textarea value={raw} disabled={locked} onChange={event=>{setRaw(event.target.value);setReviewing(false)}} rows={7} placeholder={"DIA\tALENCAR\t22/08 (SÁBADO)\t06/08 (QUINTA-FEIRA)\nNOITE\tALEXANDRE\t12/08\t14/08"}/></label><aside><b>Como importar</b><span>1. Selecione e copie as linhas da planilha.</span><span>2. Cole no campo ao lado.</span><span>3. Confira os totais de DIA e NOITE.</span><small>Nada será salvo nesta etapa.</small></aside></div>
    {unknownNames.length>0&&<div className="leave-import-name-corrections"><header><b>Confira os nomes novos</b><small>Os espaços fazem parte do nome. Corrija antes de revisar para evitar cadastros como “DESOUZA” ou “LUCASMARTINS”.</small></header>{unknownNames.map(name=>{const key=normalizeLeaveName(name);return <label key={key}><span>Texto reconhecido: <b>{name}</b></span><input value={newNames[key]??normalizeLeaveDisplayName(name)} onChange={event=>{setNewNames(current=>({...current,[key]:event.target.value}));setReviewing(false)}} placeholder="Nome completo do GM"/></label>})}</div>}
    <div className="leave-import-actions"><div className="leave-import-totals"><span className="day"><small>DIA</small><b>{recognizedDay}</b></span><span className="night"><small>NOITE</small><b>{recognizedNight}</b></span><span><small>GMs</small><b>{parsed.length}</b></span>{unknownNames.length>0&&<span className="warning"><small>NOVOS</small><b>{unknownNames.length}</b></span>}{problems>0&&<span className="danger"><small>PENDÊNCIAS</small><b>{problems}</b></span>}</div><button type="button" disabled={locked||!parsed.length} onClick={()=>setReviewing(true)}>Conferir {recognized} folgas →</button></div>
    {reviewing&&<div className="leave-import-review"><header><div><small>CONFIRMAÇÃO - NENHUM DADO SALVO AINDA</small><h3>Folgas de {month.split("-").reverse().join("/")}</h3><p>{unknownNames.length?`${unknownNames.length} GM(s) não cadastrado(s): informe a matrícula abaixo para criar e importar junto.`:"Todos os nomes foram encontrados no cadastro."}</p></div><strong className={problems?"warning":"ready"}>{problems?"Completar cadastro":`${validRows.length} novas folgas`}</strong></header><div className="leave-import-list">{parsed.map(row=><article key={`${row.line}-${row.guardName}`} className={rowHasProblem(row)?"invalid":""}><span className={`leave-shift ${row.shift.toLowerCase()}`}>{row.shift||"-"}</span><div><b>{row.guardName}</b><small>Linha {row.line}</small>{!row.guardId&&<label className="leave-new-guard"><span>GM novo · matrícula</span><input value={newRegistrations[normalizeLeaveName(row.guardName)]||""} onChange={event=>setNewRegistrations(current=>({...current,[normalizeLeaveName(row.guardName)]:event.target.value}))} placeholder="Informe a matrícula"/></label>}</div><div className="leave-date-tags">{row.dates.map(date=><span key={date} className={row.guardId&&existing.has(`${row.guardId}:${date}`)?"existing":""}>{formatDate(date)}{row.guardId&&existing.has(`${row.guardId}:${date}`)?" · já incluída":""}</span>)}{row.problems.filter(problem=>!problem.startsWith("GM não encontrado")).map(problem=><em key={problem}>{problem}</em>)}{!row.guardId&&<em className="new-guard-note">Será cadastrado após informar a matrícula</em>}</div></article>)}</div><footer><button type="button" onClick={()=>setReviewing(false)}>Voltar e corrigir</button><button type="button" className="save" disabled={!validRows.length||Boolean(problems)||saving} onClick={()=>void confirmImport()}>{saving?"Importando…":`Confirmar importação geral (${validRows.length})`}</button></footer></div>}
   </fieldset>{saving&&<div className="leave-import-progress" role="status"><span className="loading-spinner" aria-hidden="true"/><div><b>Incluindo folgas...</b><small>Todos os registros estão sendo processados. Não feche esta tela.</small></div></div>}{reviewContent}</section>
}
function LeaveMonthOverview({overview}:{overview:LeaveOverview|null}) {
  if(!overview)return <section className="leave-overview empty"><b>Panorama mensal</b><p>Abra uma campanha de folgas para visualizar os dias críticos.</p></section>;
  const [year,month]=overview.month.split("-").map(Number);
  const totalDays=new Date(year,month,0).getDate();
  const leading=(new Date(`${overview.month}-01T12:00:00`).getDay()+6)%7;
  const byDate=new Map(overview.days.map(day=>[day.date,day]));
  const calendar:Array<{date:string;number:number;day?:LeaveOverviewDay}|null>=[...Array(leading).fill(null)];
  for(let number=1;number<=totalDays;number++){
    const date=`${overview.month}-${String(number).padStart(2,"0")}`;
    calendar.push({date,number,day:byDate.get(date)});
  }
  const priorities=[...overview.days].sort((a,b)=>severityWeight(b.severity)-severityWeight(a.severity)||b.total-a.total||a.date.localeCompare(b.date)).slice(0,10);
  const monthlyAverage=overview.average.toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1});
  const totalDay=overview.days.reduce((sum,day)=>sum+day.day,0),totalNight=overview.days.reduce((sum,day)=>sum+day.night,0);
  const averageDay=(totalDay/Math.max(1,totalDays)).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1}),averageNight=(totalNight/Math.max(1,totalDays)).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1});
  return <section className="leave-overview">
    <header><div><small>PANORAMA DO MÊS</small><h2>Folgas por período de serviço</h2><p>Compare o impacto diurno e noturno separadamente. Um total igual pode representar distribuições operacionais completamente diferentes.</p></div></header>
    <div className="leave-period-summary">
      <article className="day"><header><span>☀</span><div><b>Diurno</b><small>2º + 3º turno</small></div><strong>{totalDay}</strong></header><p>Média de <b>{averageDay}</b> folga/dia</p></article>
      <article className="night"><header><span>☾</span><div><b>Noturno</b><small>4º + 1º turno</small></div><strong>{totalNight}</strong></header><p>Média de <b>{averageNight}</b> folga/dia</p></article>
      <aside><span><b>{overview.criticalDays}</b> dias críticos</span><span><b>{overview.vehicleLeaves}</b> folgas em viaturas</span><small>Média geral: {monthlyAverage}/dia</small></aside>
    </div>
    <div className="leave-overview-grid">
      <div className="leave-calendar-wrap">
        <div className="leave-calendar-weekdays">{["SEG","TER","QUA","QUI","SEX","SÁB","DOM"].map(label=><span key={label}>{label}</span>)}</div>
        <div className="leave-calendar">{calendar.map((entry,index)=>entry?<a key={entry.date} href={`/escala?date=${entry.date}`} className={entry.day?.severity||"clear"} title={entry.day?`Diurno ${entry.day.day} folgas · Noturno ${entry.day.night} folgas`:"Sem folgas confirmadas"}><span>{entry.number}</span>{entry.day?<div className="leave-calendar-periods"><small className="day"><b>D</b><strong>{entry.day.day}</strong><em>folgas</em></small><small className="night"><b>N</b><strong>{entry.day.night}</strong><em>folgas</em></small></div>:<small className="no-leave">Sem folgas</small>}{entry.day&&entry.day.vehicleTotal>0&&<em>VTR {entry.day.vehicleTotal}</em>}</a>:<span className="calendar-blank" key={`blank-${index}`}/>)}</div>
        <footer><span><i className="normal"/>Regular</span><span><i className="attention"/>Atenção</span><span><i className="critical"/>Crítico</span><small>Clique em qualquer dia para abrir a escala.</small></footer>
      </div>
      <div className="leave-priority-days"><header><div><small>MAIOR IMPACTO</small><h3>Dias para conferir</h3></div><span>{priorities.length}</span></header>{priorities.length?priorities.map(day=><a href={`/escala?date=${day.date}`} className={day.severity} key={day.date}><div className="priority-date"><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}</b><small>{day.patterns.join(" + ")}</small></div><div className="priority-detail"><div className="priority-periods"><span className="day"><b>D</b><strong>{day.day}</strong><small>folgas</small></span><span className="night"><b>N</b><strong>{day.night}</strong><small>folgas</small></span></div><div className="leave-role-chips">{roleEntries(day.roles).map(([role,count])=><span key={role}>{roleLabel(role)} {count}</span>)}</div>{day.vehicleTotal>0&&<em className="vehicle-total">VTR afetadas: {day.vehicleTotal}</em>}{day.vehicleRisks.map(risk=><em key={risk.vehicle}>⚠ {risk.vehicle}: {risk.members.map(member=>member.name).join(" + ")}</em>)}</div><span className="open-day">Abrir escala →</span></a>):<p>Nenhuma folga confirmada neste mês.</p>}</div>
    </div>
  </section>;
}
function severityWeight(value:LeaveOverviewDay["severity"]){return value==="critical"?3:value==="attention"?2:1}
function roleEntries(roles:LeaveOverviewDay["roles"]){return Object.entries(roles).filter(([,count])=>count>0) as Array<[keyof LeaveOverviewDay["roles"],number]>}
function roleLabel(role:keyof LeaveOverviewDay["roles"]){return role==="driver"?"Motoristas":role==="patrol"?"Patrulheiros":role==="third"?"3º integrantes":role==="guard"?"Postos":"Sem função"}

const formatDate = (value: string | number | null) =>
  new Date(String(value) + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
function nextDateValue(value:string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function GuardSelect({ guards }: { guards: Item[] }) {
  return (
    <select name="guardId" required>
      <option value="">Selecione o GM</option>
      {guards.map((g) => (
        <option key={g.id} value={String(g.id)}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
function Module({
  date,
  title,
  subtitle,
  active,
  children,
  busy = false,
  busyArea = "módulo",
}: {
  date: string;
  title: string;
  subtitle: string;
  active: string;
  children: React.ReactNode;
  busy?: boolean;
  busyArea?: string;
}) {
  return (
    <main className="module-shell">
      <ModuleBusyOverlay area={busyArea} active={busy} />
      <header>
        <BackToSchedule date={date} />
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      <ScheduleNav date={date} active={active} />
      {children}
    </main>
  );
}
function Form({
  title,
  disabled = false,
  submitLabel = "Salvar",
  onSubmit,
  children,
}: {
  title: string;
  disabled?: boolean;
  submitLabel?: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <form className="data-form" onSubmit={onSubmit}>
      <fieldset disabled={disabled}>
        <h3>{title}</h3>
        {children}
        <button className="save">{submitLabel}</button>
      </fieldset>
    </form>
  );
}
function Record({
  kind,
  title,
  items,
  main,
  detail,
  saving,
  onEdit,
  onDeactivate,
  onReorder,
}: {
  kind: "guard" | "post" | "vehicle";
  title: string;
  items: Item[];
  main: string;
  detail: string;
  saving: boolean;
  onEdit: (item: Item) => void;
  onDeactivate: (kind: "guard" | "post" | "vehicle", item: Item) => void;
  onReorder?: (item: Item, direction: "up" | "down") => void;
}) {
  return (
    <section className="record-list">
      <h3>
        {title}
        <span>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p>Nenhum registro.</p>
      ) : (
        items.map((i, n) => (
          <div key={String(i.id ?? n)}>
            <b>{String(i[main] ?? "")}</b>
            <small>{String(i[detail] ?? "")}</small>
            <span className="record-actions">
              {kind === "post" && onReorder && (
                <>
                  <button
                    disabled={saving}
                    aria-label="Mover posto para cima"
                    onClick={() => onReorder(i, "up")}
                  >
                    ↑
                  </button>
                  <button
                    disabled={saving}
                    aria-label="Mover posto para baixo"
                    onClick={() => onReorder(i, "down")}
                  >
                    ↓
                  </button>
                </>
              )}
              <button disabled={saving} onClick={() => onEdit(i)}>Editar</button>
              <button
                className="danger-link"
                disabled={saving}
                onClick={() => onDeactivate(kind, i)}
              >
                Desativar
              </button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}

function MovementRecords({
  title,
  items,
  saving,
  onEdit,
  onDelete,
}: {
  title: string;
  items: Item[];
  saving: boolean;
  onEdit?:(item:Item)=>void;
  onDelete?:(item:Item)=>void;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const visible = useMemo(() => items.filter((item) => {
    const text = `${item.guard_name || ""} ${item.registration || ""} ${item.request_ref || ""} ${item.notes || ""}`.toLocaleLowerCase("pt-BR");
    return (typeFilter === "all" || String(item.type) === typeFilter) && (!normalizedQuery || text.includes(normalizedQuery));
  }).sort((left,right)=>String(left.starts_at||"").localeCompare(String(right.starts_at||""))||String(left.guard_name||"").localeCompare(String(right.guard_name||""),"pt-BR")), [items, normalizedQuery, typeFilter]);
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = visible.slice(pageStart, pageStart + pageSize);
  const groups = movementTypeOptions.filter((option) => pageItems.some((item) => String(item.type) === option.value));
  const counts = movementTypeOptions.reduce<Record<string, number>>((result, option) => {
    result[option.value] = items.filter((item) => String(item.type) === option.value).length;
    return result;
  }, {});
  return (
    <section className="record-list movement-records">
      <header className="movement-records-head">
        <h3>{title}<span>{visible.length}{visible.length !== items.length ? ` / ${items.length}` : ""}</span></h3>
        <p>Registros ativos retiram o GM automaticamente do período informado e mostram o furo na escala.</p>
      </header>
      <div className="movement-record-summary" role="status">
        <button type="button" className={typeFilter==="all"?"active":""} onClick={()=>{setTypeFilter("all");setPage(1)}}><b>{items.length}</b><span>Todos</span></button>
        {movementTypeOptions.map(option=><button type="button" key={option.value} className={typeFilter===option.value?"active":""} disabled={!counts[option.value]} onClick={()=>{setTypeFilter(typeFilter===option.value?"all":option.value);setPage(1)}}><b>{counts[option.value]||0}</b><span>{option.label}</span></button>)}
      </div>
      <div className="movement-filters">
        <label>Buscar GM, matrícula ou requerimento<input value={query} onChange={(event) => {setQuery(event.target.value);setPage(1)}} placeholder="Digite para filtrar…" /></label>
        <label>Tipo<select value={typeFilter} onChange={(event) => {setTypeFilter(event.target.value);setPage(1)}}><option value="all">Todos ({items.length})</option>{movementTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label} ({counts[option.value] || 0})</option>)}</select></label>
      </div>
      {!visible.length ? <p className="movement-empty">Nenhum registro corresponde aos filtros.</p> : <div className="movement-record-groups">
        {groups.map((group) => {
          const groupItems = pageItems.filter((item) => String(item.type) === group.value);
          return <section key={group.value} className="movement-record-group">
            <header><strong>{group.label}</strong><span>{groupItems.length}</span></header>
            <div>{groupItems.map((item, index) => <article key={String(item.id ?? index)}>
              <div className="movement-record-person"><b>{String(item.guard_name || "GM sem nome")}</b><small>{displayRegistration(item.registration) ? `Mat. ${displayRegistration(item.registration)}` : "Sem matrícula"}{item.base_shift ? ` · ${item.base_shift}` : ""}</small></div>
              <div className="movement-record-period"><b>{movementPeriod(item)}</b><small>{item.request_ref ? `Req. ${item.request_ref}` : "Sem requerimento"}{item.notes ? ` · ${item.notes}` : ""}</small></div>
              <span className="record-actions">{onEdit&&<button type="button" disabled={saving} onClick={()=>onEdit(item)}>Editar</button>}{onDelete&&<button type="button" disabled={saving} className="danger-link" onClick={()=>onDelete(item)}>Remover</button>}</span>
            </article>)}</div>
          </section>;
        })}
      </div>}
      {visible.length > pageSize && <nav className="movement-pagination" aria-label="Paginação dos afastamentos">
        <span>Exibindo {pageStart + 1}–{Math.min(pageStart + pageSize, visible.length)} de {visible.length}</span>
        <div>
          <button type="button" disabled={safePage <= 1} onClick={()=>setPage(Math.max(1, safePage - 1))}>← Anterior</button>
          <b>{safePage} / {totalPages}</b>
          <button type="button" disabled={safePage >= totalPages} onClick={()=>setPage(Math.min(totalPages, safePage + 1))}>Próxima →</button>
        </div>
      </nav>}
    </section>
  );
}

const movementTypeOptions = [
  { value: "day_off", label: "Folgas" },
  { value: "vacation", label: "Férias" },
  { value: "course", label: "Cursos" },
  { value: "medical_leave", label: "Atestados / licenças" },
  { value: "technical_reserve", label: "Reserva técnica" },
  { value: "time_bank", label: "Banco de horas" },
  { value: "other_leave", label: "Outros afastamentos" },
  { value: "swap", label: "Trocas legadas" },
];

function MovementEditor({item,guards,onClose,onSubmit}:{item:Item;guards:Item[];onClose:()=>void;onSubmit:(body:Record<string,string|number|null>)=>void}) {
  function send(e:FormEvent<HTMLFormElement>){e.preventDefault();onSubmit({id:item.id,...Object.fromEntries(new FormData(e.currentTarget))} as Record<string,string|number|null>)}
  return <div className="catalog-backdrop" role="presentation"><form className="catalog-editor" onSubmit={send}>
    <header><div><small>EDITAR MOVIMENTAÇÃO</small><h2>{String(item.guard_name)}</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
    <label>GM<select name="guardId" defaultValue={String(item.guard_id)} required>{guards.map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)}</option>)}</select></label>
    <label>Tipo<select name="type" defaultValue={String(item.type)}><option value="day_off">Folga</option><option value="vacation">Férias</option><option value="course">Curso</option><option value="medical_leave">Atestado / licença</option><option value="technical_reserve">Reserva técnica</option><option value="time_bank">Banco de horas</option><option value="other_leave">Outro afastamento</option>{String(item.type)==="swap"&&<option value="swap">Troca legada — use Banco de horas e trocas</option>}</select></label>
    <label>Início<input name="startsAt" type="date" defaultValue={toDateInput(item.starts_at)} required/></label>
    <label>Retorno (inclusive)<input name="endsAt" type="date" defaultValue={toDateInput(item.ends_at, true)} required/></label>
    <label>Nº do requerimento<input name="requestRef" defaultValue={String(item.request_ref||"")}/></label>
    <label>Observação<input name="notes" defaultValue={String(item.notes||"")}/></label>
    <button className="save">Salvar alteração</button>
  </form></div>
}
function toDateInput(value:Item[string], exclusiveEnd=false){
  const text=String(value||"").slice(0,10);
  if(!exclusiveEnd||!/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const date=new Date(`${text}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);
}

function LeaveRecords({
  items,
  onAction,
}: {
  items: Item[];
  onAction: (action: "leave_approve" | "leave_cancel", id: Item["id"]) => void;
}) {
  const [period, setPeriod] = useState<"all" | "day" | "night">("all");
  const [visibleCount, setVisibleCount] = useState(50);
  const isNight = (item: Item) => /noite/i.test(String(item.base_shift || ""));
  const dayTotal = items.filter((item) => !isNight(item)).length;
  const nightTotal = items.length - dayTotal;
  const filteredItems = items.filter((item) => period === "all" || (period === "night") === isNight(item));
  const visibleItems = filteredItems.slice(0, visibleCount);
  const selectPeriod = (next: "all" | "day" | "night") => {
    setPeriod(next);
    setVisibleCount(50);
  };
  return (
    <section className="record-list leave-records">
      <h3>
        Escolhas registradas<span>{items.length}</span>
      </h3>
      <header className="leave-record-filters" aria-label="Filtrar escolhas por período">
        <button type="button" className={period === "all" ? "active" : ""} onClick={() => selectPeriod("all")}>Todas <b>{items.length}</b></button>
        <button type="button" className={`day ${period === "day" ? "active" : ""}`} onClick={() => selectPeriod("day")}>☀ Diurno <b>{dayTotal}</b></button>
        <button type="button" className={`night ${period === "night" ? "active" : ""}`} onClick={() => selectPeriod("night")}>☾ Noturno <b>{nightTotal}</b></button>
      </header>
      {filteredItems.length === 0 ? (
        <p>Nenhuma escolha registrada.</p>
      ) : (
        visibleItems.map((item) => (
          <div key={String(item.id)}>
            <b>{String(item.guard_name)}</b>
            <small>
              {formatDate(item.date)} ·{" "}
              {item.category === "weekday" ? "dia útil" : "fim de semana"}
              {item.status === "waitlist" && item.position ? ` · posição ${item.position}` : ""}
            </small>
            <span className={`choice-status ${item.status}`}>
              {item.status === "confirmed" ? "APROVADA" : "LISTA DE ESPERA"}
            </span>
            <span className="record-actions">
              {item.status === "waitlist" && (
                <button onClick={() => onAction("leave_approve", item.id)}>
                  Aprovar
                </button>
              )}
              <button
                className="danger-link"
                onClick={() => onAction("leave_cancel", item.id)}
              >
                Cancelar
              </button>
            </span>
          </div>
        ))
      )}
      {visibleItems.length < filteredItems.length && <button type="button" className="leave-record-more" onClick={() => setVisibleCount((current) => current + 50)}>Mostrar mais 50 <small>{filteredItems.length - visibleItems.length} restantes</small></button>}
    </section>
  );
}

function movementPeriod(item: Item) {
  const start = new Date(String(item.starts_at));
  const end = new Date(String(item.ends_at));
  if (/T00:00(?:$|:00)/.test(String(item.ends_at || ""))) end.setDate(end.getDate() - 1);
  return `${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`;
}
function serviceAdjustmentLabel(subtype: string) {
  return ({
    negative_early: "BH- · saída antecipada",
    negative_late: "BH- · entrada tardia",
    negative_full: "BH- · retirada integral",
    positive: "BH+ · dia extra",
    swap: "Troca de serviço",
  } as Record<string,string>)[subtype] || subtype;
}
function adjustmentHoursLabel(value: unknown) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return "";
  const rounded = Math.round(hours * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0+$/, "").replace(".", ",")}h`;
}
function serviceAdjustmentRangeWithSettlement(item: Item) {
  if (!item.settlement_date && !item.hours) return serviceAdjustmentRange(item);
  const hours = adjustmentHoursLabel(item.hours);
  const first = String(item.subtype) === "negative_full"
    ? `${String(item.service_date)} · dia inteiro`
    : `${String(item.service_date)} · ${String(item.starts_at).slice(11,16)}–${String(item.ends_at).slice(11,16)}`;
  const primary = `${serviceAdjustmentLabel(String(item.subtype))}${hours ? ` · ${hours}` : ""} · ${first}`;
  if (item.settlement_date) {
    const paidHours = adjustmentHoursLabel(item.settlement_hours || item.hours);
    return `${primary} → BH+${paidHours ? ` ${paidHours}` : ""} · ${String(item.settlement_date)} · ${String(item.settlement_starts_at || "").slice(11,16)}–${String(item.settlement_ends_at || "").slice(11,16)}`;
  }
  if (!item.counterpart_service_date) return primary;
  return `${serviceAdjustmentLabel(String(item.subtype))} · ${first} ⇄ ${String(item.counterpart_service_date)} · ${String(item.counterpart_starts_at || "").slice(11,16)}–${String(item.counterpart_ends_at || "").slice(11,16)}`;
}
function serviceAdjustmentRange(item: Item) {
  const first = `${String(item.service_date)} · ${String(item.starts_at).slice(11,16)}–${String(item.ends_at).slice(11,16)}`;
  if (!item.counterpart_service_date) return `${serviceAdjustmentLabel(String(item.subtype))} · ${first}`;
  return `${serviceAdjustmentLabel(String(item.subtype))} · ${first} ⇄ ${String(item.counterpart_service_date)} · ${String(item.counterpart_starts_at || "").slice(11,16)}–${String(item.counterpart_ends_at || "").slice(11,16)}`;
}
function activeVehicleOutages(outages:Item[],date:string){
  const byVehicle=new Map<number,Item>();
  for(const item of outages){
    const vehicleId=Number(item.vehicle_id);
    if(!Number.isFinite(vehicleId)||Number(item.active??1)===0||String(item.starts_on)>date||(item.ends_on&&String(item.ends_on)<date))continue;
    const previous=byVehicle.get(vehicleId);
    if(!previous||String(item.starts_on)>String(previous.starts_on)||(String(item.starts_on)===String(previous.starts_on)&&Number(item.id)>Number(previous.id)))byVehicle.set(vehicleId,item);
  }
  return [...byVehicle.values()].sort((a,b)=>String(a.prefix||"").localeCompare(String(b.prefix||""),"pt-BR",{numeric:true}));
}
function FleetAvailability({date,vehicles,outages,saving,onSubmit,onDelete}:{date:string;vehicles:Item[];outages:Item[];saving:boolean;onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onDelete:(id:Item["id"])=>void}){
  const activeOutages=activeVehicleOutages(outages,date);
  const unavailableIds=new Set(activeOutages.map(item=>Number(item.vehicle_id)));
  const selectable=vehicles.filter(vehicle=>!unavailableIds.has(Number(vehicle.id)));
  return <section className="fleet-status" aria-busy={saving}><header><div><small>DISPONIBILIDADE EM TEMPO REAL</small><h3>Viaturas em funcionamento / FA</h3></div><span>{unavailableIds.size} em FA nesta data</span></header><div className="fleet-layout"><form className="data-form" onSubmit={onSubmit}><select name="vehicleId" required defaultValue="" disabled={saving}><option value="">Selecionar viatura disponível</option>{selectable.map(v=><option key={String(v.id)} value={String(v.id)}>{String(v.prefix)} · {String(v.type)}</option>)}</select><label>Início do FA — vazio significa hoje<input name="startsOn" type="date" disabled={saving}/></label><label>Retorno previsto — deixe vazio para indefinido<input name="endsOn" type="date" disabled={saving}/></label><input name="reason" placeholder="Motivo / observação" disabled={saving}/><button className="save" disabled={saving}>{saving?"Salvando…":"Registrar em FA"}</button></form><div className="fleet-list">{activeOutages.length?activeOutages.map(o=><article key={String(o.id)}><span className="fleet-icon">{vehicleIconLabel(String(o.type))}</span><div><b>{String(o.prefix)}</b><small>FA desde {formatDate(o.starts_on)}{o.ends_on?` até ${formatDate(o.ends_on)}`:" · prazo indeterminado"}</small>{o.reason&&<em>{String(o.reason)}</em>}</div><button disabled={saving} onClick={()=>onDelete(o.id)}>Registrar retorno</button></article>):<p>Todas as viaturas estão disponíveis.</p>}</div></div></section>
}
const vehicleIconLabel=(type:string)=>type==="moto"?"🏍️":type==="pickup"?"🛻":type==="van"?"🚐":type==="suv"?"🚙":"🚓";
function VehicleReturnPending({items,saving,onDecision}:{items:Item[];saving:boolean;onDecision:(id:Item["id"],decision:"keep"|"show"|"restore")=>void}){
  return <section className="vehicle-return-pending"><header><div><small>DECISÕES PENDENTES</small><h2>Viaturas que retornaram após a criação da escala</h2><p>Nenhum remanejamento será desfeito sem uma escolha.</p></div><strong>{items.length}</strong></header><div>{items.map(item=><article key={String(item.id)}><span className="fleet-icon">🚓</span><div><b>{item.prefix} · {formatDate(item.schedule_date)}</b><small>Escala {item.schedule_status} · {Number(item.linked_assignments)} horários ainda vinculados à VTR</small></div><div className="vehicle-return-actions"><button disabled={saving} onClick={()=>onDecision(item.id,"keep")}>Manter fora</button><button disabled={saving} onClick={()=>onDecision(item.id,"show")}>Reexibir VTR</button><button className="restore" disabled={saving} onClick={()=>onDecision(item.id,"restore")}>Restaurar padrão</button></div></article>)}</div></section>
}

function VehicleReturnDialog({outage,preview,saving,onClose,onPreview,onConfirm}:{outage:Item;preview:{outage:Item;impacts:Item[]}|null;saving:boolean;onClose:()=>void;onPreview:(returnOn:string)=>void;onConfirm:(returnOn:string)=>void}){
  const now=new Date(),localToday=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const[returnOn,setReturnOn]=useState(localToday<String(outage.starts_on)?String(outage.starts_on):localToday);
  const automatic=preview?.impacts.filter(item=>Boolean(item.automatic)).length||0;
  const protectedCount=preview?.impacts.filter(item=>!item.automatic).length||0;
  return <div className="fleet-return-backdrop"><section className="fleet-return-dialog" role="dialog" aria-modal="true" aria-labelledby="fleet-return-title"><header><div><small>RETORNO SEGURO DE FA</small><h2 id="fleet-return-title">Registrar retorno de {outage.prefix}</h2><p>FA desde {formatDate(outage.starts_on)} · o histórico será preservado.</p></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>{!preview?<div className="fleet-return-step"><label>Disponível novamente a partir de<input type="date" min={String(outage.starts_on)} value={returnOn} onChange={event=>setReturnOn(event.target.value)}/></label><div className="fleet-return-note"><b>O aplicativo verificará todas as escalas já criadas.</b><span>Rascunhos seguros podem ser restaurados; escalas modificadas ou publicadas exigirão decisão.</span></div></div>:<div className="fleet-return-step"><div className="fleet-return-summary"><span><b>{preview.impacts.length}</b> escalas afetadas</span><span className="safe"><b>{automatic}</b> restaurações seguras</span><span className="warning"><b>{protectedCount}</b> aguardam decisão</span></div><div className="fleet-return-impact-list">{preview.impacts.length?preview.impacts.slice(0,12).map(item=><span key={String(item.schedule_id)}><b>{formatDate(item.date)}</b><small>{item.automatic?"Rascunho com guarnição preservada":"Será mantida sem alteração até decisão"} · {item.status}</small></span>):<p>Nenhuma escala já criada será afetada. A VTR entrará normalmente nas próximas escalas.</p>}</div></div>}<footer><button type="button" onClick={onClose}>Cancelar</button>{preview?<><button type="button" onClick={()=>onPreview(returnOn)}>Atualizar análise</button><button type="button" className="save" disabled={saving} onClick={()=>onConfirm(returnOn)}>{saving?"Registrando…":"Confirmar retorno"}</button></>:<button type="button" className="save" disabled={saving||!returnOn} onClick={()=>onPreview(returnOn)}>{saving?"Analisando…":"Analisar impacto"}</button>}</footer></section></div>
}

function FleetPanorama({date,vehicles,outages,crews,saving,onEdit,onQuickOutage,onClearOutage}:{date:string;vehicles:Item[];outages:Item[];crews:Item[];saving:boolean;onEdit:(item:Item)=>void;onQuickOutage:(item:Item)=>void;onClearOutage:(id:Item["id"])=>void}){
  const[query,setQuery]=useState(""),[filter,setFilter]=useState<"all"|"available"|"service"|"outage">("all");
  const activeOutages=useMemo(()=>activeVehicleOutages(outages,date),[date,outages]);
  const rows=useMemo(()=>vehicles.map(vehicle=>{
    const outage=activeOutages.find(item=>Number(item.vehicle_id)===Number(vehicle.id));
    const crew=crews.find(item=>Number(item.vehicle_id)===Number(vehicle.id));
    const status=outage?"outage":crew?"service":"available";
    return{vehicle,outage,crew,status};
  }),[activeOutages,vehicles,crews]);
  const visible=rows.filter(row=>{
    const text=`${row.vehicle.prefix||""} ${row.vehicle.zone||""} ${row.vehicle.type||""} ${row.crew?.crew_names||""}`.toLowerCase();
    return(filter==="all"||row.status===filter)&&text.includes(query.toLowerCase().trim());
  });
  const typeOrder=["moto","sedan","suv","pickup","van"];
  const groupedMap=new Map<string,typeof visible>();
  for(const row of visible){const type=String(row.vehicle.type||"other").toLowerCase();groupedMap.set(type,[...(groupedMap.get(type)||[]),row])}
  const grouped=[...groupedMap.entries()].sort(([left],[right])=>{
    const leftIndex=typeOrder.indexOf(left),rightIndex=typeOrder.indexOf(right);
    return(leftIndex<0?99:leftIndex)-(rightIndex<0?99:rightIndex)||left.localeCompare(right);
  }).map(([type,items])=>({type,items:items.sort((left,right)=>{
    const statusOrder={available:0,service:1,outage:2};
    return statusOrder[left.status]-statusOrder[right.status]||String(left.vehicle.prefix).localeCompare(String(right.vehicle.prefix),"pt-BR",{numeric:true});
  })}));
  const count=(status:string)=>rows.filter(row=>row.status===status).length;
  return <section className="fleet-panorama">
    <header><div><small>FROTA NA DATA DA ESCALA</small><h2>Panorama operacional</h2><p>As situações refletem a escala aberta e os registros de FA.</p></div><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar VTR, zona ou GM…"/></header>
    <div className="fleet-counters" role="group" aria-label="Filtrar situação da frota">
      <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}><b>{rows.length}</b><span>Total</span></button>
      <button className={filter==="available"?"active":""} onClick={()=>setFilter("available")}><b>{count("available")}</b><span>Disponíveis</span></button>
      <button className={filter==="service"?"active":""} onClick={()=>setFilter("service")}><b>{count("service")}</b><span>Em serviço</span></button>
      <button className={filter==="outage"?"active":""} onClick={()=>setFilter("outage")}><b>{count("outage")}</b><span>Em FA</span></button>
    </div>
    <div className="fleet-type-groups">{grouped.map(group=>{
      const availableCount=group.items.filter(item=>item.status!=="outage").length;
      const outageCount=group.items.length-availableCount;
      return <section className="fleet-type-group" key={group.type}><header><div><span aria-hidden="true">{vehicleIconLabel(group.type)}</span><div><h3>{vehicleTypeLabel(group.type)}</h3><small>{group.items.length} viatura{group.items.length===1?"":"s"}</small></div></div><p><b>{availableCount}</b> disponíveis <em>·</em> <strong>{outageCount}</strong> em FA</p></header><div className="fleet-map">{group.items.map(({vehicle,outage,crew,status})=><article key={String(vehicle.id)} className={`fleet-card ${status}`}>
        <span className="fleet-card-icon">{vehicleIconLabel(String(vehicle.type))}</span>
        <div><header><b>{String(vehicle.prefix)}</b><span>{status==="outage"?"EM FA":status==="service"?"EM SERVIÇO":"DISPONÍVEL"}</span></header><strong>{String(vehicle.zone||"Zona não definida")}</strong><small>{vehicleTypeLabel(String(vehicle.type))}</small>{crew&&<p><b>Equipe:</b> {String(crew.crew_names)}</p>}{outage&&<p><b>FA:</b> {String(outage.reason||"Sem motivo informado")} · {outage.ends_on?`retorno ${formatDate(outage.ends_on)}`:"prazo indeterminado"}</p>}</div>
         <div className="fleet-card-actions"><button disabled={saving} onClick={()=>onEdit(vehicle)}>Editar</button>{outage?<button className="available" disabled={saving} onClick={()=>onClearOutage(outage.id)}>Registrar retorno</button>:<button className="outage" disabled={saving} onClick={()=>onQuickOutage(vehicle)}>Marcar FA</button>}</div>
      </article>)}</div></section>;
    })}</div>
    {!visible.length&&<p className="fleet-empty">Nenhuma viatura corresponde aos filtros.</p>}
  </section>
}
const vehicleTypeLabel=(type:string)=>({moto:"Moto",pickup:"Caminhonete",van:"Furgão",suv:"SUV",sedan:"Sedan"} as Record<string,string>)[type]||"Outro";
function CatalogEditor({
  editing,
  saving,
  onClose,
  onSubmit,
}: {
  editing: { kind: "guard" | "post" | "vehicle"; item: Item };
  saving: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const i = editing.item;
  return (
    <div className="catalog-backdrop" role="presentation" aria-busy={saving}>
      <form className="catalog-editor" onSubmit={onSubmit}>
        <header>
          <div>
            <small>EDITAR CADASTRO</small>
            <h2>{String(i.name || i.prefix)}</h2>
          </div>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        {editing.kind === "guard" && (
          <>
            <label>
              Matrícula
              <input
                name="registration"
                defaultValue={displayRegistration(i.registration)}
                required
              />
            </label>
            <label>
              Nome de escala
              <input name="name" defaultValue={String(i.name || "")} required />
            </label>
            <label>
              Equipe / pelotão
              <input name="platoon" defaultValue={String(i.platoon || "")} />
            </label>
            <label>
              Regime
              <select
                name="baseShift"
                defaultValue={String(i.base_shift || "12x36 dia")}
              >
                <option>12x36 dia</option>
                <option>12x36 noite</option>
                <option>Semanal</option>
              </select>
            </label>
            <label>Tipo de escala<select name="workRegime" defaultValue={String(i.work_regime||"12x36")}><option value="12x36">Plantão 12x36</option><option value="weekly">Semanal</option></select></label>
          </>
        )}
        {editing.kind === "post" && (
          <>
            <label>
              Nome do local
              <input name="name" defaultValue={String(i.name || "")} required />
            </label>
            <label>
              Seção da escala
              <input
                name="groupName"
                defaultValue={String(i.group_name || "")}
                required
              />
            </label>
            <label>
              Ordem
              <input
                name="sortOrder"
                type="number"
                defaultValue={String(i.sort_order || 99)}
              />
            </label>
          </>
        )}
        {editing.kind === "vehicle" && (
          <>
            <label>
              Prefixo
              <input
                name="prefix"
                defaultValue={String(i.prefix || "")}
                required
              />
            </label>
            <label>
              Tipo
              <select name="type" defaultValue={String(i.type || "sedan")}>
                <option value="sedan">Sedan</option>
                <option value="pickup">Caminhonete</option>
                <option value="van">Furgão</option>
                <option value="moto">Moto</option>
                <option value="suv">SUV</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <label>
              Zona de atuação
              <input name="zone" defaultValue={String(i.zone || "")} />
            </label>
          </>
        )}
        <footer>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancelar
          </button>
          <button className="save" disabled={saving}>{saving ? "Salvando…" : "Salvar mudanças"}</button>
        </footer>
      </form>
    </div>
  );
}
