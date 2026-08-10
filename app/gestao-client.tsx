"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ModuleBusyOverlay, ModuleLoading } from "./module-loading";
import { BackToSchedule } from "./schedule-nav";
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
};

const modeLabel = {
  cadastros: "cadastros operacionais",
  viaturas: "gestão de viaturas",
  folgas: "folgas mensais",
  movimentos: "movimentações do efetivo",
  ajustes: "banco de horas e trocas",
} as const;

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
    const r = await fetch(`/api/admin?date=${date}&_=${Date.now()}`, { cache: "no-store" });
    setData(await r.json());
    setBusy(false);
  }, [date]);
  useEffect(() => {
    // The first request synchronizes this client view with the durable D1 state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
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
    if (!editing) return;
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
  }
  async function deactivate(kind: "guard" | "post" | "vehicle", item: Item) {
    if (!confirm(`Desativar ${String(item.name || item.prefix)}?`)) return;
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
  }
  async function reorderPost(item: Item, direction: "up" | "down") {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "post_reorder", id: item.id, direction }),
    });
    const j = await r.json();
    setMessage(r.ok ? "Ordem da escala atualizada." : j.error);
    if (r.ok) await load();
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
  async function importLeaves(month:string,rows:Array<{guardId?:number;guardName?:string;date:string}>,newGuards:Array<{name:string;registration:string;platoon?:string;baseShift?:string}>) {
    if(saving)return;
    setSaving(true);setMessage("");
    try{
      const r=await fetch("/api/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"leave_import",month,rows,newGuards})});
      const j=await r.json();setMessage(r.ok?j.message:j.error);
      if(r.ok)await load();
      return r.ok;
    }finally{setSaving(false)}
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
        busy={saving}
        busyArea={modeLabel[mode]}
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
            onEdit={(item) => setEditing({ kind: "guard", item })}
            onDeactivate={deactivate}
          />
          <Record
            kind="post"
            title="Postos e seções"
            items={data.posts}
            main="name"
            detail="group_name"
            onEdit={(item) => setEditing({ kind: "post", item })}
            onDeactivate={deactivate}
            onReorder={reorderPost}
          />
        </div>
        {editing && (
          <CatalogEditor
            editing={editing}
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
        busy={saving}
        busyArea={modeLabel[mode]}
      >
        <FleetPanorama
          date={date}
          vehicles={data.vehicles}
          outages={data.vehicleOutages}
          crews={data.vehicleCrews}
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
          onEdit={(item) => setEditing({ kind: "vehicle", item })}
          onDeactivate={deactivate}
        />
        {editing && (
          <CatalogEditor
            editing={editing}
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
        busy={saving}
        busyArea={modeLabel[mode]}
      >
        <Form
          title="Novo afastamento ou ajuste"
          onSubmit={(e) => submit(e, "movement")}
        >
          <GuardSelect guards={data.guards} />
          <select name="type">
            <option value="day_off">Folga</option>
            <option value="vacation">Férias</option>
            <option value="course">Curso</option>
            <option value="medical_leave">Atestado / licença</option>
            <option value="technical_reserve">Reserva técnica</option>
            <option value="time_bank">Banco de horas</option>
          </select>
          <input name="startsAt" type="datetime-local" required />
          <input name="endsAt" type="datetime-local" required />
          <input name="requestRef" placeholder="Nº do requerimento" />
          <input name="notes" placeholder="Observação" />
        </Form>
        {message && <p className="notice">{message}</p>}
        <SimpleRecords
          title="Registros recentes"
          items={data.movements}
          main="guard_name"
          detail="type"
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
  return (
    <Module
      date={date}
      title={String(campaign?.title || "Folgas mensais")}
      subtitle="Cada GM escolhe uma data útil e uma data de fim de semana. A capacidade é atualizada automaticamente."
      busy={saving}
      busyArea={modeLabel[mode]}
    >
      <LeaveMonthOverview overview={data.leaveOverview} />
      <LeaveImport
        guards={data.guards}
        choices={data.choices}
        defaultMonth={String(campaign?.month||date.slice(0,7))}
        saving={saving}
        onImport={importLeaves}
      />
      <div className="leave-layout">
        <Form title="Registrar escolha" onSubmit={(e) => submit(e, "leave")}>
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
            {data.days.map((d) => (
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
            <div key={String(d.date)}>
              <span>{formatDate(d.date)}</span>
              <progress value={Number(d.used)} max={Number(d.capacity)} />
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
const normalizeLeaveName=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9]+/gi," ").trim().toUpperCase();
function parseLeaveImport(raw:string,guards:Item[],month:string):ParsedLeave[]{
  const [year,monthNumber]=month.split("-").map(Number),byName=new Map(guards.map(guard=>[normalizeLeaveName(String(guard.name)),guard]));
  return raw.split(/\r?\n/).map((source,index)=>({source:source.trim(),line:index+1})).filter(item=>item.source&&!/^\[\d+\]|^GM\b|^DIA\s+GM\b/i.test(item.source)).map(({source,line})=>{
    const shift=/^NOITE\b/i.test(source)?"NOITE":/^DIA\b/i.test(source)?"DIA":"";
    const matches=[...source.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)];
    const prefix=(matches.length?source.slice(0,matches[0].index):source).replace(/^\s*(DIA|NOITE)\s+/i,"").replace(/\t/g," ").trim();
    const guard=byName.get(normalizeLeaveName(prefix));
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
function LeaveImport({guards,choices,defaultMonth,saving,onImport}:{guards:Item[];choices:Item[];defaultMonth:string;saving:boolean;onImport:(month:string,rows:Array<{guardId?:number;guardName?:string;date:string}>,newGuards:Array<{name:string;registration:string;platoon?:string;baseShift?:string}>)=>Promise<boolean|undefined>}){
  const [raw,setRaw]=useState(""),[month,setMonth]=useState(defaultMonth),[reviewing,setReviewing]=useState(false),[newRegistrations,setNewRegistrations]=useState<Record<string,string>>({});
  const parsed=useMemo(()=>parseLeaveImport(raw,guards,month),[raw,guards,month]);
  const existing=new Set(choices.map(choice=>`${Number(choice.guard_id)}:${String(choice.date)}`));
  const unknownNames=[...new Map(parsed.filter(row=>!row.guardId&&row.guardName).map(row=>[normalizeLeaveName(row.guardName),row.guardName])).values()];
  const newGuards=unknownNames.map(name=>({name,registration:String(newRegistrations[normalizeLeaveName(name)]||"").trim(),baseShift:"12x36 dia"}));
  const missingRegistrations=newGuards.filter(guard=>!guard.registration).length;
  const unresolvedProblems=parsed.reduce((total,row)=>total+row.problems.filter(problem=>!problem.startsWith("GM não encontrado")).length,0);
  const validRows=parsed.flatMap(row=>row.dates.filter(date=>row.guardId? !existing.has(`${row.guardId}:${date}`):Boolean(newRegistrations[normalizeLeaveName(row.guardName)]?.trim())).map(date=>row.guardId?{guardId:Number(row.guardId),date}:{guardName:row.guardName,date}));
  const problems=unresolvedProblems+missingRegistrations,recognized=parsed.reduce((total,row)=>total+row.dates.length,0);
  function rowHasProblem(row:ParsedLeave){return row.problems.some(problem=>!problem.startsWith("GM não encontrado"))||(!row.guardId&&!newRegistrations[normalizeLeaveName(row.guardName)]?.trim())}
  async function confirmImport(){if(!validRows.length||problems||saving)return;const ok=await onImport(month,validRows,newGuards.filter(guard=>guard.registration));if(ok){setRaw("");setReviewing(false);setNewRegistrations({})}}
  return <section className="leave-import">
    <header><div><small>IMPORTAÇÃO DO COMPILADO MENSAL</small><h2>Colar tabela de folgas</h2><p>Cole as colunas DIA/NOITE, GM e todas as datas. Nada é salvo antes da confirmação geral.</p></div><label>Mês<input type="month" value={month} onChange={event=>{setMonth(event.target.value);setReviewing(false)}}/></label></header>
    <textarea value={raw} onChange={event=>{setRaw(event.target.value);setReviewing(false)}} rows={6} placeholder={"DIA\tALENCAR\t22/08 (SÁBADO)\t06/08 (QUINTA-FEIRA)\nNOITE\tALEXANDRE\t12/08\t14/08"}/>
    <div className="leave-import-actions"><span><b>{parsed.length}</b> GMs · <b>{recognized}</b> folgas reconhecidas{unknownNames.length?` · ${unknownNames.length} novo(s) aguardando matrícula`:""}{problems?` · ${problems} pendência(s)`:""}</span><button type="button" disabled={!parsed.length} onClick={()=>setReviewing(true)}>Revisar antes de incluir</button></div>
    {reviewing&&<div className="leave-import-review"><header><div><small>CONFIRMAÇÃO - NENHUM DADO SALVO AINDA</small><h3>Folgas de {month.split("-").reverse().join("/")}</h3><p>{unknownNames.length?`${unknownNames.length} GM(s) não cadastrado(s): informe a matrícula abaixo para criar e importar junto.`:"Todos os nomes foram encontrados no cadastro."}</p></div><strong className={problems?"warning":"ready"}>{problems?"Completar cadastro":`${validRows.length} novas folgas`}</strong></header><div className="leave-import-list">{parsed.map(row=><article key={`${row.line}-${row.guardName}`} className={rowHasProblem(row)?"invalid":""}><span className={`leave-shift ${row.shift.toLowerCase()}`}>{row.shift||"-"}</span><div><b>{row.guardName}</b><small>Linha {row.line}</small>{!row.guardId&&<label className="leave-new-guard"><span>GM novo · matrícula</span><input value={newRegistrations[normalizeLeaveName(row.guardName)]||""} onChange={event=>setNewRegistrations(current=>({...current,[normalizeLeaveName(row.guardName)]:event.target.value}))} placeholder="Informe a matrícula"/></label>}</div><div className="leave-date-tags">{row.dates.map(date=><span key={date} className={row.guardId&&existing.has(`${row.guardId}:${date}`)?"existing":""}>{formatDate(date)}{row.guardId&&existing.has(`${row.guardId}:${date}`)?" · já incluída":""}</span>)}{row.problems.filter(problem=>!problem.startsWith("GM não encontrado")).map(problem=><em key={problem}>{problem}</em>)}{!row.guardId&&<em className="new-guard-note">Será cadastrado após informar a matrícula</em>}</div></article>)}</div><footer><button type="button" onClick={()=>setReviewing(false)}>Voltar e corrigir</button><button type="button" className="save" disabled={!validRows.length||Boolean(problems)||saving} onClick={()=>void confirmImport()}>{saving?"Importando…":`Confirmar importação geral (${validRows.length})`}</button></footer></div>}
  </section>
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
  return <section className="leave-overview">
    <header><div><small>PANORAMA DO MÊS</small><h2>Risco de efetivo nas folgas</h2><p>A média empírica é de <b>{monthlyAverage} folgas/dia</b>; dias acima de {overview.criticalThreshold} entram como críticos para conferência. O total considera todo o efetivo em viaturas.</p></div></header>
    <div className="leave-overview-summary">
      <span><b>{overview.totalLeaves}</b><small>folgas confirmadas</small></span>
      <span className="average"><b>{monthlyAverage}</b><small>média por dia</small></span>
      <span className="critical"><b>{overview.criticalDays}</b><small>dias críticos</small></span>
      <span className="vehicle"><b>{overview.vehicleLeaves}</b><small>folgas em viaturas</small></span>
    </div>
    <div className="leave-overview-grid">
      <div className="leave-calendar-wrap">
        <div className="leave-calendar-weekdays">{["SEG","TER","QUA","QUI","SEX","SÁB","DOM"].map(label=><span key={label}>{label}</span>)}</div>
        <div className="leave-calendar">{calendar.map((entry,index)=>entry?<a key={entry.date} href={`/?date=${entry.date}`} className={entry.day?.severity||"clear"} title={entry.day?`${entry.day.total} folgas · Dia ${entry.day.day} · Noite ${entry.day.night}`:"Sem folgas confirmadas"}><span>{entry.number}</span>{entry.day?<><b>{entry.day.total} folga{entry.day.total===1?"":"s"}</b><small><i>D {entry.day.day}</i><i>N {entry.day.night}</i></small>{entry.day.vehicleTotal>0&&<em>VTR {entry.day.vehicleTotal}</em>}</>:<small className="no-leave">—</small>}</a>:<span className="calendar-blank" key={`blank-${index}`}/>)}</div>
        <footer><span><i className="normal"/>Regular</span><span><i className="attention"/>Atenção</span><span><i className="critical"/>Crítico</span><small>Clique em qualquer dia para abrir a escala.</small></footer>
      </div>
      <div className="leave-priority-days"><header><div><small>MAIOR IMPACTO</small><h3>Dias para conferir</h3></div><span>{priorities.length}</span></header>{priorities.length?priorities.map(day=><a href={`/?date=${day.date}`} className={day.severity} key={day.date}><div className="priority-date"><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}</b><small>{day.patterns.join(" + ")}</small></div><div className="priority-detail"><strong>{day.total} folgas <i>Dia {day.day}</i><i>Noite {day.night}</i></strong><div className="leave-role-chips">{roleEntries(day.roles).map(([role,count])=><span key={role}>{roleLabel(role)} {count}</span>)}</div>{day.vehicleTotal>0&&<em className="vehicle-total">VTR afetadas: {day.vehicleTotal}</em>}{day.vehicleRisks.map(risk=><em key={risk.vehicle}>⚠ {risk.vehicle}: {risk.members.map(member=>member.name).join(" + ")}</em>)}</div><span className="open-day">Abrir escala →</span></a>):<p>Nenhuma folga confirmada neste mês.</p>}</div>
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
  children,
  busy = false,
  busyArea = "módulo",
}: {
  date: string;
  title: string;
  subtitle: string;
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
      {children}
    </main>
  );
}
function Form({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <form className="data-form" onSubmit={onSubmit}>
      <h3>{title}</h3>
      {children}
      <button className="save">Salvar</button>
    </form>
  );
}
function Record({
  kind,
  title,
  items,
  main,
  detail,
  onEdit,
  onDeactivate,
  onReorder,
}: {
  kind: "guard" | "post" | "vehicle";
  title: string;
  items: Item[];
  main: string;
  detail: string;
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
                    aria-label="Mover posto para cima"
                    onClick={() => onReorder(i, "up")}
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Mover posto para baixo"
                    onClick={() => onReorder(i, "down")}
                  >
                    ↓
                  </button>
                </>
              )}
              <button onClick={() => onEdit(i)}>Editar</button>
              <button
                className="danger-link"
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

function SimpleRecords({
  title,
  items,
  main,
  detail,
  onEdit,
  onDelete,
}: {
  title: string;
  items: Item[];
  main: string;
  detail: string;
  onEdit?:(item:Item)=>void;
  onDelete?:(item:Item)=>void;
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
        items.map((item, index) => (
          <div key={String(item.id ?? index)}>
            <b>{String(item[main] ?? "")}</b>
            <small>
              {movementLabel(String(item[detail] ?? ""))} ·{" "}
              {movementPeriod(item)}
              {item.request_ref ? ` · Req. ${item.request_ref}` : ""}
            </small>
            {(onEdit||onDelete)&&<span className="record-actions">{onEdit&&<button onClick={()=>onEdit(item)}>Editar</button>}{onDelete&&<button className="danger-link" onClick={()=>onDelete(item)}>Remover</button>}</span>}
          </div>
        ))
      )}
    </section>
  );
}

function MovementEditor({item,guards,onClose,onSubmit}:{item:Item;guards:Item[];onClose:()=>void;onSubmit:(body:Record<string,string|number|null>)=>void}) {
  function send(e:FormEvent<HTMLFormElement>){e.preventDefault();onSubmit({id:item.id,...Object.fromEntries(new FormData(e.currentTarget))} as Record<string,string|number|null>)}
  return <div className="catalog-backdrop" role="presentation"><form className="catalog-editor" onSubmit={send}>
    <header><div><small>EDITAR MOVIMENTAÇÃO</small><h2>{String(item.guard_name)}</h2></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
    <label>GM<select name="guardId" defaultValue={String(item.guard_id)} required>{guards.map(g=><option key={String(g.id)} value={String(g.id)}>{String(g.name)}</option>)}</select></label>
    <label>Tipo<select name="type" defaultValue={String(item.type)}><option value="day_off">Folga</option><option value="vacation">Férias</option><option value="course">Curso</option><option value="medical_leave">Atestado / licença</option><option value="technical_reserve">Reserva técnica</option><option value="time_bank">Banco de horas</option>{String(item.type)==="swap"&&<option value="swap">Troca legada — use Banco de horas e trocas</option>}</select></label>
    <label>Início<input name="startsAt" type="datetime-local" defaultValue={toLocalInput(item.starts_at)} required/></label>
    <label>Fim<input name="endsAt" type="datetime-local" defaultValue={toLocalInput(item.ends_at)} required/></label>
    <label>Nº do requerimento<input name="requestRef" defaultValue={String(item.request_ref||"")}/></label>
    <label>Observação<input name="notes" defaultValue={String(item.notes||"")}/></label>
    <button className="save">Salvar alteração</button>
  </form></div>
}
function toLocalInput(value:Item[string]){const text=String(value||"");return text.length>=16?text.slice(0,16):text}

function LeaveRecords({
  items,
  onAction,
}: {
  items: Item[];
  onAction: (action: "leave_approve" | "leave_cancel", id: Item["id"]) => void;
}) {
  return (
    <section className="record-list leave-records">
      <h3>
        Escolhas registradas<span>{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p>Nenhuma escolha registrada.</p>
      ) : (
        items.map((item) => (
          <div key={String(item.id)}>
            <b>{String(item.guard_name)}</b>
            <small>
              {formatDate(item.date)} ·{" "}
              {item.category === "weekday" ? "dia útil" : "fim de semana"}
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
    </section>
  );
}

function movementLabel(type: string) {
  return (
    (
      {
        day_off: "Folga",
        vacation: "Férias",
        course: "Curso",
        medical_leave: "Atestado / licença",
        technical_reserve: "Reserva técnica",
        time_bank: "Banco de horas",
        swap: "Troca de serviço",
      } as Record<string, string>
    )[type] || type
  );
}
function movementPeriod(item: Item) {
  const start = new Date(String(item.starts_at)),
    end = new Date(String(item.ends_at));
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
function FleetAvailability({date,vehicles,outages,onSubmit,onDelete}:{date:string;vehicles:Item[];outages:Item[];onSubmit:(e:FormEvent<HTMLFormElement>)=>void;onDelete:(id:Item["id"])=>void}){
  const activeOutages=outages.filter(item=>String(item.starts_on)<=date&&(!item.ends_on||String(item.ends_on)>=date));
  const unavailableIds=new Set(activeOutages.map(item=>Number(item.vehicle_id)));
  const selectable=vehicles.filter(vehicle=>!unavailableIds.has(Number(vehicle.id)));
  return <section className="fleet-status"><header><div><small>DISPONIBILIDADE EM TEMPO REAL</small><h3>Viaturas em funcionamento / FA</h3></div><span>{unavailableIds.size} em FA nesta data</span></header><div className="fleet-layout"><form className="data-form" onSubmit={onSubmit}><select name="vehicleId" required defaultValue=""><option value="">Selecionar viatura disponível</option>{selectable.map(v=><option key={String(v.id)} value={String(v.id)}>{String(v.prefix)} · {String(v.type)}</option>)}</select><label>Início do FA — vazio significa hoje<input name="startsOn" type="date"/></label><label>Retorno previsto — deixe vazio para indefinido<input name="endsOn" type="date"/></label><input name="reason" placeholder="Motivo / observação"/><button className="save">Registrar em FA</button></form><div className="fleet-list">{activeOutages.length?activeOutages.map(o=><article key={String(o.id)}><span className="fleet-icon">{vehicleIconLabel(String(o.type))}</span><div><b>{String(o.prefix)}</b><small>FA desde {formatDate(o.starts_on)}{o.ends_on?` até ${formatDate(o.ends_on)}`:" · prazo indeterminado"}</small>{o.reason&&<em>{String(o.reason)}</em>}</div><button onClick={()=>onDelete(o.id)}>Registrar retorno</button></article>):<p>Todas as viaturas estão disponíveis.</p>}</div></div></section>
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

function FleetPanorama({date,vehicles,outages,crews,onEdit,onQuickOutage,onClearOutage}:{date:string;vehicles:Item[];outages:Item[];crews:Item[];onEdit:(item:Item)=>void;onQuickOutage:(item:Item)=>void;onClearOutage:(id:Item["id"])=>void}){
  const[query,setQuery]=useState(""),[filter,setFilter]=useState<"all"|"available"|"service"|"outage">("all");
  const rows=useMemo(()=>vehicles.map(vehicle=>{
    const outage=outages.find(item=>Number(item.vehicle_id)===Number(vehicle.id)&&String(item.starts_on)<=date&&(!item.ends_on||String(item.ends_on)>=date));
    const crew=crews.find(item=>Number(item.vehicle_id)===Number(vehicle.id));
    const status=outage?"outage":crew?"service":"available";
    return{vehicle,outage,crew,status};
  }),[date,vehicles,outages,crews]);
  const visible=rows.filter(row=>{
    const text=`${row.vehicle.prefix||""} ${row.vehicle.zone||""} ${row.vehicle.type||""} ${row.crew?.crew_names||""}`.toLowerCase();
    return(filter==="all"||row.status===filter)&&text.includes(query.toLowerCase().trim());
  });
  const count=(status:string)=>rows.filter(row=>row.status===status).length;
  return <section className="fleet-panorama">
    <header><div><small>FROTA NA DATA DA ESCALA</small><h2>Panorama operacional</h2><p>As situações refletem a escala aberta e os registros de FA.</p></div><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar VTR, zona ou GM…"/></header>
    <div className="fleet-counters" role="group" aria-label="Filtrar situação da frota">
      <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}><b>{rows.length}</b><span>Total</span></button>
      <button className={filter==="available"?"active":""} onClick={()=>setFilter("available")}><b>{count("available")}</b><span>Disponíveis</span></button>
      <button className={filter==="service"?"active":""} onClick={()=>setFilter("service")}><b>{count("service")}</b><span>Em serviço</span></button>
      <button className={filter==="outage"?"active":""} onClick={()=>setFilter("outage")}><b>{count("outage")}</b><span>Em FA</span></button>
    </div>
    <div className="fleet-map">{visible.map(({vehicle,outage,crew,status})=><article key={String(vehicle.id)} className={`fleet-card ${status}`}>
      <span className="fleet-card-icon">{vehicleIconLabel(String(vehicle.type))}</span>
      <div><header><b>{String(vehicle.prefix)}</b><span>{status==="outage"?"EM FA":status==="service"?"EM SERVIÇO":"DISPONÍVEL"}</span></header><strong>{String(vehicle.zone||"Zona não definida")}</strong><small>{vehicleTypeLabel(String(vehicle.type))}</small>{crew&&<p><b>Equipe:</b> {String(crew.crew_names)}</p>}{outage&&<p><b>FA:</b> {String(outage.reason||"Sem motivo informado")} · {outage.ends_on?`retorno ${formatDate(outage.ends_on)}`:"prazo indeterminado"}</p>}</div>
      <div className="fleet-card-actions"><button onClick={()=>onEdit(vehicle)}>Editar</button>{outage?<button className="available" onClick={()=>onClearOutage(outage.id)}>Registrar retorno</button>:<button className="outage" onClick={()=>onQuickOutage(vehicle)}>Marcar FA</button>}</div>
    </article>)}</div>
    {!visible.length&&<p className="fleet-empty">Nenhuma viatura corresponde aos filtros.</p>}
  </section>
}
const vehicleTypeLabel=(type:string)=>({moto:"Moto",pickup:"Caminhonete",van:"Furgão",suv:"SUV",sedan:"Sedan"} as Record<string,string>)[type]||"Outro";
function CatalogEditor({
  editing,
  onClose,
  onSubmit,
}: {
  editing: { kind: "guard" | "post" | "vehicle"; item: Item };
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const i = editing.item;
  return (
    <div className="catalog-backdrop" role="presentation">
      <form className="catalog-editor" onSubmit={onSubmit}>
        <header>
          <div>
            <small>EDITAR CADASTRO</small>
            <h2>{String(i.name || i.prefix)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        {editing.kind === "guard" && (
          <>
            <label>
              Matrícula
              <input
                name="registration"
                defaultValue={String(i.registration || "")}
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
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="save">Salvar mudanças</button>
        </footer>
      </form>
    </div>
  );
}
