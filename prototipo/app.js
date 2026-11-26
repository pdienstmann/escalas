import {
  TURNOS, TIPOS, AFASTAMENTOS, calcularDia, sugerir, livroMes, resumoMes, saldoBH, somaDias, diaSemana, diasDoMes,
  mesDe, mesSeguinte, fmtHm, fmtHoras, intervalo, sobrepoe, trabalhaNoDia, hm, planejarCobertura, vigente, TIPOS_REQ,
} from "./engine.js";
import { criarExemplo } from "./seed.js";
import { interpretar, norm } from "./comando.js";

const CHAVE = "escala-gm-prototipo-v2";
const SEMANA = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const VIEWS = ["pendencias", "quadro", "lancamentos", "mes", "ficha", "folha", "ajustes"];

// ---------- estado ----------
let data = carregar();
const hojeReal = new Date().toISOString().slice(0, 10);
const ui = {
  view: VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "pendencias",
  dia: hojeReal >= "2026-10-01" && hojeReal <= "2026-12-31" ? hojeReal : "2026-11-26",
  mes: null, gm: null, drawer: null, soFuros: false,
  filtroMes: { equipe: "", ordem: "he" }, filtroLanc: { tipo: "", mes: null, req: "" },
  form: { tipo: "FOLGA" }, confirmar: null,
};
ui.mes = mesDe(ui.dia); ui.filtroLanc.mes = ui.mes;
const desfazer = [];

function carregar() {
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) { const d = JSON.parse(s); d._versao = 1; return d; }
  } catch { /* sem armazenamento: usa exemplo */ }
  return criarExemplo();
}
function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify({ ...data, _versao: undefined })); } catch { /* ignora */ } }
function mudar(msg, fn) {
  desfazer.push(JSON.stringify({ o: data.ocorrencias, p: data.postos, s: data.secoes, g: data.gms, r: data.requerimentos || {}, e: data.equipes }));
  if (desfazer.length > 30) desfazer.shift();
  fn();
  data._versao = (data._versao || 0) + 1;
  salvar();
  render();
  toast(msg, true);
}
const novoId = () => "u" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gmPorId = (id) => data.gms.find((g) => g.id === id);
const postoPorId = (id) => data.postos.find((p) => p.id === id);
const nomeGm = (id) => gmPorId(id)?.nome || "—";
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ddmmaaaa = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const nomeMes = (m) => { const n = MESES[Number(m.slice(5, 7)) - 1]; return `${n[0].toUpperCase()}${n.slice(1)} de ${m.slice(0, 4)}`; };
const mesAnterior = (m) => { const [y, mm] = m.split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; };
const equipe = (id) => data.equipes.find((e) => e.id === id);
const opcoesGm = (sel = "", filtro = () => true) => [...data.gms].filter(filtro).sort((a, b) => a.nome.localeCompare(b.nome))
  .map((g) => `<option value="${g.id}" ${g.id === sel ? "selected" : ""}>${esc(g.nome)} · ${g.equipe}</option>`).join("");
const opcoesPosto = (sel = "") => data.secoes.map((s) => `<optgroup label="${esc(s.nome)}">${data.postos.filter((p) => p.secao === s.id)
  .map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.nome)}${p.sub ? " · " + esc(p.sub) : ""}</option>`).join("")}</optgroup>`).join("");
function rotuloLotacao(g) {
  if (!g.lotacao) return "sem lotação";
  const p = postoPorId(g.lotacao.posto);
  const seg = g.lotacao.segmentos.map((s) => `${s.ini}–${s.fim}${s.tipo === "he" ? " (HE)" : ""}`).join(" + ");
  return `${p?.nome || "?"}${g.lotacao.funcao ? " · " + g.lotacao.funcao : ""} · ${seg}`;
}
const BADGE = { he: ["HE+", "he"], bh: ["BH+", "bh"], troca: ["TROCA", "troca"] };

// ---------- shell ----------
function render() {
  document.querySelectorAll("[data-nav]").forEach((a) => a.setAttribute("aria-current", a.dataset.nav === ui.view ? "page" : "false"));
  const main = $("#main");
  const html = { pendencias: vPendencias, ajustes: vAjustes, quadro: vQuadro, lancamentos: vLancamentos, mes: vMes, ficha: vFicha, folha: vFolha }[ui.view]();
  main.innerHTML = html;
  $("#drawer").innerHTML = ui.drawer ? vDrawer() : "";
  $("#drawer").hidden = !ui.drawer;
  $("#veu").hidden = !ui.drawer;
  $("#btn-desfazer").disabled = !desfazer.length;
  if (ui.pop) desenharPop(); else fecharPop();
}

let toastTimer;
function toast(msg, comDesfazer) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${comDesfazer && desfazer.length ? `<button data-act="desfazer">Desfazer</button>` : ""}`;
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------- QUADRO DO DIA ----------
function textoCelula(d, t) {
  const idx = TURNOS.indexOf(t);
  const prev = TURNOS[idx - 1], next = TURNOS[idx + 1];
  const a = d.ini < t.ini && !(prev && sobrepoe(d.ini, d.fim, prev.ini, prev.fim) > 0) ? d.ini : Math.max(d.ini, t.ini);
  const b = d.fim > t.fim && !(next && sobrepoe(d.ini, d.fim, next.ini, next.fim) > 0) ? d.fim : Math.min(d.fim, t.fim);
  return `${fmtHm(a)}/${fmtHm(b)}`;
}
function chip(d, t) {
  const g = gmPorId(d.gm);
  const [txt, cls] = BADGE[d.nat] || [];
  const extras = [];
  if (d.fixa) extras.push(`<span class="tag he">HE fixa</span>`);
  else if (d.extensao) extras.push(`<span class="tag he">HE+</span>`);
  else if (txt) extras.push(`<span class="tag ${cls}">${txt}</span>`);
  if (d.remanejado) extras.push(`<span class="tag rem">REMANEJ.</span>`);
  const ultimo = d.fim <= t.fim; // detalhes só na coluna onde o serviço termina
  if (d.bhDebito && ultimo) extras.push(`<span class="tag bhc">BH−${fmtHoras(d.bhDebito)}</span>`);
  if (d.req && !d.fixa) extras.push(`<span class="req">REQ ${esc(d.req)}</span>`);
  const reserva = postoPorId(d.posto)?.tipo === "reserva" ? "reserva" : "";
  return `<button class="chip ${cls || ""} ${reserva} ${d.conflito ? "conflito" : ""} ${d.alterado && ultimo ? "alterado" : ""}" data-act="card" data-des="${d.id}" title="Clique para mudar horário, REQ, observação ou trocar o GM">
    <span class="nm">${esc(g?.nome)}</span>${d.funcao ? `<span class="fn" title="${esc(d.funcao)}">${esc(d.funcao[0])}</span>` : ""}
    <span class="hr">${textoCelula(d, t)}</span>${extras.join("")}${d.obs && ultimo ? `<span class="obs" title="${esc(d.obs)}">${esc(d.obs.length > 34 ? d.obs.slice(0, 33) + "…" : d.obs)}</span>` : ""}</button>`;
}
function vQuadro() {
  const cd = calcularDia(data, ui.dia);
  ui.desMap = new Map(cd.designacoes.map((d) => [d.id, d]));
  const amanha = somaDias(ui.dia, 1);
  const eqDia = cd.equipes.filter((e) => equipe(e).periodo === "dia"), eqNoite = cd.equipes.filter((e) => equipe(e).periodo === "noite");
  const heHoje = cd.designacoes.filter((d) => d.nat === "he").reduce((t, d) => t + d.fim - d.ini, 0);
  const furosTotal = cd.furos.reduce((t, f) => t + f.faltam, 0);
  const faPostos = new Map(cd.fa.map((o) => [o.posto, o]));
  let linhas = "";
  for (const s of data.secoes) {
    const postos = data.postos.filter((p) => p.secao === s.id && p.ativo !== false);
    let corpo = "";
    for (const p of postos) {
      const furosP = cd.furos.filter((f) => f.posto === p.id);
      if (ui.soFuros && !furosP.length) continue;
      const desP = cd.designacoes.filter((d) => d.posto === p.id);
      const naoHoje = p.dias && !p.dias.includes(diaSemana(ui.dia));
      let cels;
      if (faPostos.has(p.id)) {
        const o = faPostos.get(p.id);
        cels = `<td colspan="4" class="fa-cel"><button class="link" data-act="pop-posto" data-posto="${p.id}">${o.tipo === "FA" ? "Viatura em manutenção (FA)" : "Posto fechado"}${o.ate && o.ate !== o.de ? ` até ${ddmm(o.ate)}` : " neste dia"}</button>${o.obs ? " · " + esc(o.obs) : ""} — quem estava aqui foi para <b>À disposição</b></td>`;
      } else {
        cels = TURNOS.map((t) => {
          const aqui = desP.filter((d) => sobrepoe(d.ini, d.fim, t.ini, t.fim) > 0).sort((a, b) => a.ini - b.ini);
          const furo = furosP.find((f) => f.turno === t.id);
          let h = aqui.map((d) => chip(d, t)).join("");
          if (furo) h += `<button class="furo" data-act="pop-add" data-posto="${p.id}" data-turno="${t.id}">Cobrir · falta ${furo.faltam}</button>`;
          if (!aqui.length && !furo) h = p.rondas ? `<span class="rondas">VTR/RONDAS FREQUENTES</span>` : naoHoje && p.vagas ? `<span class="vazio">não funciona hoje</span>` : "";
          if (!furo) h += `<button class="add" data-act="pop-add" data-posto="${p.id}" data-turno="${t.id}" aria-label="Pôr GM em ${esc(p.nome)}, ${t.nome}">+ pôr GM</button>`;
          return `<td class="${t.id === "t2" || t.id === "t3" ? "dia" : "noite"}">${h}</td>`;
        }).join("");
      }
      const aj = cd.ajustesPosto.get(p.id) || {};
      corpo += `<tr><th scope="row" class="posto"><button class="posto-btn" data-act="pop-posto" data-posto="${p.id}" title="Clique para mudar este ${ehViatura(p) ? "viatura" : "posto"}">
        <span class="pn">${esc(nomeNoDia(p, cd))}</span>${p.sub ? `<span class="ps">${esc(p.sub)}</span>` : ""}${p.obs ? `<span class="po">(${esc(p.obs)})</span>` : ""}
        ${aj.vagas ? `<span class="tag rem">vagas do dia alteradas</span>` : ""}<span class="lapis" aria-hidden="true">✎</span></button></th>${cels}</tr>`;
    }
    if (corpo || !ui.soFuros) linhas += `<tr class="secao"><th colspan="5" scope="rowgroup"><button class="secao-btn" data-act="pop-secao" data-secao="${s.id}" title="Clique para renomear, ordenar ou criar postos">${esc(s.nome)} <span class="lapis" aria-hidden="true">✎</span></button></th></tr>${corpo}`;
  }

  // efetivo fora da escala
  const grupos = {};
  for (const a of cd.afastados) (grupos[a.tipo] ||= []).push(a);
  const blocosFora = ["FOLGA", "FALTA", "FERIAS", "LICENCA", "ATESTADO", "CURSO", "BH_COMP", "TROCA"].filter((k) => grupos[k]).map((k) => `
    <section class="fora-g t-${k}"><h4>${k === "TROCA" ? "Trocas (titular fora)" : TIPOS[k]} <span class="n">${grupos[k].length}</span></h4><ul>
    ${grupos[k].map((a) => `<li><button class="link" data-act="gm" data-gm="${a.gm}">${esc(nomeGm(a.gm))}</button>
      <span class="meta">${equipe(gmPorId(a.gm)?.equipe)?.id || ""}${a.oc.ate && a.oc.ate !== a.oc.de ? ` · volta ${ddmm(somaDias(a.oc.ate, 1))}` : ""}${a.tipo === "TROCA" ? ` · coberto por ${esc(nomeGm(a.oc.substituto))}` : ""}${a.oc.req ? ` · REQ ${esc(a.oc.req)}` : ""}</span></li>`).join("")}</ul></section>`).join("");
  const disp = cd.disposicao.length ? `<section class="disposicao"><h3>À disposição <span class="n">${new Set(cd.disposicao.map((d) => d.gm)).size}</span></h3>
    <p class="dica">Sem posto neste dia (viatura parada ou posto fechado). Use "Cobrir" para mandá-los a um furo.</p><div class="chips">
    ${[...new Set(cd.disposicao.map((d) => d.gm))].map((id) => { const d = cd.disposicao.find((x) => x.gm === id); return `<button class="chip" data-act="card" data-des="${d.id}"><span class="nm">${esc(nomeGm(id))}</span><span class="hr">${fmtHm(d.ini)}/${fmtHm(d.fim)}</span><span class="req">de ${esc(postoPorId(d.postoOriginal)?.nome)}</span></button>`; }).join("")}
    </div></section>` : "";

  return `
  <div class="barra">
    <div class="datas">
      <button class="ic" data-act="dia" data-n="-1" aria-label="Dia anterior">‹</button>
      <input type="date" id="q-dia" value="${ui.dia}" min="2026-10-01" max="2026-12-31" aria-label="Data do serviço">
      <button class="ic" data-act="dia" data-n="1" aria-label="Próximo dia">›</button>
      <div class="periodo"><b>${SEMANA[diaSemana(ui.dia)]} ${ddmm(ui.dia)}</b> 07h → ${SEMANA[diaSemana(amanha)].toLowerCase()} ${ddmm(amanha)} 07h</div>
    </div>
    <div class="equipes">
      ${[...eqDia, ...eqNoite].map((e) => `<button class="eq ${equipe(e).periodo}" data-act="pop-insp" data-equipe="${e}" title="Clique para trocar o inspetor">${equipe(e).periodo === "dia" ? "Dia" : "Noite"} <b>${e}</b> ${esc(cd.inspetores.get(e) || equipe(e).inspetor || "")}</button>`).join("")}
    </div>
  </div>
  <div class="faixa">
    <span class="${furosTotal ? "ruim" : "bom"}"><b>${furosTotal}</b> ${furosTotal === 1 ? "vaga descoberta" : "vagas descobertas"}</span>
    <span><b>${fmtHoras(heHoje)}</b> de HE</span>
    <span><b>${new Set(cd.designacoes.filter((d) => d.posto).map((d) => d.gm)).size}</b> GMs escalados</span>
    <span><b>${cd.afastados.length}</b> fora da escala</span>
    <label class="toggle"><input type="checkbox" id="q-sofuros" ${ui.soFuros ? "checked" : ""}> Só furos</label>
    ${furosTotal ? `<button class="btn pri" data-act="auto" data-dias="1">Preencher furos sozinho</button>` : ""}
  </div>
  <p class="dica como">Clique em qualquer nome, posto, viatura ou seção para mudar.</p>
  ${painelPlano()}
  ${cd.alertas.length ? `<div class="alertas">${cd.alertas.map((a) => `<p class="${a.nivel}">${esc(a.texto)}</p>`).join("")}</div>` : ""}
  ${disp}
  <div class="tabela-wrap"><table class="quadro">
    <colgroup><col class="c-posto"><col><col><col><col></colgroup>
    <thead><tr><th scope="col">POSTO</th>${TURNOS.map((t) => `<th scope="col" class="${t.id === "t2" || t.id === "t3" ? "dia" : "noite"}">${t.nome}<small>${fmtHm(t.ini)}–${fmtHm(t.fim)}</small></th>`).join("")}</tr></thead>
    <tbody>${linhas || `<tr><td colspan="5" class="vazio-geral">Nenhum furo neste dia.</td></tr>`}</tbody>
  </table></div>
  <h3 class="sub">Fora da escala neste serviço</h3>
  <div class="fora">${blocosFora || `<p class="dica">Ninguém afastado.</p>`}</div>`;
}

// ---------- DRAWER ----------
function vDrawer() {
  const d = ui.drawer;
  if (d.tipo === "furo") return drawerFuro(d);
  if (d.tipo === "gm") return drawerGm(d);
  return "";
}
function drawerFuro(d) {
  const p = postoPorId(d.posto), t = TURNOS.find((x) => x.id === d.turno);
  const [ini, fim] = intervalo(d.ini, d.fim);
  const { remanejar, he } = sugerir(data, ui.dia, d.posto, ini, fim);
  const opcoes = [[fmtHm(t.ini), fmtHm(t.fim), `Só o ${t.nome.toLowerCase()}`]];
  const par = { t2: "t3", t4: "t1" }[t.id];
  if (par) opcoes.push([fmtHm(t.ini), fmtHm(TURNOS.find((x) => x.id === par).fim), "12 horas"]);
  if (t.id === "t3") opcoes.push(["13:00", "01:00", "Emendar até 01:00"]);
  return `<div class="dw-head"><div><p class="eyebrow">Cobrir vaga · ${SEMANA[diaSemana(ui.dia)].toLowerCase()} ${ddmm(ui.dia)}</p>
    <h2>${esc(p.nome)}</h2><p class="meta">${esc(p.sub || "")} ${t.nome}</p></div><button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    <section class="bloco-rem"><h3>1 · Sem custo: remanejar</h3>
    ${remanejar.length ? `<ul class="sug">${remanejar.map((s) => `<li><div class="sg"><b>${esc(s.gm.nome)}</b> <span class="meta">${s.gm.equipe} · está em ${esc(s.origem)} ${fmtHm(s.ini)}–${fmtHm(s.fim)}</span></div><span></span>
      <button class="btn pri" data-act="remanejar" data-gm="${s.gm.id}">Remanejar</button></li>`).join("")}</ul>`
      : `<p class="dica">Ninguém na reserva técnica ou à disposição nesse horário.</p>`}</section>
    <section><h3>2 · Hora extra</h3>
    <fieldset class="horario"><legend>Horário</legend>
      <div class="opts">${opcoes.map(([a, b, l]) => `<button class="opt ${a === d.ini && b === d.fim ? "on" : ""}" data-act="furo-hora" data-ini="${a}" data-fim="${b}">${l}<small>${a}–${b}</small></button>`).join("")}</div>
      <div class="linha"><label>Início <input type="time" id="f-ini" value="${d.ini}"></label><label>Fim <input type="time" id="f-fim" value="${d.fim}"></label>
      <label>Tipo <select id="f-nat"><option value="HE" ${d.nat === "HE" ? "selected" : ""}>Hora extra</option><option value="BH_MAIS" ${d.nat === "BH_MAIS" ? "selected" : ""}>Banco de horas</option></select></label>
      <label>REQ <input id="f-req" value="${esc(d.req || "")}" placeholder="nº" size="6"></label></div>
      <p class="dica">${fmtHoras(fim - ini)} · ${d.nat === "HE" ? "conta no livro de HE do mês" : "crédito no banco de horas"}</p>
    </fieldset></section>
    <div class="busca"><input type="search" id="f-busca" placeholder="Buscar GM" aria-label="Buscar GM"></div>
    <p class="dica">Ordem: quem já trabalha neste posto, depois quem tem menos HE no mês (somando o que veio do mês anterior).</p>
    <ul class="sug">${he.map((s, i) => `<li data-nome="${esc(s.gm.nome.toLowerCase())}" ${i >= 15 ? 'class="mais" hidden' : ""}>
      <div class="sg"><b>${esc(s.gm.nome)}</b> <span class="meta">${s.gm.equipe} · ${esc(postoPorId(s.gm.lotacao?.posto)?.nome || "")}</span>
      <div class="notas">${s.notas.map((n) => `<span class="nota ${/não realiza/.test(n) ? "atencao" : ""}">${esc(n)}</span>`).join("")}</div></div>
      <div class="sh"><span class="num">${fmtHoras(s.heMes)}</span><span class="meta">HE no mês${s.transporte ? ` +${fmtHoras(s.transporte)} transp.` : ""}</span></div>
      <button class="btn ${s.bloqueado ? "" : "pri"}" data-act="escalar" data-gm="${s.gm.id}" ${s.bloqueado ? "disabled" : ""}>Escalar</button></li>`).join("")}</ul>
    ${he.length > 15 ? `<button class="link" data-act="ver-todos">Ver todos os ${he.length} disponíveis</button>` : ""}
    ${!he.length ? `<p class="dica">Ninguém disponível nesse horário.</p>` : ""}
  </div>`;
}
function drawerGm(d) {
  const g = gmPorId(d.gm);
  const cd = calcularDia(data, ui.dia);
  const minhas = cd.designacoes.filter((x) => x.gm === g.id);
  const afast = cd.afastados.find((a) => a.gm === g.id);
  const l = livroMes(data, mesDe(ui.dia)).get(g.id);
  const escalado = minhas.some((x) => x.origem === "base" || x.nat === "troca");
  const acao = d.acao || "";
  const ocsDoDia = data.ocorrencias.filter((o) => o.gm === g.id && o.de <= ui.dia && ui.dia <= (o.ate || o.de));
  const ocsSub = data.ocorrencias.filter((o) => o.tipo === "TROCA" && o.substituto === g.id && o.de === ui.dia);
  let form = "";
  if (acao === "afast") form = `<div class="form"><label>Tipo <select id="a-tipo">${Object.entries(AFASTAMENTOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <div class="linha"><label>De <input type="date" id="a-de" value="${ui.dia}"></label><label>Até <input type="date" id="a-ate" value="${ui.dia}"></label></div>
    <label>REQ / observação <input id="a-req" placeholder="opcional"></label><button class="btn pri" data-act="salvar-afast">Lançar</button></div>`;
  if (acao === "troca") form = `<div class="form"><label>Quem assume o serviço <select id="t-sub">${opcoesGm("", (x) => x.id !== g.id && !cd.designacoes.some((y) => y.gm === x.id && sobrepoe(y.ini, y.fim, Math.min(...minhas.map((m) => m.ini)), Math.max(...minhas.map((m) => m.fim))) > 0))}</select></label>
    <label>REQ <input id="t-req" placeholder="opcional"></label><button class="btn pri" data-act="salvar-troca">Lançar troca</button></div>`;
  const futuras = (g.historico || []).filter((h) => h.ate >= somaDias(ui.dia, -1));
  if (acao === "lotacao") form = `<div class="form"><p class="dica">Vale a partir da data escolhida. Os dias anteriores continuam como estavam.</p>
    ${futuras.length ? `<p class="aviso">Já existe mudança de lotação em ${futuras.map((h) => ddmm(somaDias(h.ate, 1))).join(", ")}. Se salvar com data anterior, ela será substituída por esta.</p>` : ""}
    <label>A partir de <input type="date" id="lo-desde" value="${ui.dia}"></label>
    <div class="linha"><label>Equipe <select id="lo-eq">${data.equipes.map((e) => `<option value="${e.id}" ${e.id === g.equipe ? "selected" : ""}>${esc(e.nome)}</option>`).join("")}</select></label>
    <label>Função <input id="lo-fn" value="${esc(g.lotacao?.funcao || "")}" placeholder="Motorista, Patrulheiro…" size="12"></label></div>
    <label>Posto ou viatura <select id="lo-posto">${opcoesPosto(g.lotacao?.posto)}</select></label>
    <label>Horário <select id="lo-hor"><option value="">Manter (${esc(g.lotacao?.segmentos.map((x) => `${x.ini}–${x.fim}`).join(" + ") || "")})</option>${["07:00-19:00", "19:00-07:00", "07:00-13:00", "13:00-19:00", "06:00-12:00", "12:00-18:00", "08:00-17:00"].map((h) => `<option value="${h}">${h.replace("-", "–")}</option>`).join("")}</select></label>
    <button class="btn pri" data-act="salvar-lotacao">Salvar lotação</button></div>`;
  if (acao === "remanej") form = `<div class="form"><label>Novo posto <select id="r-posto">${opcoesPosto()}</select></label><label>Função <input id="r-fn" placeholder="opcional"></label>
    <div class="linha"><label>De <input type="date" id="r-de" value="${ui.dia}"></label><label>Até <input type="date" id="r-ate" value="${ui.dia}"></label></div>
    <button class="btn pri" data-act="salvar-remanej">Remanejar</button></div>`;
  return `<div class="dw-head"><div><p class="eyebrow">${esc(equipe(g.equipe)?.nome)} · mat. ${esc(g.matricula)}</p><h2>${esc(g.nome)}</h2>
    <p class="meta">${esc(rotuloLotacao(g))}</p>${g.naoFazHE ? `<p class="tag-linha"><span class="tag furo">Não realiza HE</span></p>` : ""}${g.obs ? `<p class="meta">${esc(g.obs)}</p>` : ""}</div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    <div class="mini"><div><span class="num">${fmtHoras(l?.he || 0)}</span><span class="meta">HE em ${MESES[Number(mesDe(ui.dia).slice(5)) - 1]}</span></div>
      <div><span class="num">${fmtHoras(l?.transporte || 0)}</span><span class="meta">veio do mês anterior</span></div>
      <div><span class="num">${fmtHoras(saldoBH(data, g.id, mesDe(ui.dia)))}</span><span class="meta">banco de horas</span></div></div>
    <h3>Neste serviço</h3>
    ${afast ? `<p class="estado">${esc(TIPOS[afast.tipo])}${afast.oc.ate && afast.oc.ate !== afast.oc.de ? ` até ${ddmm(afast.oc.ate)}` : ""}</p>` : ""}
    ${minhas.length ? `<ul class="lista-des">${minhas.map((x) => `<li><span class="hr">${fmtHm(x.ini)}–${fmtHm(x.fim)}</span> ${esc(postoPorId(x.posto)?.nome || "À disposição")} ${BADGE[x.nat] ? `<span class="tag ${BADGE[x.nat][1]}">${x.fixa ? "HE fixa" : BADGE[x.nat][0]}</span>` : ""}${x.titular ? ` <span class="meta">no lugar de ${esc(nomeGm(x.titular))}</span>` : ""}</li>`).join("")}</ul>` : !afast ? `<p class="dica">Não está escalado neste serviço.</p>` : ""}
    <h3>Ações</h3>
    <div class="acoes">
      ${escalado ? `<button class="btn" data-act="folga">Lançar folga hoje</button>` : ""}
      <button class="btn ${acao === "afast" ? "on" : ""}" data-act="gm-acao" data-acao="afast">Afastamento…</button>
      ${escalado ? `<button class="btn ${acao === "troca" ? "on" : ""}" data-act="gm-acao" data-acao="troca">Troca de serviço…</button>` : ""}
      ${minhas.length ? `<button class="btn ${acao === "remanej" ? "on" : ""}" data-act="gm-acao" data-acao="remanej">Remanejar…</button>` : ""}
      <button class="btn ${acao === "lotacao" ? "on" : ""}" data-act="gm-acao" data-acao="lotacao">Mudar lotação…</button>
      ${escalado ? `<button class="btn" data-act="bhcomp">Compensação BH hoje</button>` : ""}
    </div>
    ${form}
    ${[...ocsDoDia, ...ocsSub].length ? `<h3>Lançamentos que valem hoje</h3><ul class="lista-oc">${[...ocsDoDia, ...ocsSub].map((o) => `<li><span>${esc(TIPOS[o.tipo])}${o.ini ? ` ${o.ini}–${o.fim}` : ""}${o.ate && o.ate !== o.de ? ` · ${ddmm(o.de)} a ${ddmm(o.ate)}` : ""}${o.req ? ` · REQ ${esc(o.req)}` : ""}</span>
      ${ui.confirmar === o.id ? `<button class="btn perigo" data-act="apagar" data-id="${o.id}">Confirmar exclusão</button>` : `<button class="link" data-act="pre-apagar" data-id="${o.id}">Excluir</button>`}</li>`).join("")}</ul>` : ""}
    <p><button class="link" data-act="abrir-ficha" data-gm="${g.id}">Abrir ficha completa do GM →</button></p>
  </div>`;
}

// ---------- LANÇAMENTOS ----------
function camposForm(tipo) {
  const f = ui.form;
  const gmSel = `<label>GM <select id="l-gm">${opcoesGm(f.gm)}</select></label>`;
  if (tipo === "FA") return `<label>Viatura <select id="l-posto">${opcoesPosto(f.posto)}</select></label>
    <div class="linha"><label>De <input type="date" id="l-de" value="${f.de || ui.dia}"></label><label>Até <input type="date" id="l-ate" value="${f.ate || ui.dia}"></label></div>`;
  if (tipo === "HE" || tipo === "BH_MAIS") return `${gmSel}<label>Posto <select id="l-posto">${opcoesPosto(f.posto)}</select></label>
    <div class="linha"><label>Data do serviço <input type="date" id="l-de" value="${f.de || ui.dia}"></label><label>Início <input type="time" id="l-ini" value="${f.ini || "19:00"}"></label><label>Fim <input type="time" id="l-fim" value="${f.fim || "01:00"}"></label></div>`;
  if (tipo === "TROCA") return `${gmSel}<label>Substituto <select id="l-sub">${opcoesGm(f.substituto)}</select></label><label>Data <input type="date" id="l-de" value="${f.de || ui.dia}"></label>`;
  if (tipo === "REMANEJ") return `${gmSel}<label>Novo posto <select id="l-posto">${opcoesPosto(f.posto)}</select></label>
    <div class="linha"><label>De <input type="date" id="l-de" value="${f.de || ui.dia}"></label><label>Até <input type="date" id="l-ate" value="${f.ate || ui.dia}"></label></div>`;
  const umDia = ["FOLGA", "FALTA", "BH_COMP"].includes(tipo);
  return `${gmSel}<div class="linha"><label>${umDia ? "Data" : "De"} <input type="date" id="l-de" value="${f.de || ui.dia}"></label>${umDia ? "" : `<label>Até <input type="date" id="l-ate" value="${f.ate || ui.dia}"></label>`}</div>`;
}
function descreveOc(o) {
  const p = o.posto ? postoPorId(o.posto)?.nome : "";
  if (o.tipo === "HORARIO") return `${o.ini}–${o.fim}${o.obs ? " · " + esc(o.obs) : ""}`;
  if (o.tipo === "INSPETOR") return `${esc(o.equipe)}: ${esc(o.nome)}`;
  if (o.tipo === "PREFIXO") return `${esc(o.nome)} no lugar da ${esc(p)}`;
  if (o.tipo === "HE" || o.tipo === "BH_MAIS") return `${o.ini}–${o.fim} · ${esc(p)}`;
  if (o.tipo === "TROCA") return `assumido por ${esc(nomeGm(o.substituto))}`;
  if (o.tipo === "REMANEJ") return `para ${esc(p)}`;
  if (o.tipo === "FA") return esc(o.obs || "");
  return o.obs ? esc(o.obs) : "";
}
function vLancamentos() {
  const fl = ui.filtroLanc;
  const lista = data.ocorrencias.filter((o) => fl.req ? o.req === fl.req : (!fl.tipo || o.tipo === fl.tipo) && (o.de.startsWith(fl.mes) || (o.ate || o.de).startsWith(fl.mes) || (o.de < fl.mes && (o.ate || o.de) > fl.mes)))
    .sort((a, b) => b.de.localeCompare(a.de) || (a.id < b.id ? 1 : -1));
  const contagem = {};
  for (const o of lista) contagem[o.tipo] = (contagem[o.tipo] || 0) + 1;
  return `<div class="cols-lanc">
  <section class="painel form-lanc"><h2>Novo lançamento</h2>
    <p class="dica">Tudo o que foge da escala ideal é um lançamento. A escala de cada dia e o livro de horas se recalculam sozinhos.</p>
    <label>Tipo <select id="l-tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === ui.form.tipo ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    ${camposForm(ui.form.tipo)}
    <label>REQ <input id="l-req" value="${esc(ui.form.req || "")}" placeholder="número do requerimento"></label>
    <label>Observação <input id="l-obs" value="${esc(ui.form.obs || "")}" placeholder="opcional"></label>
    <button class="btn pri" data-act="lancar">Lançar</button>
  </section>
  <section class="painel"><div class="cab-lista"><h2>${fl.req ? `REQ ${esc(fl.req)}${sentidoReq(fl.req) ? ` · ${esc(TIPOS_REQ[sentidoReq(fl.req)])}` : ""} <button class="link" data-act="limpar-req">ver todos os lançamentos</button>` : `Lançamentos · ${nomeMes(fl.mes)}`}</h2>
    <div class="filtros"><button class="ic" data-act="lmes" data-n="-1" aria-label="Mês anterior">‹</button><button class="ic" data-act="lmes" data-n="1" aria-label="Próximo mês">›</button>
    <select id="lf-tipo" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === fl.tipo ? "selected" : ""}>${v}${contagem[k] ? ` (${contagem[k]})` : ""}</option>`).join("")}</select>
    <input type="search" id="lf-busca" placeholder="Buscar GM ou REQ" aria-label="Buscar GM ou REQ"></div></div>
    <div class="tabela-wrap"><table class="lanc"><thead><tr><th>Data</th><th>Tipo</th><th>GM</th><th>Detalhe</th><th>REQ</th><th></th></tr></thead><tbody>
    ${lista.slice(0, 400).map((o) => `<tr data-nome="${esc((nomeGm(o.gm) + " " + (o.substituto ? nomeGm(o.substituto) : "") + " " + (o.req || "")).toLowerCase())}">
      <td class="num">${ddmm(o.de)}${o.ate && o.ate !== o.de ? `–${ddmm(o.ate)}` : ""}</td><td><span class="tipo t-${o.tipo}">${esc(TIPOS[o.tipo])}</span></td>
      <td>${o.gm ? `<button class="link" data-act="abrir-ficha" data-gm="${o.gm}">${esc(nomeGm(o.gm))}</button>` : esc(postoPorId(o.posto)?.nome)}</td><td>${descreveOc(o)}</td><td class="num">${esc(o.req || "")}</td>
      <td>${ui.confirmar === o.id ? `<button class="btn perigo" data-act="apagar" data-id="${o.id}">Confirmar</button>` : `<button class="link" data-act="pre-apagar" data-id="${o.id}">Excluir</button>`}</td></tr>`).join("")}
    </tbody></table></div>${lista.length > 400 ? `<p class="dica">Mostrando 400 de ${lista.length}. Filtre por tipo.</p>` : ""}
  </section></div>`;
}

// ---------- MÊS ----------
const COD = { S: ["S", "s"], TR: ["T", "tr"], HE: ["", "he"], "BH+": ["", "bh"], FOLGA: ["F", "f"], FERIAS: ["FÉ", "fe"], LICENCA: ["L", "l"], ATESTADO: ["A", "l"], CURSO: ["C", "l"], BH_COMP: ["BH", "bhc"], TROCA: ["T", "tr"] };
function celulaDia(marcas) {
  if (!marcas || !marcas.length) return `<td class="d"></td>`;
  const prim = marcas.find((m) => m !== "HE" && m !== "BH+");
  const [txt, cls] = prim ? COD[prim] : ["", ""];
  const he = marcas.includes("HE"), bh = marcas.includes("BH+");
  return `<td class="d ${cls}" title="${marcas.map((m) => TIPOS[m] || { S: "Serviço", TR: "Troca (cobrindo)", HE: "Hora extra", "BH+": "Banco de horas +" }[m]).join(", ")}">${txt}${he ? `<i class="dot he"></i>` : ""}${bh ? `<i class="dot bh"></i>` : ""}</td>`;
}
function vMes() {
  const m = ui.mes;
  const livro = livroMes(data, m);
  const dias = diasDoMes(m);
  const f = ui.filtroMes;
  let gms = data.gms.filter((g) => !f.equipe || g.equipe === f.equipe);
  const L = (g) => livro.get(g.id) || {};
  gms.sort({ he: (a, b) => L(b).he - L(a).he, heAsc: (a, b) => L(a).he + L(a).transporte - L(b).he - L(b).transporte, proximo: (a, b) => L(b).proximo - L(a).proximo, nome: (a, b) => a.nome.localeCompare(b.nome), equipe: (a, b) => a.equipe.localeCompare(b.equipe) || a.nome.localeCompare(b.nome) }[f.ordem]);
  const todos = [...livro.values()];
  const tot = (k) => todos.reduce((t, l) => t + (l[k] || 0), 0);
  const acima = todos.filter((l) => l.total > (data.config.tetoHE * 60)).length;
  const alternados = data.gms.filter((g) => equipe(g.equipe)?.tipo === "alternado");
  const folgaPend = alternados.filter((g) => (L(g).folgas || 0) < 2).length;
  return `<div class="barra"><div class="datas"><button class="ic" data-act="mes" data-n="-1" aria-label="Mês anterior">‹</button><h2 class="titulo-mes">${nomeMes(m)}</h2><button class="ic" data-act="mes" data-n="1" aria-label="Próximo mês">›</button></div>
    <div class="filtros"><select id="m-eq" aria-label="Equipe"><option value="">Todas as equipes</option>${data.equipes.map((e) => `<option value="${e.id}" ${e.id === f.equipe ? "selected" : ""}>${esc(e.nome)}</option>`).join("")}</select>
    <select id="m-ord" aria-label="Ordenar"><option value="he" ${f.ordem === "he" ? "selected" : ""}>Mais HE no mês</option><option value="heAsc" ${f.ordem === "heAsc" ? "selected" : ""}>Menos HE (próximo a chamar)</option><option value="proximo" ${f.ordem === "proximo" ? "selected" : ""}>Maior transporte p/ próximo mês</option><option value="equipe" ${f.ordem === "equipe" ? "selected" : ""}>Equipe</option><option value="nome" ${f.ordem === "nome" ? "selected" : ""}>Nome</option></select>
    <input type="search" id="m-busca" placeholder="Buscar GM" aria-label="Buscar GM"></div></div>
  <div class="resumo">
    <div class="kpi"><span class="v">${fmtHoras(tot("he"))}</span><span class="l">HE realizada no mês</span></div>
    <div class="kpi"><span class="v">${fmtHoras(tot("paga"))}</span><span class="l">HE a pagar (teto ${data.config.tetoHE}h por GM)</span></div>
    <div class="kpi ${tot("proximo") ? "atencao" : ""}"><span class="v">${fmtHoras(tot("proximo"))}</span><span class="l">vai para ${MESES[Number(mesSeguinte(m).slice(5)) - 1]} · ${acima} GM${acima === 1 ? "" : "s"} acima do teto</span></div>
    <div class="kpi ${folgaPend ? "atencao" : ""}"><span class="v">${folgaPend}</span><span class="l">GMs 12x36 com menos de 2 folgas</span></div>
  </div>
  <div class="legenda"><span><i class="lg s"></i>Serviço</span><span><i class="lg tr"></i>Troca</span><span><i class="dot he"></i>HE</span><span><i class="dot bh"></i>BH+</span><span><i class="lg f"></i>Folga</span><span><i class="lg fe"></i>Férias</span><span><i class="lg l"></i>Licença/atestado/curso</span><span><i class="lg bhc"></i>Compensação</span></div>
  <div class="tabela-wrap"><table class="mes"><thead><tr><th class="gmcol">GM</th><th>Eq.</th><th title="Serviços realizados / previstos pela escala">Serv.</th><th>Folgas</th><th>HE mês</th><th title="Horas que excederam o teto no mês anterior">Transp.</th><th>Paga</th><th>Próx. mês</th><th title="Parte da HE entre 22h e 5h — informativo para o RH">22–05h</th><th>BH</th>
    ${dias.map((d) => `<th class="d ${[0, 6].includes(diaSemana(d)) ? "fds" : ""}">${Number(d.slice(8))}<small>${SEMANA[diaSemana(d)][0]}</small></th>`).join("")}</tr></thead><tbody>
    ${gms.map((g) => { const l = L(g); const alt = equipe(g.equipe)?.tipo === "alternado"; return `<tr data-nome="${esc(g.nome.toLowerCase())}">
      <th class="gmcol" scope="row"><button class="link" data-act="abrir-ficha" data-gm="${g.id}">${esc(g.nome)}</button>${g.naoFazHE ? ` <span class="tag furo" title="Não realiza HE">sem HE</span>` : ""}</th><td>${g.equipe}</td>
      <td class="num">${l.servicos || 0}<small>/${l.servicosBase || 0}</small></td>
      <td class="num ${alt && (l.folgas || 0) !== 2 ? "alerta" : ""}">${alt ? `${l.folgas || 0}/2` : "—"}</td>
      <td class="num forte">${l.he ? fmtHoras(l.he) : "—"}</td><td class="num">${l.transporte ? fmtHoras(l.transporte) : "—"}</td>
      <td class="num">${l.paga ? fmtHoras(l.paga) : "—"}</td><td class="num ${l.proximo ? "alerta" : ""}">${l.proximo ? fmtHoras(l.proximo) : "—"}</td>
      <td class="num">${l.heNoturna ? fmtHoras(l.heNoturna) : "—"}</td><td class="num">${(() => { const s = saldoBH(data, g.id, m); return s ? fmtHoras(s) : "—"; })()}</td>
      ${dias.map((d) => celulaDia(l.dias?.[d])).join("")}</tr>`; }).join("")}
  </tbody></table></div>`;
}

// ---------- FICHA DO GM ----------
function vFicha() {
  const g = gmPorId(ui.gm) || data.gms[0];
  ui.gm = g.id;
  const m = ui.mes;
  const l = livroMes(data, m).get(g.id) || {};
  const eq = equipe(g.equipe);
  const hist = [];
  for (let x = data.config.mesInicial; x <= "2026-12"; x = mesSeguinte(x)) hist.push([x, livroMes(data, x).get(g.id) || {}]);
  const dias = diasDoMes(m).map((d) => {
    const cd = calcularDia(data, d);
    const des = cd.designacoes.filter((x) => x.gm === g.id);
    const af = cd.afastados.find((a) => a.gm === g.id);
    const longo = !af && data.ocorrencias.find((o) => o.gm === g.id && ["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && o.de <= d && d <= (o.ate || o.de));
    if (!des.length && !af && !longo) return "";
    return `<li class="${d === ui.dia ? "hoje" : ""}"><button class="link data" data-act="ir-dia" data-dia="${d}">${SEMANA[diaSemana(d)].slice(0, 3)} ${ddmm(d)}</button><div>
      ${des.map((x) => `<p><span class="hr">${fmtHm(x.ini)}–${fmtHm(x.fim)}</span> ${esc(postoPorId(x.posto)?.nome || "À disposição")}${x.funcao ? ` · ${esc(x.funcao)}` : ""} ${BADGE[x.nat] ? `<span class="tag ${BADGE[x.nat][1]}">${x.fixa ? "HE fixa" : BADGE[x.nat][0]}</span>` : ""}${x.titular ? ` <span class="meta">por ${esc(nomeGm(x.titular))}</span>` : ""}${x.req && !x.fixa ? ` <span class="req">REQ ${esc(x.req)}</span>` : ""}</p>`).join("")}
      ${af ? `<p class="estado">${esc(TIPOS[af.tipo])}${af.tipo === "TROCA" ? ` · coberto por ${esc(nomeGm(af.oc.substituto))}` : ""}</p>` : ""}${longo ? `<p class="estado">${esc(TIPOS[longo.tipo])}</p>` : ""}</div></li>`;
  }).join("");
  return `<div class="barra"><div class="datas"><label class="sel-gm">GM <select id="fi-gm">${opcoesGm(g.id)}</select></label>
    <button class="ic" data-act="mes" data-n="-1" aria-label="Mês anterior">‹</button><span class="titulo-mes">${nomeMes(m)}</span><button class="ic" data-act="mes" data-n="1" aria-label="Próximo mês">›</button></div></div>
  <section class="painel ficha-cab"><div><p class="eyebrow">${esc(eq?.nome)} · mat. ${esc(g.matricula)}</p><h2>${esc(g.nome)}</h2><p class="meta">${esc(rotuloLotacao(g))}${eq?.tipo === "semanal" ? ` · ${(g.dias || [1, 2, 3, 4, 5]).map((d) => SEMANA[d].slice(0, 3).toLowerCase()).join(", ")}` : ""}</p>
    ${g.naoFazHE ? `<p class="tag-linha"><span class="tag furo">Não realiza HE</span></p>` : ""}${g.obs ? `<p class="meta">${esc(g.obs)}</p>` : ""}</div>
    <label class="toggle"><input type="checkbox" id="fi-semhe" ${g.naoFazHE ? "checked" : ""}> Não realiza HE</label></section>
  <div class="resumo">
    <div class="kpi"><span class="v">${l.servicos || 0}<small>/${l.servicosBase || 0}</small></span><span class="l">serviços realizados / previstos</span></div>
    ${eq?.tipo === "alternado" ? `<div class="kpi ${(l.folgas || 0) !== 2 ? "atencao" : ""}"><span class="v">${l.folgas || 0}/2</span><span class="l">folgas do mês</span></div>` : ""}
    <div class="kpi"><span class="v">${fmtHoras(l.he || 0)}</span><span class="l">HE no mês${l.heFixa ? ` (${fmtHoras(l.heFixa)} fixa)` : ""}</span></div>
    <div class="kpi"><span class="v">${fmtHoras(l.paga || 0)}</span><span class="l">a pagar · ${fmtHoras(l.transporte || 0)} vieram do mês anterior</span></div>
    <div class="kpi ${l.proximo ? "atencao" : ""}"><span class="v">${fmtHoras(l.proximo || 0)}</span><span class="l">passa para o mês seguinte</span></div>
    <div class="kpi"><span class="v">${fmtHoras(saldoBH(data, g.id, m))}</span><span class="l">saldo do banco de horas</span></div>
  </div>
  <div class="cols-ficha">
    <section class="painel"><h3>Dia a dia</h3><ul class="diaadia">${dias || `<li><p class="dica">Nada neste mês.</p></li>`}</ul></section>
    <section class="painel"><h3>Livro de HE</h3><table class="hist"><thead><tr><th>Mês</th><th>Veio</th><th>Feita</th><th>Paga</th><th>Passa</th></tr></thead><tbody>
      ${hist.map(([x, h]) => `<tr class="${x === m ? "atual" : ""}"><td>${MESES[Number(x.slice(5)) - 1].slice(0, 3)}/${x.slice(2, 4)}</td><td class="num">${fmtHoras(h.transporte || 0)}</td><td class="num">${fmtHoras(h.he || 0)}</td><td class="num">${fmtHoras(h.paga || 0)}</td><td class="num">${fmtHoras(h.proximo || 0)}</td></tr>`).join("")}
    </tbody></table><p class="dica">Pagamento até ${data.config.tetoHE}h por mês. O que passa disso entra no mês seguinte. O adicional noturno é calculado pelo RH${l.heNoturna ? `; neste mês ${fmtHoras(l.heNoturna)} da HE caíram entre 22h e 5h` : ""}.</p></section>
  </div>`;
}

// ---------- FOLHA (impressão) ----------
function vFolha() {
  const cd = calcularDia(data, ui.dia);
  const amanha = somaDias(ui.dia, 1);
  const eqs = cd.equipes.map(equipe);
  const insp = (per) => eqs.filter((e) => e.periodo === per).map((e) => cd.inspetores.get(e.id) || e.inspetor).join(", ");
  const faPostos = new Map(cd.fa.map((o) => [o.posto, o]));
  const cel = (p, t) => {
    if (faPostos.has(p.id)) return `<td colspan="2" class="c">${faPostos.get(p.id).tipo === "FA" ? "FA" : "FECHADO"}</td>`;
    const aqui = cd.designacoes.filter((d) => d.posto === p.id && sobrepoe(d.ini, d.fim, t.ini, t.fim) > 0).sort((a, b) => a.ini - b.ini);
    if (!aqui.length) {
      if (p.rondas) return `<td colspan="2" class="c rondas-p">VTR/RONDAS FREQUENTES</td>`;
      if (cd.furos.some((f) => f.posto === p.id && f.turno === t.id)) return `<td colspan="2" class="c furo-p">X</td>`;
      return `<td></td><td></td>`;
    }
    return `<td class="gn">${aqui.map((d) => `<div class="${d.nat} ${p.tipo === "reserva" ? "reserva" : ""}">${esc(nomeGm(d.gm))}${d.nat === "he" ? (d.fixa ? "" : " HE+") : d.nat === "bh" ? " BH+" : ""}${d.req && !d.fixa ? ` <span class="r">${esc(d.req)}</span>` : ""}</div>`).join("")}</td>
      <td class="gh">${aqui.map((d) => `<div class="${d.nat}">(${textoCelula(d, t)})</div>`).join("")}</td>`;
  };
  let corpo = "", corpoVerso = "";
  for (const s of data.secoes) {
    const ps = data.postos.filter((p) => p.secao === s.id && p.ativo !== false);
    const verso = ps.length && ps.every((p) => p.tipo === "reserva");
    let html = "";
    html += `<tr class="sec"><th>${esc(s.nome)}</th>${TURNOS.map((t) => `<th colspan="2">${t.nome}</th>`).join("")}</tr>`;
    html += ps.map((p) => `<tr><th class="p">${esc(nomeNoDia(p, cd))}${p.sub && p.tipo !== "reserva" ? `<br><span class="sub">${esc(p.sub)}</span>` : ""}${p.obs ? `<br><span class="sub">(${esc(p.obs)})</span>` : ""}</th>${TURNOS.map((t) => cel(p, t)).join("")}</tr>`).join("");
    if (verso) corpoVerso += html; else corpo += html;
  }
  const grupo = (tipos, titulo, colRet) => {
    const g = cd.afastados.filter((a) => tipos.includes(a.tipo));
    if (!g.length) return "";
    return `<tr class="sec"><th>${titulo}</th><th colspan="4">GM</th><th colspan="4">${colRet}</th></tr>
      ${g.map((a) => `<tr><th class="p"></th><td colspan="4" class="c">${esc(nomeGm(a.gm))} <span class="sub">${a.gm && equipe(gmPorId(a.gm).equipe)?.periodo === "noite" ? "(noite)" : "(dia)"}</span></td><td colspan="4" class="c r">${a.tipo === "TROCA" ? `coberto por ${esc(nomeGm(a.oc.substituto))}` : a.oc.ate && a.oc.ate !== a.oc.de ? `${ddmm(a.oc.de)} a ${ddmm(a.oc.ate)}` : a.oc.req ? `REQ ${esc(a.oc.req)}` : ddmm(a.oc.de)}</td></tr>`).join("")}`;
  };
  const enquadrado = window.self !== window.top;
  return `<div class="barra nao-imprimir"><div class="datas"><button class="ic" data-act="dia" data-n="-1" aria-label="Dia anterior">‹</button><input type="date" id="q-dia" value="${ui.dia}" aria-label="Data"><button class="ic" data-act="dia" data-n="1" aria-label="Próximo dia">›</button></div>
    ${enquadrado ? `<p class="dica">Folha no formato que vai para os inspetores. Para gerar o PDF, abra <code>prototipo/index.html</code> no Chrome e use Ctrl+P (A4, frente e verso).</p>` : `<button class="btn pri" data-act="imprimir">Imprimir / salvar PDF</button>`}</div>
  <div class="papel-wrap"><article class="papel">
    <header class="pcab"><div><b>${esc(data.config.cabecalho)}</b><span>INSP. OP. DIA: ${esc(insp("dia"))}</span><span>INSP. OP. NOITE: ${esc(insp("noite"))}</span></div>
      <div class="pdata"><span>DATA: ${ddmmaaaa(ui.dia)} · 2º 3º 4º TURNOS · ${SEMANA[diaSemana(ui.dia)]}</span><span>DATA: ${ddmmaaaa(amanha)} · 1º TURNO · ${SEMANA[diaSemana(amanha)]}</span></div></header>
    <table class="pt">${corpo}</table>
    <div class="quebra"></div>
    <table class="pt verso">
      ${corpoVerso}
      ${grupo(["BH_COMP"], "BANCO DE HORAS / COMPENSAÇÃO", "REQ.")}
      ${grupo(["FOLGA"], "FOLGAS", "DATA")}
      ${grupo(["TROCA"], "TROCAS DE SERVIÇO", "SITUAÇÃO")}
      ${grupo(["ATESTADO", "LICENCA", "CURSO"], "ATESTADO / LICENÇAS / CURSOS", "PERÍODO")}
      ${grupo(["FERIAS"], "FÉRIAS", "PERÍODO")}
    </table>
  </article></div>`;
}


// ---------- PENDÊNCIAS (semana) ----------
const PERIODOS = [["dia", ["t2", "t3"], "Dia"], ["noite", ["t4", "t1"], "Noite"]];
function pendenciasDoDia(dia) {
  const cd = calcularDia(data, dia);
  const out = [];
  for (const p of data.postos) for (const [per, ts] of PERIODOS) {
    const fs = cd.furos.filter((f) => f.posto === p.id && ts.includes(f.turno));
    if (!fs.length) continue;
    const t0 = TURNOS.find((x) => x.id === fs[0].turno), t1 = TURNOS.find((x) => x.id === fs[fs.length - 1].turno);
    out.push({ dia, posto: p, per, turnos: fs.map((f) => f.turno), faltam: Math.max(...fs.map((f) => f.faltam)), ini: t0.ini, fim: t1.fim });
  }
  return out;
}
function vPendencias() {
  const dias = Array.from({ length: 7 }, (_, i) => somaDias(ui.dia, i));
  const porDia = dias.map((d) => ({ d, cd: calcularDia(data, d), pend: pendenciasDoDia(d) }));
  let vagas = 0, cobertas = 0, heSemana = 0;
  for (const { cd, d } of porDia) {
    for (const p of data.postos) if (p.vagas && !cd.fa.some((o) => o.posto === p.id) && !(p.dias && !p.dias.includes(diaSemana(d))))
      for (const t of TURNOS) vagas += p.vagas[t.id] || 0;
    cobertas -= cd.furos.reduce((t, f) => t + f.faltam, 0);
    heSemana += cd.designacoes.filter((x) => x.nat === "he" && !x.fixa).reduce((t, x) => t + x.fim - x.ini, 0);
  }
  cobertas += vagas;
  const totalFuros = porDia.reduce((t, x) => t + x.pend.length, 0);
  const livro = livroMes(data, mesDe(ui.dia));
  const acima = [...livro.values()].filter((l) => l.total > data.config.tetoHE * 60).length;
  const naReserva = porDia[0].cd.designacoes.filter((x) => postoPorId(x.posto)?.tipo === "reserva").length;

  // mapa da semana
  const postos = data.postos.filter((p) => p.ativo !== false && p.vagas && Object.values(p.vagas).some(Boolean));
  const linhas = data.secoes.map((s) => {
    const ps = postos.filter((p) => p.secao === s.id);
    if (!ps.length) return "";
    return `<tr class="secao"><th colspan="${1 + dias.length * 2}">${esc(s.nome)}</th></tr>` + ps.map((p) => `<tr><th scope="row">${esc(p.nome)}</th>${porDia.map(({ d, cd }) => PERIODOS.map(([per, ts]) => {
      const precisa = ts.some((t) => p.vagas[t]) && !(p.dias && !p.dias.includes(diaSemana(d)));
      if (!precisa) return `<td class="m-na ${per}"></td>`;
      if (cd.fa.some((o) => o.posto === p.id)) return `<td class="m-fa ${per}" title="Fora de atividade">FA</td>`;
      const f = cd.furos.filter((x) => x.posto === p.id && ts.includes(x.turno));
      if (!f.length) return `<td class="m-ok ${per}" title="${esc(p.nome)} · ${per} ${ddmm(d)} · coberto"><span aria-label="coberto">●</span></td>`;
      const n = Math.max(...f.map((x) => x.faltam));
      return `<td class="m-furo ${per}"><button data-act="pend-abrir" data-dia="${d}" data-posto="${p.id}" data-turno="${f[0].turno}" title="${esc(p.nome)} · ${per} ${ddmm(d)} · falta ${n}">${n}</button></td>`;
    }).join("")).join("")}</tr>`).join("");
  }).join("");

  const cards = porDia.filter((x) => x.pend.length).map(({ d, pend }) => `<section class="pdia"><header><h3>${SEMANA[diaSemana(d)].toLowerCase()} <b>${ddmm(d)}</b></h3>
      <span class="n">${pend.length}</span><button class="link" data-act="ir-dia" data-dia="${d}">Abrir quadro do dia →</button></header>
      <ul>${pend.map((x) => {
        const { remanejar, he } = sugerir(data, d, x.posto.id, x.ini, x.fim);
        const r = remanejar[0], h = he.find((s) => !s.bloqueado);
        return `<li><div class="pinfo"><b>${esc(x.posto.nome)}</b> <span class="meta">${x.per === "dia" ? "Dia" : "Noite"} ${fmtHm(x.ini)}–${fmtHm(x.fim)}${x.faltam > 1 ? ` · faltam ${x.faltam}` : ""}</span></div>
          <div class="pacoes">${r ? `<button class="btn rem" data-act="pend-rem" data-dia="${d}" data-posto="${x.posto.id}" data-gm="${r.gm.id}" title="Remanejar ${esc(r.gm.nome)} da ${esc(r.origem)}">Remanejar <b>${esc(r.gm.nome)}</b><small>${esc(r.origem)} · sem custo</small></button>` : ""}
          ${h ? `<button class="btn hebtn" data-act="pend-he" data-dia="${d}" data-posto="${x.posto.id}" data-gm="${h.gm.id}" data-ini="${fmtHm(x.ini)}" data-fim="${fmtHm(x.fim)}">HE <b>${esc(h.gm.nome)}</b><small>${fmtHoras(x.fim - x.ini)} · tem ${fmtHoras(h.heMes)} no mês</small></button>` : ""}
          <button class="link" data-act="pend-abrir" data-dia="${d}" data-posto="${x.posto.id}" data-turno="${x.turnos[0]}">Outras opções</button></div></li>`;
      }).join("")}</ul></section>`).join("");

  return `<div class="barra"><div class="datas"><button class="ic" data-act="dia" data-n="-7" aria-label="Semana anterior">‹</button>
    <h2 class="titulo-mes">Semana de ${ddmm(dias[0])} a ${ddmm(dias[6])}</h2><button class="ic" data-act="dia" data-n="7" aria-label="Próxima semana">›</button>
    ${ui.dia !== hojeBase() ? `<button class="link" data-act="ir-hoje">Voltar para hoje</button>` : ""}</div></div>
  <div class="resumo">
    <div class="kpi ${totalFuros ? "ruim" : "bom"}"><span class="v">${totalFuros}</span><span class="l">furos para resolver em 7 dias</span></div>
    <div class="kpi"><span class="v">${vagas ? Math.round((cobertas / vagas) * 100) : 100}%</span><span class="l">das vagas cobertas na semana</span></div>
    <div class="kpi"><span class="v">${naReserva}</span><span class="l">na reserva técnica em ${ddmm(dias[0])}</span></div>
    <div class="kpi"><span class="v">${fmtHoras(heSemana)}</span><span class="l">de HE lançada na semana</span></div>
    <div class="kpi ${acima ? "atencao" : ""}"><span class="v">${acima}</span><span class="l">GM${acima === 1 ? "" : "s"} acima de ${data.config.tetoHE}h no mês</span></div>
  </div>
  <div class="cols-pend">
    <section class="painel"><h3>Cobertura da semana</h3><p class="dica">Cada bolinha é um posto coberto. Número vermelho = vagas descobertas; clique para resolver.</p>
      <div class="tabela-wrap mapa-wrap"><table class="mapa"><thead><tr><th></th>${dias.map((d) => `<th colspan="2" class="${d === ui.dia ? "hoje" : ""}">${SEMANA[diaSemana(d)].slice(0, 3)} ${ddmm(d)}</th>`).join("")}</tr>
      <tr><th></th>${dias.map(() => `<th class="sub dia">D</th><th class="sub noite">N</th>`).join("")}</tr></thead><tbody>${linhas}</tbody></table></div></section>
    <section class="painel fila"><div class="fila-cab"><h3>O que falta resolver</h3>${totalFuros ? `<button class="btn pri grande" data-act="auto" data-dias="7">Preencher a semana sozinho</button>` : ""}</div>
      ${ui.plano ? painelPlano() : `<p class="dica">Primeiro a sugestão sem custo (reserva técnica ou à disposição); depois a HE para quem tem menos horas no mês. Um clique lança.</p>
      ${cards || `<p class="tudo-ok">Semana coberta. Nada pendente.</p>`}`}</section>
  </div>`;
}
const hojeBase = () => (hojeReal >= "2026-10-01" && hojeReal <= "2026-12-31" ? hojeReal : "2026-11-26");

// ---------- AJUSTES ----------
function vAjustes() {
  const c = data.config;
  const anc = c.ancora || { data: ui.dia, equipes: [] };
  const alt = (per) => data.equipes.filter((e) => e.tipo === "alternado" && e.periodo === per);
  const sel = (per) => `<select id="aj-${per}">${alt(per).map((e) => `<option value="${e.id}" ${anc.equipes.includes(e.id) ? "selected" : ""}>${esc(e.nome)} (${e.id})</option>`).join("")}</select>`;
  const prox = Array.from({ length: 6 }, (_, i) => somaDias(anc.data, i));
  return `<section class="painel ajustes"><h2>Alternância das equipes 12x36</h2>
    <p class="dica">Informe um dia qualquer e quais equipes trabalham nele. O sistema alterna dia sim, dia não a partir daí, para frente e para trás.</p>
    <div class="linha"><label>Dia de referência <input type="date" id="aj-data" value="${anc.data}"></label>
      <label>Equipe do dia ${sel("dia")}</label><label>Equipe da noite ${sel("noite")}</label></div>
    <p class="dica">Próximos dias: ${prox.map((d) => `${ddmm(d)} ${calcularDia(data, d).equipes.join("/")}`).join(" · ")}</p>
    <h2>Horas extras</h2>
    <div class="linha"><label>Teto de HE paga por mês (horas) <input type="number" id="aj-teto" min="1" max="300" value="${c.tetoHE}"></label></div>
    <p class="dica">O que passar do teto vai para o mês seguinte.</p>
    <h2>Folha</h2>
    <label>Cabeçalho <input id="aj-cab" value="${esc(c.cabecalho)}" size="50"></label>
    <div><button class="btn pri" data-act="salvar-ajustes">Salvar ajustes</button></div></section>`;
}

// ---------- LANÇAMENTO RÁPIDO ----------
const EXEMPLOS = ["folga {A} 28/11", "férias {A} 1/12 a 30/12 req 1402", "he {A} hoje 19-01 vtr 1317 req 1504", "troca {A} por {B} 29/11", "remanejar {A} parcão amanhã", "fa vtr 1281 26/11 a 30/11"];
function previaComando(txt) {
  const box = $("#cmd-prev");
  if (!box) return;
  if (!txt.trim()) {
    const [A, B] = [data.gms[5]?.nome || "", data.gms[60]?.nome || ""];
    box.innerHTML = `<p class="dica">Escreva como falaria. Exemplos (clique para usar):</p><div class="exs">${EXEMPLOS.map((e) => { const x = e.replace("{A}", A.toLowerCase()).replace("{B}", B.toLowerCase()); return `<button class="ex" data-act="cmd-ex" data-txt="${esc(x)}">${esc(x)}</button>`; }).join("")}</div>`;
    return;
  }
  const r = interpretar(txt, data, ui.dia);
  const campo = (rot, val, ok = true) => `<span class="cp ${ok ? "" : "falta"}"><small>${rot}</small>${val}</span>`;
  const partes = [campo("Tipo", r.tipo ? esc(TIPOS[r.tipo]) : "?", !!r.tipo)];
  if (r.tipo !== "FA") partes.push(campo("GM", r.gm ? esc(nomeGm(r.gm)) : "?", !!r.gm));
  if (r.tipo === "TROCA") partes.push(campo("Quem assume", r.substituto ? esc(nomeGm(r.substituto)) : "?", !!r.substituto));
  partes.push(campo(r.ate && r.ate !== r.de ? "Período" : "Data", `${SEMANA[diaSemana(r.de)].slice(0, 3).toLowerCase()} ${ddmm(r.de)}${r.ate && r.ate !== r.de ? ` a ${ddmm(r.ate)}` : ""}${r.dataPresumida ? " (dia aberto)" : ""}`));
  if (r.ini || r.tipo === "HE" || r.tipo === "BH_MAIS") partes.push(campo("Horário", r.ini ? `${r.ini}–${r.fim}` : "?", !!r.ini));
  if (r.posto || ["HE", "BH_MAIS", "REMANEJ", "FA"].includes(r.tipo)) partes.push(campo(r.tipo === "FA" ? "Viatura" : "Posto", r.posto ? esc(postoPorId(r.posto).nome) : "?", !!r.posto));
  if (r.req) partes.push(campo("REQ", esc(r.req)));
  box.innerHTML = `<div class="cps">${partes.join("")}</div>
    ${r.ambiguo ? `<p class="dica">"${esc(r.ambiguo.termo)}" pode ser: ${r.ambiguo.opcoes.map(esc).join(", ")}</p>` : ""}
    ${r.completo ? `<p class="ok-linha"><button class="btn pri" data-act="cmd-lancar">Lançar</button> <span class="dica">ou tecle Enter</span></p>` : `<p class="dica falta-txt">Falta: ${r.faltando.join(", ")}</p>`}`;
}
function lancarComando() {
  const inp = $("#cmd");
  const r = interpretar(inp.value, data, ui.dia);
  if (!r.completo) { previaComando(inp.value); return; }
  const o = { id: novoId(), tipo: r.tipo, de: r.de };
  for (const k of ["gm", "substituto", "ate", "ini", "fim", "posto", "req"]) if (r[k]) o[k] = r[k];
  mudar(`Lançado: ${TIPOS[r.tipo]}${o.gm ? " · " + nomeGm(o.gm) : ""} · ${ddmm(o.de)}${o.ate && o.ate !== o.de ? " a " + ddmm(o.ate) : ""}`, () => data.ocorrencias.push(o));
  inp.value = ""; previaComando("");
}

// ---------- PREENCHER SOZINHO ----------
function painelPlano() {
  if (!ui.plano) return "";
  const p = ui.plano;
  const ok = p.filter((x) => x.ok);
  const he = ok.filter((x) => x.tipo === "HE"), rem = ok.filter((x) => x.tipo === "REMANEJ");
  const semNinguem = p.filter((x) => !x.tipo).length;
  const porDia = {};
  p.forEach((x, i) => (porDia[x.dia] ||= []).push([x, i]));
  return `<section class="plano" aria-live="polite"><h3>Proposta do sistema</h3>
    <p>Para cobrir ${p.length} ${p.length === 1 ? "vaga" : "vagas"}: <b>${rem.length}</b> remanejamento${rem.length === 1 ? "" : "s"} sem custo e <b>${he.length}</b> hora${he.length === 1 ? "" : "s"} extra${he.length === 1 ? "" : "s"} (${fmtHoras(he.reduce((t, x) => t + x.fim - x.ini, 0))}).${semNinguem ? ` ${semNinguem} sem ninguém disponível.` : ""}
    Desmarque o que não quiser e confirme.</p>
    <div class="plano-lista">${Object.entries(porDia).map(([d, itens]) => `<h4>${SEMANA[diaSemana(d)].toLowerCase()} ${ddmm(d)}</h4><ul>${itens.map(([x, i]) => `<li class="${x.tipo ? "" : "sem"}">
      ${x.tipo ? `<input type="checkbox" class="plano-ck" id="pl-${i}" data-i="${i}" ${x.ok ? "checked" : ""}>` : `<span class="x">!</span>`}
      <label for="pl-${i}"><b>${esc(postoPorId(x.posto).nome)}</b> <span class="hr">${fmtHm(x.ini)}–${fmtHm(x.fim)}</span> →
      ${x.tipo === "REMANEJ" ? `<span class="tag troca">REMANEJAR</span> <b>${esc(nomeGm(x.gm))}</b> <span class="meta">da ${esc(x.de)}, sem custo</span>`
        : x.tipo === "HE" ? `<span class="tag he">HE</span> <b>${esc(nomeGm(x.gm))}</b> <span class="meta">${fmtHoras(x.fim - x.ini)} · tinha ${fmtHoras(x.horasNoMes)} no mês${x.conhecePosto ? " · conhece o posto" : ""}</span>`
        : `<span class="meta">ninguém disponível — resolver à mão</span>`}</label></li>`).join("")}</ul>`).join("")}</div>
    <div class="plano-acoes"><button class="btn pri grande" data-act="plano-aplicar">Confirmar ${ok.length} ${ok.length === 1 ? "lançamento" : "lançamentos"}</button><button class="btn" data-act="plano-cancelar">Cancelar</button></div></section>`;
}

// ---------- EDIÇÃO NA PRÓPRIA CÉLULA ----------
const PRESETS = {
  dia: [["07:00", "13:00"], ["13:00", "19:00"], ["07:00", "19:00"], ["07:00", "21:00"], ["13:00", "01:00"]],
  noite: [["19:00", "01:00"], ["01:00", "07:00"], ["19:00", "07:00"], ["17:00", "07:00"]],
};
const periodoDe = (ini) => (ini >= 1140 || ini < 420 ? "noite" : "dia");
function abrirPop(modo, el, extra) {
  const r = el.getBoundingClientRect();
  ui.pop = { modo, anc: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }, ...extra };
  desenharPop();
}
// A caixinha acompanha a rolagem da página, ancorada no ponto clicado.
function posicionarPop() {
  const p = $("#pop"), s = ui.pop;
  if (!s || p.hidden) return;
  if (innerWidth < 600) { p.classList.add("embaixo"); p.style.left = ""; p.style.top = ""; return; }
  p.classList.remove("embaixo");
  const W = p.offsetWidth, h = p.offsetHeight;
  const ax = s.anc.x - scrollX, ay = s.anc.y - scrollY;
  const x = Math.min(Math.max(12, ax), innerWidth - W - 12);
  let y = ay + s.anc.h + 6;
  if (y + h > innerHeight - 12) y = Math.max(12, ay - h - 6);
  p.style.left = x + "px"; p.style.top = y + "px";
}
function fecharPop() { ui.pop = null; const p = $("#pop"); if (p) { p.hidden = true; p.innerHTML = ""; } }
function desenharPop() {
  const p = $("#pop"), s = ui.pop;
  p.innerHTML = { hora: popCard, card: popCard, tirar: popTirar, insp: popInsp, gm: popGm, add: popGm, motivo: popMotivo, posto: popPosto, secao: popSecao }[s.modo](s);
  p.hidden = false;
  const W = Math.min(s.modo === "posto" || s.modo === "secao" ? 440 : 380, innerWidth - 24);
  p.style.width = W + "px";
  posicionarPop();
  const foco = p.querySelector("#p-busca, #p-ini, #in-nome");
  if (foco && innerWidth >= 600) foco.focus();
  if (s.modo === "hora" || s.modo === "card") previaHora();
}
const cabPop = (t, sub) => `<div class="pop-cab"><div><b>${t}</b>${sub ? `<span class="meta">${sub}</span>` : ""}</div><button class="ic" data-act="pop-fechar" aria-label="Fechar">×</button></div>`;
function ehHeLancada(d) { return (d.nat === "he" || d.nat === "bh") && !d.fixa && !d.ajuste && d.origem !== "base"; }
function popGm(s) {
  let ini, fim, posto, titulo, sub, topo = "";
  if (s.modo === "gm") {
    const d = s.des; ini = d.ini; fim = d.fim; posto = d.posto;
    titulo = `Trocar ${esc(nomeGm(d.gm))}`;
    sub = `${esc(postoPorId(posto)?.nome || "À disposição")} · ${fmtHm(ini)}–${fmtHm(fim)} · escolha quem fica no lugar`;
  } else {
    posto = s.posto; [ini, fim] = intervalo(s.ini, s.fim);
    const t = TURNOS.find((x) => x.id === s.turno);
    titulo = `Pôr alguém em ${esc(postoPorId(posto).nome)}`;
    sub = `${SEMANA[diaSemana(ui.dia)].toLowerCase()} ${ddmm(ui.dia)} · ${t.nome.toLowerCase()}`;
    const per = ["t2", "t3"].includes(s.turno) ? "dia" : "noite";
    topo = `<div class="presets">${[[fmtHm(t.ini), fmtHm(t.fim)], ...PRESETS[per].filter(([a, b]) => { const [x, y] = intervalo(a, b); return sobrepoe(x, y, t.ini, t.fim) > 0 && !(a === fmtHm(t.ini) && b === fmtHm(t.fim)); })]
      .map(([a, b]) => `<button class="opt ${a === s.ini && b === s.fim ? "on" : ""}" data-act="pop-add-hora" data-ini="${a}" data-fim="${b}">${a}–${b}</button>`).join("")}</div>`;
  }
  const { remanejar, he } = sugerir(data, ui.dia, posto, ini, fim);
  const linhaHe = (x, i) => `<li data-nome="${esc(norm(x.gm.nome))}" ${i >= 6 ? 'class="mais" hidden' : ""}><button class="pessoa" data-act="pop-escolher" data-gm="${x.gm.id}" data-via="he" ${x.bloqueado ? "disabled" : ""}>
    <b>${esc(x.gm.nome)}</b><small>${x.gm.equipe} · ${fmtHoras(x.heMes)} de HE no mês${x.mesmoPosto ? " · conhece o posto" : ""}${x.bloqueado ? " · não realiza HE" : ""}</small><span class="via he">hora extra</span></button></li>`;
  return `${cabPop(titulo, sub)}<div class="pop-corpo">${topo}
    ${remanejar.length ? `<p class="grupo">Sem custo</p><ul class="pessoas">${remanejar.map((x) => `<li data-nome="${esc(norm(x.gm.nome))}"><button class="pessoa" data-act="pop-escolher" data-gm="${x.gm.id}" data-via="rem" data-origem="${esc(x.origem.toLowerCase())}">
      <b>${esc(x.gm.nome)}</b><small>está na ${esc(x.origem.toLowerCase())}</small><span class="via rem">remanejar</span></button></li>`).join("")}</ul>` : ""}
    <p class="grupo">Livres nesse horário · ${fmtHoras(fim - ini)} de hora extra</p>
    <input type="search" id="p-busca" placeholder="Digite o nome" aria-label="Buscar GM">
    <ul class="pessoas" id="p-lista">${he.map(linhaHe).join("")}</ul>
    ${!he.length ? `<p class="dica">Ninguém livre nesse horário.</p>` : ""}
    ${s.modo === "add" ? `<button class="link" data-act="pop-drawer">Mais opções (banco de horas, REQ…)</button>` : ""}</div>`;
}
function popMotivo(s) {
  const d = s.des, X = nomeGm(s.escolhido), T = nomeGm(d.gm);
  const como = s.via === "rem" ? `${esc(X)} sai de ${esc(s.origem)} (sem custo).` : `${esc(X)} entra com ${fmtHoras(d.fim - d.ini)} de hora extra.`;
  const op = (m, t, sub) => `<button class="pessoa motivo" data-act="pop-motivo" data-m="${m}"><b>${t}</b>${sub ? `<small>${sub}</small>` : ""}</button>`;
  return `${cabPop(`${esc(X)} no lugar de ${esc(T)}`, "O que aconteceu?")}<div class="pop-corpo">
    <div class="motivos">${op("TROCA", "Trocaram de serviço", `sem hora extra · ${esc(T)} paga o serviço depois`)}
    ${op("FOLGA", `${esc(T)} está de folga`, como)}${op("FALTA", `${esc(T)} faltou`, como)}${op("ATESTADO", `${esc(T)} apresentou atestado`, como)}${op("BH_COMP", `${esc(T)} compensou banco de horas`, como)}</div>
    <button class="link" data-act="pop-voltar">← escolher outro GM</button></div>`;
}

// ---------- POSTOS, VIATURAS E SEÇÕES CLICÁVEIS ----------
const NOME_TURNO = { t2: "2º", t3: "3º", t4: "4º", t1: "1º" };
const stepper = (pref, vagas) => `<div class="steppers">${TURNOS.map((t) => `<div class="stp"><span>${NOME_TURNO[t.id]} turno</span><div class="stp-ctl">
  <button class="ic" data-act="step" data-alvo="${pref}-${t.id}" data-d="-1" aria-label="Menos no ${NOME_TURNO[t.id]} turno">−</button>
  <input type="number" id="${pref}-${t.id}" min="0" max="9" value="${(vagas || {})[t.id] || 0}" aria-label="Vagas no ${NOME_TURNO[t.id]} turno">
  <button class="ic" data-act="step" data-alvo="${pref}-${t.id}" data-d="1" aria-label="Mais no ${NOME_TURNO[t.id]} turno">+</button></div></div>`).join("")}</div>`;
const lerStepper = (pref) => Object.fromEntries(TURNOS.map((t) => [t.id, Math.max(0, Math.min(9, Number($(`#${pref}-${t.id}`).value) || 0))]));
const ehViatura = (p) => p.tipo === "vtr" || p.tipo === "moto";
function nomeNoDia(p, cd) {
  const pre = cd?.ajustesPosto?.get(p.id)?.prefixo;
  return pre ? `${pre.nome} (no lugar da ${p.nome.replace(/^(NOITE )?(VTR|MT) /, "")})` : p.nome;
}
function popPosto(s) {
  const p = postoPorId(s.posto), cd = calcularDia(data, ui.dia);
  const aj = cd.ajustesPosto.get(p.id) || {}, fa = cd.fa.find((o) => o.posto === p.id);
  const abas = `<div class="abas-pop" role="tablist"><button role="tab" aria-selected="${s.aba === "dia"}" data-act="pop-aba" data-aba="dia">Só em ${ddmm(ui.dia)}</button><button role="tab" aria-selected="${s.aba === "sempre"}" data-act="pop-aba" data-aba="sempre">Sempre (cadastro)</button></div>`;
  let corpo;
  if (s.aba === "dia") {
    corpo = `${fa ? `<p class="estado">${fa.tipo === "FA" ? "Viatura em manutenção (FA)" : "Posto fechado"} ${fa.ate && fa.ate !== fa.de ? `de ${ddmm(fa.de)} até ${ddmm(fa.ate)}` : "neste dia"}</p>
        <button class="btn pri grande" data-act="posto-reabrir" data-oc="${fa.id}">Voltar a funcionar a partir de ${ddmm(ui.dia)}</button>`
      : `<div class="bloco"><b>${ehViatura(p) ? "Viatura parada?" : "Posto não vai funcionar?"}</b>
        <div class="linha"><label>Até <input type="date" id="pp-ate" value="${ui.dia}" min="${ui.dia}"></label>
        <button class="btn grande perigo-leve" data-act="posto-fechar" data-tipo="${ehViatura(p) ? "FA" : "FECHADO"}">${ehViatura(p) ? "Pôr em manutenção (FA)" : "Fechar o posto"}</button></div>
        <p class="dica">Quem estiver escalado aqui vai para <b>À disposição</b>, para ser remanejado.</p></div>`}
      ${ehViatura(p) && !fa ? `<div class="bloco"><b>Usar outra viatura neste dia</b><div class="linha"><label>Número <input id="pp-prefixo" inputmode="numeric" placeholder="ex.: 1290" value="${esc(aj.prefixo ? aj.prefixo.nome.replace(/^\D+/, "") : "")}" size="8"></label>
        <button class="btn" data-act="posto-prefixo">Salvar</button>${aj.prefixo ? `<button class="link" data-act="posto-prefixo-reset" data-oc="${aj.prefixo.id}">Voltar à ${esc(p.nome)}</button>` : ""}</div></div>` : ""}
      ${!fa ? `<div class="bloco"><b>Quantos GMs neste dia</b>${stepper("pd", aj.vagas?.vagas || p.vagas)}
        <div class="linha"><button class="btn" data-act="posto-vagas-dia">Salvar só para ${ddmm(ui.dia)}</button>${aj.vagas ? `<button class="link" data-act="posto-vagas-reset" data-oc="${aj.vagas.id}">Voltar ao normal</button>` : ""}</div></div>` : ""}`;
  } else {
    const idxs = data.postos.map((x, i) => [x, i]).filter(([x]) => x.secao === p.secao);
    const pos = idxs.findIndex(([x]) => x === p);
    corpo = `<div class="form-pop"><label>Nome <input id="ps-nome" value="${esc(p.nome)}"></label>
      <label>${ehViatura(p) ? "Zona / área" : "Complemento"} <input id="ps-sub" value="${esc(p.sub || "")}" placeholder="opcional"></label>
      <div class="linha"><label>Tipo <select id="ps-tipo">${[["posto", "Posto fixo"], ["vtr", "Viatura"], ["moto", "Moto"], ["reserva", "Reserva técnica"]].map(([v, l]) => `<option value="${v}" ${(p.tipo || "posto") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Funciona <select id="ps-dias"><option value="">todos os dias</option><option value="util" ${p.dias ? "selected" : ""}>seg a sex</option></select></label></div>
      <label>Seção <select id="ps-secao">${data.secoes.map((x) => `<option value="${x.id}" ${x.id === p.secao ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></label>
      <b>Quantos GMs por turno</b>${stepper("ps-v", p.vagas)}
      <label class="toggle"><input type="checkbox" id="ps-rondas" ${p.rondas ? "checked" : ""}> Quando ninguém estiver aqui, mostrar "VTR/RONDAS FREQUENTES"</label>
      <div class="pop-acoes"><button class="btn pri grande" data-act="posto-salvar">Salvar</button>
        <button class="btn" data-act="posto-mover" data-d="-1" ${pos <= 0 ? "disabled" : ""}>↑ Subir</button><button class="btn" data-act="posto-mover" data-d="1" ${pos >= idxs.length - 1 ? "disabled" : ""}>↓ Descer</button></div>
      <p class="dica">Vale para todos os dias. Para mudar só um dia, use a aba "Só em ${ddmm(ui.dia)}".</p>
      ${s.confirmarDesativar ? `<button class="btn perigo" data-act="posto-desativar-ok">Confirmar: desativar ${esc(p.nome)}</button><p class="dica">Quem for lotado aqui aparece em À disposição até ser remanejado. Dá para reativar na seção.</p>`
        : `<button class="link perigo-txt" data-act="posto-desativar">Desativar este ${ehViatura(p) ? "viatura" : "posto"}</button>`}</div>`;
  }
  return `${cabPop(esc(nomeNoDia(p, cd)), esc(p.sub || ""))}<div class="pop-corpo">${abas}${corpo}</div>`;
}
function popSecao(s) {
  const sec = data.secoes.find((x) => x.id === s.secao);
  const i = data.secoes.indexOf(sec);
  const inativos = data.postos.filter((p) => p.secao === sec.id && p.ativo === false);
  return `${cabPop(esc(sec.nome), "Seção da escala")}<div class="pop-corpo">
    <div class="bloco"><div class="linha"><label>Nome <input id="sc-nome" value="${esc(sec.nome)}"></label><button class="btn" data-act="secao-salvar">Salvar</button></div>
      <div class="linha"><button class="btn" data-act="secao-mover" data-d="-1" ${i === 0 ? "disabled" : ""}>↑ Subir seção</button><button class="btn" data-act="secao-mover" data-d="1" ${i === data.secoes.length - 1 ? "disabled" : ""}>↓ Descer seção</button></div></div>
    <div class="bloco"><b>Novo posto ou viatura nesta seção</b>
      <label>Nome <input id="np-nome" placeholder="ex.: VTR 1330 ou PRAÇA NOVA"></label>
      <div class="linha"><label>Tipo <select id="np-tipo"><option value="posto">Posto fixo</option><option value="vtr">Viatura</option><option value="moto">Moto</option></select></label>
      <label>GMs de dia <input type="number" id="np-dia" min="0" max="9" value="1" size="3"></label><label>GMs de noite <input type="number" id="np-noite" min="0" max="9" value="0" size="3"></label></div>
      <button class="btn pri" data-act="posto-criar">Criar</button></div>
    <div class="bloco"><b>Nova seção logo abaixo</b><div class="linha"><label>Nome <input id="ns-nome" placeholder="ex.: OPERAÇÃO VERÃO"></label><button class="btn" data-act="secao-criar">Criar seção</button></div></div>
    ${inativos.length ? `<div class="bloco"><b>Desativados</b><ul class="lista-oc">${inativos.map((p) => `<li><span>${esc(p.nome)}</span><button class="link" data-act="posto-reativar" data-posto="${p.id}">Reativar</button></li>`).join("")}</ul></div>` : ""}</div>`;
}
function encerrarEm(oc, dia) {
  // termina um lançamento com período no dia anterior; se começava neste dia, apaga
  if (oc.de >= dia) data.ocorrencias = data.ocorrencias.filter((o) => o !== oc);
  else oc.ate = somaDias(dia, -1);
}

// ---------- CARTÃO DO GM (um clique no nome abre tudo) ----------
const REQ_DE_TIPO = { HE: "HE", BH_MAIS: "BH", BH_COMP: "BH", TROCA: "TROCA", FOLGA: "FOLGA", FALTA: "OUTRO", FERIAS: "FERIAS", LICENCA: "AFAST", ATESTADO: "AFAST", CURSO: "OUTRO" };
// O que um REQ significa: cadastro de requerimentos ou, na falta dele, o tipo do lançamento onde já foi usado.
function sentidoReq(req) {
  if (!req) return null;
  const cad = data.requerimentos?.[req];
  if (cad) return cad.tipo;
  const o = data.ocorrencias.find((x) => x.req === req && REQ_DE_TIPO[x.tipo]);
  return o ? REQ_DE_TIPO[o.tipo] : null;
}
const usosReq = (req) => data.ocorrencias.filter((o) => o.req === req).length;
function valoresCartao(d) {
  const ehHE = ehHeLancada(d);
  const oc = ehHE ? data.ocorrencias.find((x) => x.id === d.origem) : d.ajuste ? data.ocorrencias.find((x) => x.id === d.ajuste) : null;
  const troca = d.nat === "troca" ? data.ocorrencias.find((x) => x.id === d.origem) : null;
  return {
    ini: oc ? oc.ini : fmtHm(d.ini), fim: oc ? oc.fim : fmtHm(d.fim),
    req: oc?.req || (d.fixa ? "" : troca?.req || d.req || ""), obs: oc?.obs || "",
  };
}
function popCard(s) {
  const d = s.des, g = gmPorId(d.gm), v = valoresCartao(d), per = periodoDe(d.ini);
  const papel = d.fixa ? "HE fixa da escala semanal" : ehHeLancada(d) ? (d.nat === "bh" ? "Banco de horas (crédito)" : "Hora extra") : d.nat === "troca" ? `Troca: no lugar de ${nomeGm(d.titular)}` : d.remanejado ? "Remanejado" : d.posto === null ? "À disposição" : "";
  const sent = sentidoReq(v.req);
  return `${cabPop(esc(g.nome), `${esc(postoPorId(d.posto)?.nome || "À disposição")}${d.funcao ? " · " + esc(d.funcao) : ""}${papel ? " · " + esc(papel) : ""}`)}
  <div class="pop-corpo">
    <div class="campo"><span class="rot">Horário</span>
      <div class="linha grande"><label>Entra <input type="time" id="p-ini" value="${v.ini}"></label><label>Sai <input type="time" id="p-fim" value="${v.fim}"></label></div>
      <div class="presets">${PRESETS[per].slice(0, 3).map(([a, b]) => `<button class="opt" data-act="pop-preset" data-ini="${a}" data-fim="${b}">${a}–${b}</button>`).join("")}</div></div>
    <div class="campo"><label class="rot" for="c-req">REQ</label>
      <div class="linha"><input id="c-req" value="${esc(v.req)}" inputmode="numeric" placeholder="nº do requerimento" size="12">
      <span id="c-req-sent" class="sentido">${sent ? esc(TIPOS_REQ[sent]) : ""}</span></div>
      <label id="c-req-tipo-l" class="rot-sub" ${v.req && !sent ? "" : "hidden"}>Esse REQ é de quê? <select id="c-req-tipo"><option value="">escolha…</option>${Object.entries(TIPOS_REQ).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label></div>
    <div class="campo"><label class="rot" for="c-obs">Observação</label>
      <input id="c-obs" value="${esc(v.obs)}" placeholder="ex.: saiu às 17h para consulta"></div>
    <p id="p-prev" class="previa"></p>
    <div class="pop-acoes"><button class="btn pri grande" data-act="card-salvar">Salvar</button><button class="btn" data-act="pop-fechar">Cancelar</button></div>
    <p class="links-pop"><button class="link" data-act="card-trocar">Trocar o GM</button> · <button class="link" data-act="card-tirar">${ehHeLancada(d) ? "Remover esta hora extra" : "Tirar do dia"}</button> · <button class="link" data-act="card-mais">Mais…</button>${v.req && usosReq(v.req) ? ` · <button class="link" data-act="ver-req" data-req="${esc(v.req)}">Ver tudo do REQ ${esc(v.req)}</button>` : ""}</p>
  </div>`;
}
// Explica, antes de salvar, o que a mudança vai gerar
function previaHora() {
  const d = ui.pop?.des, el = $("#p-prev");
  if (!d || !el) return;
  const ini = $("#p-ini").value, fim = $("#p-fim").value;
  const req = $("#c-req")?.value.trim() || "";
  const tipoReq = sentidoReq(req) || $("#c-req-tipo")?.value || "";
  const sentEl = $("#c-req-sent"), tipoL = $("#c-req-tipo-l");
  if (sentEl) sentEl.textContent = sentidoReq(req) ? TIPOS_REQ[sentidoReq(req)] : "";
  if (tipoL) tipoL.hidden = !req || !!sentidoReq(req);
  if (!ini || !fim) { el.textContent = "Informe a entrada e a saída."; return; }
  const [a, b] = intervalo(ini, fim);
  if (ehHeLancada(d) || d.fixa) { el.innerHTML = `${d.nat === "bh" ? "Banco de horas" : "Hora extra"} de <b>${fmtHoras(b - a)}</b>.`; return; }
  const [a0, b0] = (d.alvo || `${d.ini}-${d.fim}`).split("-").map(Number);
  const normal = sobrepoe(a, b, a0, b0), extra = b - a - normal, falta = b0 - a0 - normal;
  if (!extra && !falta) { el.innerHTML = `Horário normal (${fmtHm(a0)}–${fmtHm(b0)}).`; return; }
  el.innerHTML = (extra > 0 ? `<span class="he-txt">+ ${fmtHoras(extra)} de hora extra (lançada sozinha)</span>` : "") +
    (falta > 0 ? `${extra > 0 ? "<br>" : ""}${tipoReq === "BH" ? `<span class="bh-txt">${fmtHoras(falta)} descontadas do banco de horas</span>` : `${fmtHoras(falta)} a menos que o normal. <span class="meta">Se for compensação, informe o REQ de banco de horas.</span>`}` : "");
}
function popTirar(s) {
  const d = s.des, T = esc(nomeGm(d.gm));
  const op = (m, t) => `<button class="pessoa motivo" data-act="tirar-motivo" data-m="${m}"><b>${t}</b></button>`;
  return `${cabPop(`Tirar ${T} deste dia`, "O que aconteceu?")}<div class="pop-corpo"><div class="motivos">
    ${op("FOLGA", "Folga")}${op("FALTA", "Faltou")}${op("ATESTADO", "Atestado")}${op("BH_COMP", "Compensação de banco de horas")}</div>
    <p class="dica">A vaga fica aberta como furo, para cobrir em seguida.</p><button class="link" data-act="card-voltar">← voltar</button></div>`;
}
function popInsp(s) {
  const eq = equipe(s.equipe), cd = calcularDia(data, ui.dia), atual = cd.inspetores.get(eq.id) || eq.inspetor || "";
  return `${cabPop(`Inspetor de serviço · ${esc(eq.nome)}`, `${SEMANA[diaSemana(ui.dia)].toLowerCase()} ${ddmm(ui.dia)}`)}<div class="pop-corpo">
    <label class="campo"><span class="rot">Nome</span><input id="in-nome" value="${esc(atual)}"></label>
    <div class="pop-acoes"><button class="btn pri" data-act="insp-salvar" data-escopo="dia">Só em ${ddmm(ui.dia)}</button><button class="btn" data-act="insp-salvar" data-escopo="sempre">Sempre para a ${esc(eq.id)}</button></div></div>`;
}

// ---------- eventos ----------
function abrirFuro(posto, turno) {
  const t = TURNOS.find((x) => x.id === turno);
  ui.drawer = { tipo: "furo", posto, turno, ini: fmtHm(t.ini), fim: fmtHm(t.fim), nat: "HE", req: "" };
  render();
}
document.addEventListener("click", (e) => {
  if (ui.pop && !e.target.closest("#pop")) fecharPop();
  const el = e.target.closest("[data-act],[data-nav]");
  if (!el) return;
  if (el.dataset.nav) { ui.view = el.dataset.nav; ui.drawer = null; ui.plano = null; location.hash = ui.view; render(); return; }
  const a = el.dataset.act;
  const d = ui.drawer;
  if (a !== "apagar" && a !== "pre-apagar") ui.confirmar = null;
  switch (a) {
    case "dia": ui.dia = somaDias(ui.dia, Number(el.dataset.n)); ui.mes = mesDe(ui.dia); ui.drawer = null; ui.plano = null; render(); break;
    case "mes": ui.mes = Number(el.dataset.n) > 0 ? mesSeguinte(ui.mes) : mesAnterior(ui.mes); render(); break;
    case "lmes": ui.filtroLanc.mes = Number(el.dataset.n) > 0 ? mesSeguinte(ui.filtroLanc.mes) : mesAnterior(ui.filtroLanc.mes); render(); break;
    case "furo": abrirFuro(el.dataset.posto, el.dataset.turno); break;
    case "pop-hora": abrirPop("hora", el, { des: ui.desMap.get(el.dataset.des) }); return;
    case "pop-gm": abrirPop("gm", el, { des: ui.desMap.get(el.dataset.des) }); return;
    case "pop-add": { const t = TURNOS.find((x) => x.id === el.dataset.turno); abrirPop("add", el, { posto: el.dataset.posto, turno: t.id, ini: fmtHm(t.ini), fim: fmtHm(t.fim) }); return; }
    case "pop-fechar": fecharPop(); return;
    case "card": { const d = ui.desMap.get(el.dataset.des); if (d) abrirPop("card", el, { des: d }); return; }
    case "card-trocar": ui.pop.modo = "gm"; desenharPop(); return;
    case "card-tirar": {
      const d = ui.pop.des;
      if (ehHeLancada(d)) { fecharPop(); mudar(`Hora extra de ${nomeGm(d.gm)} removida`, () => { data.ocorrencias = data.ocorrencias.filter((o) => o.id !== d.origem); }); return; }
      ui.pop.modo = "tirar"; desenharPop(); return;
    }
    case "card-voltar": ui.pop.modo = "card"; desenharPop(); return;
    case "card-mais": { const d = ui.pop.des; fecharPop(); ui.drawer = { tipo: "gm", gm: d.gm }; render(); return; }
    case "tirar-motivo": {
      const d = ui.pop.des, m = el.dataset.m, quem = d.nat === "troca" ? d.titular : d.gm;
      fecharPop();
      mudar(`${TIPOS[m]} para ${nomeGm(d.gm)}. A vaga ficou aberta: clique em "Cobrir".`, () => {
        if (d.nat === "troca") data.ocorrencias = data.ocorrencias.filter((o) => o.id !== d.origem);
        data.ocorrencias.push({ id: novoId(), tipo: m, gm: quem, de: ui.dia });
      });
      return;
    }
    case "card-salvar": {
      const d = ui.pop.des, ini = $("#p-ini").value, fim = $("#p-fim").value;
      const req = $("#c-req").value.trim().toUpperCase(), obs = $("#c-obs").value.trim(), tipoNovo = $("#c-req-tipo")?.value || "";
      if (!ini || !fim) { toast("Informe a entrada e a saída."); return; }
      if (req && !sentidoReq(req) && !tipoNovo) { toast(`Escolha de que é o REQ ${req}.`); $("#c-req-tipo")?.focus(); return; }
      const [a, b] = intervalo(ini, fim);
      const tipoReq = req ? sentidoReq(req) || tipoNovo : "";
      fecharPop();
      mudar(`${nomeGm(d.gm)}: alterações salvas`, () => {
        if (req) { data.requerimentos ||= {}; if (!data.requerimentos[req]) data.requerimentos[req] = { tipo: tipoReq }; }
        if (ehHeLancada(d)) { const o = data.ocorrencias.find((x) => x.id === d.origem); Object.assign(o, { ini, fim, req, obs }); return; }
        const alvo = d.alvo || `${d.ini}-${d.fim}`, [a0, b0] = alvo.split("-").map(Number), quem = d.titular || d.gm;
        const atual = data.ocorrencias.find((o) => o.tipo === "HORARIO" && o.gm === quem && o.de === ui.dia && o.alvo === alvo);
        const igual = a === a0 && b === b0 && !obs && (!req || req === (d.nat === "troca" ? data.ocorrencias.find((x) => x.id === d.origem)?.req : ""));
        if (igual) { if (atual) data.ocorrencias = data.ocorrencias.filter((o) => o !== atual); }
        else if (atual) Object.assign(atual, { ini, fim, req, obs });
        else data.ocorrencias.push({ id: novoId(), tipo: "HORARIO", gm: quem, de: ui.dia, alvo, ini, fim, req, obs });
      });
      return;
    }
    case "ver-req": { const r = el.dataset.req; fecharPop(); ui.drawer = null; ui.filtroLanc.req = r; ui.view = "lancamentos"; location.hash = "lancamentos"; render(); return; }
    case "limpar-req": ui.filtroLanc.req = ""; render(); return;
    case "pop-insp": abrirPop("insp", el, { equipe: el.dataset.equipe }); return;
    case "insp-salvar": {
      const eq = equipe(ui.pop.equipe), nome = $("#in-nome").value.trim().toUpperCase();
      if (!nome) { toast("Digite o nome do inspetor."); return; }
      const escopo = el.dataset.escopo;
      fecharPop();
      mudar(`Inspetor ${nome} ${escopo === "dia" ? `em ${ddmm(ui.dia)}` : `para a equipe ${eq.id}`}`, () => {
        const atual = data.ocorrencias.find((o) => o.tipo === "INSPETOR" && o.equipe === eq.id && o.de === ui.dia);
        if (escopo === "sempre") { eq.inspetor = nome; if (atual) data.ocorrencias = data.ocorrencias.filter((o) => o !== atual); }
        else if (atual) atual.nome = nome;
        else data.ocorrencias.push({ id: novoId(), tipo: "INSPETOR", equipe: eq.id, de: ui.dia, ate: ui.dia, nome });
      });
      return;
    }
    case "pop-posto": abrirPop("posto", el, { posto: el.dataset.posto, aba: "dia" }); return;
    case "pop-secao": abrirPop("secao", el, { secao: el.dataset.secao }); return;
    case "pop-aba": ui.pop.aba = el.dataset.aba; ui.pop.confirmarDesativar = false; desenharPop(); return;
    case "step": { const i = $("#" + el.dataset.alvo); i.value = Math.max(0, Math.min(9, (Number(i.value) || 0) + Number(el.dataset.d))); return; }
    case "posto-fechar": {
      const s = ui.pop, p = postoPorId(s.posto), ate = $("#pp-ate")?.value || ui.dia, tipo = el.dataset.tipo;
      if (ate < ui.dia) { toast("A data final é anterior ao dia aberto."); return; }
      fecharPop();
      mudar(`${p.nome} ${tipo === "FA" ? "em manutenção" : "fechado"} ${ate !== ui.dia ? `até ${ddmm(ate)}` : "neste dia"}. Quem estava lá foi para À disposição.`, () => data.ocorrencias.push({ id: novoId(), tipo, posto: p.id, de: ui.dia, ate }));
      return;
    }
    case "posto-reabrir": { const p = postoPorId(ui.pop.posto), oc = data.ocorrencias.find((o) => o.id === el.dataset.oc); fecharPop(); mudar(`${p.nome} volta a funcionar a partir de ${ddmm(ui.dia)}`, () => encerrarEm(oc, ui.dia)); return; }
    case "posto-prefixo": {
      const p = postoPorId(ui.pop.posto), v = $("#pp-prefixo").value.trim().toUpperCase();
      if (!v) { toast("Digite o número da viatura."); return; }
      const nome = /^\d+$/.test(v) ? `${p.tipo === "moto" ? "MT" : "VTR"} ${v}` : v;
      const atual = calcularDia(data, ui.dia).ajustesPosto.get(p.id)?.prefixo;
      fecharPop();
      mudar(`${nome} no lugar da ${p.nome} em ${ddmm(ui.dia)}`, () => { if (atual) atual.nome = nome; else data.ocorrencias.push({ id: novoId(), tipo: "PREFIXO", posto: p.id, de: ui.dia, ate: ui.dia, nome }); });
      return;
    }
    case "posto-prefixo-reset": case "posto-vagas-reset": { const oc = data.ocorrencias.find((o) => o.id === el.dataset.oc); fecharPop(); mudar("Voltou ao normal neste dia", () => encerrarEm(oc, ui.dia)); return; }
    case "posto-vagas-dia": {
      const p = postoPorId(ui.pop.posto), vagas = lerStepper("pd");
      const atual = calcularDia(data, ui.dia).ajustesPosto.get(p.id)?.vagas;
      fecharPop();
      mudar(`${p.nome}: vagas de ${ddmm(ui.dia)} ajustadas`, () => { if (atual && atual.de === ui.dia && (atual.ate || atual.de) === ui.dia) atual.vagas = vagas; else data.ocorrencias.push({ id: novoId(), tipo: "VAGAS", posto: p.id, de: ui.dia, ate: ui.dia, vagas }); });
      return;
    }
    case "posto-salvar": {
      const p = postoPorId(ui.pop.posto), nome = $("#ps-nome").value.trim().toUpperCase();
      if (!nome) { toast("O nome não pode ficar vazio."); return; }
      const novo = { nome, sub: $("#ps-sub").value.trim().toUpperCase(), tipo: $("#ps-tipo").value, secao: $("#ps-secao").value, vagas: lerStepper("ps-v"), rondas: $("#ps-rondas").checked, dias: $("#ps-dias").value ? [1, 2, 3, 4, 5] : undefined };
      fecharPop();
      mudar(`${nome} atualizado para todos os dias`, () => { Object.assign(p, novo); if (!novo.sub) delete p.sub; if (!novo.dias) delete p.dias; if (novo.tipo === "posto") delete p.tipo; });
      return;
    }
    case "posto-mover": {
      const p = postoPorId(ui.pop.posto), d = Number(el.dataset.d);
      const irmaos = data.postos.filter((x) => x.secao === p.secao);
      const viz = irmaos[irmaos.indexOf(p) + d];
      if (!viz) return;
      mudar(`${p.nome} ${d < 0 ? "subiu" : "desceu"} na escala`, () => { const a = data.postos.indexOf(p), b = data.postos.indexOf(viz); [data.postos[a], data.postos[b]] = [data.postos[b], data.postos[a]]; });
      return;
    }
    case "posto-desativar": ui.pop.confirmarDesativar = true; desenharPop(); return;
    case "posto-desativar-ok": { const p = postoPorId(ui.pop.posto); fecharPop(); mudar(`${p.nome} desativado`, () => { p.ativo = false; }); return; }
    case "posto-reativar": { const p = postoPorId(el.dataset.posto); fecharPop(); mudar(`${p.nome} reativado`, () => { delete p.ativo; }); return; }
    case "posto-criar": {
      const sec = ui.pop.secao, nome = $("#np-nome").value.trim().toUpperCase();
      if (!nome) { toast("Digite o nome do posto ou viatura."); return; }
      const tipo = $("#np-tipo").value, nd = Number($("#np-dia").value) || 0, nn = Number($("#np-noite").value) || 0;
      fecharPop();
      mudar(`${nome} criado. Clique em "+ pôr GM" para escalar alguém.`, () => {
        const p = { id: "p" + novoId(), secao: sec, nome, vagas: { t2: nd, t3: nd, t4: nn, t1: nn } };
        if (tipo !== "posto") p.tipo = tipo;
        const ult = data.postos.map((x, i) => [x, i]).filter(([x]) => x.secao === sec).pop();
        data.postos.splice(ult ? ult[1] + 1 : data.postos.length, 0, p);
      });
      return;
    }
    case "secao-salvar": { const sec = data.secoes.find((x) => x.id === ui.pop.secao), nome = $("#sc-nome").value.trim().toUpperCase(); if (!nome) { toast("O nome não pode ficar vazio."); return; } fecharPop(); mudar(`Seção renomeada para ${nome}`, () => { sec.nome = nome; }); return; }
    case "secao-mover": {
      const sec = data.secoes.find((x) => x.id === ui.pop.secao), i = data.secoes.indexOf(sec), j = i + Number(el.dataset.d);
      if (j < 0 || j >= data.secoes.length) return;
      fecharPop();
      mudar(`Seção ${sec.nome} movida`, () => { [data.secoes[i], data.secoes[j]] = [data.secoes[j], data.secoes[i]]; });
      return;
    }
    case "secao-criar": {
      const nome = $("#ns-nome").value.trim().toUpperCase(), i = data.secoes.findIndex((x) => x.id === ui.pop.secao);
      if (!nome) { toast("Digite o nome da seção."); return; }
      fecharPop();
      mudar(`Seção ${nome} criada. Clique no nome dela para pôr postos.`, () => data.secoes.splice(i + 1, 0, { id: "s" + novoId(), nome }));
      return;
    }
    case "salvar-lotacao": {
      const g = gmPorId(ui.drawer.gm), desde = $("#lo-desde").value, posto = $("#lo-posto").value, hor = $("#lo-hor").value;
      if (!desde) { toast("Informe a data."); return; }
      const antes = vigente(g, somaDias(desde, -1));
      const lot = { posto, funcao: $("#lo-fn").value.trim(), segmentos: hor ? [{ ini: hor.slice(0, 5), fim: hor.slice(6), tipo: "normal" }] : g.lotacao.segmentos };
      mudar(`${g.nome}: nova lotação a partir de ${ddmm(desde)} (${postoPorId(posto).nome})`, () => {
        g.historico = [...(g.historico || []).filter((h) => h.ate < somaDias(desde, -1)), { ate: somaDias(desde, -1), equipe: antes.equipe, lotacao: antes.lotacao, dias: antes.dias }];
        g.equipe = $("#lo-eq").value; g.lotacao = lot;
        ui.drawer = null;
      });
      return;
    }
    case "pop-preset": $("#p-ini").value = el.dataset.ini; $("#p-fim").value = el.dataset.fim; previaHora(); return;
    case "pop-add-hora": ui.pop.ini = el.dataset.ini; ui.pop.fim = el.dataset.fim; desenharPop(); return;
    case "pop-voltar": ui.pop.modo = "gm"; desenharPop(); return;
    case "pop-drawer": { const s = ui.pop; fecharPop(); ui.drawer = { tipo: "furo", posto: s.posto, turno: s.turno, ini: s.ini, fim: s.fim, nat: "HE", req: "" }; render(); return; }
    case "pop-salvar-hora": {
      const d = ui.pop.des, ini = $("#p-ini").value, fim = $("#p-fim").value;
      if (!ini || !fim) { toast("Informe a entrada e a saída."); return; }
      const [a, b] = intervalo(ini, fim);
      fecharPop();
      if (ehHeLancada(d)) { mudar(`Horário da hora extra de ${nomeGm(d.gm)}: ${ini}–${fim}`, () => { const o = data.ocorrencias.find((x) => x.id === d.origem); o.ini = ini; o.fim = fim; }); return; }
      const alvo = d.alvo || `${d.ini}-${d.fim}`, [a0, b0] = alvo.split("-").map(Number), quem = d.titular || d.gm;
      const atual = data.ocorrencias.find((o) => o.tipo === "HORARIO" && o.gm === quem && o.de === ui.dia && o.alvo === alvo);
      const extra = b - a - sobrepoe(a, b, a0, b0);
      mudar(`${nomeGm(d.gm)}: ${ini}–${fim}${extra > 0 ? ` (${fmtHoras(extra)} de hora extra)` : ""}`, () => {
        if (a === a0 && b === b0) { if (atual) data.ocorrencias = data.ocorrencias.filter((o) => o !== atual); }
        else if (atual) { atual.ini = ini; atual.fim = fim; }
        else data.ocorrencias.push({ id: novoId(), tipo: "HORARIO", gm: quem, de: ui.dia, alvo, ini, fim });
      });
      return;
    }
    case "pop-hora-reset": { const d = ui.pop.des; fecharPop(); mudar(`${nomeGm(d.gm)} voltou ao horário normal`, () => { data.ocorrencias = data.ocorrencias.filter((o) => o.id !== d.ajuste); }); return; }
    case "pop-escolher": {
      const s = ui.pop, X = el.dataset.gm, via = el.dataset.via;
      if (s.modo === "add") {
        fecharPop();
        const pn = postoPorId(s.posto).nome;
        if (via === "rem") mudar(`${nomeGm(X)} remanejado para ${pn}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: X, de: ui.dia, ate: ui.dia, posto: s.posto, obs: "Da reserva técnica" }));
        else mudar(`${nomeGm(X)} entra com hora extra ${s.ini}–${s.fim} em ${pn}`, () => data.ocorrencias.push({ id: novoId(), tipo: "HE", gm: X, de: ui.dia, ini: s.ini, fim: s.fim, posto: s.posto, req: "" }));
        return;
      }
      const d = s.des;
      if (ehHeLancada(d)) { fecharPop(); mudar(`Hora extra passou para ${nomeGm(X)}`, () => { data.ocorrencias.find((o) => o.id === d.origem).gm = X; }); return; }
      if (d.nat === "troca") { fecharPop(); mudar(`Troca: agora ${nomeGm(X)} cobre ${nomeGm(d.titular)}`, () => { data.ocorrencias.find((o) => o.id === d.origem).substituto = X; }); return; }
      s.modo = "motivo"; s.escolhido = X; s.via = via; s.origem = el.dataset.origem || ""; desenharPop(); return;
    }
    case "pop-motivo": {
      const s = ui.pop, d = s.des, m = el.dataset.m, X = s.escolhido, T = d.gm;
      fecharPop();
      if (m === "TROCA") { mudar(`${nomeGm(X)} assume o serviço de ${nomeGm(T)} (troca)`, () => data.ocorrencias.push({ id: novoId(), tipo: "TROCA", gm: T, substituto: X, de: ui.dia })); return; }
      mudar(`${TIPOS[m]} para ${nomeGm(T)}; ${nomeGm(X)} ${s.via === "rem" ? "remanejado" : "com hora extra"}`, () => {
        data.ocorrencias.push({ id: novoId(), tipo: m, gm: T, de: ui.dia });
        if (s.via === "rem") data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: X, de: ui.dia, ate: ui.dia, posto: d.posto, obs: `Remanejado (${s.origem})` });
        else data.ocorrencias.push({ id: novoId(), tipo: "HE", gm: X, de: ui.dia, ini: fmtHm(d.ini), fim: fmtHm(d.fim), posto: d.posto, req: "" });
      });
      return;
    }
    case "auto": { const n = Number(el.dataset.dias); ui.plano = planejarCobertura(data, Array.from({ length: n }, (_, i) => somaDias(ui.dia, i))).map((x) => ({ ...x, ok: !!x.tipo })); render(); break; }
    case "plano-cancelar": ui.plano = null; render(); break;
    case "plano-aplicar": {
      const itens = ui.plano.filter((x) => x.ok && x.tipo);
      ui.plano = null;
      if (!itens.length) { render(); break; }
      mudar(`${itens.length} lançamentos feitos de uma vez`, () => { for (const x of itens) data.ocorrencias.push(x.tipo === "REMANEJ"
        ? { id: novoId(), tipo: "REMANEJ", gm: x.gm, de: x.dia, ate: x.dia, posto: x.posto, obs: "Preenchido automaticamente" }
        : { id: novoId(), tipo: "HE", gm: x.gm, de: x.dia, ini: fmtHm(x.ini), fim: fmtHm(x.fim), posto: x.posto, req: "" }); });
      break;
    }
    case "letra": { const on = document.documentElement.classList.toggle("letra-grande"); try { localStorage.setItem("escala-letra", on ? "1" : ""); } catch { /* ignora */ } el.setAttribute("aria-pressed", String(on)); if (ui.pop) desenharPop(); return; }
    case "remanejar": mudar(`${nomeGm(el.dataset.gm)} remanejado para ${postoPorId(d.posto).nome}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: el.dataset.gm, de: ui.dia, ate: ui.dia, posto: d.posto, obs: "Da reserva técnica" }); ui.drawer = null; }); break;
    case "pend-rem": mudar(`${nomeGm(el.dataset.gm)} remanejado para ${postoPorId(el.dataset.posto).nome} em ${ddmm(el.dataset.dia)}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: el.dataset.gm, de: el.dataset.dia, ate: el.dataset.dia, posto: el.dataset.posto, obs: "Da reserva técnica" })); break;
    case "pend-he": mudar(`HE: ${nomeGm(el.dataset.gm)} ${el.dataset.ini}–${el.dataset.fim} em ${postoPorId(el.dataset.posto).nome} (${ddmm(el.dataset.dia)})`, () => data.ocorrencias.push({ id: novoId(), tipo: "HE", gm: el.dataset.gm, de: el.dataset.dia, ini: el.dataset.ini, fim: el.dataset.fim, posto: el.dataset.posto, req: "" })); break;
    case "pend-abrir": ui.dia = el.dataset.dia; ui.mes = mesDe(ui.dia); ui.view = "quadro"; location.hash = "quadro"; abrirFuro(el.dataset.posto, el.dataset.turno); break;
    case "ir-hoje": ui.dia = hojeBase(); ui.mes = mesDe(ui.dia); render(); break;
    case "cmd-ex": $("#cmd").value = el.dataset.txt; $("#cmd").focus(); previaComando(el.dataset.txt); return;
    case "cmd-lancar": lancarComando(); return;
    case "salvar-ajustes": {
      const teto = Number($("#aj-teto").value);
      if (!(teto > 0)) { toast("Informe um teto de HE válido."); break; }
      data.config.ancora = { data: $("#aj-data").value, equipes: [$("#aj-dia").value, $("#aj-noite").value] };
      data.config.tetoHE = teto; data.config.cabecalho = $("#aj-cab").value;
      data._versao++; salvar(); render(); toast("Ajustes salvos. A escala foi recalculada.");
      break;
    }
    case "furo-hora": d.ini = el.dataset.ini; d.fim = el.dataset.fim; render(); break;
    case "ver-todos": document.querySelectorAll(".sug li.mais").forEach((li) => (li.hidden = false)); el.hidden = true; break;
    case "escalar": {
      const g = gmPorId(el.dataset.gm);
      const req = $("#f-req")?.value.trim() || "";
      mudar(`${g.nome} escalado ${d.ini}–${d.fim} em ${postoPorId(d.posto).nome} (${d.nat === "HE" ? "HE" : "BH+"})`, () => {
        data.ocorrencias.push({ id: novoId(), tipo: d.nat, gm: g.id, de: ui.dia, ini: d.ini, fim: d.fim, posto: d.posto, req });
        ui.drawer = null;
      });
      break;
    }
    case "gm": ui.drawer = { tipo: "gm", gm: el.dataset.gm }; render(); break;
    case "gm-acao": d.acao = d.acao === el.dataset.acao ? "" : el.dataset.acao; render(); break;
    case "folga": mudar(`Folga lançada para ${nomeGm(d.gm)}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "FOLGA", gm: d.gm, de: ui.dia }); ui.drawer = null; }); break;
    case "bhcomp": mudar(`Compensação lançada para ${nomeGm(d.gm)}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "BH_COMP", gm: d.gm, de: ui.dia }); ui.drawer = null; }); break;
    case "salvar-afast": {
      const tipo = $("#a-tipo").value, de = $("#a-de").value, ate = $("#a-ate").value || de, req = $("#a-req").value.trim();
      if (ate < de) { toast("A data final é anterior à inicial."); break; }
      mudar(`${TIPOS[tipo]} lançada para ${nomeGm(d.gm)}`, () => { data.ocorrencias.push({ id: novoId(), tipo, gm: d.gm, de, ate, req }); ui.drawer = null; });
      break;
    }
    case "salvar-troca": {
      const sub = $("#t-sub").value;
      mudar(`${nomeGm(sub)} assume o serviço de ${nomeGm(d.gm)}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "TROCA", gm: d.gm, substituto: sub, de: ui.dia, req: $("#t-req").value.trim() }); ui.drawer = null; });
      break;
    }
    case "salvar-remanej": {
      const posto = $("#r-posto").value;
      mudar(`${nomeGm(d.gm)} remanejado para ${postoPorId(posto).nome}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: d.gm, posto, funcao: $("#r-fn").value.trim(), de: $("#r-de").value, ate: $("#r-ate").value || $("#r-de").value }); ui.drawer = null; });
      break;
    }
    case "pre-apagar": ui.confirmar = el.dataset.id; render(); break;
    case "apagar": mudar("Lançamento excluído", () => { data.ocorrencias = data.ocorrencias.filter((o) => o.id !== el.dataset.id); ui.confirmar = null; }); break;
    case "abrir-ficha": ui.gm = el.dataset.gm; ui.mes = mesDe(ui.dia); ui.view = "ficha"; ui.drawer = null; location.hash = "ficha"; render(); window.scrollTo(0, 0); break;
    case "ir-dia": ui.dia = el.dataset.dia; ui.view = "quadro"; location.hash = "quadro"; render(); break;
    case "fechar": ui.drawer = null; render(); break;
    case "desfazer": if (desfazer.length) { const u = JSON.parse(desfazer.pop()); data.ocorrencias = u.o; data.postos = u.p; data.secoes = u.s; data.gms = u.g; data.requerimentos = u.r; data.equipes = u.e; data._versao++; ui.plano = null; salvar(); render(); toast("Última alteração desfeita"); } break;
    case "imprimir": window.print(); break;
    case "restaurar": ui.confirmar = "restaurar"; $("#restaurar").outerHTML = `<button id="restaurar" class="btn perigo" data-act="restaurar-ok">Apagar meus lançamentos e restaurar</button>`; return;
    case "restaurar-ok": try { localStorage.removeItem(CHAVE); } catch { /* ignora */ } data = criarExemplo(); desfazer.length = 0; $("#restaurar").outerHTML = `<button id="restaurar" class="link" data-act="restaurar">Restaurar exemplo</button>`; render(); toast("Dados de exemplo restaurados"); break;
    case "lancar": {
      const t = ui.form.tipo, v = (id) => $(id)?.value?.trim() || "";
      const o = { id: novoId(), tipo: t, de: v("#l-de"), req: v("#l-req"), obs: v("#l-obs") };
      if (t !== "FA") o.gm = v("#l-gm");
      if (["FERIAS", "LICENCA", "ATESTADO", "CURSO", "REMANEJ", "FA"].includes(t)) o.ate = v("#l-ate") || o.de;
      if (["HE", "BH_MAIS", "REMANEJ", "FA"].includes(t)) o.posto = v("#l-posto");
      if (t === "HE" || t === "BH_MAIS") { o.ini = v("#l-ini"); o.fim = v("#l-fim"); if (!o.ini || !o.fim) { toast("Informe início e fim."); break; } }
      if (t === "TROCA") { o.substituto = v("#l-sub"); if (o.substituto === o.gm) { toast("O substituto precisa ser outro GM."); break; } }
      if (!o.de) { toast("Informe a data."); break; }
      if (o.ate && o.ate < o.de) { toast("A data final é anterior à inicial."); break; }
      mudar(`${TIPOS[t]} lançado${o.gm ? " para " + nomeGm(o.gm) : ""}`, () => { data.ocorrencias.push(o); ui.form = { tipo: t }; ui.filtroLanc.mes = mesDe(o.de); });
      break;
    }
  }
});
document.addEventListener("change", (e) => {
  const id = e.target.id, v = e.target.value;
  if (e.target.classList.contains("plano-ck")) { ui.plano[Number(e.target.dataset.i)].ok = e.target.checked; const n = ui.plano.filter((x) => x.ok && x.tipo).length; const b = $("[data-act=plano-aplicar]"); if (b) b.textContent = `Confirmar ${n} ${n === 1 ? "lançamento" : "lançamentos"}`; return; }
  if (["p-ini", "p-fim", "c-req", "c-req-tipo"].includes(id)) { previaHora(); return; }
  if (id === "q-dia" && v) { ui.dia = v; ui.mes = mesDe(v); ui.drawer = null; render(); }
  else if (id === "q-sofuros") { ui.soFuros = e.target.checked; render(); }
  else if (id === "f-ini" || id === "f-fim") { ui.drawer[id === "f-ini" ? "ini" : "fim"] = v; ui.drawer.req = $("#f-req").value; render(); }
  else if (id === "f-nat") { ui.drawer.nat = v; ui.drawer.req = $("#f-req").value; render(); }
  else if (id === "f-req") ui.drawer.req = v;
  else if (id === "l-tipo") { ui.form = { tipo: v }; render(); }
  else if (id === "lf-tipo") { ui.filtroLanc.tipo = v; render(); }
  else if (id === "m-eq") { ui.filtroMes.equipe = v; render(); }
  else if (id === "m-ord") { ui.filtroMes.ordem = v; render(); }
  else if (id === "fi-gm") { ui.gm = v; render(); }
  else if (id === "fi-semhe") { const g = gmPorId(ui.gm); g.naoFazHE = e.target.checked; data._versao++; salvar(); render(); toast(g.naoFazHE ? `${g.nome} não aparece mais nas sugestões de HE` : `${g.nome} volta às sugestões de HE`); }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "cmd") { previaComando(e.target.value); return; }
  if (["p-ini", "p-fim", "c-req"].includes(e.target.id)) { previaHora(); return; }
  if (e.target.id === "p-busca") { const q = norm(e.target.value.trim()); document.querySelectorAll("#p-lista li").forEach((li, i) => { li.hidden = q ? !li.dataset.nome.includes(q) : i >= 6; }); return; }
  const map = { "f-busca": ".sug li", "m-busca": "table.mes tbody tr", "lf-busca": "table.lanc tbody tr" };
  const sel = map[e.target.id];
  if (!sel) return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll(sel).forEach((el) => { el.hidden = q ? !el.dataset.nome.includes(q) : el.classList.contains("mais"); });
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "cmd" && e.key === "Enter") { e.preventDefault(); lancarComando(); return; }
  if (e.target.id === "cmd" && e.key === "Escape") { e.target.blur(); return; }
  if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("#cmd").focus(); return; }
  if (e.key === "Escape" && ui.pop) { fecharPop(); return; }
  if (e.key === "Enter" && ui.pop?.modo === "card" && /p-ini|p-fim|c-req|c-obs/.test(e.target.id)) { $("[data-act=card-salvar]").click(); return; }
  if (e.key === "Enter" && ui.pop?.modo === "insp" && e.target.id === "in-nome") { $("[data-act=insp-salvar]").click(); return; }
  if (e.key === "Escape" && ui.drawer) { ui.drawer = null; render(); }
});
document.addEventListener("focusin", (e) => { if (e.target.id === "cmd") { $("#cmd-prev").hidden = false; previaComando(e.target.value); } });
document.addEventListener("focusout", (e) => { if (e.target.id === "cmd") setTimeout(() => { if (!document.querySelector(".cmd")?.contains(document.activeElement)) $("#cmd-prev").hidden = true; }, 150); });
$("#veu").addEventListener("click", () => { ui.drawer = null; render(); });
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (VIEWS.includes(h) && h !== ui.view) { ui.view = h; ui.drawer = null; render(); } });

window.addEventListener("scroll", posicionarPop, { passive: true });
document.addEventListener("scroll", (e) => { if (ui.pop && e.target !== document && !e.target.closest?.("#pop")) fecharPop(); }, { passive: true, capture: true });
window.addEventListener("resize", () => { if (ui.pop) desenharPop(); });
try { if (localStorage.getItem("escala-letra")) { document.documentElement.classList.add("letra-grande"); $("#btn-letra")?.setAttribute("aria-pressed", "true"); } } catch { /* ignora */ }
void hm; void trabalhaNoDia; void resumoMes; void norm;
render();
