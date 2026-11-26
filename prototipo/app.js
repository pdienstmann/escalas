import {
  TURNOS, TIPOS, AFASTAMENTOS, calcularDia, sugerir, livroMes, resumoMes, saldoBH, somaDias, diaSemana, diasDoMes,
  mesDe, mesSeguinte, fmtHm, fmtHoras, intervalo, sobrepoe, trabalhaNoDia, hm,
} from "./engine.js";
import { criarExemplo } from "./seed.js";

const CHAVE = "escala-gm-prototipo-v1";
const SEMANA = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const VIEWS = ["quadro", "lancamentos", "mes", "ficha", "folha"];

// ---------- estado ----------
let data = carregar();
const hojeReal = new Date().toISOString().slice(0, 10);
const ui = {
  view: VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "quadro",
  dia: hojeReal >= "2026-10-01" && hojeReal <= "2026-12-31" ? hojeReal : "2026-11-26",
  mes: null, gm: null, drawer: null, soFuros: false,
  filtroMes: { equipe: "", ordem: "he" }, filtroLanc: { tipo: "", mes: null },
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
  desfazer.push(JSON.stringify(data.ocorrencias));
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
  const html = { quadro: vQuadro, lancamentos: vLancamentos, mes: vMes, ficha: vFicha, folha: vFolha }[ui.view]();
  main.innerHTML = html;
  $("#drawer").innerHTML = ui.drawer ? vDrawer() : "";
  $("#drawer").hidden = !ui.drawer;
  $("#veu").hidden = !ui.drawer;
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
  else if (txt) extras.push(`<span class="tag ${cls}">${txt}</span>`);
  if (d.remanejado) extras.push(`<span class="tag rem">REMANEJ.</span>`);
  if (d.req && !d.fixa) extras.push(`<span class="req">REQ ${esc(d.req)}</span>`);
  return `<button class="chip ${cls || ""} ${d.conflito ? "conflito" : ""}" data-act="gm" data-gm="${d.gm}" data-des="${d.id}" title="${esc(rotuloLotacao(g))}">
    <span class="nm">${esc(g?.nome)}</span>${d.funcao ? `<span class="fn">${esc(d.funcao[0])}</span>` : ""}
    <span class="hr">${textoCelula(d, t)}</span>${extras.join("")}</button>`;
}
function vQuadro() {
  const cd = calcularDia(data, ui.dia);
  const amanha = somaDias(ui.dia, 1);
  const eqDia = cd.equipes.filter((e) => equipe(e).periodo === "dia"), eqNoite = cd.equipes.filter((e) => equipe(e).periodo === "noite");
  const heHoje = cd.designacoes.filter((d) => d.nat === "he").reduce((t, d) => t + d.fim - d.ini, 0);
  const furosTotal = cd.furos.reduce((t, f) => t + f.faltam, 0);
  const faPostos = new Map(cd.fa.map((o) => [o.posto, o]));
  let linhas = "";
  for (const s of data.secoes) {
    const postos = data.postos.filter((p) => p.secao === s.id);
    let corpo = "";
    for (const p of postos) {
      const furosP = cd.furos.filter((f) => f.posto === p.id);
      if (ui.soFuros && !furosP.length) continue;
      const desP = cd.designacoes.filter((d) => d.posto === p.id);
      const naoHoje = p.dias && !p.dias.includes(diaSemana(ui.dia));
      let cels;
      if (faPostos.has(p.id)) {
        const o = faPostos.get(p.id);
        cels = `<td colspan="4" class="fa-cel">Fora de atividade até ${ddmm(o.ate || o.de)}${o.obs ? " · " + esc(o.obs) : ""} — guarnição em <b>à disposição</b></td>`;
      } else {
        cels = TURNOS.map((t) => {
          const aqui = desP.filter((d) => sobrepoe(d.ini, d.fim, t.ini, t.fim) > 0).sort((a, b) => a.ini - b.ini);
          const furo = furosP.find((f) => f.turno === t.id);
          let h = aqui.map((d) => chip(d, t)).join("");
          if (furo) h += `<button class="furo" data-act="furo" data-posto="${p.id}" data-turno="${t.id}">Cobrir · falta ${furo.faltam}</button>`;
          if (!aqui.length && !furo) h = p.rondas ? `<span class="rondas">VTR/RONDAS FREQUENTES</span>` : naoHoje && p.vagas ? `<span class="vazio">não funciona hoje</span>` : `<span class="vazio">—</span>`;
          return `<td class="${t.id === "t2" || t.id === "t3" ? "dia" : "noite"}">${h}</td>`;
        }).join("");
      }
      corpo += `<tr><th scope="row" class="posto"><span class="pn">${esc(p.nome)}</span>${p.sub ? `<span class="ps">${esc(p.sub)}</span>` : ""}${p.obs ? `<span class="po">(${esc(p.obs)})</span>` : ""}</th>${cels}</tr>`;
    }
    if (corpo) linhas += `<tr class="secao"><th colspan="5" scope="rowgroup">${esc(s.nome)}</th></tr>${corpo}`;
  }

  // efetivo fora da escala
  const grupos = {};
  for (const a of cd.afastados) (grupos[a.tipo] ||= []).push(a);
  const blocosFora = ["FOLGA", "FERIAS", "LICENCA", "ATESTADO", "CURSO", "BH_COMP", "TROCA"].filter((k) => grupos[k]).map((k) => `
    <section class="fora-g"><h4>${k === "TROCA" ? "Trocas (titular fora)" : TIPOS[k]} <span class="n">${grupos[k].length}</span></h4><ul>
    ${grupos[k].map((a) => `<li><button class="link" data-act="gm" data-gm="${a.gm}">${esc(nomeGm(a.gm))}</button>
      <span class="meta">${equipe(gmPorId(a.gm)?.equipe)?.id || ""}${a.oc.ate && a.oc.ate !== a.oc.de ? ` · volta ${ddmm(somaDias(a.oc.ate, 1))}` : ""}${a.tipo === "TROCA" ? ` · coberto por ${esc(nomeGm(a.oc.substituto))}` : ""}${a.oc.req ? ` · REQ ${esc(a.oc.req)}` : ""}</span></li>`).join("")}</ul></section>`).join("");
  const disp = cd.disposicao.length ? `<section class="disposicao"><h3>À disposição <span class="n">${new Set(cd.disposicao.map((d) => d.gm)).size}</span></h3>
    <p class="dica">Guarnição de viatura fora de atividade. Remaneje para um posto com furo.</p><div class="chips">
    ${[...new Set(cd.disposicao.map((d) => d.gm))].map((id) => { const d = cd.disposicao.find((x) => x.gm === id); return `<button class="chip" data-act="gm" data-gm="${id}" data-des="${d.id}"><span class="nm">${esc(nomeGm(id))}</span><span class="hr">${fmtHm(d.ini)}/${fmtHm(d.fim)}</span><span class="req">de ${esc(postoPorId(d.postoOriginal)?.nome)}</span></button>`; }).join("")}
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
      <span class="eq dia">Dia <b>${eqDia.join(" ")}</b> ${eqDia.map((e) => esc(equipe(e).inspetor)).join("")}</span>
      <span class="eq noite">Noite <b>${eqNoite.join(" ")}</b> ${eqNoite.map((e) => esc(equipe(e).inspetor)).join("")}</span>
    </div>
  </div>
  <div class="resumo">
    <div class="kpi ${furosTotal ? "ruim" : "bom"}"><span class="v">${furosTotal}</span><span class="l">${furosTotal === 1 ? "vaga descoberta" : "vagas descobertas"}</span></div>
    <div class="kpi"><span class="v">${fmtHoras(heHoje)}</span><span class="l">de HE neste serviço</span></div>
    <div class="kpi"><span class="v">${new Set(cd.designacoes.filter((d) => d.posto).map((d) => d.gm)).size}</span><span class="l">GMs escalados</span></div>
    <div class="kpi"><span class="v">${cd.afastados.length}</span><span class="l">fora da escala hoje</span></div>
    <label class="toggle"><input type="checkbox" id="q-sofuros" ${ui.soFuros ? "checked" : ""}> Só postos com furo</label>
  </div>
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
  const lista = sugerir(data, ui.dia, d.posto, ini, fim);
  const opcoes = [[fmtHm(t.ini), fmtHm(t.fim), `Só o ${t.nome.toLowerCase()}`]];
  const par = { t2: "t3", t4: "t1" }[t.id];
  if (par) opcoes.push([fmtHm(t.ini), fmtHm(TURNOS.find((x) => x.id === par).fim), "12 horas"]);
  if (t.id === "t3") opcoes.push(["13:00", "01:00", "Emendar até 01:00"]);
  return `<div class="dw-head"><div><p class="eyebrow">Cobrir vaga · ${SEMANA[diaSemana(ui.dia)].toLowerCase()} ${ddmm(ui.dia)}</p>
    <h2>${esc(p.nome)}</h2><p class="meta">${esc(p.sub || "")} ${t.nome}</p></div><button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    <fieldset class="horario"><legend>Horário</legend>
      <div class="opts">${opcoes.map(([a, b, l]) => `<button class="opt ${a === d.ini && b === d.fim ? "on" : ""}" data-act="furo-hora" data-ini="${a}" data-fim="${b}">${l}<small>${a}–${b}</small></button>`).join("")}</div>
      <div class="linha"><label>Início <input type="time" id="f-ini" value="${d.ini}"></label><label>Fim <input type="time" id="f-fim" value="${d.fim}"></label>
      <label>Tipo <select id="f-nat"><option value="HE" ${d.nat === "HE" ? "selected" : ""}>Hora extra</option><option value="BH_MAIS" ${d.nat === "BH_MAIS" ? "selected" : ""}>Banco de horas</option></select></label>
      <label>REQ <input id="f-req" value="${esc(d.req || "")}" placeholder="nº" size="6"></label></div>
      <p class="dica">${fmtHoras(fim - ini)} · ${d.nat === "HE" ? "conta no livro de HE do mês" : "crédito no banco de horas"}</p>
    </fieldset>
    <div class="busca"><input type="search" id="f-busca" placeholder="Buscar GM" aria-label="Buscar GM"></div>
    <p class="dica">Ordem: quem já trabalha neste posto, depois descanso adequado, depois menos HE no mês (somando o que veio do mês anterior).</p>
    <ul class="sug">${lista.map((s, i) => `<li data-nome="${esc(s.gm.nome.toLowerCase())}" ${i >= 15 ? 'class="mais" hidden' : ""}>
      <div class="sg"><b>${esc(s.gm.nome)}</b> <span class="meta">${s.gm.equipe} · ${esc(postoPorId(s.gm.lotacao?.posto)?.nome || "")}</span>
      <div class="notas">${s.notas.map((n) => `<span class="nota ${/emenda|não realiza|saiu|entra/.test(n) ? "atencao" : ""}">${esc(n)}</span>`).join("")}</div></div>
      <div class="sh"><span class="num">${fmtHoras(s.heMes)}</span><span class="meta">HE no mês${s.transporte ? ` +${fmtHoras(s.transporte)} transp.` : ""}</span></div>
      <button class="btn ${s.bloqueado ? "" : "pri"}" data-act="escalar" data-gm="${s.gm.id}" ${s.bloqueado ? "disabled" : ""}>Escalar</button></li>`).join("")}</ul>
    ${lista.length > 15 ? `<button class="link" data-act="ver-todos">Ver todos os ${lista.length} disponíveis</button>` : ""}
    ${!lista.length ? `<p class="dica">Ninguém disponível nesse horário.</p>` : ""}
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
  const umDia = tipo === "FOLGA" || tipo === "BH_COMP";
  return `${gmSel}<div class="linha"><label>${umDia ? "Data" : "De"} <input type="date" id="l-de" value="${f.de || ui.dia}"></label>${umDia ? "" : `<label>Até <input type="date" id="l-ate" value="${f.ate || ui.dia}"></label>`}</div>`;
}
function descreveOc(o) {
  const p = o.posto ? postoPorId(o.posto)?.nome : "";
  if (o.tipo === "HE" || o.tipo === "BH_MAIS") return `${o.ini}–${o.fim} · ${esc(p)}`;
  if (o.tipo === "TROCA") return `assumido por ${esc(nomeGm(o.substituto))}`;
  if (o.tipo === "REMANEJ") return `para ${esc(p)}`;
  if (o.tipo === "FA") return esc(o.obs || "");
  return o.obs ? esc(o.obs) : "";
}
function vLancamentos() {
  const fl = ui.filtroLanc;
  const lista = data.ocorrencias.filter((o) => (!fl.tipo || o.tipo === fl.tipo) && (o.de.startsWith(fl.mes) || (o.ate || o.de).startsWith(fl.mes) || (o.de < fl.mes && (o.ate || o.de) > fl.mes)))
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
  <section class="painel"><div class="cab-lista"><h2>Lançamentos · ${nomeMes(fl.mes)}</h2>
    <div class="filtros"><button class="ic" data-act="lmes" data-n="-1" aria-label="Mês anterior">‹</button><button class="ic" data-act="lmes" data-n="1" aria-label="Próximo mês">›</button>
    <select id="lf-tipo" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === fl.tipo ? "selected" : ""}>${v}${contagem[k] ? ` (${contagem[k]})` : ""}</option>`).join("")}</select>
    <input type="search" id="lf-busca" placeholder="Buscar GM" aria-label="Buscar GM"></div></div>
    <div class="tabela-wrap"><table class="lanc"><thead><tr><th>Data</th><th>Tipo</th><th>GM</th><th>Detalhe</th><th>REQ</th><th></th></tr></thead><tbody>
    ${lista.slice(0, 400).map((o) => `<tr data-nome="${esc((nomeGm(o.gm) + " " + (o.substituto ? nomeGm(o.substituto) : "")).toLowerCase())}">
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
  const insp = (per) => eqs.filter((e) => e.periodo === per).map((e) => e.inspetor).join(", ");
  const faPostos = new Map(cd.fa.map((o) => [o.posto, o]));
  const cel = (p, t) => {
    if (faPostos.has(p.id)) return `<td colspan="2" class="c">FA</td>`;
    const aqui = cd.designacoes.filter((d) => d.posto === p.id && sobrepoe(d.ini, d.fim, t.ini, t.fim) > 0).sort((a, b) => a.ini - b.ini);
    if (!aqui.length) {
      if (p.rondas) return `<td colspan="2" class="c rondas-p">VTR/RONDAS FREQUENTES</td>`;
      if (cd.furos.some((f) => f.posto === p.id && f.turno === t.id)) return `<td colspan="2" class="c furo-p">X</td>`;
      return `<td></td><td></td>`;
    }
    return `<td class="gn">${aqui.map((d) => `<div class="${d.nat}">${esc(nomeGm(d.gm))}${d.nat === "he" ? (d.fixa ? "" : " HE+") : d.nat === "bh" ? " BH+" : ""}${d.req && !d.fixa ? ` <span class="r">${esc(d.req)}</span>` : ""}</div>`).join("")}</td>
      <td class="gh">${aqui.map((d) => `<div class="${d.nat}">(${textoCelula(d, t)})</div>`).join("")}</td>`;
  };
  let corpo = "";
  for (const s of data.secoes) {
    const ps = data.postos.filter((p) => p.secao === s.id);
    corpo += `<tr class="sec"><th>${esc(s.nome)}</th>${TURNOS.map((t) => `<th colspan="2">${t.nome}</th>`).join("")}</tr>`;
    corpo += ps.map((p) => `<tr><th class="p">${esc(p.nome)}${p.sub ? `<br><span class="sub">${esc(p.sub)}</span>` : ""}${p.obs ? `<br><span class="sub">(${esc(p.obs)})</span>` : ""}</th>${TURNOS.map((t) => cel(p, t)).join("")}</tr>`).join("");
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
      ${grupo(["BH_COMP"], "BANCO DE HORAS / COMPENSAÇÃO", "REQ.")}
      ${grupo(["FOLGA"], "FOLGAS", "DATA")}
      ${grupo(["TROCA"], "TROCAS DE SERVIÇO", "SITUAÇÃO")}
      ${grupo(["ATESTADO", "LICENCA", "CURSO"], "ATESTADO / LICENÇAS / CURSOS", "PERÍODO")}
      ${grupo(["FERIAS"], "FÉRIAS", "PERÍODO")}
    </table>
  </article></div>`;
}

// ---------- eventos ----------
function abrirFuro(posto, turno) {
  const t = TURNOS.find((x) => x.id === turno);
  ui.drawer = { tipo: "furo", posto, turno, ini: fmtHm(t.ini), fim: fmtHm(t.fim), nat: "HE", req: "" };
  render();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act],[data-nav]");
  if (!el) return;
  if (el.dataset.nav) { ui.view = el.dataset.nav; ui.drawer = null; location.hash = ui.view; render(); return; }
  const a = el.dataset.act;
  const d = ui.drawer;
  if (a !== "apagar" && a !== "pre-apagar") ui.confirmar = null;
  switch (a) {
    case "dia": ui.dia = somaDias(ui.dia, Number(el.dataset.n)); ui.mes = mesDe(ui.dia); ui.drawer = null; render(); break;
    case "mes": ui.mes = Number(el.dataset.n) > 0 ? mesSeguinte(ui.mes) : mesAnterior(ui.mes); render(); break;
    case "lmes": ui.filtroLanc.mes = Number(el.dataset.n) > 0 ? mesSeguinte(ui.filtroLanc.mes) : mesAnterior(ui.filtroLanc.mes); render(); break;
    case "furo": abrirFuro(el.dataset.posto, el.dataset.turno); break;
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
    case "desfazer": if (desfazer.length) { data.ocorrencias = JSON.parse(desfazer.pop()); data._versao++; salvar(); render(); toast("Alteração desfeita"); } break;
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
  const map = { "f-busca": ".sug li", "m-busca": "table.mes tbody tr", "lf-busca": "table.lanc tbody tr" };
  const sel = map[e.target.id];
  if (!sel) return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll(sel).forEach((el) => { el.hidden = q ? !el.dataset.nome.includes(q) : el.classList.contains("mais"); });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.drawer) { ui.drawer = null; render(); } });
$("#veu").addEventListener("click", () => { ui.drawer = null; render(); });
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (VIEWS.includes(h) && h !== ui.view) { ui.view = h; ui.drawer = null; render(); } });

void hm; void trabalhaNoDia; void resumoMes;
render();
