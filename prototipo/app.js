import {
  TURNOS, TIPOS, AFASTAMENTOS, calcularDia, sugerir, livroMes, resumoMes, saldoBH, somaDias, diaSemana, diasDoMes,
  mesDe, mesSeguinte, fmtHm, fmtHoras, intervalo, sobrepoe, trabalhaNoDia, hm, planejarCobertura, vigente, TIPOS_REQ, montarSegmentos, lerFaixas, descreverSegmentos,
  limitarExtensao, cargoProprio, parseData, horasParaSugestao, postoAtivoEm, secaoOperacao, horarioEja, horarioProposto, pendencias, diaFinalizado, afastamentoNoDia, heDoDia, diasEmAberto, controleMes, previstaMes,
} from "./engine.js";
import { criarExemplo } from "./seed.js";
import { interpretar, norm } from "./comando.js";

const CHAVE = "escala-gm-prototipo-v2";
const SEMANA = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const VIEWS = ["pendencias", "quadro", "padroes", "lancamentos", "mes", "ficha", "folha", "frota", "ajustes"];

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
  if (typeof window !== "undefined" && window.ESCALA_SERVIDOR) return { config: { tetoHE: 60, mesInicial: "2026-10", cabecalho: "" }, equipes: [], secoes: [], postos: [], gms: [], ocorrencias: [], controle: [], requerimentos: {}, inspetores: {}, frota: [], _versao: 0 };
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) { const d = JSON.parse(s); d._versao = 1; return d; }
  } catch { /* sem armazenamento: usa exemplo */ }
  return criarExemplo();
}
function salvar() { if (SERVIDOR) { sincronizar(); return; } try { localStorage.setItem(CHAVE, JSON.stringify({ ...data, _versao: undefined })); } catch { /* ignora */ } }
function mudar(msg, fn) {
  desfazer.push(JSON.stringify({ o: data.ocorrencias, p: data.postos, s: data.secoes, g: data.gms, r: data.requerimentos || {}, e: data.equipes, c: data.controle || [], i: data.inspetores || {}, f: data.frota || [], fs: data.folgasSync || {} }));
  if (desfazer.length > 30) desfazer.shift();
  fn();
  data._versao = (data._versao || 0) + 1;
  if (SERVIDOR) srv.resumos.push(msg);
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
const opcoesPosto = (sel = "") => data.secoes.map((s) => `<optgroup label="${esc(s.nome)}">${data.postos.filter((p) => p.secao === s.id && !p.apagado && (p.ativo !== false || p.id === sel))
  .map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.nome)}${p.sub ? " · " + esc(p.sub) : ""}${p.ativo === false ? " (excluído)" : ""}</option>`).join("")}</optgroup>`).join("");
function rotuloLotacao(g) {
  if (!g.lotacao) return "sem lotação";
  const p = postoPorId(g.lotacao.posto);
  const seg = g.lotacao.segmentos.map((s) => `${s.ini}–${s.fim}${s.tipo === "he" ? " (HE)" : ""}`).join(" + ");
  return `${p?.nome || "?"}${g.lotacao.funcao ? " · " + g.lotacao.funcao : ""} · ${seg}`;
}
const BADGE = { he: ["HE+", "he"], bh: ["BH+", "bh"], troca: ["TROCA", "troca"] };

// ---------- shell ----------
// Na folha, nome (coluna GM) e horário ficam em colunas separadas: cada GM precisa ter a mesma altura
// nas duas, senão um nome que quebra linha (ou um REQ embaixo) desencontra o horário.
function alinharFolha() {
  document.querySelectorAll(".pt td.gn").forEach((gn) => {
    const gh = gn.nextElementSibling; if (!gh?.classList.contains("gh")) return;
    const a = [...gn.children], b = [...gh.children];
    a.forEach((x, i) => { const y = b[i]; if (!y) return; x.style.minHeight = y.style.minHeight = ""; const h = Math.max(x.offsetHeight, y.offsetHeight); x.style.minHeight = y.style.minHeight = h + "px"; });
  });
}
if (typeof window !== "undefined") { window.addEventListener("beforeprint", () => ui.view === "folha" && alinharFolha()); window.addEventListener("resize", () => ui.view === "folha" && alinharFolha()); }
function render() {
  document.querySelectorAll("[data-nav]").forEach((a) => a.setAttribute("aria-current", a.dataset.nav === ui.view ? "page" : "false"));
  if (SERVIDOR && (!ui.pronto || ui.vazio)) { $("#main").innerHTML = telaServidor(); $("#drawer").hidden = true; $("#veu").hidden = true; return; }
  const main = $("#main");
  const html = { padroes: vPadroes, pendencias: vPendencias, ajustes: vAjustes, quadro: vQuadro, lancamentos: vLancamentos, mes: vMes, ficha: vFicha, folha: vFolha, frota: vFrota }[ui.view]();
  main.innerHTML = html;
  $("#drawer").innerHTML = ui.drawer ? vDrawer() : "";
  $("#drawer").hidden = !ui.drawer;
  $("#veu").hidden = !ui.drawer;
  $("#btn-desfazer").disabled = !desfazer.length;
  if (SERVIDOR && ui.view === "ajustes") carregarHistorico();
  if (ui.view === "folha") alinharFolha();
  document.querySelectorAll("table.quadro .secao-btn[data-secao], table.quadro .posto-btn[data-posto]").forEach((x) => { // alça para arrastar e reordenar
    if (x.previousElementSibling?.classList.contains("alca")) return;
    const a = document.createElement("span"); a.className = "alca"; a.draggable = true; a.textContent = "⠿"; a.setAttribute("aria-hidden", "true");
    a.title = "Arraste para mudar a ordem"; if (x.dataset.secao) a.dataset.secao = x.dataset.secao; else a.dataset.posto = x.dataset.posto;
    x.before(a);
  });
  document.body.dataset.view = ui.view;
  const esc0 = $("#marca-escudo"); if (esc0 && data.config?.brasoes?.esq && !esc0.querySelector("img")) esc0.innerHTML = `<img src="${data.config.brasoes.esq}" alt="">`;
  const hdr = document.querySelector("header.app"); if (hdr) document.documentElement.style.setProperty("--hdr", hdr.offsetHeight + "px");
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
// Em que coluna(s) cada serviço aparece, como no PDF: serviço de 8h ou mais é dividido no meio
// (06–18 → 06–12 | 12–18; 18–06 → 18–00 | 00–06); serviço curto fica só na coluna que mais ocupa.
const cachePartes = new WeakMap();
function partesVisuais(d) {
  if (cachePartes.has(d)) return cachePartes.get(d);
  const meio = Math.round((d.ini + d.fim) / 2 / 30) * 30;
  const pedacos = d.fim - d.ini >= 8 * 60 ? [[d.ini, meio], [meio, d.fim]] : [[d.ini, d.fim]];
  const partes = [];
  for (const [a, b] of pedacos) {
    let t = null, ov = 0;
    for (const x of TURNOS) { const o = sobrepoe(a, b, x.ini, x.fim); if (o > ov) { ov = o; t = x; } }
    t ||= a < TURNOS[0].ini ? TURNOS[0] : TURNOS[3];
    const ja = partes.find((p) => p.t === t);
    if (ja) ja.fim = b; else partes.push({ t, ini: a, fim: b });
  }
  cachePartes.set(d, partes);
  return partes;
}
const naColuna = (d, t) => partesVisuais(d).some((p) => p.t === t);
function textoCelula(d, t) {
  const pt = partesVisuais(d).find((p) => p.t === t);
  if (pt) return `${fmtHm(pt.ini)}/${fmtHm(pt.fim)}`;
  const idx = TURNOS.indexOf(t);
  const prev = TURNOS[idx - 1], next = TURNOS[idx + 1];
  const a = d.ini < t.ini && !(prev && sobrepoe(d.ini, d.fim, prev.ini, prev.fim) > 0) ? d.ini : Math.max(d.ini, t.ini);
  const b = d.fim > t.fim && !(next && sobrepoe(d.ini, d.fim, next.ini, next.fim) > 0) ? d.fim : Math.min(d.fim, t.fim);
  return `${fmtHm(a)}/${fmtHm(b)}`;
}
function chip(d, t, junto) {
  const g = gmPorId(d.gm);
  const [txt, cls] = BADGE[d.nat] || [];
  const extras = [];
  if (d.recorrente) extras.push(`<span class="he-num">HE+</span>`);
  else if (d.fixa) extras.push(`<span class="he-num">${fmtHE(d.fim - d.ini)}</span>`);
  else if (d.extensao) extras.push(`<span class="tag he">HE+</span>`);
  else if (txt) extras.push(`<span class="tag ${cls}">${txt}</span>`);
  if (d.remanejado) extras.push(`<span class="tag rem">REMANEJ.</span>`);
  const ultimo = partesVisuais(d).at(-1).t === t; // detalhes só na coluna onde o serviço termina
  if (d.bhDebito && ultimo) extras.push(`<span class="tag bhc">BH−${fmtHoras(d.bhDebito)}</span>`);
  if (d.req && !d.fixa) extras.push(`<span class="req">REQ ${esc(d.req)}</span>`);
  const reserva = postoPorId(d.posto)?.tipo === "reserva" ? "reserva" : "";
  return `<button class="chip ${cls || ""} ${reserva} ${d.conflito ? "conflito" : ""} ${d.alterado && ultimo ? "alterado" : ""}" data-act="card" data-des="${d.id}" title="Clique para mudar horário, REQ, observação ou trocar o GM">
    <span class="nm">${esc(g?.nome)}</span>${d.funcao && (emVtr(d.posto) || !ICO_FUNCAO[d.funcao]) ? `<span class="fn${ICO_FUNCAO[d.funcao] ? " fn-ico" : ""}" title="${esc(d.funcao)} · botão direito › Função para mudar">${ICO_FUNCAO[d.funcao] || esc(d.funcao.slice(0, 3).toUpperCase())}</span>` : ""}
    <span class="hr" ${junto ? `data-junto="${junto.he.id}"` : ""}>${junto ? `${textoCelula(d, t).split("/")[0]}/${fmtHm(junto.he.fim)}` : textoCelula(d, t)}</span>${(() => { const n = d.nat === "he" ? 0 : numeroHeNaColuna(d, t, junto, [...(ui.desMap?.values() || [])]); return n ? `<span class="he-num" title="${fmtHoras(n)} de hora extra fixa">${fmtHE(n)}</span>` : ""; })()}${extras.join("")}${d.obs && ultimo ? `<span class="obs" title="${esc(d.obs)}">${esc(d.obs.length > 34 ? d.obs.slice(0, 33) + "…" : d.obs)}</span>` : ""}</button>`;
}
function painelAvisos() {
  const as = avisosDoDia(ui.dia), novos = as.filter((o) => !avisoLido(o, ui.dia)), lidos = as.filter((o) => avisoLido(o, ui.dia));
  if (!as.length) return "";
  return `${novos.map((o) => `<section class="aviso-dia" role="note"><span class="av-ico" aria-hidden="true">📌</span><div><b>Aviso${o.ate && o.ate !== o.de ? ` · ${ddmm(o.de)} a ${ddmm(o.ate)}` : ""}</b><p>${esc(o.texto).replace(/\n/g, "<br>")}</p></div>
      <button class="btn" data-act="av-lido" data-id="${o.id}">Marcar como lido</button></section>`).join("")}
    ${lidos.length ? `<p class="av-lidos"><button class="link" data-act="av-ver-lidos">${ui.verLidos ? "esconder" : `${lidos.length} aviso${lidos.length === 1 ? "" : "s"} lido${lidos.length === 1 ? "" : "s"} neste dia`}</button></p>
      ${ui.verLidos ? lidos.map((o) => `<section class="aviso-dia lido"><div><p>${esc(o.texto).replace(/\n/g, "<br>")}</p></div><button class="link" data-act="av-naolido" data-id="${o.id}">marcar como não lido</button></section>`).join("") : ""}` : ""}`;
}
// Faixa "Atenção hoje": tudo o que pede ação no dia, com a cor da gravidade (vermelho = resolver, laranja = conferir)
function faixaAtencao(cd, furosTotal) {
  const it = [];
  const ofer = cd.furos.filter((f) => ofertaDaVaga(f.posto, f.turno, ui.dia)).reduce((t, f) => t + f.faltam, 0), semNinguem = furosTotal - ofer;
  if (semNinguem) it.push(["grave", `${semNinguem} ${semNinguem === 1 ? "vaga descoberta" : "vagas descobertas"}${ofer ? " (sem oferta)" : ""}`, `<button class="link" data-act="so-furos">ver só os furos</button>`]);
  if (ofer) it.push(["aviso", `${ofer} ${ofer === 1 ? "vaga" : "vagas"} com HE oferecida, aguardando resposta`, ""]);
  const pendResp = ofertasAbertas(ui.dia).filter((o) => !cd.furos.some((f) => f.posto === o.posto && sobrepoe(...intervalo(o.ini, o.fim), TURNOS.find((t) => t.id === f.turno).ini, TURNOS.find((t) => t.id === f.turno).fim) > 0)).reduce((t, o) => t + aguardando(o).length, 0);
  if (pendResp) it.push(["info", `${pendResp} GM${pendResp === 1 ? "" : "s"} ainda sem resposta em vagas já preenchidas (avise que não precisa mais)`, ""]);
  for (const a of cd.alertas) it.push([a.nivel === "erro" ? "grave" : "aviso", a.texto, ""]);
  const semInsp = ["dia", "noite"].filter((per) => cd.equipes.map(equipe).some((e) => e.periodo === per) && cd.equipes.map(equipe).filter((e) => e.periodo === per).every((e) => !(cd.inspetores.has(e.id) ? cd.inspetores.get(e.id) : e.inspetor)));
  if (semInsp.length) it.push(["grave", `Sem inspetor de serviço ${semInsp.map((p) => (p === "dia" ? "de dia" : "à noite")).join(" e ")}`, `<button class="link" data-act="ir-insp">escolher</button>`]);
  const faLog = data.postos.filter((p) => p.ativo !== false && !cd.fa.some((o) => o.posto === p.id) && cd.designacoes.some((d) => d.posto === p.id)).map((p) => viaturaNaFrota(numeroDe(nomeNoDia(p, cd)))).filter((v) => v && v.situacao !== "QAP");
  if (faLog.length) it.push(["aviso", `Viatura em FA pela logística com guarnição escalada: ${[...new Set(faLog.map((v) => v.prefixo))].join(", ")}`, `<button class="link" data-act="ir-frota">ver viaturas</button>`]);
  if (ui.dia < hojeBase() && !diaFinalizado(data, ui.dia)) it.push(["info", "Este dia já passou e a escala ainda não foi finalizada (as HEs não estão no controle)", `<button class="link" data-act="fin-abrir">finalizar</button>`]);
  if (!it.length) return `<div class="atencao-ok">✓ Nada pendente neste dia</div>`;
  return `<section class="atencao" aria-label="Atenção hoje"><h3>Atenção</h3><ul>${it.map(([n, t, a]) => `<li class="${n}"><span class="pt-cor" aria-hidden="true"></span><span>${esc(t)}</span>${a}</li>`).join("")}</ul></section>`;
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
    if (!opNoDia(s, ui.dia)) continue;
    const postos = data.postos.filter((p) => p.secao === s.id && postoDoDia(p, ui.dia));
    let corpo = "";
    let nLinha = 0;
    for (const p of postos) {
      const furosP = cd.furos.filter((f) => f.posto === p.id);
      if (ui.soFuros && !furosP.length) continue;
      const desP = cd.designacoes.filter((d) => d.posto === p.id);
      const naoHoje = p.dias && !p.dias.includes(diaSemana(ui.dia));
      let cels;
      if (faPostos.has(p.id)) {
        const o = faPostos.get(p.id);
        const voltaram = desP.filter((d) => d.ficaNaFA);
        cels = `<td colspan="4" class="fa-cel"><button class="link" data-act="pop-posto" data-posto="${p.id}">${o.tipo === "FA" ? "Viatura em manutenção (FA)" : "Posto fechado"}${o.ate && o.ate !== o.de ? ` até ${ddmm(o.ate)}` : " neste dia"}</button>${o.obs ? " · " + esc(o.obs) : ""}${voltaram.length ? ` — guarnição mantida no posto: <span class="fa-guarn">${voltaram.map((d) => chip(d, TURNOS.find((t) => naColuna(d, t)) || TURNOS[0])).join("")}</span>` : " — quem estava aqui foi para <b>À disposição</b>"}</td>`;
      } else {
        cels = TURNOS.map((t) => {
          const aqui = desP.filter((d) => naColuna(d, t)).sort((a, b) => a.ini - b.ini);
          const furo = furosP.find((f) => f.turno === t.id);
          const { mostrar, junto } = juntarHeFixa(aqui, t, cd.designacoes);
          let h = mostrar.map((d) => chip(d, t, junto.get(d))).join("");
          const of = ofertaDaVaga(p.id, t.id, ui.dia);
          if (of && !furo && aguardando(of).length) h += `<button class="oferta-pend" data-act="oferta-abrir" data-id="${of.id}" title="Ainda falta resposta de quem recebeu a oferta">⏳ ${aguardando(of).length} aguardando resposta da HE oferecida</button>`;
          else if (of && furo) h += `<button class="furo oferecida" data-act="oferta-abrir" data-id="${of.id}" title="Clique para marcar quem confirmou">HE oferecida a ${aguardando(of).length || of.gms.length} · aguardando<small>${esc(aguardando(of).map((g) => nomeGm(g.gm)).join(", "))}</small></button>`;
          else if (furo) h += `<button class="furo" data-act="pop-add" data-posto="${p.id}" data-turno="${t.id}">Cobrir · falta ${furo.faltam}${p.reforco ? ` · ${p.reforco.ini}–${p.reforco.fim}` : ""}</button>`;
          if (!aqui.length && !furo) h = p.rondas ? `<span class="rondas">VTR/RONDAS FREQUENTES</span>` : naoHoje && p.vagas ? `<span class="vazio">não funciona hoje</span>` : "";
          if (!furo) h += `<button class="add" data-act="pop-add" data-posto="${p.id}" data-turno="${t.id}" aria-label="Pôr GM em ${esc(p.nome)}, ${t.nome}">+ pôr GM</button>`;
          return `<td class="${t.id === "t2" || t.id === "t3" ? "dia" : "noite"}" data-posto="${p.id}" data-turno="${t.id}" tabindex="-1">${h}</td>`;
        }).join("");
      }
      const aj = cd.ajustesPosto.get(p.id) || {};
      const ninguem = !p.rondas && !faPostos.has(p.id) && !cd.designacoes.some((d) => d.posto === p.id);
      corpo += `<tr class="${s.grupamento ? "em-grupo" : ""} ${ninguem ? "ninguem" : ""} ${nLinha++ % 2 ? "alt" : ""} tipo-${p.tipo || "posto"}"><th scope="row" class="posto"><button class="posto-btn" data-act="pop-posto" data-posto="${p.id}" title="Clique para mudar este ${ehViatura(p) ? "viatura" : "posto"}">
        <span class="pn">${iconePosto(p)}${esc(nomeNoDia(p, cd))}</span>${subNoDia(p, cd) ? `<span class="ps ${aj.area ? "dia" : ""}">${esc(subNoDia(p, cd))}</span>` : ""}${p.so ? `<span class="tag rem">só neste dia</span>` : ""}${p.obs ? `<span class="po">(${esc(p.obs)})</span>` : ""}
        ${aj.vagas ? `<span class="tag rem" title="Clique no nome para voltar ao normal">${aj.vagas.obs === "vaga dispensada" ? "vaga dispensada hoje" : "vagas do dia alteradas"}</span>` : ""}${(() => { const fv = viaturaNaFrota(numeroDe(nomeNoDia(p, cd))); if (!fv || fv.situacao === "QAP" || faPostos.has(p.id)) return ""; const alt = (data.frota || []).filter((x) => x.situacao === "QAP" && x.modelo === fv.modelo && !guarnicaoNaEscala(x.prefixo, cd)).map((x) => x.prefixo); return `<span class="tag fa-log" title="A logística marcou a ${esc(fv.prefixo)} como ${SIT[fv.situacao][0]}.${alt.length ? ` Livres do mesmo modelo: ${alt.join(", ")}.` : ""} Botão direito › Usar outra viatura hoje.">logística: ${fv.situacao === "FAP" ? "FA perm." : "FA"}</span>`; })()}${ninguem ? `<span class="tag vazio" title="Ninguém escalado neste dia. Botão direito: excluir ou mudar as vagas.">ninguém escalado</span>` : ""}<span class="lapis" aria-hidden="true">✎</span></button></th>${cels}</tr>`;
    }
    const vazioGrupo = s.grupamento && !cd.designacoes.some((d) => postos.some((p) => p.id === d.posto));
    if (vazioGrupo) continue; // grupamento sem ninguém escalado no dia não aparece
    if (s.operacao && (corpo || !ui.soFuros)) { linhas += `<tr class="secao operacao"><th colspan="5" scope="rowgroup"><button class="secao-btn" data-act="op-editar" data-secao="${s.id}" title="Editar a operação · botão direito: mais opções"><span class="op-selo">OPERAÇÃO</span> ${esc(s.nome)} <span class="lapis" aria-hidden="true">✎</span></button><span class="op-info">${esc(textoOp(s.operacao))}${s.operacao.obs ? ` · ${esc(s.operacao.obs)}` : ""}</span><button class="link add-sec" data-act="op-editar" data-secao="${s.id}">+ equipe / viatura</button></th></tr>${corpo}`; continue; }
    if (corpo || !ui.soFuros) linhas += `<tr class="secao ${s.grupamento ? "grupo" : ""}"><th colspan="5" scope="rowgroup"><button class="secao-btn" data-act="secao-nome" data-secao="${s.id}" title="Clique para renomear · botão direito: mais opções">${s.grupamento ? ICONES.grupo : ""}${esc(s.nome)} <span class="lapis" aria-hidden="true">✎</span></button>${s.grupamento ? `<span class="selo-grupo">GRUPAMENTO</span>` : ""}<button class="link add-sec" data-act="pad-novo" data-secao="${s.id}">+ posto/viatura</button></th></tr>${corpo}`;
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
    ${[...new Set(cd.disposicao.map((d) => d.gm))].map((id) => { const d = cd.disposicao.find((x) => x.gm === id); return `<button class="chip" data-act="disp-mandar" data-des="${d.id}" title="Clique para mandar a uma vaga · ou arraste até o posto"><span class="nm">${esc(nomeGm(id))}</span><span class="hr">${fmtHm(d.ini)}/${fmtHm(d.fim)}</span><span class="req">de ${esc(postoPorId(d.postoOriginal)?.nome)}${postoPorId(d.postoOriginal)?.ativo === false ? " (excluída)" : ""}</span></button>`; }).join("")}
    </div></section>` : "";

  return `
  <div class="barra">
    <div class="datas">
      <button class="ic" data-act="dia" data-n="-1" aria-label="Dia anterior">‹</button>
      <input type="date" id="q-dia" value="${ui.dia}" min="2026-10-01" max="2026-12-31" aria-label="Data do serviço">
      <button class="ic" data-act="dia" data-n="1" aria-label="Próximo dia">›</button>
      <span class="selo-dia" title="Mudanças aqui valem só para este dia">Escala do dia</span><div class="periodo"><b>${SEMANA[diaSemana(ui.dia)]} ${ddmm(ui.dia)}</b> 07h → ${SEMANA[diaSemana(amanha)].toLowerCase()} ${ddmm(amanha)} 07h</div>
    </div>
    <div class="equipes">
      ${[...eqDia, ...eqNoite].map((e) => `<button class="eq ${equipe(e).periodo}" data-act="pop-insp" data-equipe="${e}" title="Clique para trocar o inspetor"><b>${esc(rotuloEquipe(equipe(e)))}</b> ${cd.inspetores.get(e) === "" ? `<span class="sem-insp">sem inspetor</span>` : esc(cd.inspetores.get(e) || equipe(e).inspetor || "")}</button>`).join("")}
    </div>
  </div>
  <div class="faixa">
    <span class="${furosTotal ? "ruim" : "bom"}"><b>${furosTotal}</b> ${furosTotal === 1 ? "vaga descoberta" : "vagas descobertas"}</span>
    <span><b>${fmtHoras(heHoje)}</b> de HE</span>
    <button class="btn" data-act="busca-gm" title="Onde está um GM neste dia (Ctrl+F)">🔍 Buscar GM</button>
    <button class="btn" data-act="pad-novo" title="Adicionar posto, viatura, seção ou grupamento">+ Posto / viatura</button>
    <button class="btn op-btn" data-act="op-nova" title="Operação anexa à escala (eventos, reforço especial)">+ Operação</button>
    ${(() => { const a = alteracoesDoDia(ui.dia); return a.ocs.length + a.extras.length ? `<button class="link" data-act="rst-abrir" title="Voltar a escala deste dia para o padrão">Desfazer alterações do dia…</button>` : ""; })()}
    ${diaFinalizado(data, ui.dia) ? `<span class="fin-ok">✓ Escala finalizada <button class="link" data-act="fin-reabrir">reabrir</button></span>` : `<button class="btn fin" data-act="fin-abrir" title="Confirmar as horas extras deste dia e lançar no controle do mês">Finalizar escala…</button>`}
    <span><b>${new Set(cd.designacoes.filter((d) => d.posto).map((d) => d.gm)).size}</b> GMs escalados</span>
    <span><b>${cd.afastados.length}</b> fora da escala</span>
    <label class="toggle"><input type="checkbox" id="q-sofuros" ${ui.soFuros ? "checked" : ""}> Só furos</label>
  </div>
  <p class="dica como">Clique no <b>nome</b> ou no <b>horário</b> para editar ali mesmo · <b>botão direito</b> mostra todas as opções · <b>arraste</b> para remanejar · setas, Enter, Delete, Ctrl+C e Ctrl+V também funcionam.</p>
  ${painelPlano()}
  ${painelAvisos()}
  ${faixaAtencao(cd, furosTotal)}
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
  if (d.tipo === "finalizar") return drawerFinalizar(d);
  if (d.tipo === "controle") return drawerControle(d);
  if (d.tipo === "gmnovo") return drawerGmNovo(d);
  if (d.tipo === "resetdia") return drawerResetDia(d);
  if (d.tipo === "operacao") return drawerOperacao(d);
  if (d.tipo === "excluidos") return drawerExcluidos(d);
  if (d.tipo === "folgasmud") return drawerFolgasMud();
  return "";
}
// ---------- OPERAÇÕES (seção anexa à escala) ----------
// Uma operação é uma seção com período e horário próprios; cada equipe é um posto (viatura da frota, viatura nova ou equipe a pé)
// que só existe nesses dias. O efetivo vem da escala do dia (remanejado no horário da operação), de HE, BH+ ou troca.
const ehMoto = (modelo) => /XRE|NX|MOTO|CG|BROS|TITAN/i.test(modelo || "");
function vagaDoReforco(ini, fim, n) { // reforço = uma vaga só, no turno em que ele mais cai
  const [a, b] = intervalo(ini, fim), v = {}; let melhor = null, m = -1;
  for (const t of TURNOS) { v[t.id] = 0; const x = sobrepoe(a, b, t.ini, t.fim); if (x > m) { m = x; melhor = t.id; } }
  v[melhor] = n; return v;
}
function vagasDoHorario(ini, fim, n) {
  const [a, b] = intervalo(ini, fim), v = {};
  for (const t of TURNOS) v[t.id] = sobrepoe(a, b, t.ini, t.fim) >= 60 ? n : 0;
  return v;
}
function drawerOperacao(d) {
  const s = d.secao ? data.secoes.find((x) => x.id === d.secao) : null, o = s?.operacao || {}, cd = calcularDia(data, ui.dia);
  const existentes = s ? data.postos.filter((p) => p.secao === s.id && p.ativo !== false) : [];
  const usoNaEscala = (pref) => data.postos.find((p) => p.ativo !== false && !secaoOperacao(data, p.id) && numeroDe(nomeNoDia(p, cd)) === String(pref) && cd.designacoes.some((x) => x.posto === p.id));
  const livres = (data.frota || []).filter((v) => v.situacao === "QAP").sort((a, b) => !!usoNaEscala(a.prefixo) - !!usoNaEscala(b.prefixo) || String(a.prefixo).localeCompare(String(b.prefixo)));
  const novas = d.novas || [];
  return `<div class="dw-head"><div><p class="eyebrow">Anexo da escala</p><h2>${s ? `Operação ${esc(s.nome)}` : "Nova operação"}</h2>
    <p class="meta">Aparece no quadro e na folha só nos dias dela. Depois de criada, use "+ pôr GM" em cada equipe: dá para tirar GMs da escala do dia (no horário da operação), chamar em HE ou BH+, ou lançar troca.</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body"><div class="form-lanc">
    <label>Nome <input id="op-nome" value="${esc(s?.nome || "")}" placeholder="ex.: VERÃO 2027, JOGO NO ESTÁDIO"></label>
    <label>Local <input id="op-local" value="${esc(o.local || "")}" placeholder="opcional"></label>
    <div class="linha"><label>De <input type="date" id="op-de" value="${o.de || ui.dia}"></label><label>Até <input type="date" id="op-ate" value="${o.ate || ui.dia}"></label></div>
    <div class="linha"><label>Início <input type="time" id="op-ini" value="${o.ini || "19:00"}"></label><label>Fim <input type="time" id="op-fim" value="${o.fim || "03:00"}"></label></div>
    <label>Observação <input id="op-obs" value="${esc(o.obs || "")}" placeholder="ex.: briefing às 18h na sede"></label>
    <h3>Equipes e viaturas</h3>
    ${existentes.length ? `<ul class="op-eq">${existentes.map((p) => `<li><b>${esc(p.nome)}</b>${p.sub ? ` <span class="meta">${esc(p.sub)}</span>` : ""} <span class="meta">· ${Math.max(...Object.values(p.vagas || { a: 0 }))} GM</span><button class="link" data-act="op-tirar" data-posto="${p.id}">tirar</button></li>`).join("")}</ul>` : ""}
    ${novas.map((n, i) => `<div class="op-nova"><b>${esc(n.nome)}</b>${n.uso ? ` <span class="aviso-mini">está na escala em ${esc(n.uso)}</span>` : ""}<label>GMs <input type="number" min="1" max="9" value="${n.n}" data-opn="${i}" size="3"></label><button class="link" data-act="op-nova-tirar" data-i="${i}">tirar</button></div>`).join("")}
    <div class="linha op-add"><label class="cresce">Viatura da frota <select id="op-frota"><option value="">escolha…</option>${livres.map((v) => { const u = usoNaEscala(v.prefixo); return `<option value="${esc(v.prefixo)}">${esc(v.prefixo)} · ${esc(v.modelo)}${u ? ` (na escala: ${esc(u.nome)})` : " (livre)"}</option>`; }).join("")}</select></label><button class="btn" data-act="op-add-frota">Adicionar</button></div>
    <div class="linha op-add"><label class="cresce">Outra viatura ou equipe <input id="op-outra" placeholder="ex.: VTR 1399, MOTO 651, EQUIPE A PÉ 1"></label><button class="btn" data-act="op-add-outra">Adicionar</button></div>
    <button class="btn pri largo" data-act="op-salvar">${s ? "Salvar operação" : "Criar operação"}</button>
    ${s ? `<p class="dica">Para excluir a operação, clique com o botão direito no nome dela no quadro › Excluir seção.</p>` : ""}
  </div></div>`;
}
// ---------- POSTOS EXCLUÍDOS ----------
// Reativar, passar os GMs que ainda estão lotados nele para outro posto, ou tirar da lista de vez
const postosExcluidos = () => data.postos.filter((p) => p.ativo === false && !p.apagado && !p.so && !p.de);
const lotadosEm = (postoId, dia) => data.gms.filter((g) => g.ativo !== false && vigente(g, dia).lotacao?.posto === postoId);
function drawerExcluidos() {
  const dia = ui.padrao?.desde || ui.dia, ex = postosExcluidos();
  const ativos = data.postos.filter((p) => p.ativo !== false && !p.so && !p.de);
  return `<div class="dw-head"><div><p class="eyebrow">Cadastro</p><h2>Postos e viaturas excluídos</h2>
    <p class="meta">Excluídos não aparecem na escala. Quem ainda estiver lotado num deles fica "sem posto" — passe para outro posto ou reative.</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">${ex.length ? `<ul class="ex-lista">${ex.map((p) => { const lot = lotadosEm(p.id, dia), igual = ativos.find((x) => norm(x.nome) === norm(p.nome));
    return `<li><div class="ex-cab"><b>${esc(p.nome)}</b>${p.sub ? ` <span class="meta">${esc(p.sub)}</span>` : ""} <span class="meta">· ${esc(data.secoes.find((x) => x.id === p.secao)?.nome || "")}</span></div>
      ${lot.length ? `<p class="aviso-mini">${lot.length} GM${lot.length === 1 ? "" : "s"} ainda lotado${lot.length === 1 ? "" : "s"} aqui: ${lot.map((g) => esc(g.nome)).join(", ")}</p>
        <div class="linha"><select data-ex-dest="${p.id}">${ativos.map((x) => `<option value="${x.id}" ${igual?.id === x.id ? "selected" : ""}>${esc(x.nome)}${x.sub ? " · " + esc(x.sub) : ""}</option>`).join("")}</select><button class="btn" data-act="ex-passar" data-posto="${p.id}">Passar para este posto</button></div>` : `<p class="meta">Ninguém lotado aqui.</p>`}
      <div class="linha"><button class="btn" data-act="ex-reativar" data-posto="${p.id}">Reativar</button>${lot.length ? "" : `<button class="link perigo-txt" data-act="ex-apagar" data-posto="${p.id}">Apagar da lista</button>`}</div></li>`; }).join("")}</ul>`
    : `<p class="tudo-ok">Nenhum posto excluído.</p>`}</div>`;
}
// ---------- RESET DAS ALTERAÇÕES DO DIA ----------
// Só o que foi mexido no próprio dia (HE, BH+, horário, remanejamento, função, ajustes do posto, inspetor, extras).
// Folgas, afastamentos, trocas lançadas, FA e o que veio do Sistema de Folgas ficam.
const TIPOS_DO_DIA = ["HE", "BH_MAIS", "HORARIO", "REMANEJ", "FUNCAO", "PREFIXO", "VAGAS", "AREA", "INSPETOR", "SEM_HE_REC"];
function alteracoesDoDia(dia) {
  const ocs = data.ocorrencias.filter((o) => TIPOS_DO_DIA.includes(o.tipo) && o.de === dia && (!o.ate || o.ate === dia) && o.origem !== "folgas-gmnh");
  const extras = data.postos.filter((p) => p.so === dia);
  const insp = data.inspetores?.[dia] ? Object.keys(data.inspetores[dia]).filter((k) => ["dia", "noite"].includes(k)) : [];
  return { ocs, extras, insp };
}
function drawerResetDia(d) {
  const { ocs, extras } = alteracoesDoDia(ui.dia), fora = new Set(d.fora || []);
  const linha = (id, txt) => `<li><label class="fin-he"><input type="checkbox" data-rst="${id}" ${fora.has(id) ? "" : "checked"}><span>${txt}</span></label></li>`;
  const total = ocs.length + extras.length;
  return `<div class="dw-head"><div><p class="eyebrow">Escala do dia</p><h2>Desfazer alterações de ${ddmm(ui.dia)}</h2>
    <p class="meta">Volta a escala deste dia para o padrão. <b>Não mexe</b> em folgas, férias, atestados, cursos, trocas lançadas, FA nem no que veio do Sistema de Folgas.</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    ${total ? `<ul class="fin-lista">${ocs.map((o) => linha(o.id, `<b>${esc(TIPOS[o.tipo])}</b> · ${o.gm ? esc(nomeGm(o.gm)) + " · " : ""}${descreveOc(o)}`)).join("")}
      ${extras.map((p) => linha("p:" + p.id, `<b>Viatura/posto extra</b> · ${esc(p.nome)} (só neste dia)`)).join("")}</ul>
      <button class="btn perigo largo" data-act="rst-ok">Desfazer ${total - fora.size} alteraç${total - fora.size === 1 ? "ão" : "ões"}</button>
      <p class="dica">Dá para voltar atrás com Ctrl+Z.</p>` : `<p class="tudo-ok">Nenhuma alteração feita neste dia.</p>`}
  </div>`;
}
// ---------- FINALIZAR ESCALA E CONTROLE DE HE ----------
// Ao finalizar, a HE do dia vai para o controle. HE fixa/recorrente da semanal entra direto; as demais pedem confirmação.
function drawerFinalizar(d) {
  const dias = d.dias, fora = new Set(d.fora || []);
  const porDia = dias.map((dia) => ({ dia, hs: heDoDia(data, dia) }));
  const todas = porDia.flatMap((x) => x.hs), marcadas = todas.filter((h) => !fora.has(h.id));
  const linha = (h) => `<li><label class="fin-he ${h.fixa ? "fixa" : ""}"><input type="checkbox" data-fin="${h.id}" data-min="${h.min}" ${fora.has(h.id) ? "" : "checked"}>
    <b>${esc(nomeGm(h.gm))}</b><span class="hr">${h.ini}–${h.fim}</span><span class="meta">${esc(postoPorId(h.posto)?.nome || "")}${h.fixa ? " · HE fixa" : ""}${h.req ? ` · REQ ${esc(h.req)}` : ""}</span><span class="num">${fmtHoras(h.min)}</span></label></li>`;
  return `<div class="dw-head"><div><p class="eyebrow">Finalizar escala</p><h2>${dias.length === 1 ? `${SEMANA[diaSemana(dias[0])]} ${ddmm(dias[0])}` : `${dias.length} dias · ${ddmm(dias[0])} a ${ddmm(dias.at(-1))}`}</h2>
    <p class="meta">Confirme as horas extras que vão para o controle do mês. Desmarque quem não fez. Dá para corrigir depois em <b>Mês e horas</b>.</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    ${d.abertosAntes?.length ? `<p class="aviso-fin">${d.abertosAntes.length} ${d.abertosAntes.length === 1 ? "dia anterior ainda está aberto" : "dias anteriores ainda estão abertos"} neste mês. <button class="link" data-act="fin-incluir">Finalizar junto</button></p>` : ""}
    ${porDia.map(({ dia, hs }) => {
      const fixas = hs.filter((h) => h.fixa), outras = hs.filter((h) => !h.fixa);
      return `${dias.length > 1 ? `<h3>${SEMANA[diaSemana(dia)]} ${ddmm(dia)}</h3>` : ""}
      ${outras.length ? `<p class="grupo">Horas extras lançadas na escala</p><ul class="fin-lista">${outras.map(linha).join("")}</ul>` : `<p class="meta">Nenhuma hora extra lançada${dias.length > 1 ? "" : " neste dia"}.</p>`}
      ${fixas.length ? `<details class="fin-fixas"><summary>HE fixa da escala semanal · ${fixas.length} GM${fixas.length === 1 ? "" : "s"} · ${fmtHoras(fixas.reduce((t, h) => t + h.min, 0))} (entra automaticamente)</summary><ul class="fin-lista">${fixas.map(linha).join("")}</ul></details>` : ""}`;
    }).join("")}
    <button class="btn pri largo" data-act="fin-ok" id="fin-ok">Finalizar e lançar ${fmtHoras(marcadas.reduce((t, h) => t + h.min, 0))} no controle</button>
    ${todas.length - marcadas.length ? `<p class="meta">${todas.length - marcadas.length} desmarcada${todas.length - marcadas.length === 1 ? "" : "s"}: não entra${todas.length - marcadas.length === 1 ? "" : "m"} no controle.</p>` : ""}
  </div>`;
}
function finalizar(dias, fora) {
  const quando = new Date().toISOString(), lista = data.controle ||= [];
  for (const dia of dias) {
    data.controle = data.controle.filter((c) => c.dia !== dia || c.manual);
    data.controle.push({ id: `f${dia.replaceAll("-", "")}`, tipo: "FECHADO", dia, quando });
    for (const h of heDoDia(data, dia)) if (!fora.has(h.id)) data.controle.push(h);
  }
  void lista;
}
function abrirFinalizar(dia) {
  const antes = diasEmAberto(data, mesDe(dia), somaDias(dia, -1));
  ui.drawer = { tipo: "finalizar", dias: [dia], fora: [], abertosAntes: antes };
  render();
}
// Controle do GM no mês: cada lançamento pode ser corrigido (horas, observação) ou retirado; dá para incluir ajustes.
function drawerControle(d) {
  const g = gmPorId(d.gm), m = d.mes, ls = (data.controle || []).filter((c) => c.tipo === "HE" && c.gm === g.id && c.dia.startsWith(m)).sort((a, b) => a.dia.localeCompare(b.dia) || a.ini?.localeCompare(b.ini || ""));
  const l = controleMes(data, m).get(g.id) || {}, prev = previstaMes(data, m).get(g.id) || 0;
  return `<div class="dw-head"><div><p class="eyebrow">Controle de HE · ${nomeMes(m)}</p><h2>${esc(g.nome)}</h2>
    <p class="meta">${fmtHoras(l.he || 0)} no controle${l.transporte ? ` + ${fmtHoras(l.transporte)} do mês anterior` : ""} · ${fmtHoras(l.paga || 0)} a pagar${l.proximo ? ` · ${fmtHoras(l.proximo)} para o próximo mês` : ""}${prev ? ` · ${fmtHoras(prev)} previstas nos dias em aberto` : ""}</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    <p class="dica">Corrija as horas quando o GM não fez a HE toda (ex.: <b>0</b> se faltou). Só os dias finalizados entram aqui.</p>
    ${ls.length ? `<table class="lanc ctl"><thead><tr><th>Dia</th><th>Horário e observação</th><th>Horas</th><th></th></tr></thead><tbody>
      ${ls.map((c) => `<tr class="${c.editado ? "editado" : ""}"><td>${ddmm(c.dia)}</td><td>${c.manual ? "ajuste" : `${c.ini}–${c.fim} <span class="meta">${esc(postoPorId(c.posto)?.nome || "")}${c.fixa ? " · fixa" : ""}</span>`}
          <input class="ctl-o" data-ctl="${c.id}" value="${esc(c.obs || "")}" placeholder="observação (ex.: RH — não compareceu)" aria-label="Observação"></td>
        <td><input class="ctl-h" data-ctl="${c.id}" value="${fmtHoras(c.min).replace("h", ":").replace(/:$/, ":00")}" size="5" inputmode="numeric" aria-label="Horas"></td>
        <td><button class="ic" data-act="ctl-del" data-ctl="${c.id}" title="Tirar do controle" aria-label="Tirar do controle">×</button></td></tr>`).join("")}</tbody></table>` : `<p class="meta">Nada no controle neste mês ainda.</p>`}
    <div class="form linha-ctl"><label>Dia <input type="date" id="ctl-dia" value="${ui.dia.startsWith(m) ? ui.dia : m + "-01"}"></label>
      <label>Horas (use − para descontar) <input id="ctl-h" placeholder="ex.: 6 ou -6" size="6"></label>
      <label>Motivo <input id="ctl-o" placeholder="ex.: correção do RH"></label>
      <button class="btn" data-act="ctl-add">Incluir ajuste</button></div>
  </div>`;
}
// Células editáveis do Mês e horas: digitar o número já corrige o controle
const ajusteDoMes = (gm, mes) => (data.controle || []).find((c) => c.tipo === "HE" && c.ajusteMes === mes && c.gm === gm);
const hhmm = (min) => (min ? `${Math.floor(Math.abs(min) / 60) * Math.sign(min)}:${String(Math.abs(min) % 60).padStart(2, "0")}` : "");
function celHoras(gm, campo, min, manual) {
  const tit = { he: "HE no controle", transporte: "Veio do mês anterior", paga: "A pagar" }[campo];
  return `<input class="cel-h ${manual ? "manual" : ""}" data-cgm="${gm}" data-ccampo="${campo}" value="${hhmm(min)}" placeholder="—" inputmode="numeric" aria-label="${tit}" title="${tit}${manual ? " · ajustado à mão (apague para voltar ao calculado)" : " · digite para ajustar"}">`;
}
function salvarCelHoras(el) {
  const gm = el.dataset.cgm, campo = el.dataset.ccampo, m = ui.mes, txt = el.value.trim(), g = gmPorId(gm);
  const atual = controleMes(data, m).get(gm) || {};
  if (campo === "he") {
    const aj = ajusteDoMes(gm, m), semAjuste = (atual.he || 0) - (aj ? Number(aj.min) : 0);
    const novo = txt ? lerHoras(txt) : semAjuste;
    if (novo === null) { toast("Horas inválidas. Use, por exemplo, 62 ou 62:30."); render(); return; }
    if (novo === atual.he) return;
    mudar(`${g.nome}: HE no controle de ${MESES[Number(m.slice(5)) - 1]} = ${fmtHoras(novo)}`, () => {
      const delta = novo - semAjuste;
      data.controle = (data.controle || []).filter((c) => c !== aj);
      if (delta) data.controle.push({ id: aj?.id || novoId(), tipo: "HE", manual: true, ajusteMes: m, dia: `${m}-01`, gm, min: delta, obs: "ajuste do total no Mês e horas", editado: true });
    });
    return;
  }
  const tipo = campo === "transporte" ? "TRANSPORTE" : "PAGA", ex = (data.controle || []).find((c) => c.tipo === tipo && c.mes === m && c.gm === gm);
  if (!txt) { if (ex) mudar(`${g.nome}: ${campo === "paga" ? "a pagar" : "transporte"} volta ao calculado`, () => { data.controle = data.controle.filter((c) => c !== ex); }); return; }
  const novo = lerHoras(txt);
  if (novo === null || novo < 0) { toast("Horas inválidas. Use, por exemplo, 8 ou 8:30."); render(); return; }
  mudar(`${g.nome}: ${campo === "paga" ? "a pagar" : "veio do mês anterior"} = ${fmtHoras(novo)}`, () => {
    if (ex) ex.min = novo; else (data.controle ||= []).push({ id: novoId(), tipo, mes: m, gm, min: novo });
  });
}
// "6", "6h", "6:30", "6,5", "-6" → minutos
function lerHoras(txt) {
  const t = String(txt || "").trim().replace(/h$/i, "").replace(",", ".");
  if (!t) return null;
  const neg = /^[-−]/.test(t), x = t.replace(/^[-−+]/, "");
  let min;
  if (/^\d{1,3}:\d{2}$/.test(x)) { const [h, m] = x.split(":").map(Number); min = h * 60 + m; }
  else if (/^\d{1,3}(\.\d+)?$/.test(x)) min = Math.round(Number(x) * 60);
  else return null;
  return neg ? -min : min;
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
    <section class="bloco-rem" style="order:9"><h3>Reserva técnica / à disposição (por último)</h3>
    ${remanejar.length ? `<ul class="sug">${remanejar.map((s) => `<li><div class="sg"><b>${esc(s.gm.nome)}</b> <span class="meta">${s.gm.equipe} · está em ${esc(s.origem)} ${fmtHm(s.ini)}–${fmtHm(s.fim)}</span></div><span></span>
      <button class="btn pri" data-act="remanejar" data-gm="${s.gm.id}">Remanejar</button></li>`).join("")}</ul>`
      : `<p class="dica">Ninguém na reserva técnica ou à disposição nesse horário.</p>`}</section>
    <section><h3>Hora extra</h3>
    <fieldset class="horario"><legend>Horário</legend>
      <div class="opts">${opcoes.map(([a, b, l]) => `<button class="opt ${a === d.ini && b === d.fim ? "on" : ""}" data-act="furo-hora" data-ini="${a}" data-fim="${b}">${l}<small>${a}–${b}</small></button>`).join("")}</div>
      <div class="linha"><label>Início <input type="time" id="f-ini" value="${d.ini}"></label><label>Fim <input type="time" id="f-fim" value="${d.fim}"></label>
      <label>Tipo <select id="f-nat"><option value="HE" ${d.nat === "HE" ? "selected" : ""}>Hora extra</option><option value="BH_MAIS" ${d.nat === "BH_MAIS" ? "selected" : ""}>Banco de horas</option></select></label>
      <label>REQ <input id="f-req" value="${esc(d.req || "")}" placeholder="nº" size="6"></label></div>
      <p class="dica">${fmtHoras(fim - ini)} · ${d.nat === "HE" ? "conta no livro de HE do mês" : "crédito no banco de horas"}</p>
    </fieldset></section>
    <div class="busca"><input type="search" id="f-busca" placeholder="Buscar GM" aria-label="Buscar GM"></div>
    <p class="dica">Ordem: escala oposta deste posto, quem já está no posto hoje (estende), depois quem tem menos HE no mês. Quem passou do teto vai para o fim; reserva técnica por último.</p>
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
  const l = { ...controleMes(data, mesDe(ui.dia)).get(g.id), prevista: previstaMes(data, mesDe(ui.dia)).get(g.id) || 0 };
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
  if (acao === "lotacao") form = formHorarioFixo(g, d.desde || ui.dia);
  if (acao === "remanej") form = `<div class="form"><label>Novo posto <select id="r-posto">${opcoesPosto()}</select></label><label>Função <input id="r-fn" placeholder="opcional"></label>
    <div class="linha"><label>De <input type="date" id="r-de" value="${ui.dia}"></label><label>Até <input type="date" id="r-ate" value="${ui.dia}"></label></div>
    <button class="btn pri" data-act="salvar-remanej">Remanejar</button></div>`;
  return `<div class="dw-head"><div><p class="eyebrow">${esc(rotuloEquipe(equipe(g.equipe)))}${g.matricula ? ` · mat. ${esc(g.matricula)}` : ""}</p><h2>${esc(g.nome)}</h2>
    <p class="meta">${esc(rotuloLotacao(g))}</p>${g.naoFazHE ? `<p class="tag-linha"><span class="tag furo">Não realiza HE</span></p>` : ""}${g.obs ? `<p class="meta">${esc(g.obs)}</p>` : ""}</div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    <div class="mini"><div><span class="num">${fmtHoras(l?.he || 0)}</span><span class="meta">HE no controle de ${MESES[Number(mesDe(ui.dia).slice(5)) - 1]}${l.prevista ? ` · +${fmtHoras(l.prevista)} prevista` : ""}</span></div>
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
      <button class="btn ${acao === "lotacao" ? "on" : ""}" data-act="gm-acao" data-acao="lotacao">Lotação e horário fixo…</button>
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
  if (o.tipo === "AREA") return `${esc(p)}: ${esc(o.sub || "sem complemento")}`;
  if (o.tipo === "VAGAS") return `${esc(p)}: vagas do dia`;
  if (o.tipo === "FUNCAO") return esc(o.funcao || "sem função");
  if (o.tipo === "SEM_HE_REC") return "HE recorrente suspensa";
  if (o.tipo === "CURSO") return esc([o.curso, o.local].filter(Boolean).join(" · "));
  return o.obs ? esc(o.obs) : "";
}
// ---------- LANÇAMENTOS em seções ----------
const ABAS_LANC = [["ferias", "Férias"], ["cursos", "Cursos"], ["folgas", "Folgas"], ["trocas", "Trocas de serviço"], ["atestados", "Atestados e licenças"], ["avisos", "Avisos e observações"], ["todos", "Todos os lançamentos"]];
const cobreMes = (o, m) => o.de.slice(0, 7) <= m && (o.ate || o.de).slice(0, 7) >= m;
const diasEntre = (a, b) => Math.round((parseData(b) - parseData(a)) / 864e5) + 1;
function vLancamentos() {
  const L = (ui.lanc ||= { aba: "ferias", sel: [] }), m = ui.filtroLanc.mes;
  if (ui.filtroLanc.req) L.aba = "todos"; // "Ver tudo do REQ" abre a lista completa filtrada
  const corpo = { ferias: lancFerias, cursos: lancCursos, folgas: lancFolgas, trocas: lancTrocas, atestados: lancAtestados, avisos: lancAvisos, todos: vLancTodos }[L.aba]();
  return `${L.aba === "todos" ? "" : `<div class="barra"><div class="datas"><button class="ic" data-act="lmes" data-n="-1" aria-label="Mês anterior">‹</button><h2 class="titulo-mes">${nomeMes(m)}</h2><button class="ic" data-act="lmes" data-n="1" aria-label="Próximo mês">›</button></div></div>`}
  <div class="abas-pad" role="tablist">${ABAS_LANC.map(([k, t]) => `<button role="tab" aria-selected="${L.aba === k}" data-act="lanc-aba" data-aba="${k}">${t}</button>`).join("")}</div>
  ${corpo}`;
}
// escolher vários GMs: campo com sugestões + etiquetas
function seletorGms(id, rotulo) {
  const L = ui.lanc;
  return `<div class="sel-gms"><label>${rotulo} <input id="${id}" list="lg-nomes" placeholder="digite o nome e Enter" autocomplete="off"></label>
    <datalist id="lg-nomes">${data.gms.filter((g) => g.ativo !== false).map((g) => `<option value="${esc(g.nome)}">`).join("")}</datalist>
    <div class="chips-gm">${chipsSel()}</div></div>`;
}
const chipsSel = () => ui.lanc.sel.map((g) => `<span class="chip-gm">${esc(nomeGm(g))}<button class="ic" data-act="lg-tirar" data-gm="${g}" aria-label="Tirar ${esc(nomeGm(g))}">×</button></span>`).join("") || `<span class="meta">nenhum GM escolhido</span>`;
// atualiza só as etiquetas, sem apagar o resto do formulário
const redesenharSel = () => { const c = document.querySelector(".chips-gm"); if (c) c.innerHTML = chipsSel(); };
// faixa do mês: um quadradinho por dia, pintado nos dias do período
function faixaMes(m, periodos, cls) {
  return `<div class="faixa-mes">${diasDoMes(m).map((d) => `<i class="${periodos.some(([a, b]) => a <= d && d <= b) ? cls : ""} ${[0, 6].includes(diaSemana(d)) ? "fds" : ""}" title="${ddmm(d)}"></i>`).join("")}</div>`;
}
const btnExcluir = (o) => (ui.confirmar === o.id ? `<button class="btn perigo" data-act="apagar" data-id="${o.id}">Confirmar</button>` : `<button class="link" data-act="pre-apagar" data-id="${o.id}">Excluir</button>`);
function lancFerias() {
  const m = ui.filtroLanc.mes, fs = data.ocorrencias.filter((o) => o.tipo === "FERIAS" && cobreMes(o, m)).sort((a, b) => a.de.localeCompare(b.de) || nomeGm(a.gm).localeCompare(nomeGm(b.gm)));
  const declarou = data.ocorrencias.filter((o) => o.tipo === "DISP_FERIAS" && o.de.startsWith(m) && !fs.some((f) => f.gm === o.gm));
  return `<div class="cols-lanc"><section class="painel form-lanc"><h2>Lançar férias</h2>
    <p class="dica">Escolha um ou vários GMs com o mesmo período. Nos dias de férias o GM sai da escala sozinho.</p>
    ${seletorGms("lg-gm", "GMs")}
    <div class="linha"><label>De <input type="date" id="lg-de" value="${m}-01"></label><label>Até <input type="date" id="lg-ate" value="${somaDias(m + "-01", 29)}"></label></div>
    <label>REQ <input id="lg-req" placeholder="opcional"></label><label>Observação <input id="lg-obs" placeholder="opcional"></label>
    <button class="btn pri" data-act="lg-lancar" data-tipo="FERIAS">Lançar férias</button></section>
  <section class="painel"><h2>Férias em ${nomeMes(m).toLowerCase()} <span class="n">${fs.length}</span></h2>
    ${declarou.length ? `<p class="aviso-falta">Declararam férias no sistema de folgas, mas ainda não têm férias lançadas: ${declarou.map((o) => `<b>${esc(nomeGm(o.gm))}</b>`).join(", ")}.</p>` : ""}
    ${fs.length ? `<div class="tabela-wrap"><table class="lanc lanc-per"><thead><tr><th>GM</th><th>Período</th><th>Dias</th><th class="faixa-th">${nomeMes(m)}</th><th>REQ</th><th></th></tr></thead><tbody>
      ${fs.map((o) => `<tr data-nome="${esc(nomeGm(o.gm).toLowerCase())}"><td><button class="link" data-act="abrir-ficha" data-gm="${o.gm}">${esc(nomeGm(o.gm))}</button></td>
        <td class="num"><input type="date" class="lg-data" data-oc="${o.id}" data-campo="de" value="${o.de}"> a <input type="date" class="lg-data" data-oc="${o.id}" data-campo="ate" value="${o.ate || o.de}"></td>
        <td class="num">${diasEntre(o.de, o.ate || o.de)}</td><td>${faixaMes(m, [[o.de, o.ate || o.de]], "fe")}</td><td class="num">${esc(o.req || "")}</td><td>${btnExcluir(o)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="meta">Ninguém de férias neste mês.</p>`}</section></div>`;
}
function lancCursos() {
  const m = ui.filtroLanc.mes, cs = data.ocorrencias.filter((o) => o.tipo === "CURSO" && cobreMes(o, m));
  const grupos = new Map();
  for (const o of cs) { const k = o.curso || "Curso sem nome"; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(o); }
  return `<div class="cols-lanc"><section class="painel form-lanc"><h2>Lançar curso</h2>
    <p class="dica">Um curso com vários GMs. Nos dias do curso o GM sai da escala. Depois dá para mudar o período de cada um.</p>
    <label>Nome do curso <input id="lc-nome" list="lc-cursos" placeholder="ex.: Reciclagem de tiro"><datalist id="lc-cursos">${[...new Set(data.ocorrencias.filter((o) => o.curso).map((o) => o.curso))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label>Local / detalhes <input id="lc-local" placeholder="opcional"></label>
    ${seletorGms("lg-gm", "GMs")}
    <div class="linha"><label>De <input type="date" id="lg-de" value="${m}-01"></label><label>Até <input type="date" id="lg-ate" value="${m}-01"></label></div>
    <label>REQ <input id="lg-req" placeholder="opcional"></label>
    <button class="btn pri" data-act="lg-lancar" data-tipo="CURSO">Lançar curso</button></section>
  <section class="painel"><h2>Cursos em ${nomeMes(m).toLowerCase()} <span class="n">${grupos.size}</span></h2>
    ${[...grupos].map(([nome, os]) => `<div class="curso-card"><header><b>${esc(nome)}</b>${os[0].local ? ` <span class="meta">· ${esc(os[0].local)}</span>` : ""}<span class="meta"> · ${os.length} GM${os.length === 1 ? "" : "s"}</span>
        <button class="link" data-act="lc-mais" data-curso="${esc(nome)}">+ GM neste curso</button></header>
      <table class="lanc lanc-per"><tbody>${os.sort((a, b) => nomeGm(a.gm).localeCompare(nomeGm(b.gm))).map((o) => `<tr><td><button class="link" data-act="abrir-ficha" data-gm="${o.gm}">${esc(nomeGm(o.gm))}</button></td>
        <td class="num"><input type="date" class="lg-data" data-oc="${o.id}" data-campo="de" value="${o.de}"> a <input type="date" class="lg-data" data-oc="${o.id}" data-campo="ate" value="${o.ate || o.de}"></td>
        <td>${faixaMes(m, [[o.de, o.ate || o.de]], "cu")}</td><td>${btnExcluir(o)}</td></tr>`).join("")}</tbody></table></div>`).join("") || `<p class="meta">Nenhum curso neste mês.</p>`}</section></div>`;
}
// Troca de serviço: A trabalha no lugar de B num dia, e B devolve trabalhando no lugar de A em outro dia (mesmo REQ).
function servicoDe(gm, dia) { return calcularDia(data, dia).designacoes.filter((d) => d.gm === gm && (d.origem === "base" || d.nat === "troca") && d.nat !== "he"); }
function checarTroca(a, b, dia) {
  if (!a || !b || !dia) return "";
  const sa = servicoDe(a, dia), sb = calcularDia(data, dia).designacoes.filter((d) => d.gm === b && sa.some((x) => sobrepoe(x.ini, x.fim, d.ini, d.fim) > 0));
  if (!sa.length) return `${nomeGm(a)} não está escalado em ${ddmm(dia)}`;
  if (sb.length) return `${nomeGm(b)} já trabalha nesse horário em ${ddmm(dia)}`;
  return `${nomeGm(b)} cobre ${fmtHm(sa[0].ini)}–${fmtHm(sa.at(-1).fim)} em ${postoPorId(sa[0].posto)?.nome || "—"}`;
}
function lancTrocas() {
  const m = ui.filtroLanc.mes, ts = data.ocorrencias.filter((o) => o.tipo === "TROCA" && o.de.startsWith(m)).sort((a, b) => a.de.localeCompare(b.de));
  const pares = new Map();
  for (const o of ts) { const k = o.par || o.id; if (!pares.has(k)) pares.set(k, []); pares.get(k).push(o); }
  const t = (ui.lanc.troca ||= {});
  return `<div class="cols-lanc"><section class="painel form-lanc"><h2>Lançar troca de serviço</h2>
    <p class="dica">Um GM trabalha no lugar do outro num dia e, se for o caso, o outro devolve em outro dia. Na escala, quem cobre aparece no lugar de quem saiu, sem hora extra.</p>
    <div class="linha"><label>GM que sai <input id="tr-a" list="lg-nomes" value="${esc(t.a ? nomeGm(t.a) : "")}" placeholder="nome"></label><label>GM que cobre <input id="tr-b" list="lg-nomes" value="${esc(t.b ? nomeGm(t.b) : "")}" placeholder="nome"></label></div>
    <datalist id="lg-nomes">${data.gms.filter((g) => g.ativo !== false).map((g) => `<option value="${esc(g.nome)}">`).join("")}</datalist>
    <label>Dia do serviço de quem sai <input type="date" id="tr-dia1" value="${t.dia1 || ""}"></label>
    <p class="meta" id="tr-chk1">${esc(checarTroca(t.a, t.b, t.dia1))}</p>
    <label class="toggle"><input type="checkbox" id="tr-volta" ${t.volta !== false ? "checked" : ""}> Com devolução (o outro paga em outro dia)</label>
    <div id="tr-volta-campos" ${t.volta === false ? "hidden" : ""}><label>Dia em que o serviço é devolvido <input type="date" id="tr-dia2" value="${t.dia2 || ""}"></label>
    <p class="meta" id="tr-chk2">${esc(checarTroca(t.b, t.a, t.dia2))}</p></div>
    <label>REQ <input id="tr-req" value="${esc(t.req || "")}" placeholder="número do requerimento"></label>
    <button class="btn pri" data-act="tr-lancar">Lançar troca</button></section>
  <section class="painel"><h2>Trocas em ${nomeMes(m).toLowerCase()} <span class="n">${pares.size}</span></h2>
    ${pares.size ? `<div class="tabela-wrap"><table class="lanc"><thead><tr><th>Dia</th><th>Sai</th><th>Cobre</th><th>Devolução</th><th>REQ</th><th></th></tr></thead><tbody>
      ${[...pares.values()].map((os) => { const [x, y] = os; return `<tr><td class="num">${ddmm(x.de)}</td><td>${esc(nomeGm(x.gm))}</td><td>${esc(nomeGm(x.substituto))}</td>
        <td class="num">${y ? `${ddmm(y.de)}: ${esc(nomeGm(y.substituto))} cobre ${esc(nomeGm(y.gm))}` : `<span class="meta">sem devolução</span>`}</td><td class="num">${esc(x.req || "")}</td>
        <td>${ui.confirmar === x.id ? `<button class="btn perigo" data-act="tr-apagar" data-par="${esc(x.par || x.id)}">Confirmar</button>` : `<button class="link" data-act="pre-apagar" data-id="${x.id}">Excluir</button>`}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="meta">Nenhuma troca neste mês.</p>`}</section></div>`;
}
// Avisos e observações: aparecem no quadro do dia (e, se marcado, na folha) e podem ser dados como lidos
const avisosDoDia = (dia) => data.ocorrencias.filter((o) => o.tipo === "AVISO" && o.de <= dia && dia <= (o.ate || o.de));
const avisoLido = (o, dia) => (o.lidos || []).includes(dia);
function lancAvisos() {
  const m = ui.filtroLanc.mes, as = data.ocorrencias.filter((o) => o.tipo === "AVISO" && cobreMes(o, m)).sort((a, b) => a.de.localeCompare(b.de));
  const ed = ui.lanc.avisoEd ? data.ocorrencias.find((o) => o.id === ui.lanc.avisoEd) : null;
  return `<div class="cols-lanc"><section class="painel form-lanc"><h2>${ed ? "Editar aviso" : "Novo aviso"}</h2>
    <p class="dica">Fica em destaque no topo do quadro do dia (ou de cada dia do período) até alguém marcar como lido.</p>
    <div class="linha"><label>De <input type="date" id="av-de" value="${ed?.de || ui.dia}"></label><label>Até <input type="date" id="av-ate" value="${ed?.ate || ed?.de || ui.dia}"></label></div>
    <label>Aviso <textarea id="av-txt" rows="4" placeholder="ex.: Visita do prefeito à sede às 10h · VTR 1317 vai para revisão às 14h">${esc(ed?.texto || "")}</textarea></label>
    <label class="toggle"><input type="checkbox" id="av-folha" ${ed?.folha ? "checked" : ""}> Sair também na folha impressa</label>
    <div class="linha"><button class="btn pri" data-act="av-salvar">${ed ? "Salvar" : "Lançar aviso"}</button>${ed ? `<button class="link" data-act="av-cancelar">cancelar</button>` : ""}</div></section>
  <section class="painel"><h2>Avisos em ${nomeMes(m).toLowerCase()} <span class="n">${as.length}</span></h2>
    ${as.length ? `<ul class="avisos-lista">${as.map((o) => { const dias = []; for (let d = o.de; d <= (o.ate || o.de); d = somaDias(d, 1)) dias.push(d); const lidos = dias.filter((d) => avisoLido(o, d)).length;
      return `<li><div class="av-cab"><span class="num">${ddmm(o.de)}${o.ate && o.ate !== o.de ? ` a ${ddmm(o.ate)}` : ""}</span>${o.folha ? `<span class="tag rem">na folha</span>` : ""}<span class="av-lido ${lidos === dias.length ? "ok" : ""}">${lidos === dias.length ? "✓ lido" : lidos ? `lido em ${lidos} de ${dias.length} dias` : "não lido"}</span>
        <button class="link" data-act="av-editar" data-id="${o.id}">editar</button>${btnExcluir(o)}</div><p>${esc(o.texto)}</p></li>`; }).join("")}</ul>` : `<p class="meta">Nenhum aviso neste mês.</p>`}</section></div>`;
}
function lancAtestados() {
  const m = ui.filtroLanc.mes, as = data.ocorrencias.filter((o) => ["ATESTADO", "LICENCA"].includes(o.tipo) && cobreMes(o, m)).sort((a, b) => a.de.localeCompare(b.de));
  return `<div class="cols-lanc"><section class="painel form-lanc"><h2>Lançar atestado ou licença</h2>
    ${seletorGms("lg-gm", "GM")}
    <label>Tipo <select id="la-tipo"><option value="ATESTADO">Atestado</option><option value="LICENCA">Licença</option></select></label>
    <div class="linha"><label>De <input type="date" id="lg-de" value="${ui.dia.startsWith(m) ? ui.dia : m + "-01"}"></label><label>Até <input type="date" id="lg-ate" value="${ui.dia.startsWith(m) ? ui.dia : m + "-01"}"></label></div>
    <label>REQ <input id="lg-req" placeholder="opcional"></label><label>Observação <input id="lg-obs" placeholder="ex.: licença-saúde"></label>
    <button class="btn pri" data-act="lg-lancar" data-tipo="ATESTADO">Lançar</button></section>
  <section class="painel"><h2>Atestados e licenças em ${nomeMes(m).toLowerCase()} <span class="n">${as.length}</span></h2>
    ${as.length ? `<div class="tabela-wrap"><table class="lanc lanc-per"><thead><tr><th>GM</th><th>Tipo</th><th>Período</th><th>Dias</th><th class="faixa-th">${nomeMes(m)}</th><th>REQ / obs</th><th></th></tr></thead><tbody>
      ${as.map((o) => `<tr><td><button class="link" data-act="abrir-ficha" data-gm="${o.gm}">${esc(nomeGm(o.gm))}</button></td><td>${esc(TIPOS[o.tipo])}</td>
        <td class="num"><input type="date" class="lg-data" data-oc="${o.id}" data-campo="de" value="${o.de}"> a <input type="date" class="lg-data" data-oc="${o.id}" data-campo="ate" value="${o.ate || o.de}"></td>
        <td class="num">${diasEntre(o.de, o.ate || o.de)}</td><td>${faixaMes(m, [[o.de, o.ate || o.de]], "at")}</td><td>${esc([o.req, o.obs].filter(Boolean).join(" · "))}</td><td>${btnExcluir(o)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Nenhum atestado ou licença neste mês.</p>`}</section></div>`;
}
function lancFolgas() {
  const m = ui.filtroLanc.mes, L = ui.lanc;
  const fs = data.ocorrencias.filter((o) => o.tipo === "FOLGA" && o.de.startsWith(m));
  const disp = data.ocorrencias.filter((o) => o.tipo === "DISP_HE" && o.de.startsWith(m));
  const porGm = new Map();
  for (const o of fs) { if (!porGm.has(o.gm)) porGm.set(o.gm, []); porGm.get(o.gm).push(o); }
  const alternados = data.gms.filter((g) => g.ativo !== false && equipe(vigente(g, m + "-15").equipe)?.tipo === "alternado");
  const faltam = alternados.filter((g) => (porGm.get(g.id) || []).length < 2);
  const imp = L.import;
  return `<div class="cols-lanc largo"><section class="painel form-lanc"><h2>Sistema de Folgas</h2>
    <p class="dica">No Sistema de Folgas, exporte o CSV da competência e escolha o arquivo aqui. As folgas entram na escala, e quem se ofereceu para HE passa a aparecer primeiro nas sugestões daquele dia.</p>
    ${SERVIDOR ? `<button class="btn pri" data-act="fg-buscar">Buscar do Sistema de Folgas (${MESES[Number(m.slice(5)) - 1]})</button><p class="dica">Consulta direto o Sistema de Folgas, só para leitura. Depois de aplicar uma vez, a escala avisa (selo no topo) quando algo mudar lá.</p>
    ${syncFolgas.comp[m]?.situacao === "OPEN" ? `<p class="meta">Escolha de folgas aberta no sistema${syncFolgas.comp[m].fecha ? ` até ${ddmm(syncFolgas.comp[m].fecha.slice(0, 10))}` : ""}: o ideal é trazer depois que fechar.</p>` : ""}
    ${data.folgasSync?.[m] ? `<p class="meta">Sincronizado com o Sistema de Folgas · ${Object.keys(data.folgasSync[m].linhas).length} pedidos. <button class="link" data-act="fm-conferir">Conferir alterações agora</button></p>` : ""}
    <details><summary class="meta">ou importar o arquivo CSV</summary>` : ""}
    <label class="arq">Arquivo CSV <input type="file" id="fg-arq" accept=".csv,text/csv"></label>${SERVIDOR ? "</details>" : ""}
    ${imp ? `<div class="prev-imp">${imp.competencia ? `<p class="meta">Competência <b>${esc(imp.competencia.rotulo || imp.competencia.mes)}</b> · ${esc({ OPEN: "escolha aberta", CLOSED: "escolha encerrada", CONSOLIDATED: "consolidada", SCHEDULED: "escolha ainda não abriu", DRAFT: "rascunho" }[imp.competencia.situacao] || imp.competencia.situacao)}</p>
      ${imp.competencia.situacao === "OPEN" ? `<p class="aviso-falta">A escolha de folgas ainda está aberta${imp.competencia.fecha ? ` até ${ddmm(imp.competencia.fecha.slice(0, 10))}` : ""}: os GMs ainda podem mudar. Dá para aplicar agora, mas a escala só vai avisar as mudanças depois que a escolha fechar.</p>` : ""}` : ""}<p><b>${imp.linhas.length}</b> GMs ${imp.competencia ? "no Sistema de Folgas" : "no arquivo"} · <b>${imp.linhas.filter((x) => x.gm).length}</b> encontrados${imp.linhas.some((x) => !x.gm) ? ` · <b class="ruim">${imp.linhas.filter((x) => !x.gm).length}</b> sem correspondência` : ""}</p>
      <table class="lanc"><thead><tr><th>No arquivo</th><th>Na escala</th><th>Folgas</th><th>HE</th></tr></thead><tbody>${imp.linhas.map((x, i) => `<tr class="${x.gm ? "" : "sem-par"}"><td>${esc(x.nome)}</td>
        <td><select data-imp="${i}"><option value="">— ignorar —</option>${data.gms.filter((g) => g.ativo !== false).map((g) => `<option value="${g.id}" ${g.id === x.gm ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}</select></td>
        <td class="num">${x.folgas.map(ddmm).join(", ")}${x.ferias ? " · férias" : ""}</td><td class="num">${x.he.length || ""}</td></tr>`).join("")}</tbody></table>
      <button class="btn pri" data-act="fg-aplicar">Aplicar na escala</button> <button class="link" data-act="fg-cancelar">Cancelar</button>
      <p class="dica">Aplicar de novo substitui o que veio do sistema de folgas nesses dias (folgas lançadas à mão ficam).</p></div>` : ""}
    <h3>Folga lançada à mão</h3>${seletorGms("lg-gm", "GM")}<label>Dia <input type="date" id="lg-de" value="${ui.dia.startsWith(m) ? ui.dia : m + "-01"}"></label>
    <button class="btn" data-act="lg-lancar" data-tipo="FOLGA">Lançar folga</button></section>
  <section class="painel"><h2>Folgas em ${nomeMes(m).toLowerCase()} <span class="n">${fs.length}</span></h2>
    ${faltam.length ? `<p class="aviso-falta">${faltam.length} GM${faltam.length === 1 ? "" : "s"} 12x36 com menos de 2 folgas: ${faltam.slice(0, 12).map((g) => esc(g.nome)).join(", ")}${faltam.length > 12 ? "…" : ""}</p>` : ""}
    ${porGm.size ? `<div class="tabela-wrap"><table class="lanc"><thead><tr><th>GM</th><th>Folgas</th><th>Origem</th><th>Disponível p/ HE</th></tr></thead><tbody>
      ${[...porGm].sort((a, b) => nomeGm(a[0]).localeCompare(nomeGm(b[0]))).map(([g, os]) => `<tr data-nome="${esc(nomeGm(g).toLowerCase())}"><td><button class="link" data-act="abrir-ficha" data-gm="${g}">${esc(nomeGm(g))}</button></td>
        <td>${os.sort((a, b) => a.de.localeCompare(b.de)).map((o) => `<span class="chip-gm">${ddmm(o.de)}<button class="ic" data-act="pre-apagar" data-id="${o.id}" aria-label="Excluir folga">×</button></span>`).join("")}${os.some((o) => ui.confirmar === o.id) ? `<button class="btn perigo" data-act="apagar" data-id="${ui.confirmar}">Confirmar exclusão</button>` : ""}</td>
        <td class="meta">${os.some((o) => o.origem === "folgas-gmnh") ? `Sistema de Folgas${os[0].req ? ` · ${esc(os[0].req)}` : ""}` : "à mão"}</td>
        <td class="num meta">${disp.filter((o) => o.gm === g).map((o) => ddmm(o.de)).join(", ")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Nenhuma folga lançada neste mês.</p>`}</section></div>`;
}
// ---------- SINCRONIA COM O SISTEMA DE FOLGAS ----------
// O Sistema de Folgas é a fonte das folgas. data.folgasSync[mes] guarda o que já foi aplicado (ou ignorado) de cada pedido:
// { em, linhas: { idNoSistema: { versao, nome, gm, folgas, he, ferias, protocolo } } }. A escala só avisa o que mudou desde então.
// Escolha de folgas: no mês anterior (mais ou menos de 15 a 25) os GMs mudam à vontade; depois, só por solicitação.
// Enquanto a escolha está aberta a escala não avisa cada mudança; quando fecha, avisa que dá para trazer.
const syncFolgas = { mudancas: [], buscando: false, em: 0, comp: {}, prontos: [] };
const igualLista = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
const folgasDoSistemaNaEscala = (gm, mes) => data.ocorrencias.filter((o) => o.tipo === "FOLGA" && o.gm === gm && o.origem === "folgas-gmnh" && o.de.startsWith(mes)).map((o) => o.de).sort();
function diffFolgas(mes, linhas) {
  const snap = data.folgasSync?.[mes];
  if (!snap) return [];
  const out = [], vistos = new Set();
  const local = (gm, antes) => (gm && !igualLista(folgasDoSistemaNaEscala(gm, mes), antes) ? folgasDoSistemaNaEscala(gm, mes) : null);
  for (const l of linhas) {
    vistos.add(l.fgId);
    const a = snap.linhas[l.fgId];
    if (a && igualLista(a.folgas, l.folgas) && igualLista(a.he, l.he)) continue;
    const gm = a?.gm || acharGmPorNome(l.nome)?.id || "";
    out.push({ mes, fgId: l.fgId, nome: l.nome, gm, antes: a?.folgas || [], depois: l.folgas, heAntes: a?.he || [], heDepois: l.he, novo: !a, linha: l, local: local(gm, a?.folgas || []) });
  }
  for (const [id, a] of Object.entries(snap.linhas)) if (!vistos.has(id) && (a.folgas.length || a.he.length))
    out.push({ mes, fgId: id, nome: a.nome, gm: a.gm, antes: a.folgas, depois: [], heAntes: a.he, heDepois: [], excluido: true, linha: null, local: local(a.gm, a.folgas) });
  return out.filter((x) => !igualLista(x.antes, x.depois) || !igualLista(x.heAntes, x.heDepois));
}
// confere ao abrir a escala, no máximo uma vez por hora (o resultado fica guardado neste navegador)
async function conferirFolgas(forcar) {
  if (!SERVIDOR || syncFolgas.buscando) return;
  const atual = mesDe(hojeBase());
  const meses = [...new Set([...Object.keys(data.folgasSync || {}).filter((m) => m >= atual), atual, mesSeguinte(atual)])].sort().slice(0, 3);
  const usar = (res) => {
    syncFolgas.comp = Object.fromEntries(Object.entries(res).map(([m, r]) => [m, r.competencia]));
    // durante a escolha aberta não avisa cada mudança
    syncFolgas.mudancas = Object.entries(res).filter(([, r]) => r.competencia?.situacao !== "OPEN").flatMap(([m, r]) => diffFolgas(m, r.linhas));
    syncFolgas.prontos = Object.entries(res).filter(([m, r]) => !data.folgasSync?.[m] && ["CLOSED", "CONSOLIDATED"].includes(r.competencia?.situacao)).map(([m]) => m);
  };
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem("folgas-cache2") || "null"); } catch { /* sem armazenamento */ }
  if (!forcar && cache && Date.now() - cache.em < 3600e3 && meses.every((m) => m in cache.meses)) { usar(Object.fromEntries(Object.entries(cache.meses).filter(([, r]) => r))); syncFolgas.em = cache.em; mostrarSeloFolgas(); return; }
  syncFolgas.buscando = true;
  try {
    const res = {};
    for (const m of meses) { const { status, corpo } = await api(`/api/folgas?mes=${m}`); res[m] = status === 200 ? { linhas: corpo.linhas, competencia: corpo.competencia } : null; }
    syncFolgas.em = Date.now();
    try { localStorage.setItem("folgas-cache2", JSON.stringify({ em: syncFolgas.em, meses: res })); } catch { /* ignora */ }
    usar(Object.fromEntries(Object.entries(res).filter(([, r]) => r)));
  } catch { /* sem conexão: tenta na próxima vez */ }
  syncFolgas.buscando = false;
  mostrarSeloFolgas();
  if (ui.drawer?.tipo === "folgasmud") render();
}
// só para os testes automáticos (página aberta como arquivo local)
if (typeof location !== "undefined" && location.protocol === "file:") window.__testeFolgas = { diffFolgas, registrarFolgas, syncFolgas, get data() { return data; }, render: () => { mostrarSeloFolgas(); render(); } };
function mostrarSeloFolgas() {
  const el = $("#selo-folgas"); if (!el) return;
  // recalcula com o que está guardado (o escalante pode ter aplicado algo em outra aba)
  const n = syncFolgas.mudancas.length, pr = syncFolgas.prontos;
  el.hidden = !n && !pr.length;
  el.textContent = n ? `Folgas: ${n} alteraç${n === 1 ? "ão" : "ões"}` : `Folgas de ${MESES[Number(pr[0]?.slice(5)) - 1]} prontas para trazer`;
}
// o que a mudança causa na escala
function efeitoMudanca(x) {
  if (!x.gm) return "GM não encontrado na escala";
  const ent = x.depois.filter((d) => !x.antes.includes(d)), sai = x.antes.filter((d) => !x.depois.includes(d)), fx = [];
  for (const d of ent) { const des = calcularDia(data, d).designacoes.find((y) => y.gm === x.gm && y.posto && y.nat !== "he"); fx.push(des ? `abre vaga em ${postoPorId(des.posto)?.nome} (${ddmm(d)})` : `folga em ${ddmm(d)}`); }
  for (const d of sai) fx.push(trabalhaNoDia(data, gmPorId(x.gm), d) ? `volta a trabalhar em ${ddmm(d)}` : `sai a folga de ${ddmm(d)}`);
  const he = x.heDepois.filter((d) => !x.heAntes.includes(d)).length;
  if (he) fx.push(`+${he} dia${he === 1 ? "" : "s"} disponível para HE`);
  return fx.join(" · ");
}
function registrarFolgas(x) {
  const s = ((data.folgasSync ||= {})[x.mes] ||= { linhas: {} });
  s.em = new Date().toISOString();
  if (x.excluido) delete s.linhas[x.fgId];
  else s.linhas[x.fgId] = { versao: x.linha.versao, nome: x.linha.nome, gm: x.gm, folgas: x.depois, he: x.heDepois, ferias: !!x.linha.ferias, protocolo: x.linha.protocolo || "" };
}
function aplicarFolgasNaEscala(x) {
  if (!x.gm) return;
  data.ocorrencias = data.ocorrencias.filter((o) => !(o.gm === x.gm && o.origem === "folgas-gmnh" && ["FOLGA", "DISP_HE"].includes(o.tipo) && o.de.startsWith(x.mes)));
  for (const d of x.depois) if (!data.ocorrencias.some((o) => o.tipo === "FOLGA" && o.gm === x.gm && o.de === d)) data.ocorrencias.push({ id: novoId(), tipo: "FOLGA", gm: x.gm, de: d, origem: "folgas-gmnh", ...(x.linha?.protocolo ? { req: x.linha.protocolo } : {}) });
  for (const d of x.heDepois) data.ocorrencias.push({ id: novoId(), tipo: "DISP_HE", gm: x.gm, de: d, origem: "folgas-gmnh" });
}
function drawerFolgasMud() {
  const ms = syncFolgas.mudancas, lista = (ds) => (ds.length ? ds.map(ddmm).join(", ") : "—");
  return `<div class="dw-head"><div><p class="eyebrow">Sistema de Folgas</p><h2>${ms.length} alteraç${ms.length === 1 ? "ão" : "ões"}</h2>
    <p class="meta">O que mudou no Sistema de Folgas desde a última vez que foi aplicado na escala${syncFolgas.em ? ` · conferido às ${new Date(syncFolgas.em).toTimeString().slice(0, 5)}` : ""}. Nada muda na escala até você aplicar.</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    ${ms.length ? `<div class="linha"><button class="btn pri" data-act="fm-todas">Aplicar todas</button><button class="link" data-act="fm-conferir">Conferir de novo</button></div>
    <ul class="fm-lista">${ms.map((x, i) => `<li class="${x.local ? "conflito" : ""}"><div class="fm-cab"><b>${esc(x.gm ? nomeGm(x.gm) : x.nome)}</b> <span class="meta">${x.novo ? "pedido novo" : x.excluido ? "pedido excluído no sistema" : "pedido alterado"} · ${MESES[Number(x.mes.slice(5)) - 1]}</span></div>
      <div class="fm-dif">Folgas: <s>${lista(x.antes)}</s> → <b>${lista(x.depois)}</b>${!igualLista(x.heAntes, x.heDepois) ? `<br><span class="meta">Disponível para HE: ${lista(x.heDepois)}</span>` : ""}</div>
      ${x.local ? `<div class="fm-local">Na escala estava diferente (alterada à mão): <b>${lista(x.local)}</b></div>` : ""}
      <div class="fm-efeito">${esc(efeitoMudanca(x))}</div>
      <div class="linha">${x.gm ? `<button class="btn" data-act="fm-aplicar" data-i="${i}">${x.local ? "Usar o do sistema" : "Aplicar"}</button>` : ""}<button class="link" data-act="fm-ignorar" data-i="${i}">${x.local ? "Manter o da escala" : "Ignorar"}</button></div></li>`).join("")}</ul>`
    : `<p class="tudo-ok">Escala e Sistema de Folgas estão iguais.</p><button class="link" data-act="fm-conferir">Conferir de novo</button>`}
  </div>`;
}
// nome vindo de outro sistema → GM da escala (igual, ou contido sem ambiguidade)
function acharGmPorNome(nome) {
  const n = norm(nome), ativos = data.gms.filter((g) => g.ativo !== false);
  return ativos.find((g) => norm(g.nome) === n) || (() => { const c = ativos.filter((g) => n.split(" ").includes(norm(g.nome)) || norm(g.nome).split(" ").includes(n)); return c.length === 1 ? c[0] : null; })();
}
// lê o CSV do Sistema de Folgas: "NOME DO GM";"FOLGA 1";"FOLGA 2";"FÉRIAS NO MÊS";"DISPONIBILIDADE HORA EXTRA";"PROTOCOLO";"VERSÃO"
function lerCsvFolgas(txt) {
  const linhas = txt.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const cel = (l) => (l.match(/("([^"]|"")*"|[^;]*)(;|$)/g) || []).map((c) => c.replace(/;$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').replace(/^'/, "").trim()).slice(0, -1).concat([]);
  const cab = cel(linhas[0]).map((c) => norm(c));
  const col = (nome) => cab.findIndex((c) => c.includes(norm(nome)));
  const iN = col("nome"), iF = cab.map((c, i) => (c.startsWith("folga") ? i : -1)).filter((i) => i >= 0), iFe = col("ferias"), iHe = col("hora extra"), iP = col("protocolo");
  if (iN < 0) return null;
  const achar = acharGmPorNome;
  const iso = (v) => { const t = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const b = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return b ? `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}` : ""; };
  return { linhas: linhas.slice(1).map((l) => { const c = cel(l), g = achar(c[iN] || "");
    return { nome: c[iN] || "", gm: g?.id || "", folgas: iF.map((i) => iso(c[i])).filter(Boolean), ferias: iFe >= 0 && /^sim$/i.test(c[iFe] || ""), he: iHe >= 0 ? (c[iHe] || "").split(/[,\s]+/).map(iso).filter(Boolean) : [], protocolo: iP >= 0 ? c[iP] || "" : "" }; }).filter((x) => x.nome) };
}
function vLancTodos() {
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
// Horas que passam do mês anterior (acima do teto): confere e confirma de uma vez, corrigindo só o que divergir
function anteriorDe(m) { const [y, mm] = m.split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; }
function painelTransporte(m) {
  const ant = anteriorDe(m), conf = data.config.transporteConfirmado?.[m];
  if (ant < (data.config.mesInicial || ant)) return "";
  const calc = controleMes(data, ant), atual = controleMes(data, m);
  const lista = data.gms.filter((g) => (calc.get(g.id)?.proximo || 0) > 0 || atual.get(g.id)?.manual?.transporte);
  if (!lista.length) return "";
  const nomeAnt = MESES[Number(ant.slice(5)) - 1];
  if (conf && !ui.verTransporte) return `<p class="transp-ok">✓ Horas que vieram de ${nomeAnt} confirmadas${conf.quem ? ` por ${esc(conf.quem)}` : ""} em ${ddmm(conf.em.slice(0, 10))} · ${lista.length} GM${lista.length === 1 ? "" : "s"} · <button class="link" data-act="tr-rever">rever</button></p>`;
  return `<section class="painel transp"><div class="transp-cab"><h3>Horas que vieram de ${nomeAnt}</h3><span class="meta">Passaram do teto de ${data.config.tetoHE}h em ${nomeAnt}. Confira e corrija só quem tiver diferença (falta, saiu mais cedo…).</span></div>
    <table class="lanc transp-t"><thead><tr><th>GM</th><th>Calculado</th><th>Vai para ${MESES[Number(m.slice(5)) - 1]}</th></tr></thead><tbody>
    ${lista.sort((a, b) => a.nome.localeCompare(b.nome)).map((g) => { const c = calc.get(g.id)?.proximo || 0, v = atual.get(g.id)?.transporte ?? c;
      return `<tr><td>${esc(g.nome)}</td><td class="num">${fmtHoras(c)}</td><td><input class="tr-h" data-trgm="${g.id}" data-calc="${c}" value="${hhmm(v) || "0:00"}" size="6" inputmode="numeric"></td></tr>`; }).join("")}
    </tbody></table>
    <div class="linha"><button class="btn pri" data-act="tr-confirmar">Confirmar ${lista.length} valor${lista.length === 1 ? "" : "es"}</button>${conf ? `<button class="link" data-act="tr-fechar">fechar</button>` : ""}</div></section>`;
}
function vMes() {
  const m = ui.mes;
  // serviços, folgas e dias vêm da escala; as horas extras vêm do controle (só dias finalizados)
  const escala = livroMes(data, m), ctl = controleMes(data, m), prev = previstaMes(data, m);
  const livro = new Map(data.gms.map((g) => [g.id, { ...escala.get(g.id), ...ctl.get(g.id), prevista: prev.get(g.id) || 0 }]));
  const nFin = diasDoMes(m).filter((d) => diaFinalizado(data, d)).length, abertos = diasEmAberto(data, m, somaDias(hojeBase(), -1));
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
    <div class="filtros"><select id="m-eq" aria-label="Equipe"><option value="">Todas as equipes</option>${data.equipes.map((e) => `<option value="${e.id}" ${e.id === f.equipe ? "selected" : ""}>${esc(rotuloEquipe(e, m + "-01"))}</option>`).join("")}</select>
    <select id="m-ord" aria-label="Ordenar"><option value="he" ${f.ordem === "he" ? "selected" : ""}>Mais HE no mês</option><option value="heAsc" ${f.ordem === "heAsc" ? "selected" : ""}>Menos HE (próximo a chamar)</option><option value="proximo" ${f.ordem === "proximo" ? "selected" : ""}>Maior transporte p/ próximo mês</option><option value="equipe" ${f.ordem === "equipe" ? "selected" : ""}>Equipe</option><option value="nome" ${f.ordem === "nome" ? "selected" : ""}>Nome</option></select>
    <input type="search" id="m-busca" placeholder="Buscar GM" aria-label="Buscar GM">
    ${abertos.length ? `<button class="btn fin" data-act="fin-pendentes">Finalizar ${abertos.length} dia${abertos.length === 1 ? "" : "s"} em aberto…</button>` : ""}</div></div>
  ${painelTransporte(m)}
  <div class="resumo">
    <div class="kpi"><span class="v">${fmtHoras(tot("he"))}</span><span class="l">HE no controle · ${nFin} de ${diasDoMes(m).length} dias finalizados</span></div>
    <div class="kpi previsto"><span class="v">${fmtHoras(tot("prevista"))}</span><span class="l">HE prevista nos dias em aberto (ainda não conta)</span></div>
    <div class="kpi"><span class="v">${fmtHoras(tot("paga"))}</span><span class="l">HE a pagar (teto ${data.config.tetoHE}h por GM)</span></div>
    <div class="kpi ${tot("proximo") ? "atencao" : ""}"><span class="v">${fmtHoras(tot("proximo"))}</span><span class="l">vai para ${MESES[Number(mesSeguinte(m).slice(5)) - 1]} · ${acima} GM${acima === 1 ? "" : "s"} acima do teto</span></div>
    <div class="kpi ${folgaPend ? "atencao" : ""}"><span class="v">${folgaPend}</span><span class="l">GMs 12x36 com menos de 2 folgas</span></div>
  </div>
  <div class="legenda"><span><i class="lg s"></i>Serviço</span><span><i class="lg tr"></i>Troca</span><span><i class="dot he"></i>HE</span><span><i class="dot bh"></i>BH+</span><span><i class="lg f"></i>Folga</span><span><i class="lg fe"></i>Férias</span><span><i class="lg l"></i>Licença/atestado/curso</span><span><i class="lg bhc"></i>Compensação</span></div>
  <div class="tabela-wrap"><table class="mes"><thead><tr><th class="gmcol">GM</th><th>Eq.</th><th title="Serviços realizados / previstos pela escala">Serv.</th><th>Folgas</th><th title="HE confirmada ao finalizar a escala. Digite para ajustar o total; ⋯ mostra dia a dia.">HE controle</th><th title="HE prevista pela escala nos dias ainda não finalizados">Prevista</th><th title="Horas que excederam o teto no mês anterior">Transp.</th><th>Paga</th><th>Próx. mês</th><th title="Parte da HE entre 22h e 5h — informativo para o RH">22–05h</th><th>BH</th>
    ${dias.map((d) => `<th class="d ${[0, 6].includes(diaSemana(d)) ? "fds" : ""}">${Number(d.slice(8))}<small>${SEMANA[diaSemana(d)][0]}</small></th>`).join("")}</tr></thead><tbody>
    ${gms.map((g) => { const l = L(g); const alt = equipe(g.equipe)?.tipo === "alternado"; return `<tr data-nome="${esc(g.nome.toLowerCase())}">
      <th class="gmcol" scope="row"><button class="link" data-act="abrir-ficha" data-gm="${g.id}">${esc(g.nome)}</button>${g.naoFazHE ? ` <span class="tag furo" title="Não realiza HE">sem HE</span>` : ""}</th><td>${g.equipe}</td>
      <td class="num">${l.servicos || 0}<small>/${l.servicosBase || 0}</small></td>
      <td class="num ${alt && (l.folgas || 0) !== 2 ? "alerta" : ""}">${alt ? `${l.folgas || 0}/2` : "—"}</td>
      <td class="num forte ctl-td">${celHoras(g.id, "he", l.he, ajusteDoMes(g.id, m))}<button class="ic ctl-mais" data-act="abrir-controle" data-gm="${g.id}" title="Ver dia a dia e corrigir" aria-label="Detalhes do controle de ${esc(g.nome)}">⋯</button></td><td class="num previsto">${l.prevista ? fmtHoras(l.prevista) : "—"}</td>
      <td class="num">${celHoras(g.id, "transporte", l.transporte, l.manual?.transporte)}</td>
      <td class="num">${celHoras(g.id, "paga", l.paga, l.manual?.paga)}</td><td class="num ${l.proximo ? "alerta" : ""}">${l.proximo ? fmtHoras(l.proximo) : "—"}</td>
      <td class="num">${l.heNoturna ? fmtHoras(l.heNoturna) : "—"}</td><td class="num">${(() => { const s = saldoBH(data, g.id, m); return s ? fmtHoras(s) : "—"; })()}</td>
      ${dias.map((d) => celulaDia(l.dias?.[d])).join("")}</tr>`; }).join("")}
  </tbody></table></div>`;
}

// ---------- FICHA DO GM ----------
function vFicha() {
  const g = gmPorId(ui.gm) || data.gms[0];
  ui.gm = g.id;
  const m = ui.mes;
  const l = { ...livroMes(data, m).get(g.id), ...controleMes(data, m).get(g.id), prevista: previstaMes(data, m).get(g.id) || 0 };
  const eq = equipe(g.equipe);
  const hist = [];
  for (let x = data.config.mesInicial; x <= "2026-12"; x = mesSeguinte(x)) hist.push([x, controleMes(data, x).get(g.id) || {}]);
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
  <section class="painel ficha-cab"><div><p class="eyebrow">${esc(rotuloEquipe(eq, m + "-01"))}${g.matricula ? ` · mat. ${esc(g.matricula)}` : ""}</p><h2>${esc(g.nome)}</h2><p class="meta">${esc(rotuloLotacao(g))}${eq?.tipo === "semanal" ? ` · ${(g.dias || [1, 2, 3, 4, 5]).map((d) => SEMANA[d].slice(0, 3).toLowerCase()).join(", ")}` : ""}</p>
    ${g.naoFazHE ? `<p class="tag-linha"><span class="tag furo">Não realiza HE</span></p>` : ""}${g.obs ? `<p class="meta">${esc(g.obs)}</p>` : ""}</div>
    <label class="toggle"><input type="checkbox" id="fi-semhe" ${g.naoFazHE ? "checked" : ""}> Não realiza HE</label></section>
  <div class="resumo">
    <div class="kpi"><span class="v">${l.servicos || 0}<small>/${l.servicosBase || 0}</small></span><span class="l">serviços realizados / previstos</span></div>
    ${eq?.tipo === "alternado" ? `<div class="kpi ${(l.folgas || 0) !== 2 ? "atencao" : ""}"><span class="v">${l.folgas || 0}/2</span><span class="l">folgas do mês</span></div>` : ""}
    <div class="kpi"><span class="v">${fmtHoras(l.he || 0)}</span><span class="l">HE no controle${l.heFixa ? ` (${fmtHoras(l.heFixa)} fixa)` : ""}${l.prevista ? ` · +${fmtHoras(l.prevista)} prevista nos dias em aberto` : ""} · <button class="link" data-act="abrir-controle" data-gm="${g.id}">corrigir</button></span></div>
    <div class="kpi"><span class="v">${fmtHoras(l.paga || 0)}</span><span class="l">a pagar · ${fmtHoras(l.transporte || 0)} vieram do mês anterior</span></div>
    ${(() => { const of = data.ocorrencias.filter((o) => o.tipo === "OFERTA" && o.de.startsWith(m)).flatMap((o) => o.gms.filter((x) => x.gm === g.id)); if (!of.length) return "";
      const c = (e) => of.filter((x) => x.estado === e).length; return `<div class="kpi"><span class="v">${of.length}</span><span class="l">HE oferecida${of.length === 1 ? "" : "s"} no mês · ${c("confirmou")} confirmou · ${c("recusou")} recusou${c("oferecida") ? ` · ${c("oferecida")} sem resposta` : ""}</span></div>`; })()}
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
  const insp = (per) => eqs.filter((e) => e.periodo === per).map((e) => (cd.inspetores.has(e.id) ? cd.inspetores.get(e.id) : e.inspetor)).filter(Boolean).join(", ");
  const faPostos = new Map(cd.fa.map((o) => [o.posto, o]));
  const cel = (p, t) => {
    if (faPostos.has(p.id) && !cd.designacoes.some((d) => d.posto === p.id && naColuna(d, t))) return `<td colspan="2" class="c">${faPostos.get(p.id).tipo === "FA" ? "FA" : "FECHADO"}</td>`;
    const todos = cd.designacoes.filter((d) => d.posto === p.id && naColuna(d, t)).sort((a, b) => a.ini - b.ini);
    const { mostrar: aqui, junto } = juntarHeFixa(todos, t, cd.designacoes);
    if (!aqui.length) {
      if (p.rondas) return `<td colspan="2" class="c rondas-p">VTR/RONDAS FREQUENTES</td>`;
      if (cd.furos.some((f) => f.posto === p.id && f.turno === t.id)) return `<td colspan="2" class="c furo-p">X</td>`;
      return `<td></td><td></td>`;
    }
    const fixaSo = (d) => d.fixa && !d.recorrente ? "" : d.nat;
    return `<td class="gn">${aqui.map((d) => `<div class="${fixaSo(d)} ${p.tipo === "reserva" ? "reserva" : ""}">${funcaoFolha(d)}${esc(nomeGm(d.gm))}${d.nat === "he" ? (d.fixa ? "" : " HE+") : d.nat === "bh" ? " BH+" : ""}${d.req && !d.fixa ? `<span class="r req-l">REQ ${esc(d.req)}</span>` : ""}</div>`).join("")}</td>
      <td class="gh">${aqui.map((d) => { const j = junto.get(d); const hr = j ? `${textoCelula(d, t).split("/")[0]}/${fmtHm(j.he.fim)}` : textoCelula(d, t);
        const nHe = d.nat === "he" ? 0 : numeroHeNaColuna(d, t, j, cd.designacoes);
        return `<div class="${fixaSo(d)}">(${hr})${nHe ? ` <span class="r he-n">${fmtHE(nHe)}</span>` : j ? "" : d.recorrente ? ` <span class="r he-n">HE+</span>` : d.fixa ? ` <span class="r he-n">${fmtHE(d.fim - d.ini)}</span>` : ""}</div>`; }).join("")}</td>`;
  };
  let corpo = "", corpoVerso = "";
  for (const s of data.secoes) {
    if (!opNoDia(s, ui.dia)) continue;
    const ps = data.postos.filter((p) => p.secao === s.id && postoDoDia(p, ui.dia) && (faPostos.get(p.id)?.tipo !== "FA" || cd.designacoes.some((d) => d.posto === p.id)) // viatura em FA não sai na folha (a não ser que a guarnição fique nela)
      && (p.rondas || faPostos.has(p.id) || cd.designacoes.some((d) => d.posto === p.id) || cd.furos.some((f) => f.posto === p.id))); // nem posto vazio sem vaga
    if (!ps.length) continue;
    const verso = ps.every((p) => p.tipo === "reserva");
    if (s.grupamento && !cd.designacoes.some((d) => ps.some((p) => p.id === d.posto))) continue;
    let html = "";
    html += `<tr class="sec ${s.grupamento ? "grupo" : ""} ${s.operacao ? "op" : ""}"><th>${s.operacao ? `ANEXO · OPERAÇÃO ${esc(s.nome)}<br><span class="sub">${esc(textoOp(s.operacao))}</span>` : esc(s.nome)}</th>${TURNOS.map((t) => `<th>${t.nome.split(" ")[0]}</th><th>TURNO</th>`).join("")}</tr>`;
    html += ps.map((p) => `<tr><th class="p">${esc(nomeNoDia(p, cd))}${subNoDia(p, cd) && p.tipo !== "reserva" ? `<br><span class="sub">${esc(subNoDia(p, cd))}</span>` : ""}${p.obs ? `<br><span class="sub">(${esc(p.obs)})</span>` : ""}</th>${TURNOS.map((t) => cel(p, t)).join("")}</tr>`).join("");
    if (verso) corpoVerso += html; else corpo += html;
  }
  const grupo = (tipos, titulo, colRet, cor) => {
    const g = cd.afastados.filter((a) => tipos.includes(a.tipo));
    if (!g.length) return "";
    return `<tr class="sec"><th>${titulo} <span class="quad ${cor}"></span></th><th colspan="4">GM</th><th colspan="4">${colRet}</th></tr>
      ${g.map((a) => `<tr><th class="p"></th><td colspan="4" class="c">${esc(nomeGm(a.gm))} <span class="sub">${a.gm && equipe(gmPorId(a.gm).equipe)?.periodo === "noite" ? "(noite)" : "(dia)"}</span></td><td colspan="4" class="c r">${a.tipo === "TROCA" ? `coberto por ${esc(nomeGm(a.oc.substituto))}` : a.oc.ate && a.oc.ate !== a.oc.de ? `${ddmm(a.oc.de)} a ${ddmm(a.oc.ate)}` : a.oc.req ? `REQ ${esc(a.oc.req)}` : ddmm(a.oc.de)}</td></tr>`).join("")}`;
  };
  const enquadrado = window.self !== window.top;
  return `<div class="barra nao-imprimir"><div class="datas"><button class="ic" data-act="dia" data-n="-1" aria-label="Dia anterior">‹</button><input type="date" id="q-dia" value="${ui.dia}" aria-label="Data"><button class="ic" data-act="dia" data-n="1" aria-label="Próximo dia">›</button></div>
    ${enquadrado ? `<p class="dica">Folha no formato que vai para os inspetores. Para gerar o PDF, abra <code>prototipo/index.html</code> no Chrome e use Ctrl+P (A4, frente e verso).</p>` : `<button class="btn pri" data-act="imprimir">Imprimir / salvar PDF</button>`}</div>
  <div class="papel-wrap"><article class="papel">
    <header class="pcab2">
      <div class="brasao">${data.config.brasoes?.esq ? `<img src="${data.config.brasoes.esq}" alt="">` : ICONES.grupo}</div>
      <div class="pcab-tit">${linhasCabecalho().map((l, i) => `<div class="${i === 0 ? "l1" : ""}">${esc(l)}</div>`).join("")}</div>
      <div class="brasao">${data.config.brasoes?.dir ? `<img src="${data.config.brasoes.dir}" alt="">` : ""}</div>
    </header>
    <table class="pcab-info"><tr>
      <td class="chefe" rowspan="2">INSP. CHEFE: ${esc(data.config.inspetorChefe || "")}</td>
      <td>INSP. OP. DIA: ${esc(insp("dia"))}</td><td class="data">DATA: ${ddmmaaaa(ui.dia)}</td><td class="data">2º3º4º TURNOS ${SEMANA[diaSemana(ui.dia)]}</td></tr>
      <tr><td>INSP. OP. NOITE: ${esc(insp("noite"))}</td><td class="data">DATA: ${ddmmaaaa(amanha)}</td><td class="data">1º TURNO ${SEMANA[diaSemana(amanha)]}</td></tr></table>
    ${avisosDoDia(ui.dia).filter((o) => o.folha).map((o) => `<p class="pt-aviso"><b>OBSERVAÇÃO:</b> ${esc(o.texto).replace(/\n/g, "<br>")}</p>`).join("")}
    <table class="pt">${corpo}</table>
    <div class="quebra"></div>
    <table class="pt verso">
      ${corpoVerso}
      ${grupo(["BH_COMP"], "BANCO DE HORAS / COMPENSAÇÃO", "REQ.", "q-bh")}
      ${grupo(["FOLGA", "FALTA"], "FOLGAS / FALTAS", "DATA", "q-folga")}
      ${grupo(["TROCA"], "TROCAS DE SERVIÇO", "SITUAÇÃO")}
      ${grupo(["ATESTADO", "LICENCA", "CURSO"], "ATESTADO / LICENÇAS / CURSOS", "RETORNO", "q-atest")}
      ${grupo(["FERIAS"], "FÉRIAS", "RETORNO", "q-ferias")}
    </table>
  </article></div>`;
}


// ---------- PENDÊNCIAS (semana) ----------
const PERIODOS = [["dia", ["t2", "t3"], "Dia"], ["noite", ["t4", "t1"], "Noite"]];
function pendenciasDoDia(dia) {
  return pendencias(data, dia).map((x) => ({ ...x, posto: postoPorId(x.posto) })).filter((x) => x.posto);
}
// junta trechos seguidos do mesmo GM no mesmo posto (ex.: 07–13 + 13–19 → 07–19)
function juntarPlano(plano) {
  const out = [];
  for (const x of [...plano].sort((a, b) => String(a.gm).localeCompare(String(b.gm)) || String(a.posto).localeCompare(String(b.posto)) || a.ini - b.ini)) {
    const u = out.at(-1);
    if (u && x.tipo === "HE" && u.tipo === "HE" && u.gm === x.gm && u.posto === x.posto && u.dia === x.dia && u.fim === x.ini) u.fim = x.fim; else out.push({ ...x });
  }
  return out;
}
// Horas de HE do GM no mês (controle + previstas) num selo colorido: verde, âmbar perto do teto, vermelho acima
const minHE = (gm, dia) => { const l = horasParaSugestao(data, mesDe(dia)).get(gm); return l ? l.he + l.transporte : 0; };
function seloHE(min) {
  const teto = (data.config.tetoHE || 60) * 60, cls = min >= teto ? "acima" : min >= teto * 0.75 ? "perto" : "ok";
  return `<span class="he-pill ${cls}" title="HE no mês (já no controle + prevista na escala)${min >= teto ? " · passou do teto" : ""}">${fmtHoras(min)} HE</span>`;
}
// Motivo da sugestão em poucas palavras
const motivoSug = (x) => (x.notas || []).filter((n) => !/teto/.test(n))[0] || "";
// Cartões do "O que falta resolver": para cada dia, um plano sem repetir GM (o mesmo do "Preencher sozinho"),
// mais 2 alternativas por vaga, cada uma já com o horário que vai ser lançado.
function cartoesPendencias(porDia) {
  return porDia.filter((x) => x.pend.length).map(({ d, pend }) => {
    const plano = juntarPlano(planejarCobertura(data, [d])), usados = new Set(plano.filter((x) => x.gm).map((x) => x.gm));
    const nOk = plano.filter((x) => x.tipo).length;
    return `<section class="pdia"><header><h3>${SEMANA[diaSemana(d)].toLowerCase()} <b>${ddmm(d)}</b></h3>
      <span class="n">${pend.length}</span><button class="link" data-act="ir-dia" data-dia="${d}">Abrir quadro →</button></header>
      <ul>${pend.map((x) => {
        const meus = plano.filter((y) => y.posto === x.posto.id && sobrepoe(y.ini, y.fim, x.ini, x.fim) > 0);
        const { remanejar, he } = sugerir(data, d, x.posto.id, x.ini, x.fim);
        const livres = he.filter((s) => !s.bloqueado && !usados.has(s.gm.id)), alts = livres.slice(0, 2), chave = `${d}|${x.posto.id}|${x.ini}`, aberto = (ui.pendMais ||= new Set()).has(chave);
        const extras = livres.slice(2, 12);
        const btn = (gm, ini, fim, via, motivo, principal) => via === "rem"
          ? `<button class="btn rem ${principal ? "" : "alt"}" data-act="pend-pergunta" data-via="rem" data-dia="${d}" data-posto="${x.posto.id}" data-gm="${gm}">Remanejar <b>${esc(nomeGm(gm))}</b><small>${esc(motivo)}</small></button>`
          : `<button class="btn hebtn ${principal ? "" : "alt"}" data-act="pend-pergunta" data-via="he" data-dia="${d}" data-posto="${x.posto.id}" data-gm="${gm}" data-ini="${fmtHm(ini)}" data-fim="${fmtHm(fim)}"><span class="nm-l"><b>${esc(nomeGm(gm))}</b>${seloHE(minHE(gm, d))}</span><span class="hr">${fmtHm(ini)}–${fmtHm(fim)}</span><small>${esc(motivo)}</small></button>`;
        const principais = meus.filter((y) => y.tipo).map((y) => {
          const s = he.find((z) => z.gm.id === y.gm) || remanejar.find((z) => z.gm.id === y.gm);
          return btn(y.gm, y.ini, y.fim, y.tipo === "REMANEJ" ? "rem" : "he", y.tipo === "REMANEJ" ? `da ${y.de}` : motivoSug(s) || "menos horas no mês", true);
        }).join("");
        const outras = alts.map((s) => { const [a, b] = horarioProposto(data, d, s.gm.id, x.posto.id, x.ini, x.fim); return btn(s.gm.id, a, b, "he", motivoSug(s) || "livre", false); }).join("");
        const of = ofertasAbertas(d).find((o) => o.posto === x.posto.id && sobrepoe(...intervalo(o.ini, o.fim), x.ini, x.fim) > 0);
        const stOf = of ? `<div class="oferta-st"><span class="of-tit">📲 HE oferecida · aguardando resposta</span>${aguardando(of).map((g) => `<span class="of-gm"><b>${esc(nomeGm(g.gm))}</b><button class="btn mini of-sim" data-act="of-resp" data-id="${of.id}" data-gm="${g.gm}" data-e="confirmou">✓ confirmou</button><button class="link" data-act="of-resp" data-id="${of.id}" data-gm="${g.gm}" data-e="recusou">recusou</button><button class="link" data-act="of-resp" data-id="${of.id}" data-gm="${g.gm}" data-e="cancelada">cancelar envio</button></span>`).join("")}<button class="link" data-act="of-copiar" data-id="${of.id}">copiar mensagem</button></div>` : "";
        return `<li class="${of ? "com-oferta" : ""}"><div class="pinfo"><b>${esc(x.posto.nome)}</b> <span class="meta">${x.posto.reforco ? "Reforço" : x.per === "dia" ? "Dia" : "Noite"} ${fmtHm(x.ini)}–${fmtHm(x.fim)}${x.faltam > 1 ? ` · faltam ${x.faltam}` : ""}</span></div>
          ${stOf}<div class="pacoes">${of ? `<span class="meta">oferecer a mais:</span>` : ""}${principais || `<span class="meta">ninguém livre</span>`}${outras ? `<span class="ou">ou</span>${outras}` : ""}
          ${extras.length ? `<button class="link" data-act="pend-mais" data-k="${esc(chave)}" aria-expanded="${aberto}">${aberto ? "menos" : `+${extras.length} opções`}</button>` : ""}
          <button class="link" data-act="pend-abrir" data-dia="${d}" data-posto="${x.posto.id}" data-turno="${x.turnos[0]}" title="Abrir no quadro do dia, com todas as opções">quadro…</button>
          <button class="link sem-gm" data-act="pend-semgm" data-dia="${d}" data-posto="${x.posto.id}" data-turnos="${x.turnos.join(",")}" title="Dispensar esta vaga só neste dia">deixar sem GM</button></div>
          ${aberto ? `<ul class="pend-extras">${extras.map((s2) => { const [a, b] = horarioProposto(data, d, s2.gm.id, x.posto.id, x.ini, x.fim);
            return `<li><button class="link" data-act="pend-pergunta" data-via="he" data-dia="${d}" data-posto="${x.posto.id}" data-gm="${s2.gm.id}" data-ini="${fmtHm(a)}" data-fim="${fmtHm(b)}"><b>${esc(s2.gm.nome)}</b></button> ${seloHE(s2.heMes + s2.transporte)} <span class="hr">${fmtHm(a)}–${fmtHm(b)}</span> <span class="meta">${esc(motivoSug(s2) || "livre")}</span></li>`; }).join("")}</ul>` : ""}</li>`;
      }).join("")}</ul></section>`;
  }).join("");
}
// Lembretes do mês: o que costuma ficar esquecido
// lista de GMs de um aviso: mostra alguns e "ver todos (N)" abre a lista inteira ali mesmo
function nomesAviso(chave, gms, extra = () => "") {
  const aberto = (ui.lembAberto ||= new Set()).has(chave), mostrar = aberto ? gms : gms.slice(0, 6);
  return `${mostrar.map((g) => `<button class="link" data-act="abrir-ficha" data-gm="${g.id}">${esc(g.nome)}</button>${extra(g)}`).join(", ")}${gms.length > 6 ? ` <button class="link ver-todos" data-act="lemb-todos" data-k="${chave}">${aberto ? "mostrar menos" : `ver todos (${gms.length})`}</button>` : ""}`;
}
const plural = (n, um, varios) => (n === 1 ? um : varios);
function lembretesMes() {
  const m = mesDe(ui.dia), it = [], nomeM = MESES[Number(m.slice(5)) - 1];
  const abertos = diasEmAberto(data, m, somaDias(hojeBase(), -1));
  if (abertos.length) it.push(`<li><b>${abertos.length}</b> ${plural(abertos.length, "dia já passou", "dias já passaram")} sem finalizar a escala (as HEs ainda não estão no controle). <button class="link" data-act="ir-mes-fin">Finalizar…</button></li>`);
  const limbo = semPadrao(ui.dia);
  if (limbo.length) it.push(`<li><b>${limbo.length}</b> GM${plural(limbo.length, "", "s")} sem posto no padrão (${plural(limbo.length, "fica", "ficam")} fora da escala): ${nomesAviso("limbo", limbo)} <button class="link" data-act="ir-efetivo">Abrir o Efetivo</button></li>`);
  const livro = livroMes(data, m), poucas = data.gms.filter((g) => g.ativo !== false && equipe(g.equipe)?.tipo === "alternado" && (livro.get(g.id)?.folgas || 0) < 2).sort((a, b) => a.nome.localeCompare(b.nome));
  if (poucas.length) it.push(`<li><b>${poucas.length}</b> GM${plural(poucas.length, "", "s")} 12x36 com menos de 2 folgas em ${nomeM}: ${nomesAviso("folgas", poucas, (g) => ` <small class="meta">(${livro.get(g.id)?.folgas || 0})</small>`)}</li>`);
  const ctl = controleMes(data, m), prev = previstaMes(data, m), teto = data.config.tetoHE * 60, tot = (g) => (ctl.get(g.id)?.total || 0) + (prev.get(g.id) || 0);
  const acima = data.gms.filter((g) => tot(g) > teto).sort((a, b) => tot(b) - tot(a));
  if (acima.length) it.push(`<li><b>${acima.length}</b> GM${plural(acima.length, " vai", "s vão")} passar de ${data.config.tetoHE}h de HE no mês (o excedente fica para o próximo): ${nomesAviso("teto", acima, (g) => ` <small class="meta">(${fmtHoras(tot(g))})</small>`)}</li>`);
  const semana = Array.from({ length: 7 }, (_, i) => somaDias(ui.dia, i));
  const aguard = semana.flatMap((d) => ofertasAbertas(d).flatMap((o) => aguardando(o).map((g) => ({ d, o, g }))));
  if (aguard.length) it.push(`<li><b>${aguard.length}</b> HE${plural(aguard.length, "", "s")} oferecida${plural(aguard.length, "", "s")} sem resposta: ${[...new Set(aguard.map((x) => `${nomeGm(x.g.gm)} (${ddmm(x.d)} · ${postoPorId(x.o.posto)?.nome})`))].slice(0, 6).map(esc).join(", ")}${aguard.length > 6 ? "…" : ""}</li>`);
  const faVtr = new Set();
  for (const d of semana) { const cd = calcularDia(data, d); for (const p of data.postos) { const fv = viaturaNaFrota(numeroDe(nomeNoDia(p, cd))); if (fv && fv.situacao !== "QAP" && !cd.fa.some((o) => o.posto === p.id) && cd.designacoes.some((x) => x.posto === p.id)) faVtr.add(fv.prefixo); } }
  if (faVtr.size) it.push(`<li>${plural(faVtr.size, "Viatura", "Viaturas")} em FA pela logística, mas com guarnição escalada: <b>${[...faVtr].join(", ")}</b>. <button class="link" data-act="ir-frota">Ver viaturas</button></li>`);
  const semInsp = semana.filter((d) => !data.inspetores?.[d]?.dia || !data.inspetores?.[d]?.noite);
  if (Object.keys(data.inspetores || {}).length && semInsp.length) it.push(`<li>Sem inspetor de serviço na escala mensal: ${semInsp.map(ddmm).join(", ")}. <button class="link" data-act="ir-insp">Abrir</button></li>`);
  return it.length ? `<section class="painel lembretes"><h3>Não esqueça</h3><ul>${it.join("")}</ul></section>` : "";
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
  const postos = data.postos.filter((p) => p.ativo !== false && !p.so && !p.de && p.vagas && Object.values(p.vagas).some(Boolean));
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

  const cards = cartoesPendencias(porDia);

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
  ${lembretesMes()}
  <div class="cols-pend">
    <section class="painel"><h3>Cobertura da semana</h3><p class="dica">Cada bolinha é um posto coberto. Número vermelho = vagas descobertas; clique para resolver.</p>
      <div class="tabela-wrap mapa-wrap"><table class="mapa"><thead><tr><th></th>${dias.map((d) => `<th colspan="2" class="${d === ui.dia ? "hoje" : ""}">${SEMANA[diaSemana(d)].slice(0, 3)} ${ddmm(d)}</th>`).join("")}</tr>
      <tr><th></th>${dias.map(() => `<th class="sub dia">D</th><th class="sub noite">N</th>`).join("")}</tr></thead><tbody>${linhas}</tbody></table></div></section>
    <section class="painel fila"><div class="fila-cab"><h3>O que falta resolver</h3>${totalFuros ? `<button class="btn pri grande" data-act="auto" data-dias="7">Preencher a semana sozinho</button>` : ""}</div>
      ${ui.plano ? painelPlano() : `<p class="dica">Para cada vaga, a melhor opção e duas alternativas, já com o horário. Clique num nome para <b>oferecer a HE</b> (WhatsApp); quando ele responder, marque “confirmou” e ele entra na escala.</p>
      ${cards || `<p class="tudo-ok">Semana coberta. Nada pendente.</p>`}`}</section>
  </div>`;
}
const hojeBase = () => (hojeReal >= "2026-10-01" && hojeReal <= "2026-12-31" ? hojeReal : "2026-11-26");

// ---------- AJUSTES ----------
// "Padrão ímpar · dia (nov/26)": o padrão é sempre relativo ao mês. Quem trabalha no dia 1º do mês é o ímpar daquele mês.
// Depois de um mês de 31 dias a alternância segue e as equipes trocam de nome (o par vira ímpar).
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (dia) => `${MES_CURTO[Number(dia.slice(5, 7)) - 1]}/${dia.slice(2, 4)}`;
function padraoNoMes(eqId, dia) { return calcularDia(data, `${dia.slice(0, 7)}-01`).equipes.includes(eqId) ? "ímpar" : "par"; }
function rotuloEquipe(eq, dia = ui.dia, curto = false) {
  if (!eq) return "";
  if (eq.tipo !== "alternado") return eq.nome;
  const r = `Padrão ${padraoNoMes(eq.id, dia)} · ${eq.periodo}`;
  return curto ? r : `${r} (${mesCurto(dia)})`;
}
function linhasCabecalho() {
  const c = data.config;
  return c.cabecalhoLinhas?.length ? c.cabecalhoLinhas : String(c.cabecalho || "").split(" · ").filter(Boolean);
}
// Função como ícone (volante = motorista, distintivo = patrulheiro) para não poluir a folha
const ICO_FUNCAO = {
  Motorista: `<svg class="ico-fn" viewBox="0 0 24 24" aria-label="Motorista" role="img"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="2.6"/><path d="M3.5 11h6M14.5 11h6M12 14.6V21" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>`,
  Patrulheiro: `<svg class="ico-fn" viewBox="0 0 24 24" aria-label="Patrulheiro" role="img"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.5l1.3 2.7 3 .4-2.2 2.1.5 3L12 14.3l-2.6 1.4.5-3-2.2-2.1 3-.4z"/></svg>`,
};
const icoFuncao = (f) => ICO_FUNCAO[f] || "";
// motorista / patrulheiro só faz sentido em viatura
const emVtr = (postoId) => postoPorId(postoId)?.tipo === "vtr";
// na folha, a letra num quadradinho (M = motorista, P = patrulheiro), mais fácil de ler impresso
const funcaoFolha = (d) => (emVtr(d.posto) && ICO_FUNCAO[d.funcao] ? `<span class="fn-l" title="${d.funcao}">${d.funcao[0]}</span>` : "");
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
    <h3 class="sub">Padrão ímpar e par mês a mês</h3>
    <p class="dica">Padrão ímpar = quem trabalha nos dias ímpares do mês. Depois de um mês com 31 dias, as equipes trocam de nome.</p>
    <div class="tabela-wrap"><table class="lanc meses-pad"><thead><tr><th>Mês</th><th>Padrão ímpar</th><th>Padrão par</th></tr></thead><tbody>
    ${Array.from({ length: 6 }, (_, i) => { let m = ui.dia.slice(0, 7); for (let k = 0; k < i; k++) m = mesSeguinte(m); const d1 = `${m}-01`;
      const imp = calcularDia(data, d1).equipes, todas = data.equipes.filter((e) => e.tipo === "alternado");
      return `<tr><td>${nomeMes(m)}</td><td>${todas.filter((e) => imp.includes(e.id)).map((e) => esc(e.id)).join(" + ")}</td><td>${todas.filter((e) => !imp.includes(e.id)).map((e) => esc(e.id)).join(" + ")}</td></tr>`; }).join("")}
    </tbody></table></div>
    <h2>Horas extras</h2>
    <div class="linha"><label>Teto de HE paga por mês (horas) <input type="number" id="aj-teto" min="1" max="300" value="${c.tetoHE}"></label></div>
    <p class="dica">O que passar do teto vai para o mês seguinte.</p>
    <h2>Folha</h2>
    <label>Cabeçalho (uma linha por linha) <textarea id="aj-cab" rows="5" cols="60">${esc(linhasCabecalho().join("\n"))}</textarea></label>
    <label>Inspetor chefe <input id="aj-chefe" value="${esc(c.inspetorChefe || "")}"></label>
    <div class="linha brasoes-aj">
      <label>Brasão da esquerda <input type="file" id="aj-bras-esq" accept="image/*"></label>${c.brasoes?.esq ? `<img src="${c.brasoes.esq}" alt="" class="bras-prev">` : ""}
      <label>Brasão da direita <input type="file" id="aj-bras-dir" accept="image/*"></label>${c.brasoes?.dir ? `<img src="${c.brasoes.dir}" alt="" class="bras-prev">` : ""}
    </div>
    <p class="dica">Os brasões aparecem no cabeçalho da folha impressa, como no PDF da escala.</p>
    <div><button class="btn pri" data-act="salvar-ajustes">Salvar ajustes</button></div></section>
    ${SERVIDOR ? `<section class="painel ajustes"><h2>Histórico de alterações</h2><p class="dica">Quem mudou o quê, do mais recente para o mais antigo. O histórico não pode ser apagado.</p><div id="historico"><p class="dica">Carregando…</p></div></section>` : ""}`;
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
  ui.pop = { modo, anc: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }, turno: el.closest?.("td[data-turno]")?.dataset.turno, ...extra };
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
  const fora = ay + s.anc.h < 0 || ay > innerHeight;
  if (s.fixo || fora) { // âncora fora da tela (ex.: Ctrl+F com a escala rolada): abre no alto da área visível
    const topo = (document.querySelector("header.app")?.getBoundingClientRect().bottom || 0) + 12;
    p.style.left = Math.max(12, (innerWidth - W) / 2) + "px"; p.style.top = Math.min(Math.max(12, topo), Math.max(12, innerHeight - h - 12)) + "px"; return;
  }
  const x = Math.min(Math.max(12, ax), innerWidth - W - 12);
  let y = ay + s.anc.h + 6;
  if (y + h > innerHeight - 12) y = Math.max(12, ay - h - 6);
  y = Math.max(12, Math.min(y, innerHeight - h - 12)); // nunca fora da tela
  p.style.left = x + "px"; p.style.top = y + "px";
}
function fecharPop() { ui.pop = null; const p = $("#pop"); if (p) { p.hidden = true; p.innerHTML = ""; } }
function desenharPop() {
  const p = $("#pop"), s = ui.pop;
  p.innerHTML = { hora: popCard, card: popCard, tirar: popTirar, insp: popInsp, gm: popGm, add: popGm, motivo: popMotivo, posto: popPosto, secao: popSecao, novo: popNovo, buscagm: popBuscaGm }[s.modo](s);
  p.hidden = false;
  const W = Math.min(s.modo === "posto" || s.modo === "secao" || s.modo === "novo" || s.modo === "buscagm" ? 460 : 380, innerWidth - 24);
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
    <b>${esc(x.gm.nome)}</b><small>${x.notas?.length ? esc(x.notas.join(" · ")) + " · " : ""}${fmtHoras(x.heMes + x.transporte)} de HE no mês</small><span class="via he">hora extra</span></button></li>`;
  return `${cabPop(titulo, sub)}<div class="pop-corpo">${topo}
    <p class="grupo">Livres nesse horário · ${fmtHoras(fim - ini)} de hora extra</p>
    <input type="search" id="p-busca" placeholder="Digite o nome" aria-label="Buscar GM">
    <ul class="pessoas" id="p-lista">${he.map(linhaHe).join("")}</ul>
    ${!he.length ? `<p class="dica">Ninguém livre nesse horário.</p>` : ""}
    ${remanejar.length ? `<p class="grupo">Reserva técnica / à disposição</p><ul class="pessoas">${remanejar.map((x) => `<li data-nome="${esc(norm(x.gm.nome))}"><button class="pessoa" data-act="pop-escolher" data-gm="${x.gm.id}" data-via="rem" data-origem="${esc(x.origem.toLowerCase())}">
      <b>${esc(x.gm.nome)}</b><small>está na ${esc(x.origem.toLowerCase())}</small><span class="via rem">remanejar</span></button></li>`).join("")}</ul>` : ""}
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
// ---------- VIATURAS (logística) ----------
// data.frota: [{ id, prefixo, modelo, situacao: "QAP" | "FA" | "FAP", finalidade, guarnicao }]
const SIT = { QAP: ["QAP", "qap"], FA: ["FA", "fa"], FAP: ["FA permanente", "fap"] };
const numeroDe = (txt) => (String(txt || "").match(/\b(\d{3,4})\b/) || [])[1] || "";
const viaturaNaFrota = (num) => num && (data.frota || []).find((v) => String(v.prefixo) === String(num));
// quem está na viatura hoje, pela escala (dia / noite)
function guarnicaoNaEscala(prefixo, cd) {
  const ps = data.postos.filter((p) => p.ativo !== false && numeroDe(nomeNoDia(p, cd)) === String(prefixo));
  const nomes = (per) => [...new Set(cd.designacoes.filter((d) => ps.some((p) => p.id === d.posto) && (per === "dia" ? d.ini % 1440 < 1140 && d.ini % 1440 >= 300 : !(d.ini % 1440 < 1140 && d.ini % 1440 >= 300))).map((d) => nomeGm(d.gm)))];
  const d = nomes("dia"), n = nomes("noite");
  return [d.length ? d.join("/") : "", n.length ? `noite: ${n.join("/")}` : ""].filter(Boolean).join(" · ");
}
function vFrota() {
  const fr = data.frota || [], f = (ui.frota ||= { sit: "", busca: "" }), cd = calcularDia(data, ui.dia);
  const conta = (k) => fr.filter((v) => v.situacao === k).length;
  const modelos = [...new Set(fr.map((v) => v.modelo || "SEM MODELO"))];
  const vis = (v) => (!f.sit || v.situacao === f.sit) && (!f.busca || norm(`${v.prefixo} ${v.modelo} ${v.finalidade} ${v.guarnicao}`).includes(norm(f.busca)));
  const linha = (v) => { const esc2 = guarnicaoNaEscala(v.prefixo, cd);
    return `<tr class="sit-${SIT[v.situacao]?.[1] || "qap"}"><td class="num pref"><input class="fr-in pref" data-fr="${v.id}" data-campo="prefixo" value="${esc(v.prefixo)}" size="5" aria-label="Prefixo"></td>
      <td class="sit">${Object.entries(SIT).map(([k, [t, c]]) => `<button class="sitb ${c} ${v.situacao === k ? "on" : ""}" data-act="fr-sit" data-fr="${v.id}" data-sit="${k}" aria-pressed="${v.situacao === k}" title="${t}">${k === "FAP" ? "FA perm." : k}</button>`).join("")}</td>
      <td><input class="fr-in" data-fr="${v.id}" data-campo="finalidade" value="${esc(v.finalidade || "")}" placeholder="${v.situacao === "FAP" ? "FA permanente" : "finalidade"}" aria-label="Finalidade"></td>
      <td><input class="fr-in" data-fr="${v.id}" data-campo="guarnicao" value="${esc(v.guarnicao || "")}" placeholder="${esc(esc2 || "guarnição")}" title="${esc2 ? `Na escala de ${ddmm(ui.dia)}: ${esc(esc2)}` : ""}" aria-label="Guarnição"></td>
      <td><button class="ic" data-act="fr-del" data-fr="${v.id}" aria-label="Excluir viatura ${esc(v.prefixo)}" title="Excluir">×</button></td></tr>`; };
  const cards = modelos.map((m) => { const vs = fr.filter((v) => (v.modelo || "SEM MODELO") === m), mostra = vs.filter(vis);
    if (!mostra.length && (f.sit || f.busca)) return "";
    return `<section class="fr-card"><header><span class="fr-qtd">${vs.length}</span><button class="link fr-modelo" data-act="fr-renomear" data-modelo="${esc(m)}" title="Renomear modelo">${esc(m)}</button>
        <span class="fr-mini">${["QAP", "FA", "FAP"].map((k) => vs.filter((v) => v.situacao === k).length ? `<i class="${SIT[k][1]}">${vs.filter((v) => v.situacao === k).length} ${k === "FAP" ? "FA perm." : k}</i>` : "").join("")}</span>
        <button class="btn mini" data-act="fr-add" data-modelo="${esc(m)}">+ viatura</button></header>
      <table class="fr"><thead><tr><th>Prefixo</th><th>Situação</th><th>Finalidade</th><th>Guarnição</th><th></th></tr></thead><tbody>${mostra.map(linha).join("")}</tbody></table></section>`; }).join("");
  return `<div class="barra"><div class="datas"><h2 class="titulo-mes">Viaturas</h2><span class="meta">situação atual da frota · guarnição sugerida pela escala de ${ddmm(ui.dia)}</span></div>
    <div class="filtros"><input type="search" id="fr-busca" value="${esc(f.busca)}" placeholder="Buscar prefixo, modelo, finalidade" aria-label="Buscar viatura"></div></div>
  <div class="resumo fr-resumo">
    ${[["", "Geral", fr.length, ""], ["QAP", "QAP", conta("QAP"), "qap"], ["FA", "FA", conta("FA"), "fa"], ["FAP", "FA permanente", conta("FAP"), "fap"]].map(([k, t, n, c]) => `<button class="kpi fr-kpi ${c} ${f.sit === k ? "on" : ""}" data-act="fr-filtro" data-sit="${k}"><span class="v">${n}</span><span class="l">${t}</span></button>`).join("")}
  </div>
  <div class="fr-grade">${cards || `<p class="meta">Nenhuma viatura cadastrada.</p>`}</div>
  <section class="painel fr-novo"><h3>Novo modelo</h3><div class="linha"><label>Modelo <input id="fr-nm" placeholder="ex.: DUSTER"></label><label>Prefixo <input id="fr-np" placeholder="ex.: 1351" size="6"></label><button class="btn" data-act="fr-novo">Adicionar</button></div></section>`;
}
// Ao criar posto: vale para os dois padrões (ímpar e par) ou só para um?
function escolhaPadrao() {
  const atual = ui.view === "padroes" && ["impar", "par"].includes(ui.padrao?.aba) ? ui.padrao.aba : "";
  return `<fieldset class="np-padrao"><legend>Em quais dias ele existe?</legend>
    <label class="toggle"><input type="radio" name="np-pad" value="" checked> <span><b>Nos dois padrões</b> (ímpar e par): mesmo posto, as duas guarnições ficam ligadas para HE</span></label>
    <label class="toggle"><input type="radio" name="np-pad" value="impar"> Só no padrão ímpar${atual === "impar" ? " (este)" : ""}</label>
    <label class="toggle"><input type="radio" name="np-pad" value="par"> Só no padrão par${atual === "par" ? " (este)" : ""}</label></fieldset>`;
}
// Modelos para criar posto. "copiar:<id>" usa um posto existente como modelo.
const MODELOS_POSTO = {
  vtr: { t: "Viatura 12x36 (2 GMs de dia)", tipo: "vtr", dia: 2, noite: 0 },
  vtrn: { t: "Viatura dia e noite (2 + 2)", tipo: "vtr", dia: 2, noite: 2 },
  moto: { t: "Moto (1 GM de dia)", tipo: "moto", dia: 1, noite: 0 },
  posto: { t: "Posto fixo 12x36 (1 GM de dia)", tipo: "posto", dia: 1, noite: 0 },
  postodn: { t: "Posto fixo dia e noite (1 + 1)", tipo: "posto", dia: 1, noite: 1 },
  eja: { t: "Reforço / EJA (seg–sex, horário fixo, coberto com HE)", tipo: "posto", reforco: { ini: "19:00", fim: "23:00" }, dias: [1, 2, 3, 4, 5], n: 1 },
};
function modeloDoPosto(chave) {
  if (chave?.startsWith("copiar:")) { const p = postoPorId(chave.slice(7)); if (!p) return null;
    const ts = (a, b) => Math.max(0, ...[a, b].map((t) => p.vagas?.[t] || 0));
    return { tipo: p.tipo || "posto", dia: ts("t2", "t3"), noite: ts("t4", "t1"), reforco: p.reforco ? { ...p.reforco } : null, dias: p.dias ? [...p.dias] : null, n: Math.max(1, ...Object.values(p.vagas || { a: 1 })), sub: p.sub || "", obs: p.obs || "", rondas: !!p.rondas, nome: p.nome }; }
  return MODELOS_POSTO[chave] || MODELOS_POSTO.vtr;
}
function blocoNovoPosto(sec, s) {
  const chave = s.modeloPosto || (ui.modeloCopiado ? "copiar:" + ui.modeloCopiado : "vtr"), m = modeloDoPosto(chave) || MODELOS_POSTO.vtr;
  const ref = !!m.reforco, nomeSec = (id) => esc(data.secoes.find((x) => x.id === id)?.nome || "");
  const copiaveis = data.secoes.filter((x) => !x.operacao).map((x) => [x, data.postos.filter((p) => p.secao === x.id && p.ativo !== false && !p.so && !p.de)]).filter(([, ps]) => ps.length);
  const diasSel = new Set(m.dias || [1, 2, 3, 4, 5]);
  return `<div class="bloco"><b>Posto, viatura ou moto</b>
      <label>Modelo <select id="np-modelo">
        <optgroup label="Modelos prontos">${Object.entries(MODELOS_POSTO).map(([k, x]) => `<option value="${k}" ${chave === k ? "selected" : ""}>${esc(x.t)}</option>`).join("")}</optgroup>
        ${copiaveis.map(([x, ps]) => `<optgroup label="Copiar de ${esc(x.nome)}">${ps.map((p) => `<option value="copiar:${p.id}" ${chave === "copiar:" + p.id ? "selected" : ""}>${esc(p.nome)}${p.sub ? " · " + esc(p.sub) : ""}</option>`).join("")}</optgroup>`).join("")}
      </select></label>
      ${chave.startsWith("copiar:") ? `<p class="dica">Copiando ${esc(m.nome)}: tipo, vagas, horário e dias. Só falta o nome.</p>` : ""}
      <label>Nome <input id="np-nome" placeholder="${ref ? "ex.: EMEF NOVA · EJA" : "ex.: VTR 1352 ou PRAÇA NOVA"}" autocomplete="off"></label>
      <div class="linha"><label>Tipo <select id="np-tipo">${[["vtr", "Viatura"], ["moto", "Moto"], ["posto", "Posto fixo"]].map(([v, t]) => `<option value="${v}" ${m.tipo === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="cresce">Seção <select id="np-secao">${data.secoes.map((x) => `<option value="${x.id}" ${x.id === sec ? "selected" : ""}>${nomeSec(x.id)}</option>`).join("")}</select></label></div>
      ${ref ? `<div class="np-ref"><div class="linha"><div><span class="meta">Horário do reforço</span><label class="np-hr"><input id="np-ri" value="${esc(m.reforco.ini)}" size="5" aria-label="Início"> às <input id="np-rf" value="${esc(m.reforco.fim)}" size="5" aria-label="Fim"></label></div><label>GMs <input type="number" id="np-n" min="1" max="9" value="${m.n || 1}" size="3"></label></div>
        <div class="np-dias" role="group" aria-label="Dias da semana">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="dia-chk"><input type="checkbox" value="${d}" ${diasSel.has(d) ? "checked" : ""}> ${SEMANA[d].slice(0, 3)}</label>`).join("")}</div>
        <p class="dica">Vaga coberta com hora extra: as sugestões trazem primeiro quem é do dia e estende (EJA começa quando o serviço do GM termina).</p></div>`
      : `<div class="linha"><label>GMs de dia <input type="number" id="np-dia" min="0" max="9" value="${m.dia}" size="3"></label><label>GMs de noite <input type="number" id="np-noite" min="0" max="9" value="${m.noite}" size="3"></label></div>`}
      <label>Área / complemento <input id="np-sub" placeholder="opcional" value="${esc(m.sub || "")}"></label>
      ${ui.view === "quadro" ? `<label class="toggle"><input type="checkbox" id="np-so"> Só em ${ddmm(ui.dia)} (extra deste dia, não entra no padrão)</label>` : ""}
      ${ref ? "" : escolhaPadrao()}
      <button class="btn pri" data-act="posto-criar">Criar</button></div>`;
}
function popNovo(s) {
  const sec = s.secao || data.secoes[0]?.id;
  return `${cabPop("Adicionar", "Posto, viatura, moto, seção ou grupamento")}<div class="pop-corpo">
    ${blocoNovoPosto(sec, s)}
    <div class="bloco"><b>Seção ou grupamento</b>
      <div class="linha"><label class="cresce">Nome <input id="ns-nome" placeholder="ex.: GOC ou OPERAÇÃO VERÃO"></label></div>
      <label class="toggle"><input type="checkbox" id="ns-grupo"> É um grupamento (motos, GOC…): só aparece quando tem GM escalado</label>
      <button class="btn" data-act="secao-criar">Criar seção</button></div></div>`;
}
// complemento (área / finalidade) do posto naquele dia: o do dia, se houver, senão o do cadastro
const subNoDia = (p, cd) => { const a = cd?.ajustesPosto?.get(p.id)?.area; return a ? a.sub : p.sub || ""; };
const postoDoDia = (p, dia) => postoAtivoEm(p, dia);
const opNoDia = (s, dia) => !s.operacao || (s.operacao.de <= dia && dia <= s.operacao.ate);
const textoOp = (o) => `${o.local ? `${o.local} · ` : ""}${o.de === o.ate ? ddmm(o.de) : `${ddmm(o.de)} a ${ddmm(o.ate)}`} · ${o.ini}–${o.fim}`;
// ---------- BUSCAR GM ----------
// Onde o GM está no dia (ou por que não está), o padrão dele, horas e folgas do mês
function popBuscaGm(s) {
  return `${cabPop("Buscar GM", `${SEMANA[diaSemana(ui.dia)]} ${ddmm(ui.dia)}`)}<div class="pop-corpo">
    <input id="bg-in" class="bg-in" placeholder="Digite o nome do GM" autocomplete="off" value="${esc(s.q || "")}">
    <div id="bg-res">${resultadosBuscaGm(s.q || "", s.gm)}</div></div>`;
}
function resultadosBuscaGm(q, gmSel) {
  if (gmSel) return cartaoBuscaGm(gmPorId(gmSel));
  const n = norm(q.trim()); if (!n) return `<p class="meta">Mostra onde ele está escalado hoje, ou a situação dele (folga, férias, à disposição…), o padrão e as horas do mês.</p>`;
  const lista = data.gms.filter((g) => norm(g.nome).includes(n)).sort((a, b) => norm(b.nome).startsWith(n) - norm(a.nome).startsWith(n) || a.nome.localeCompare(b.nome)).slice(0, 8);
  if (lista.length === 1) return cartaoBuscaGm(lista[0]);
  return lista.length ? `<ul class="bg-lista">${lista.map((g) => `<li><button class="pessoa" data-act="bg-escolher" data-gm="${g.id}"><b>${esc(g.nome)}</b><small>${esc(situacaoCurta(g, ui.dia))}</small></button></li>`).join("")}</ul>` : `<p class="meta">Nenhum GM com esse nome.</p>`;
}
function situacaoCurta(g, dia) {
  if (g.ativo === false) return "desativado";
  const cd = calcularDia(data, dia), des = cd.designacoes.filter((d) => d.gm === g.id), af = cd.afastados.find((a) => a.gm === g.id);
  if (des.length) return des.map((d) => `${d.posto ? postoPorId(d.posto)?.nome : "À disposição"} ${fmtHm(d.ini)}–${fmtHm(d.fim)}${d.nat === "he" && !d.fixa ? " (HE)" : d.nat === "bh" ? " (BH+)" : ""}`).join(" · ");
  if (af) return TIPOS[af.tipo] || af.tipo;
  return "não trabalha neste dia";
}
function cartaoBuscaGm(g) {
  if (!g) return "";
  const dia = ui.dia, cd = calcularDia(data, dia), v = vigente(g, dia), eq = equipe(v.equipe), p = v.lotacao?.posto && postoPorId(v.lotacao.posto);
  const des = cd.designacoes.filter((d) => d.gm === g.id), af = cd.afastados.find((a) => a.gm === g.id);
  const longo = !af && data.ocorrencias.find((o) => o.gm === g.id && ["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && o.de <= dia && dia <= (o.ate || o.de));
  let prox = ""; if (!des.length && !af && !longo && g.ativo !== false) for (let k = 1; k <= 7; k++) { const d2 = somaDias(dia, k); if (trabalhaNoDia(data, g, d2)) { prox = `${SEMANA[diaSemana(d2)].toLowerCase()} ${ddmm(d2)}`; break; } }
  const m = mesDe(dia), folgas = data.ocorrencias.filter((o) => o.tipo === "FOLGA" && o.gm === g.id && o.de.startsWith(m)).map((o) => ddmm(o.de));
  const ofertas = ofertasAbertas(dia).filter((o) => aguardando(o).some((x) => x.gm === g.id));
  const situ = g.ativo === false ? `<span class="tag furo">desativado</span>`
    : des.length ? des.map((d) => `<div class="bg-onde"><b>${esc(d.posto ? postoPorId(d.posto)?.nome : "À disposição")}</b> <span class="hr">${fmtHm(d.ini)}–${fmtHm(d.fim)}</span>${d.nat === "he" && !d.fixa ? ` <span class="tag he">HE</span>` : d.nat === "bh" ? ` <span class="tag bh">BH+</span>` : d.fixa ? ` <span class="tag he">HE fixa</span>` : ""}${d.remanejado ? ` <span class="tag rem">remanejado</span>` : ""}${d.funcao ? ` <small class="meta">${esc(d.funcao)}</small>` : ""}</div>`).join("")
    : af ? `<div class="bg-onde fora"><b>${esc(TIPOS[af.tipo] || af.tipo)}</b>${af.oc?.ate && af.oc.ate !== af.oc.de ? ` até ${ddmm(af.oc.ate)}` : ""}${af.tipo === "TROCA" ? ` · coberto por ${esc(nomeGm(af.oc.substituto))}` : ""}</div>`
    : longo ? `<div class="bg-onde fora"><b>${esc(TIPOS[longo.tipo])}</b> até ${ddmm(longo.ate || longo.de)}</div>`
    : `<div class="bg-onde fora">Não trabalha neste dia${prox ? ` · próximo serviço: <b>${prox}</b>` : ""}</div>`;
  return `<div class="bg-card"><div class="bg-cab"><b class="bg-nome">${esc(g.nome)}</b>${seloHE(minHE(g.id, dia))}</div>
    ${situ}
    <dl class="bg-dl"><dt>Padrão</dt><dd>${eq ? esc(rotuloEquipe(eq, dia)) : "<b class='ruim'>sem escala</b>"}</dd>
      <dt>Posto</dt><dd>${p ? `${esc(p.nome)}${p.ativo === false ? " <b class='ruim'>(excluído)</b>" : ""}` : "<b class='ruim'>sem posto</b>"}${v.lotacao?.funcao ? ` · ${esc(v.lotacao.funcao)}` : ""}</dd>
      <dt>Horário</dt><dd>${esc(textoHorario(v.lotacao?.segmentos))}</dd>
      <dt>Folgas em ${MESES[Number(m.slice(5)) - 1]}</dt><dd>${folgas.length ? folgas.join(", ") : "nenhuma"}</dd>
      ${g.grupos?.length ? `<dt>Grupamentos</dt><dd>${esc(g.grupos.join(", "))}</dd>` : ""}${g.cnh ? `<dt>CNH</dt><dd>${esc(g.cnh)}</dd>` : ""}${g.obs ? `<dt>Obs.</dt><dd>${esc(g.obs)}</dd>` : ""}
      ${ofertas.length ? `<dt>HE oferecida</dt><dd>aguardando resposta (${ofertas.map((o) => esc(postoPorId(o.posto)?.nome)).join(", ")})</dd>` : ""}</dl>
    <div class="linha">${des.some((d) => d.posto) ? `<button class="btn pri" data-act="bg-mostrar" data-gm="${g.id}">Mostrar no quadro</button>` : ""}
      <button class="btn" data-act="abrir-ficha" data-gm="${g.id}">Ficha</button><button class="btn" data-act="bg-lotacao" data-gm="${g.id}">Lotação e horário…</button><button class="link" data-act="bg-limpar">outro GM</button></div></div>`;
}
function destacarGm(gm) {
  setTimeout(() => {
    const el = document.querySelector(`button.chip[data-des] .nm`) && [...document.querySelectorAll("table.quadro button.chip[data-des]")].find((c) => ui.desMap.get(c.dataset.des)?.gm === gm)
      || [...document.querySelectorAll(`.pgm[data-gm="${gm}"]`)][0];
    if (!el) { toast(`${nomeGm(gm)} não aparece nesta tela.`); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("piscar"); setTimeout(() => el.classList.remove("piscar"), 2400);
  }, 60);
}
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
      ${!fa ? `<div class="bloco"><b>${ehViatura(p) ? "Área / finalidade" : "Complemento"} neste dia</b><div class="linha"><label class="cresce"><input id="pp-area" value="${esc(subNoDia(p, cd))}" placeholder="ex.: CANUDOS 2 · OPERAÇÃO VERÃO"></label>
        <button class="btn" data-act="posto-area">Salvar só para ${ddmm(ui.dia)}</button>${aj.area ? `<button class="link" data-act="posto-prefixo-reset" data-oc="${aj.area.id}">Voltar ao normal (${esc(p.sub || "vazio")})</button>` : ""}</div></div>` : ""}
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
      <label class="toggle"><input type="checkbox" id="ps-cargo" ${cargoProprio(p) ? "checked" : ""}> Outro cargo (ex.: operadores do videomonitoramento): quem é lotado aqui só faz HE aqui</label>
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
    ${blocoNovoPosto(sec.id, s)}
    <div class="bloco"><label class="toggle"><input type="checkbox" id="sc-grupo" ${sec.grupamento ? "checked" : ""}> Destacar como grupamento (motos, GOC…)</label></div>
    <div class="bloco ${s.excluir ? "realce" : ""}"><b>Excluir seção</b>${(() => { const ps = data.postos.filter((p) => p.secao === sec.id); return ps.length
      ? `<p class="dica">Tem ${ps.length} posto(s). Eles vão para outra seção:</p><div class="linha"><select id="sc-destino">${data.secoes.filter((x) => x.id !== sec.id).map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join("")}</select><button class="btn perigo-leve" data-act="secao-excluir">Mover postos e excluir</button></div>`
      : `<div><button class="btn perigo-leve" data-act="secao-excluir">Excluir esta seção</button></div>`; })()}</div>
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
  const oc = ehHE ? data.ocorrencias.find((x) => x.id === d.origem) : d.ajuste ? data.ocorrencias.find((x) => x.id === d.ajuste) : d.remanej ? data.ocorrencias.find((x) => x.id === d.remanej) : null;
  const troca = d.nat === "troca" ? data.ocorrencias.find((x) => x.id === d.origem) : null;
  return {
    ini: oc?.ini || fmtHm(d.ini), fim: oc?.fim || fmtHm(d.fim),
    req: oc?.req || (d.fixa ? "" : troca?.req || d.req || ""), obs: oc?.obs && !(d.remanej && !d.ajuste && OBS_AUTO_REMANEJ.has(oc.obs)) ? oc.obs : d.obs || "",
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

// ---------- MODO SERVIDOR (dados no banco da Cloudflare) ----------
// Sem servidor, tudo fica no navegador (localStorage). Com servidor, cada alteração vira um
// comando enviado com a revisão que a tela conhece; se outra pessoa salvou antes, recarrega.
const SERVIDOR = typeof window !== "undefined" ? window.ESCALA_SERVIDOR : null;
const DOCS_SYNC = ["postos", "secoes", "equipes", "config", "requerimentos", "inspetores", "frota", "folgasSync"];
const srv = { revisao: 0, foto: null, enviando: false, pendente: false, resumos: [], estado: "ok" };
function fotografar(d) {
  return {
    gms: new Map(d.gms.map((g) => [g.id, JSON.stringify(g)])),
    ocorrencias: new Map(d.ocorrencias.map((o) => [o.id, JSON.stringify(o)])),
    controle: new Map((d.controle || []).map((o) => [o.id, JSON.stringify(o)])),
    docs: Object.fromEntries(DOCS_SYNC.map((k) => [k, JSON.stringify(d[k] ?? null)])),
  };
}
function diferenca() {
  const ops = [], f = srv.foto;
  for (const c of ["gms", "ocorrencias", "controle"]) {
    const vistos = new Set();
    for (const x of data[c] || []) {
      vistos.add(x.id);
      const j = JSON.stringify(x);
      if (f[c].get(x.id) !== j) ops.push({ t: "put", c, id: x.id, v: x });
    }
    for (const id of f[c].keys()) if (!vistos.has(id)) ops.push({ t: "del", c, id });
  }
  for (const k of DOCS_SYNC) if (JSON.stringify(data[k] ?? null) !== f.docs[k]) ops.push({ t: "doc", k, v: data[k] ?? null });
  return ops;
}
function mostrarSync(estado) {
  srv.estado = estado;
  const el = $("#sync");
  if (!el) return;
  el.hidden = false;
  el.className = "sync " + estado;
  el.textContent = { ok: "✓ Salvo", salvando: "Salvando…", erro: "Sem conexão · tentando de novo" }[estado];
}
async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, { ...opcoes, headers: { "content-type": "application/json", ...(opcoes.headers || {}) } });
  if (r.status === 401) { location.href = "/login"; throw new Error("sessao"); }
  const corpo = await r.json().catch(() => ({}));
  return { status: r.status, corpo };
}
async function sincronizar() {
  if (srv.enviando) { srv.pendente = true; return; }
  const ops = diferenca();
  if (!ops.length) { mostrarSync("ok"); return; }
  srv.enviando = true; srv.pendente = false;
  mostrarSync("salvando");
  const resumo = srv.resumos.splice(0).join(" · ") || "Alteração";
  const cmd = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    let res;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try { res = await api("/api/comandos", { method: "POST", body: JSON.stringify({ revisao: srv.revisao, cmd, resumo, ops }) }); break; }
      catch (e) { if (e.message === "sessao" || tentativa === 2) throw e; await new Promise((ok) => setTimeout(ok, 1500 * (tentativa + 1))); }
    }
    if (res.status === 409) {
      await carregarDoServidor();
      toast("A escala foi alterada em outro computador. Abri a versão mais nova: confira e refaça a sua última mudança, se precisar.");
    } else if (res.status !== 200) {
      throw new Error(res.corpo.erro || "erro");
    } else {
      srv.revisao = res.corpo.revisao;
      srv.foto = fotografar(data);
      mostrarSync("ok");
    }
  } catch (e) {
    if (e.message === "sessao") return;
    srv.resumos.unshift(resumo);
    mostrarSync("erro");
    setTimeout(() => { srv.enviando = false; sincronizar(); }, 4000);
    return;
  }
  srv.enviando = false;
  if (srv.pendente) sincronizar();
}
async function carregarDoServidor() {
  const { status, corpo } = await api("/api/estado");
  if (status !== 200) throw new Error(corpo.erro || "Falha ao carregar");
  srv.revisao = corpo.revisao;
  if (corpo.vazio) { ui.vazio = true; ui.pronto = true; render(); return; }
  data = { controle: [], ...corpo.estado, _versao: Date.now() };
  srv.foto = fotografar(data);
  desfazer.length = 0;
  ui.vazio = false; ui.pronto = true;
  mostrarSync("ok");
  render();
  conferirFolgas(false);
}
function telaServidor() {
  if (!ui.pronto) return `<div class="tela-centro"><p class="dica">Carregando a escala…</p></div>`;
  return `<div class="tela-centro"><section class="painel boas-vindas"><h2>Banco de dados vazio</h2>
    <p>Este é o primeiro acesso. Para conhecer o sistema, comece com os dados de exemplo (nomes e escalas fictícios). Depois dá para trocar pelos dados reais.</p>
    <button class="btn pri grande" data-act="srv-exemplo">Começar com dados de exemplo</button></section></div>`;
}
async function iniciarServidor() {
  $("#restaurar").outerHTML = `<span>${esc(SERVIDOR.nome)}</span> · <a class="link" href="/sair">Sair</a>`;
  try { await carregarDoServidor(); }
  catch { $("#main").innerHTML = `<div class="tela-centro"><p class="dica">Não consegui falar com o servidor. Verifique a internet e recarregue a página.</p></div>`; }
}
async function carregarHistorico() {
  const el = $("#historico");
  if (!el) return;
  try {
    const { corpo } = await api("/api/eventos");
    el.innerHTML = corpo.eventos.length ? `<table class="hist-ev"><tbody>${corpo.eventos.map((e) => `<tr><td class="num">${e.quando.slice(8, 10)}/${e.quando.slice(5, 7)} ${new Date(e.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(e.quem)}</td><td>${esc(e.resumo)}</td></tr>`).join("")}</tbody></table>` : `<p class="dica">Nenhuma alteração ainda.</p>`;
  } catch { el.innerHTML = `<p class="dica">Não consegui carregar o histórico.</p>`; }
}

// ---------- MENU DO BOTÃO DIREITO (estilo Windows) ----------
// Mostra todas as opções do GM, posto, célula ou seção num menu pequeno. A opção em negrito é a mesma do clique normal.
function tirarDoDia(d, m) {
  const quem = d.nat === "troca" ? d.titular : d.gm;
  mudar(`${TIPOS[m]} para ${nomeGm(quem)}. A vaga ficou aberta: clique em "Cobrir".`, () => {
    if (d.nat === "troca") data.ocorrencias = data.ocorrencias.filter((o) => o.id !== d.origem);
    data.ocorrencias.push({ id: novoId(), tipo: m, gm: quem, de: ui.dia });
  });
}
function itensGm(d, turnoId) {
  const req = valoresCartao(d).req;
  return [
    { t: "Editar horário, REQ e observação…", act: "mn-card", padrao: true },
    { t: "Trocar o GM…", act: "mn-trocar" },
    ...(ehHeLancada(d) || d.fixa || !emVtr(d.posto) ? [] : [{ t: `Função${d.funcao ? ` (${d.funcao.toLowerCase()})` : ""}`, sub: [
      ...[["Motorista", "Motorista"], ["Patrulheiro", "Patrulheiro"], ["", "Sem função"]].map(([f, t]) => ({ t: `${d.funcao === f ? "✓ " : ""}${t} · só hoje`, act: "mn-funcao", d: { f, escopo: "dia" } })),
      { sep: true },
      ...[["Motorista", "Motorista"], ["Patrulheiro", "Patrulheiro"]].map(([f, t]) => ({ t: `${t} · sempre (no padrão)`, act: "mn-funcao", d: { f, escopo: "sempre" } })),
    ] }]),
    ...itensEstender(d),
    { sep: true },
    ...(d.recorrente ? [{ t: "Não fazer esta HE recorrente hoje", act: "mn-sem-rec" }]
    : ehHeLancada(d) ? [{ t: d.nat === "bh" ? "Converter em hora extra" : "Converter em banco de horas (BH+)", act: "mn-converter" }, ...itensRemoverHE(d, turnoId).map((x) => ({ ...x, padrao: false }))]
      : [{ t: "Tirar do dia", sub: [["FOLGA", "Folga"], ["FALTA", "Faltou"], ["ATESTADO", "Atestado"], ["BH_COMP", "Compensação de banco de horas"]].map(([m, t]) => ({ t, act: "mn-tirar", d: { m } })) }]),
    { t: "Remanejar para outro posto…", act: "mn-drawer", d: { acao: "remanej" } },
    { t: "Afastamento (férias, licença, curso)…", act: "mn-drawer", d: { acao: "afast" } },
    { t: "Lotação e horário fixo…", act: "mn-drawer", d: { acao: "lotacao" } },
    { sep: true },
    { t: "Copiar", act: "mn-copiar", atalho: "Ctrl+C" },
    { sep: true },
    { t: "Ver ficha do GM", act: "mn-ficha" },
    ...(req ? [{ t: `Ver tudo do REQ ${req}`, act: "mn-req", d: { req } }] : []),
    ...itensGerais(),
  ];
}
function itensPosto(p) {
  const cd = calcularDia(data, ui.dia), fa = cd.fa.find((o) => o.posto === p.id), irmaos = data.postos.filter((x) => x.secao === p.secao), i = irmaos.indexOf(p);
  return [
    { t: `Editar ${ehViatura(p) ? "viatura" : "posto"} neste dia…`, act: "mn-posto", d: { aba: "dia" }, padrao: true },
    fa ? { t: "Voltar a funcionar a partir de hoje", act: "mn-reabrir", d: { oc: fa.id } }
      : { t: ehViatura(p) ? "Pôr em manutenção (FA) hoje" : "Fechar o posto hoje", act: "mn-fechar", d: { tipo: ehViatura(p) ? "FA" : "FECHADO" } },
    ...(ehViatura(p) && !fa ? [{ t: "Usar outra viatura hoje…", act: "mn-posto", d: { aba: "dia" } }] : []),
    { sep: true },
    { t: "Cadastro (nome, zona, vagas)…", act: "mn-posto", d: { aba: "sempre" } },
    { t: "Subir", act: "mn-mover", d: { d: "-1" }, desab: i <= 0 },
    { t: "Descer", act: "mn-mover", d: { d: "1" }, desab: i >= irmaos.length - 1 },
    ...itensMoverPosto(p),
    { t: "Copiar como modelo (para colar em outra seção)", act: "copiar-modelo", d: { id: p.id } },
    { sep: true },
    { t: `Excluir ${ehViatura(p) ? "viatura" : "posto"}…`, act: "mn-excluir-posto" },
    ...itensGerais(),
  ];
}
function itensPostoPadrao(p) {
  const irmaos = data.postos.filter((x) => x.secao === p.secao && x.ativo !== false), i = irmaos.indexOf(p);
  const temNoite = ["t4", "t1"].some((t) => p.vagas?.[t]), temDia = ["t2", "t3"].some((t) => p.vagas?.[t]);
  return [
    { t: "Editar cadastro (nome, zona, vagas)…", act: "mn-posto", d: { aba: "sempre" }, padrao: true },
    { t: temDia ? "Não usar de dia (tirar as vagas do dia)" : "Usar de dia (1 vaga)", act: "pad-vagas", d: { per: "dia", n: temDia ? "0" : "1" } },
    { t: temNoite ? "Não usar à noite (tirar as vagas da noite)" : "Usar à noite (1 vaga)", act: "pad-vagas", d: { per: "noite", n: temNoite ? "0" : "1" } },
    ...(["impar", "par"].includes(ui.padrao?.aba) ? [p.equipes?.length
      ? { t: "Existir nos dois padrões (ímpar e par)", act: "pad-so", d: { qual: "" } }
      : { t: `Existir só no padrão ${ui.padrao.aba === "impar" ? "ímpar" : "par"} (este)`, act: "pad-so", d: { qual: ui.padrao.aba } }] : []),
    { sep: true },
    { t: "Subir", act: "mn-mover", d: { d: "-1" }, desab: i <= 0 },
    { t: "Descer", act: "mn-mover", d: { d: "1" }, desab: i >= irmaos.length - 1 },
    ...itensMoverPosto(p),
    { t: "Copiar como modelo (para colar em outra seção)", act: "copiar-modelo", d: { id: p.id } },
    { sep: true },
    { t: `Excluir ${ehViatura(p) ? "viatura" : "posto"}…`, act: "mn-excluir-posto" },
    ...itensGerais(),
  ];
}
function mudarVagasPeriodo(p, per, n) {
  const ts = per === "dia" ? ["t2", "t3"] : ["t4", "t1"];
  mudar(`${p.nome}: ${n ? `${n} vaga ${per === "dia" ? "de dia" : "à noite"}` : `sem vaga ${per === "dia" ? "de dia" : "à noite"} (não abre mais falta)`}`, () => { p.vagas = { ...(p.vagas || {}) }; for (const t of ts) p.vagas[t] = n; });
}
function itensCelula(posto, turno) {
  const cd = calcularDia(data, ui.dia), t = TURNOS.find((x) => x.id === turno), p = postoPorId(posto);
  const furo = cd.furos.some((f) => f.posto === posto && f.turno === turno);
  const ops = opcoesVaga(posto, turno);
  const it = [...ops.map(([a, b, r], i) => ({ t: `Hora extra ${r} (${fmtHm(a)}–${fmtHm(b)})…`, act: "mn-add", d: { posto, turno, ini: a, fim: b }, padrao: i === 0 })),
    ...(furo ? [{ t: "Deixar sem GM neste dia", act: "pend-semgm", d: { posto, turnos: turno, dia: ui.dia } }] : []),
    { t: "Banco de horas (BH+)", sub: ops.map(([a, b, r]) => ({ t: `${r} (${fmtHm(a)}–${fmtHm(b)})…`, act: "mn-add", d: { posto, turno, ini: a, fim: b, nat: "bh" } })) }];
  // estender quem termina antes deste turno; começar mais cedo quem entra depois dele (no mesmo posto)
  const aqui = cd.designacoes.filter((d) => d.posto === posto && d.nat !== "he" && !d.fixa);
  const estender = aqui.filter((d) => d.fim === t.ini).map((d) => ({ t: `Estender ${nomeGm(d.gm)} até ${fmtHm(t.fim)} (+${fmtHoras(t.fim - t.ini)} de HE)`, act: "mn-est-cel", d: { des: d.id, fim: fmtHm(t.fim) } }));
  const cedo = aqui.filter((d) => d.ini === t.fim).map((d) => ({ t: `${nomeGm(d.gm)} começa mais cedo, às ${fmtHm(t.ini)} (+${fmtHoras(t.fim - t.ini)} de HE)`, act: "mn-cedo-cel", d: { des: d.id, ini: fmtHm(t.ini) } }));
  return [
    ...(furo || !aqui.some((d) => naColuna(d, t)) ? it : [{ t: "Pôr mais um GM aqui…", act: "mn-add", d: { posto, turno }, padrao: true }]),
    ...(estender.length || cedo.length ? [{ sep: true }, ...estender, ...cedo] : []),
    ...(ui.copiado ? [{ sep: true }, { t: `Colar ${nomeGm(ui.copiado.gm)} aqui`, act: "mn-colar", atalho: "Ctrl+V" }] : []),
    ...(cd.furos.length ? [{ sep: true }, { t: "Preencher furos do dia sozinho", act: "auto", d: { dias: "1" } }] : []),
    { sep: true },
    ...itensPosto(p).slice(0, 2),
    ...itensGerais(),
  ];
}
// submenu longo: sobe o que for preciso para caber na tela
document.addEventListener("mouseover", (e) => {
  const sub = e.target.closest?.("#menu .mn-sub"); if (!sub) return; const fly = sub.querySelector(":scope > .mn-fly"); if (!fly) return;
  requestAnimationFrame(() => { fly.style.top = "-5px"; const r = fly.getBoundingClientRect(), passa = r.bottom - (innerHeight - 8); if (passa > 0) fly.style.top = `${-5 - Math.min(passa, r.top - 8)}px`; });
});
// ---------- ORDENAR SEÇÕES E POSTOS ----------
// Arrastar pelo nome: seção sobre outra seção = vai para antes dela; posto sobre outro posto = antes dele (pode trocar de seção);
// posto sobre o nome de uma seção = vai para o topo dela.
const ordem = { arr: null };
document.addEventListener("dragstart", (e) => {
  const al = e.target.closest?.(".alca"); if (!al) return;
  const s0 = al.dataset.secao ? al : null, p0 = al.dataset.posto ? al : null;
  ordem.arr = s0 ? { tipo: "secao", id: s0.dataset.secao } : { tipo: "posto", id: p0.dataset.posto };
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ordem.arr.id);
  document.body.classList.add("ordenando");
});
const alvoOrdem = (el) => { const tr = el?.closest?.("tr"); if (!tr) return null; const s0 = tr.querySelector(".secao-btn[data-secao]"), p0 = tr.querySelector(".posto-btn[data-posto]");
  return s0 ? { tr, secao: s0.dataset.secao } : p0 ? { tr, posto: p0.dataset.posto } : null; };
document.addEventListener("dragover", (e) => {
  if (!ordem.arr) return; const a = alvoOrdem(e.target); if (!a) return;
  e.preventDefault(); document.querySelectorAll(".drop-antes").forEach((x) => x !== a.tr && x.classList.remove("drop-antes")); a.tr.classList.add("drop-antes");
});
document.addEventListener("dragend", () => { ordem.arr = null; document.body.classList.remove("ordenando"); document.querySelectorAll(".drop-antes").forEach((x) => x.classList.remove("drop-antes")); });
document.addEventListener("drop", (e) => {
  const o = ordem.arr; if (!o) return; const a = alvoOrdem(e.target); if (!a) return; e.preventDefault();
  if (o.tipo === "secao") moverSecao(o.id, a.secao || postoPorId(a.posto)?.secao);
  else if (a.posto) moverPosto(o.id, postoPorId(a.posto).secao, a.posto);
  else { const prim = data.postos.find((x) => x.secao === a.secao && x.ativo !== false); moverPosto(o.id, a.secao, prim?.id || ""); }
});
function moverSecao(id, antesDe) { // antesDe = id da seção (ou "" para o fim)
  const sec = data.secoes.find((x) => x.id === id); if (!sec || id === antesDe) return;
  const alvo = antesDe ? data.secoes.find((x) => x.id === antesDe) : null;
  mudar(`Seção ${sec.nome} ${alvo ? `movida para antes de ${alvo.nome}` : "movida para o fim"}`, () => {
    data.secoes.splice(data.secoes.indexOf(sec), 1);
    data.secoes.splice(alvo ? data.secoes.indexOf(alvo) : data.secoes.length, 0, sec);
  });
}
function moverPosto(id, secaoId, antesDe) { // antesDe = id do posto (ou "" para o fim da seção)
  const p = postoPorId(id); if (!p || id === antesDe) return;
  const sec = data.secoes.find((x) => x.id === secaoId), alvo = antesDe ? postoPorId(antesDe) : null;
  mudar(`${p.nome} ${alvo ? `movido para antes de ${alvo.nome}` : `movido para o fim de ${sec?.nome || "seção"}`}`, () => {
    data.postos.splice(data.postos.indexOf(p), 1);
    p.secao = secaoId;
    let i;
    if (alvo) i = data.postos.indexOf(alvo);
    else { const ult = data.postos.map((x, k) => [x, k]).filter(([x]) => x.secao === secaoId).pop(); i = ult ? ult[1] + 1 : data.postos.length; }
    data.postos.splice(i, 0, p);
  });
}
const itensMoverSecao = (id) => {
  const outras = data.secoes.filter((x) => x.id !== id && !x.operacao);
  return [{ t: "Mover para o topo", act: "ord-sec", d: { id, antes: data.secoes[0]?.id === id ? "" : data.secoes[0]?.id || "" }, desab: data.secoes[0]?.id === id },
    { t: "Mover para…", sub: [...outras.map((x) => ({ t: `antes de ${x.nome}`, act: "ord-sec", d: { id, antes: x.id } })), { sep: true }, { t: "para o fim", act: "ord-sec", d: { id, antes: "" } }] }];
};
const itensMoverPosto = (p) => {
  const irmaos = data.postos.filter((x) => x.secao === p.secao && x.ativo !== false);
  return [{ t: "Mover para o topo da seção", act: "ord-posto", d: { id: p.id, sec: p.secao, antes: irmaos[0]?.id || "" }, desab: irmaos[0] === p },
    { t: "Mover para a seção…", sub: data.secoes.filter((x) => x.id !== p.secao && !x.operacao).map((x) => ({ t: x.nome, act: "ord-posto", d: { id: p.id, sec: x.id, antes: "" } })) }];
};
function itensSecao(id) {
  const s = data.secoes.find((x) => x.id === id), i = data.secoes.indexOf(s);
  return [
    { t: "Renomear", act: "mn-secao-nome", d: { secao: id }, padrao: true },
    { t: "Novo posto ou viatura…", act: "mn-secao", d: { secao: id } },
    ...(ui.modeloCopiado && postoPorId(ui.modeloCopiado) ? [{ t: `Colar modelo de ${postoPorId(ui.modeloCopiado).nome} aqui…`, act: "colar-modelo", d: { secao: id } }] : []),
    { t: s.grupamento ? "✓ Destacada como grupamento" : "Destacar como grupamento", act: "secao-grupo", d: { secao: id } },
    { sep: true },
    { t: "Subir", act: "mn-secao-mover", d: { secao: id, d: "-1" }, desab: i === 0 },
    { t: "Descer", act: "mn-secao-mover", d: { secao: id, d: "1" }, desab: i === data.secoes.length - 1 },
    ...itensMoverSecao(id),
    { sep: true },
    { t: "Excluir seção…", act: "mn-secao", d: { secao: id, excluir: "1" } },
    ...itensGerais(),
  ];
}
const itensGerais = () => desfazer.length ? [{ sep: true }, { t: "Desfazer", act: "desfazer", atalho: "Ctrl+Z" }] : [];

function htmlItens(itens) {
  return itens.map((i) => {
    if (i.sep) return `<div class="mn-sep" role="separator"></div>`;
    const dados = Object.entries(i.d || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
    if (i.sub) return `<div class="mn-sub"><button class="mn-item" role="menuitem" aria-haspopup="menu" aria-expanded="false">${esc(i.t)}<span class="mn-seta" aria-hidden="true">›</span></button><div class="mn-fly" role="menu">${htmlItens(i.sub)}</div></div>`;
    return `<button class="mn-item ${i.padrao ? "padrao" : ""}" role="menuitem" data-act="${i.act}"${dados} ${i.desab ? "disabled" : ""}>${esc(i.t)}${i.atalho ? `<span class="mn-atalho">${i.atalho}</span>` : ""}</button>`;
  }).join("");
}
function abrirMenu(itens, x, y, alvo, ctx) {
  const m = $("#menu");
  ui.menu = { alvo, ...ctx, aberto: Date.now() };
  m.innerHTML = htmlItens(itens);
  m.hidden = false;
  m.style.left = "0px"; m.style.top = "0px";
  const w = m.offsetWidth, h = m.offsetHeight;
  const L = Math.max(4, Math.min(x, innerWidth - w - 4)), T = Math.max(4, Math.min(y, innerHeight - h - 4));
  m.style.left = L + "px"; m.style.top = T + "px";
  m.classList.toggle("abre-esq", L + w + 220 > innerWidth);
  m.querySelector(".mn-item:not([disabled])")?.focus();
}
function fecharMenu() { const m = $("#menu"); if (m && !m.hidden) { m.hidden = true; m.innerHTML = ""; ui.menu = null; } }

document.addEventListener("contextmenu", (e) => {
  // menu normal do navegador só em campos de texto, texto selecionado (copiar) ou com Shift
  if (e.shiftKey || e.target.closest("input, textarea, select, #menu") || String(getSelection?.() || "").trim()) return;
  const liEd = e.target.closest("#ed-lista li[data-i]");
  if (liEd) { e.preventDefault(); menuSugestao(Number(liEd.dataset.i), liEd, e.clientX, e.clientY); return; }
  if (e.target.closest("#inline")) { e.preventDefault(); ui.proxies = []; const it = itensDosBotoes($("#inline")).slice(0, 12); if (it.length) abrirMenu(it, e.clientX, e.clientY, $("#inline"), {}); return; }
  if (e.target.closest("#pop, #drawer")) { menuGenerico(e); return; }
  const chipEl = e.target.closest("button.chip[data-des]"), tr = e.target.closest("table.quadro tr");
  // a linha inteira conta: passar o mouse em qualquer parte da seção ou do nome do posto abre o menu dela
  const postoEl = e.target.closest(".posto-btn") || e.target.closest("table.quadro th.posto")?.querySelector(".posto-btn");
  const secEl = e.target.closest(".secao-btn") || (tr?.classList.contains("secao") ? tr.querySelector(".secao-btn[data-secao]") : null);
  const cel = e.target.closest("table.quadro td[data-posto]");
  const alvo = chipEl || postoEl || secEl || cel;
  if (!alvo) { menuGenerico(e); return; }
  e.preventDefault();
  fecharPop();
  const r = alvo.getBoundingClientRect();
  const x = e.clientX || r.left + 8, y = e.clientY || r.bottom; // teclado (Shift+F10) não informa posição
  if (chipEl) { const d = ui.desMap.get(chipEl.dataset.des); if (d) abrirMenu(itensGm(d, chipEl.closest("td[data-turno]")?.dataset.turno), x, y, chipEl, { des: d }); }
  else if (postoEl) abrirMenu((ui.view === "padroes" ? itensPostoPadrao : itensPosto)(postoPorId(postoEl.dataset.posto)), x, y, postoEl, { posto: postoEl.dataset.posto });
  else if (secEl) abrirMenu(itensSecao(secEl.dataset.secao), x, y, secEl, {});
  else abrirMenu(itensCelula(cel.dataset.posto, cel.dataset.turno), x, y, cel, { posto: cel.dataset.posto });
});
// Menu do botão direito em qualquer outro lugar: célula dos padrões, linhas de listas (lançamentos, mês, efetivo),
// cartões da frota e o fundo do quadro. Os itens são os próprios botões daquele lugar ("atalhos" que clicam neles).
function itensDosBotoes(box) {
  const vistos = new Set(), out = [];
  for (const b of box.querySelectorAll("button[data-act], a[data-act]")) {
    if (b.disabled || b.closest("[hidden]") || !b.getClientRects().length) continue;
    if (b.dataset.act === "abrir-ficha" && b.dataset.gm) continue; // já vem nos itens do GM
    let t = (b.getAttribute("aria-label") || b.textContent || b.title || "").replace(/\s+/g, " ").replace(/[✎›×]/g, "").trim();
    if (b.title && t.length <= 8 && !b.title.includes(t)) t = `${t} · ${b.title}`;
    if (b.getAttribute("aria-pressed") === "true" || b.classList.contains("on")) t = "✓ " + t;
    if (!t || t.length > 60) t = (b.title || t).slice(0, 60); if (!t || vistos.has(t)) continue;
    vistos.add(t); out.push({ t, act: "mn-proxy", d: { i: String((ui.proxies ||= []).push(b) - 1) } });
  }
  return out;
}
function itensDeGm(gm) {
  return [{ t: "Onde está hoje / situação…", act: "mn-busca-gm", d: { gm } }, { t: "Ficha do GM", act: "abrir-ficha", d: { gm } }, { t: "Lotação e horário…", act: "bg-lotacao", d: { gm } }];
}
// Sugestão da lista (pôr GM / trocar / cobrir): botão direito = as mesmas escolhas do clique, mais ficha e situação
function menuSugestao(i, li, x, y) {
  const it = ed.lista[i]; if (!it) return;
  ed.sel = i; atualizarLista();
  if (ed.modo === "add" && it.via !== "rem" && !ed.oferta) { escolherEditor(i); return; } // já abre: oferecer / copiar / lançar
  const g = it.gm.id;
  abrirMenu([{ t: ed.oferta ? `${ed.oferta.has(g) ? "Desmarcar" : "Marcar"} ${it.gm.nome} para a oferta` : it.via === "rem" ? `Remanejar ${it.gm.nome} para cá` : `Escolher ${it.gm.nome}`, act: "mn-ed-escolher", d: { i: String(i) }, padrao: true, desab: !!it.bloqueado },
    { sep: true }, { t: "Onde está hoje / situação…", act: "mn-busca-gm", d: { gm: g } }, { t: "Ficha do GM", act: "abrir-ficha", d: { gm: g } }], x, y, li, {});
}
function menuGenerico(e) {
  ui.proxies = [];
  const x = e.clientX, y = e.clientY;
  const geral = () => { e.preventDefault(); fecharMenu();
    const busca = $("main [data-act=busca-gm]");
    abrirMenu([{ t: "Buscar GM…", act: busca ? "mn-proxy" : "mn-busca-gm", d: busca ? { i: String(ui.proxies.push(busca) - 1) } : { gm: "" }, atalho: "Ctrl+F" },
      ...(desfazer.length ? [{ t: "Desfazer", act: "desfazer", atalho: "Ctrl+Z" }] : []),
      { sep: true }, { t: "Menu do navegador: Shift + botão direito", act: "ed-nada", desab: true }], x, y, e.target, {}); };
  const nav = e.target.closest("a[data-nav]");
  if (nav) { e.preventDefault(); abrirMenu([{ t: `Abrir ${nav.textContent.trim()}`, act: "mn-proxy", d: { i: String(ui.proxies.push(nav) - 1) }, padrao: true }, { t: "Abrir em nova aba", act: "mn-nova-aba", d: { href: nav.getAttribute("href") } }], x, y, nav, {}); return; }
  if (e.target.closest("a[href]")) return; // outros links: menu do navegador
  const naJanela = e.target.closest("#pop, #drawer");
  if (naJanela) { // dentro de uma janela: os botões do item onde clicou
    const box = e.target.closest("li, tr, .pessoa, .bloco, .linha, section") || naJanela;
    const gm = e.target.closest("[data-gm]")?.dataset.gm || box.querySelector("[data-gm]")?.dataset.gm;
    const itens = [...(gm && gmPorId(gm) ? itensDeGm(gm) : []), ...itensDosBotoes(box).slice(0, 10)];
    if (itens.length) { e.preventDefault(); abrirMenu([...itens.slice(0, 1).map((i) => ({ ...i, padrao: true })), ...itens.slice(1), ...itensGerais()], x, y, box, {}); }
    else geral();
    return;
  }
  if (!e.target.closest("main") || !["quadro", "padroes", "lancamentos", "mes", "frota", "pendencias", "ajustes", "ficha", "folha"].includes(ui.view)) { geral(); return; }
  const tdPad = e.target.closest("td[data-pposto]");
  if (tdPad) { // célula do padrão (dia / noite de um posto)
    const p = postoPorId(tdPad.dataset.pposto), per = tdPad.dataset.pper, add = tdPad.querySelector("[data-act=pad-add]");
    const tem = (per === "dia" ? ["t2", "t3"] : ["t4", "t1"]).some((t) => p.vagas?.[t]);
    e.preventDefault(); fecharPop();
    abrirMenu([...(add ? [{ t: `Pôr GM ${per === "dia" ? "de dia" : "à noite"} aqui…`, act: "mn-proxy", d: { i: String(ui.proxies.push(add) - 1) }, padrao: true }] : []),
      { t: tem ? `Não usar ${per === "dia" ? "de dia" : "à noite"}` : `Usar ${per === "dia" ? "de dia" : "à noite"} (1 vaga)`, act: "pad-vagas", d: { per, n: tem ? "0" : "1" } },
      { sep: true }, ...itensPostoPadrao(p).filter((i) => !i.sep && i.act !== "pad-vagas").slice(0, 1), ...itensGerais()], x, y, tdPad, { posto: p.id });
    return;
  }
  const box = e.target.closest("main tr, main li, .fr-card > header, .fr-card");
  if (box && !box.closest("thead")) {
    const gm = box.querySelector("[data-act=abrir-ficha][data-gm]")?.dataset.gm;
    const itens = [...(gm ? itensDeGm(gm) : []), ...itensDosBotoes(box).filter((i) => !(gm && /ficha/i.test(i.t)))];
    if (itens.length) { e.preventDefault(); fecharPop(); abrirMenu([...itens.slice(0, 1).map((i) => ({ ...i, padrao: true })), ...itens.slice(1), ...itensGerais()], x, y, box, {}); return; }
  }
  if (["quadro", "padroes"].includes(ui.view)) { // fundo da tela
    const novo = $("main [data-act=pad-novo]"), busca = $("main [data-act=busca-gm]");
    e.preventDefault(); fecharPop();
    abrirMenu([...(novo ? [{ t: "Novo posto, viatura, seção ou grupamento…", act: "mn-proxy", d: { i: String(ui.proxies.push(novo) - 1) } }] : []),
      ...(busca ? [{ t: "Buscar GM…", act: "mn-proxy", d: { i: String(ui.proxies.push(busca) - 1) }, atalho: "Ctrl+F" }] : []),
      ...(ui.view === "quadro" ? [{ t: `${ui.soFuros ? "✓ " : ""}Ver só o que falta cobrir`, act: "mn-so-furos" }] : []), ...itensGerais()], x, y, e.target, {});
    return;
  }
  // card/item com botões (Semana, ficha, ajustes…): os botões dele; senão, o menu geral
  const card = e.target.closest("main li, main section, main .painel, main .card, main .kpi");
  const gm = e.target.closest("[data-gm]")?.dataset.gm;
  const itens = card ? [...(gm && gmPorId(gm) ? itensDeGm(gm) : []), ...itensDosBotoes(card).slice(0, 10)] : [];
  if (itens.length) { e.preventDefault(); fecharPop(); abrirMenu([...itens, ...itensGerais()], x, y, card, {}); return; }
  geral();
}
// Teclado dentro do menu: setas, Enter, Esc
document.addEventListener("keydown", (e) => {
  const m = $("#menu");
  if (!m || m.hidden) return;
  const atual = document.activeElement?.closest(".mn-item");
  const lista = atual ? [...atual.closest("[role=menu], #menu").querySelectorAll(":scope > .mn-item:not([disabled]), :scope > .mn-sub > .mn-item")] : [];
  const mover = (n) => { if (!lista.length) return; const i = lista.indexOf(atual); lista[(i + n + lista.length) % lista.length].focus(); };
  if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
  else if (e.key === "ArrowRight" && atual?.parentElement.classList.contains("mn-sub")) { e.preventDefault(); atual.parentElement.classList.add("aberto"); atual.setAttribute("aria-expanded", "true"); atual.nextElementSibling.querySelector(".mn-item")?.focus(); }
  else if (e.key === "ArrowLeft" && atual?.closest(".mn-fly")) { e.preventDefault(); const sub = atual.closest(".mn-sub"); sub.classList.remove("aberto"); sub.firstElementChild.setAttribute("aria-expanded", "false"); sub.firstElementChild.focus(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); const el = ui.menu?.alvo; fecharMenu(); el?.focus?.(); }
  else if (e.key === "Tab") { fecharMenu(); }
}, true);
window.addEventListener("resize", fecharMenu);
window.addEventListener("scroll", () => { if (ui.menu && Date.now() - ui.menu.aberto > 400) fecharMenu(); }, { passive: true });

// ---------- ARRASTAR O GM (mouse) ----------
// Segure o quadradinho do GM e solte em outro posto ou turno. Ao soltar, um menu pequeno mostra o que pode ser
// feito ali (remanejar, só um turno, mudar horário, hora extra, trocar de lugar) já com a consequência escrita.
const arr = { ativo: false, d: null, el: null, x0: 0, y0: 0, fantasma: null, alvo: null, rolar: 0, raf: 0 };
function ocupadoEm(gm, a, b, ignorar) {
  return calcularDia(data, ui.dia).designacoes.some((x) => x.gm === gm && x !== ignorar && sobrepoe(x.ini, x.fim, a, b) > 0);
}
function alvoEm(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const chipEl = el.closest("table.quadro button.chip[data-des]");
  const td = el.closest("table.quadro td[data-posto]");
  if (!td) return null;
  return { td, posto: td.dataset.posto, turno: td.dataset.turno, des: chipEl ? ui.desMap.get(chipEl.dataset.des) : null };
}
function marcarAlvo(a) {
  document.querySelectorAll(".alvo-drop").forEach((e) => e.classList.remove("alvo-drop"));
  if (a) a.td.classList.add("alvo-drop");
}
function iniciarArrasto() {
  arr.ativo = true;
  document.body.classList.add("arrastando");
  arr.el.classList.add("origem-drag");
  const f = document.createElement("div");
  f.className = "fantasma";
  f.innerHTML = `<b>${esc(nomeGm(arr.d.gm))}</b> <span>${fmtHm(arr.d.ini)}–${fmtHm(arr.d.fim)}</span>`;
  document.body.appendChild(f);
  arr.fantasma = f;
  const passo = () => { if (!arr.ativo) return; if (arr.rolar) window.scrollBy(0, arr.rolar); arr.raf = requestAnimationFrame(passo); };
  arr.raf = requestAnimationFrame(passo);
}
function encerrarArrasto() {
  arr.ativo = false;
  cancelAnimationFrame(arr.raf);
  arr.fantasma?.remove(); arr.fantasma = null;
  arr.el?.classList.remove("origem-drag");
  document.body.classList.remove("arrastando");
  marcarAlvo(null);
}
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse" || e.button !== 0 || ui.colando) return; // no toque, use o toque longo (menu) para mover
  const el = e.target.closest("table.quadro button.chip[data-des], .disposicao button.chip[data-des]");
  if (!el) return;
  const d = ui.desMap.get(el.dataset.des);
  if (!d) return;
  Object.assign(arr, { d, el, x0: e.clientX, y0: e.clientY, ativo: false, alvo: null, rolar: 0 });
});
document.addEventListener("pointermove", (e) => {
  if (!arr.d) return;
  if (!arr.ativo) {
    if (Math.hypot(e.clientX - arr.x0, e.clientY - arr.y0) < 7) return;
    fecharPop(); fecharMenu(); iniciarArrasto();
  }
  e.preventDefault();
  arr.fantasma.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 10}px)`;
  arr.rolar = e.clientY < 70 ? -14 : e.clientY > innerHeight - 70 ? 14 : 0;
  arr.alvo = alvoEm(e.clientX, e.clientY);
  marcarAlvo(arr.alvo);
});
document.addEventListener("pointerup", (e) => {
  if (!arr.d) return;
  const era = arr.ativo, d = arr.d, alvo = arr.alvo, origem = arr.el;
  encerrarArrasto();
  arr.d = null;
  if (!era) return; // foi só um clique: o cartão abre normalmente
  ui.ignorarClique = Date.now();
  if (!alvo) return;
  const itens = opcoesSoltar(d, alvo);
  if (itens.length) abrirMenu(itens, e.clientX, e.clientY, origem, { des: d, drop: alvo });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && arr.ativo) { encerrarArrasto(); arr.d = null; ui.ignorarClique = Date.now(); } });

function opcoesSoltar(d, alvo, copia = false) {
  const t = TURNOS.find((x) => x.id === alvo.turno), p = postoPorId(alvo.posto), pn = p.nome;
  const he = ehHeLancada(d), quem = nomeGm(d.gm);
  const noTurno = sobrepoe(d.ini, d.fim, t.ini, t.fim) > 0;
  const mesmoPosto = d.posto === alvo.posto;
  const it = [];
  const outro = alvo.des && alvo.des.gm !== d.gm ? alvo.des : null;
  if (he && copia) {
    // colar uma hora extra cria outra hora extra para a mesma pessoa no destino
    const ocupado = ocupadoEm(d.gm, t.ini, t.fim);
    it.push({ t: `Hora extra para ${quem} em ${pn} ${fmtHm(t.ini)}–${fmtHm(t.fim)} (${fmtHoras(t.fim - t.ini)})${ocupado ? " · já está trabalhando nesse horário" : ""}`, act: "dr-he", padrao: true, desab: ocupado });
  } else if (he) {
    // hora extra lançada: só muda de lugar/horário
    const [a, b] = noTurno ? [d.ini, d.fim] : [t.ini, t.fim];
    const ocupado = ocupadoEm(d.gm, a, b, d);
    if (!(mesmoPosto && noTurno)) it.push({ t: `Mover esta hora extra para ${pn} ${fmtHm(a)}–${fmtHm(b)}${ocupado ? " (já está trabalhando nesse horário)" : ""}`, act: "dr-mover-he", d: { ini: fmtHm(a), fim: fmtHm(b) }, padrao: true, desab: ocupado });
  } else {
    if (outro && noTurno && !mesmoPosto && !ehHeLancada(outro)) it.push({ t: `Trocar de lugar com ${nomeGm(outro.gm)}`, act: "dr-trocar-lugar", padrao: true });
    if (!mesmoPosto && noTurno) {
      it.push({ t: `Remanejar ${quem} para ${pn} (serviço inteiro, ${fmtHm(d.ini)}–${fmtHm(d.fim)})`, act: "dr-rem", padrao: !it.length });
      if (d.fim - d.ini > t.fim - t.ini) it.push({ t: `Remanejar só o ${t.nome.toLowerCase()} (${fmtHm(Math.max(d.ini, t.ini))}–${fmtHm(Math.min(d.fim, t.fim))})`, act: "dr-rem-parcial" });
    }
    if (!noTurno && copia) {
      const ocupado = ocupadoEm(d.gm, t.ini, t.fim, d);
      it.push({ t: `Hora extra para ${quem} em ${pn} ${fmtHm(t.ini)}–${fmtHm(t.fim)} (${fmtHoras(t.fim - t.ini)})${ocupado ? " · já está trabalhando nesse horário" : ""}`, act: "dr-he", padrao: true, desab: ocupado });
    } else if (!noTurno) {
      const [a0, b0] = (d.alvo || `${d.ini}-${d.fim}`).split("-").map(Number), dur = b0 - a0;
      const onde = mesmoPosto ? "" : ` em ${pn}`;
      const colado = t.ini === b0 || t.fim === a0;
      // 1) estender o serviço até o turno (as horas a mais são HE)
      if (colado && mesmoPosto) {
        const [ni, nf] = t.ini === b0 ? [a0, t.fim] : [t.ini, b0];
        it.push({ t: `Estender ${t.ini === b0 ? "até" : "desde"} ${fmtHm(t.ini === b0 ? t.fim : t.ini)} (+${fmtHoras(t.fim - t.ini)} de hora extra)`, act: "dr-hora", d: { ini: fmtHm(ni), fim: fmtHm(nf) }, padrao: true });
      }
      // 2) trabalhar em outro horário, mesma duração, sem hora extra (ex.: do 3º ao 4º turno)
      const deslocados = [[t.fim - dur, t.fim], [t.ini, t.ini + dur]].filter(([a, b], k, arr) => a !== a0 && arr.findIndex(([x]) => x === a) === k);
      for (const [a, b] of deslocados) {
        const ocupado = ocupadoEm(d.gm, a, b, d);
        it.push({ t: `Trabalhar${onde} ${fmtHm(a)}–${fmtHm(b)} (${turnosDe(a, b)}), sem hora extra${ocupado ? " · já tem outro serviço nesse horário" : ""}`, act: "dr-deslocar", d: { ini: fmtHm(a), fim: fmtHm(b) }, desab: ocupado });
      }
      // 3) hora extra separada, mantendo o serviço normal
      const ocupado = ocupadoEm(d.gm, t.ini, t.fim, d);
      it.push({ t: `Hora extra${onde || " neste posto"} ${fmtHm(t.ini)}–${fmtHm(t.fim)} (${fmtHoras(t.fim - t.ini)}), mantém o serviço normal${ocupado ? " · já está trabalhando nesse horário" : ""}`, act: "dr-he", padrao: !it.some((x) => x.padrao), desab: ocupado });
    }
  }
  if (!it.length) return [];
  return [...it, { sep: true }, { t: "Cancelar", act: "dr-cancelar" }];
}

// ---------- EDIÇÃO DIRETA NA PLANILHA ----------
// Clique no horário ou no nome: o texto vira um campo ali mesmo (Enter salva, Esc cancela).
// Célula selecionada + digitar = pôr alguém. Setas andam pela planilha. Ctrl+C/Ctrl+V copiam um GM.
const ed = { modo: null, d: null, el: null, lista: [], sel: 0, ctx: null, aberto: 0 };

// "7-21", "07:00 às 21:00", "19 01", "7h30-17h" → ["07:00", "21:00"]
function normHora(t) { // "19", "19h", "1930", "19:30" → "19:30"
  const m = String(t || "").trim().match(/^(\d{1,2})(?:[:h.]?(\d{2}))?h?$/i); if (!m) return "";
  const h = Number(m[1]), mi = Number(m[2] || 0); return h > 24 || mi > 59 ? "" : `${String(h % 24).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
function parseFaixa(txt) {
  const m = [...String(txt).matchAll(/(\d{1,2})(?:[:hH.]?(\d{2}))?/g)].slice(0, 2);
  if (m.length < 2) return null;
  const f = ([, h, mi]) => { const H = Number(h), M = Number(mi || 0); return H > 24 || M > 59 ? null : `${String(H % 24).padStart(2, "0")}:${String(M).padStart(2, "0")}`; };
  const a = f(m[0]), b = f(m[1]);
  return a && b && a !== b ? [a, b] : null;
}
// Horário de quem tem HE fixa colada no serviço: o início mexe no trecho normal, o fim mexe na HE fixa (3HE → 4HE).
function aplicarHorarioJunto(d, he, ini, fim) {
  const [a, b] = intervalo(ini, fim), quem = d.titular || d.gm;
  const alvoN = d.alvo || `${d.ini}-${d.fim}`, alvoH = he.alvo || `${he.ini}-${he.fim}`;
  const [n0, n1] = alvoN.split("-").map(Number), [h0, h1] = alvoH.split("-").map(Number);
  const heNovo = Math.max(0, b - h0);
  mudar(`${nomeGm(d.gm)}: ${ini}–${fim} · HE fixa ${fmtHE(h1 - h0)} → ${fmtHE(heNovo)}`, () => {
    const ajuste = (alvo, campos) => {
      const at = data.ocorrencias.find((o) => o.tipo === "HORARIO" && o.gm === quem && o.de === ui.dia && o.alvo === alvo);
      if (!campos) { if (at && !at.req && !at.obs) data.ocorrencias = data.ocorrencias.filter((o) => o !== at); else if (at) { at.ini = fmtHm(Number(alvo.split("-")[0])); at.fim = fmtHm(Number(alvo.split("-")[1])); delete at.semHE; delete at.remover; } return; }
      if (at) { delete at.semHE; delete at.remover; Object.assign(at, campos); } else data.ocorrencias.push({ id: novoId(), tipo: "HORARIO", gm: quem, de: ui.dia, alvo, ...campos });
    };
    const nFim = Math.min(b, h0);
    ajuste(alvoN, a === n0 && nFim === n1 ? null : { ini: fmtHm(a), fim: fmtHm(nFim) });
    ajuste(alvoH, b === h1 ? null : b > h0 ? { ini: fmtHm(h0), fim: fmtHm(b), semHE: true } : { ini: fmtHm(h0), fim: fmtHm(h1), remover: true });
  });
}
function aplicarHorario(d, ini, fim, semHE = false) {
  const [a, b] = intervalo(ini, fim);
  if (ehHeLancada(d)) { mudar(`Horário da hora extra de ${nomeGm(d.gm)}: ${ini}–${fim}`, () => Object.assign(data.ocorrencias.find((x) => x.id === d.origem), { ini, fim })); return; }
  const alvo = d.alvo || `${d.ini}-${d.fim}`, [a0, b0] = alvo.split("-").map(Number), quem = d.titular || d.gm;
  const atual = data.ocorrencias.find((o) => o.tipo === "HORARIO" && o.gm === quem && o.de === ui.dia && o.alvo === alvo);
  const extra = b - a - sobrepoe(a, b, a0, b0);
  mudar(`${nomeGm(d.gm)}: ${ini}–${fim}${semHE ? " (sem hora extra)" : extra > 0 ? ` (${fmtHoras(extra)} de hora extra)` : ""}`, () => {
    if (a === a0 && b === b0 && !atual?.req && !atual?.obs) { if (atual) data.ocorrencias = data.ocorrencias.filter((o) => o !== atual); }
    else if (atual) { Object.assign(atual, { ini, fim }); if (semHE) atual.semHE = true; else delete atual.semHE; }
    else data.ocorrencias.push({ id: novoId(), tipo: "HORARIO", gm: quem, de: ui.dia, alvo, ini, fim, ...(semHE ? { semHE: true } : {}) });
  });
}
function consequenciaHorario(d, ini, fim) {
  const [a, b] = intervalo(ini, fim);
  if (ehHeLancada(d) || d.fixa) return `Hora extra de ${fmtHoras(b - a)}`;
  const [a0, b0] = (d.alvo || `${d.ini}-${d.fim}`).split("-").map(Number);
  const extra = b - a - sobrepoe(a, b, a0, b0), falta = b0 - a0 - sobrepoe(a, b, a0, b0);
  return [extra > 0 ? `+${fmtHoras(extra)} de hora extra` : "", falta > 0 ? `${fmtHoras(falta)} a menos que o normal` : ""].filter(Boolean).join(" · ") || "Horário normal";
}
function substituirGm(d, X, via, m) {
  const T = d.gm;
  if (m === "TROCA") { mudar(`${nomeGm(X)} assume o serviço de ${nomeGm(T)} (troca)`, () => data.ocorrencias.push({ id: novoId(), tipo: "TROCA", gm: T, substituto: X, de: ui.dia })); return; }
  mudar(`${TIPOS[m]} para ${nomeGm(T)}; ${nomeGm(X)} ${via === "rem" ? "remanejado" : "com hora extra"}`, () => {
    data.ocorrencias.push({ id: novoId(), tipo: m, gm: T, de: ui.dia });
    if (via === "rem") data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: X, de: ui.dia, ate: ui.dia, posto: d.posto });
    else data.ocorrencias.push({ id: novoId(), tipo: "HE", gm: X, de: ui.dia, ini: fmtHm(d.ini), fim: fmtHm(d.fim), posto: d.posto, req: "" });
  });
}

function abrirEditor(modo, el, ctx) {
  fecharMenu(); fecharPop(); fecharEditor();
  const r = el.getBoundingClientRect(), box = $("#inline");
  Object.assign(ed, { modo, el, ctx, d: ctx.des || null, sel: 0, aberto: Date.now(), oferta: null });
  if (modo === "hora") {
    const v = valoresCartao(ed.d);
    if (ctx.junto) v.fim = fmtHm(ctx.junto.fim);
    const [, b0] = ctx.junto ? [0, ctx.junto.fim] : (ed.d.alvo || `${ed.d.ini}-${ed.d.fim}`).split("-").map(Number);
    const atalhos = ehHeLancada(ed.d) || ed.d.fixa ? [] : [["+1h", b0 + 60], ["+2h", b0 + 120], ["+3h", b0 + 180], ...(b0 <= 1140 ? [["até 01:00", 1500]] : [])];
    box.innerHTML = `<input id="ed-in" class="ed-in hora" value="${v.ini}–${v.fim}" aria-label="Horário: entrada e saída" autocomplete="off" spellcheck="false">
      <div class="ed-painel">${atalhos.length ? `<div class="ed-chips">${atalhos.map(([r, m]) => `<button class="ed-chip" data-act="ed-estender" data-fim="${fmtHm(m)}" tabindex="-1">${r}</button>`).join("")}</div>` : ""}
      <div id="ed-modo" class="ed-modo" hidden><label><input type="radio" name="ed-m" value="he" checked> As horas a mais são <b>hora extra</b></label><label><input type="radio" name="ed-m" value="sem"> Só mudou o horário (<b>sem HE</b>)</label></div>
      <div id="ed-dica" class="ed-dica"></div></div>`;
  } else {
    if (modo === "add" && ctx.ini == null) [ctx.ini, ctx.fim] = intervaloVaga(ctx.posto, ctx.turno);
    const titulo = modo === "nome" ? `No lugar de ${nomeGm(ed.d.gm)}` : modo === "padrao" ? `${postoPorId(ctx.posto).nome} · ${ctx.per} · padrão ${ui.padrao.aba === "impar" ? "ímpar" : "par"}` : `${postoPorId(ctx.posto).nome}`;
    box.innerHTML = `<input id="ed-in" class="ed-in" value="${esc(ctx.inicial || "")}" placeholder="Digite o nome do GM" aria-label="${esc(titulo)}" role="combobox" aria-expanded="true" aria-controls="ed-lista" autocomplete="off" spellcheck="false">
      <div class="ed-lista-box"><p class="ed-titulo">${esc(titulo)}</p>${modo === "add" && ctx.ini != null ? `<div class="ed-chips ed-dur">${opcoesVaga(ctx.posto, ctx.turno).map(([a, b, r]) => `<button class="ed-chip ${a === ctx.ini && b === ctx.fim ? "on" : ""}" data-act="ed-dur" data-ini="${a}" data-fim="${b}" tabindex="-1">${r} · ${fmtHm(a)}–${fmtHm(b)}</button>`).join("")}</div>` : ""}${modo === "add" ? `<div class="ed-chips ed-nat"><button class="ed-chip ${!["bh", "rem"].includes(ctx.nat) ? "on" : ""}" data-act="ed-nat" data-nat="he" tabindex="-1">Hora extra</button><button class="ed-chip ${ctx.nat === "bh" ? "on bh" : ""}" data-act="ed-nat" data-nat="bh" tabindex="-1">Banco de horas (BH+)</button><button class="ed-chip ${ctx.nat === "rem" ? "on rem" : ""}" data-act="ed-nat" data-nat="rem" tabindex="-1" title="GMs à disposição ou na reserva técnica">Remanejar<span class="n-rem"></span></button><input id="ed-req" class="ed-req" placeholder="REQ (opcional)" size="9" autocomplete="off"></div>` : ""}<ul id="ed-lista" role="listbox"></ul><div class="ed-rodape"><button class="link ed-mais" data-act="ed-mais">Mais opções…</button>${modo === "add" ? `<button class="link ed-of" data-act="ed-oferecer">📲 Oferecer a vários (WhatsApp)…</button>` : ""}${modo === "add" && calcularDia(data, ui.dia).furos.some((f) => f.posto === ctx.posto && f.turno === ctx.turno) ? `<button class="link ed-sem" data-act="ed-semgm">Deixar sem GM neste dia</button>` : ""}</div></div>`;
  }
  box.hidden = false;
  box.style.left = Math.max(4, Math.min(r.left - 2, innerWidth - 284)) + "px";
  box.style.top = r.top - 2 + "px";
  box.style.minWidth = Math.max(r.width + 4, modo === "hora" ? 150 : 260) + "px";
  const inp = $("#ed-in");
  inp.focus();
  if (modo === "hora") { inp.select(); atualizarDicaHora(); }
  else { const n = inp.value.length; inp.setSelectionRange(n, n); atualizarLista(); }
  // se não couber embaixo, a lista abre para cima
  const lb = box.querySelector(".ed-lista-box");
  if (lb) lb.classList.toggle("cima", r.bottom + lb.offsetHeight + 8 > innerHeight && r.top > lb.offsetHeight + 8);
}
function fecharEditor(devolverFoco) {
  const box = $("#inline");
  if (!box || box.hidden) return;
  box.hidden = true; box.innerHTML = "";
  const el = ed.el; ed.modo = null;
  if (devolverFoco && el?.isConnected) el.focus();
}
function atualizarDicaHora(trocouModo) {
  const f = parseFaixa($("#ed-in").value), dica = $("#ed-dica"), modo = $("#ed-modo");
  if (ed.ctx?.junto) { // horário com HE fixa: o fim mexe na HE fixa
    if (modo) modo.hidden = true;
    const he = ed.ctx.junto;
    if (!f) { dica.textContent = "Ex.: 7-20"; dica.classList.add("erro"); return; }
    const [, b] = intervalo(f[0], f[1]);
    dica.innerHTML = `${f[0]}–${f[1]} · HE fixa ${fmtHE(he.fim - he.ini)} → <b class="he-num">${fmtHE(Math.max(0, b - he.ini))}</b> · Enter salva`;
    dica.classList.remove("erro");
    return;
  }
  const d = ed.d, base = !ehHeLancada(d) && !d.fixa;
  if (f && base && modo) {
    const [a, b] = intervalo(f[0], f[1]), [a0, b0] = (d.alvo || `${d.ini}-${d.fim}`).split("-").map(Number);
    const sai = b - a - sobrepoe(a, b, a0, b0) > 0;
    modo.hidden = !sai;
    // mesma duração em outro horário = provavelmente só trocou o horário; mais tempo = hora extra
    if (sai && !trocouModo) modo.querySelector(`[value=${b - a === b0 - a0 ? "sem" : "he"}]`).checked = true;
  } else if (modo) modo.hidden = true;
  const sem = modo && !modo.hidden && modo.querySelector("[value=sem]").checked;
  dica.textContent = f ? `${f[0]}–${f[1]} · ${sem ? "sem hora extra (só mudou o horário)" : consequenciaHorario(d, f[0], f[1])} · Enter salva` : "Ex.: 7-19, 13-01, 19 07";
  dica.classList.toggle("erro", !f);
}
function intervaloEd() { return ed.ctx.ini != null ? [ed.ctx.ini, ed.ctx.fim] : intervaloVaga(ed.ctx.posto, ed.ctx.turno); }
function candidatosEditor() {
  if (ed.modo === "padrao") { // qualquer GM ativo; mostra onde está hoje no padrão
    const ref = ui.padrao.desde;
    return data.gms.filter((g) => g.ativo !== false).map((g) => { const v = vigente(g, ref); return { gm: g, via: "pad", notas: [`${rotuloEquipe(equipe(v.equipe), ref, true)} · ${postoPorId(v.lotacao?.posto)?.nome || "sem posto"}`], heMes: 0, transporte: 0 }; })
      .sort((a, b) => a.gm.nome.localeCompare(b.gm.nome));
  }
  let ini, fim, posto;
  if (ed.modo === "nome") ({ ini, fim, posto } = ed.d);
  else { [ini, fim] = intervaloEd(); posto = ed.ctx.posto; }
  const { remanejar, he } = sugerir(data, ui.dia, posto, ini, fim);
  // hora extra primeiro (escala oposta do posto, quem está no posto, menos horas); reserva técnica por último
  return [...he.map((x) => ({ ...x, via: "he" })), ...remanejar.map((x) => ({ ...x, via: "rem" }))].map((x) => ({ ...x, dur: fim - ini }));
}
function atualizarLista() {
  const q = norm($("#ed-in").value.trim());
  const cand = candidatosEditor(), nat = ed.modo === "add" ? ed.ctx?.nat || "he" : null;
  const nRem = cand.filter((x) => x.via === "rem").length, sp = document.querySelector(".ed-nat .n-rem"); if (sp) sp.textContent = ` (${nRem})`;
  const todos = cand.filter((x) => (!nat ? true : nat === "rem" ? x.via === "rem" : x.via !== "rem")).filter((x) => !q || norm(x.gm.nome).includes(q));
  todos.sort((a, b) => (q ? (norm(b.gm.nome).startsWith(q) - norm(a.gm.nome).startsWith(q)) : 0));
  ed.lista = todos.slice(0, 25); // mais opções, com rolagem (as mesmas informações de cada uma)
  if (ed.sel >= ed.lista.length) ed.sel = 0;
  $("#ed-lista").innerHTML = ed.lista.length ? ed.lista.map((x, i) => `<li role="option" id="ed-op-${i}" aria-selected="${i === ed.sel}" aria-disabled="${!!x.bloqueado}" data-i="${i}" class="${x.bloqueado ? "bloq" : ""} ${ed.oferta?.has(x.gm.id) ? "marcado" : ""}">
    <b>${ed.oferta ? `<span class="caixa" aria-hidden="true">${ed.oferta.has(x.gm.id) ? "☑" : "☐"}</span>` : ""}${esc(x.gm.nome)}</b><span>${x.via === "pad" ? esc(x.notas[0]) : x.via === "rem" ? `${esc(x.origem.toLowerCase())} · ${x.daEscala ? "tirar da escala (abre vaga lá)" : "remanejar"}` : `${x.notas?.length ? `<span class="mot">${esc(x.notas[0])}</span>` : ""}`}${x.via === "rem" ? "" : seloHE(x.heMes + x.transporte)}</span></li>`).join("")
    + (todos.length > 25 ? `<li class="ed-resto" aria-hidden="true">+ ${todos.length - 25} — continue digitando</li>` : "")
    : `<li class="ed-resto">${nat === "rem" && !q ? "Ninguém à disposição ou na reserva nesse horário" : "Ninguém livre com esse nome nesse horário"}</li>`;
  $("#ed-in").setAttribute("aria-activedescendant", ed.lista.length ? `ed-op-${ed.sel}` : "");
  // a lista nunca passa da borda da tela: encolhe para caber
  const lst = $("#ed-lista"), box = lst?.closest(".ed-lista-box");
  if (lst && box) {
    lst.style.maxHeight = "";
    const r = box.getBoundingClientRect(), extra = r.height - lst.getBoundingClientRect().height;
    const cabe = box.classList.contains("cima") ? r.bottom - 8 : innerHeight - r.top - 8;
    if (r.height > cabe) lst.style.maxHeight = Math.max(140, cabe - extra) + "px";
  }
  document.getElementById(`ed-op-${ed.sel}`)?.scrollIntoView({ block: "nearest" });
}
function atualizarRodapeOferta() {
  const r = $("#ed-of-rodape"); if (!r) return;
  const n = ed.oferta.size;
  r.innerHTML = `<span>${n ? `${n} marcado${n === 1 ? "" : "s"}` : "Marque quem vai receber a oferta"}</span><button class="btn pri" data-act="ed-ofertar" ${n ? "" : "disabled"}>Ofereci no WhatsApp</button><button class="link" data-act="ed-copiar">copiar mensagem</button>`;
}
function escolherEditor(i) {
  const x = ed.lista[i];
  if (!x || x.bloqueado) return;
  if (ed.oferta) { const s0 = ed.oferta; s0.has(x.gm.id) ? s0.delete(x.gm.id) : s0.add(x.gm.id); atualizarLista(); atualizarRodapeOferta(); $("#ed-in").focus(); return; }
  const { modo, d, ctx, el } = ed, X = x.gm.id, reqEd = $("#ed-req")?.value.trim() || "";
  // cobrir vaga com HE: primeiro oferecer (WhatsApp); lançar direto só se ele já confirmou
  if (modo === "add" && x.via !== "rem") {
    const r = (document.getElementById(`ed-op-${i}`) || el).getBoundingClientRect();
    const [vi, vf] = ctx.ini != null ? [ctx.ini, ctx.fim] : intervaloVaga(ctx.posto, ctx.turno), [a, b] = horarioProposto(data, ui.dia, X, ctx.posto, vi, vf);
    const dd = { dia: ui.dia, posto: ctx.posto, gm: X, ini: fmtHm(a), fim: fmtHm(b), req: reqEd, nat: ctx.nat || "he" };
    fecharEditor();
    abrirMenu([{ t: `${nomeGm(X)} · ${postoPorId(ctx.posto).nome} ${dd.ini}–${dd.fim}`, act: "ed-nada", desab: true }, { sep: true },
      { t: "📲 Oferecer a ele (WhatsApp)", act: "pend-oferecer", d: { ...dd, ini: fmtHm(vi), fim: fmtHm(vf) }, padrao: true }, { t: "Copiar mensagem da vaga", act: "pend-copiar", d: { ...dd, ini: fmtHm(vi), fim: fmtHm(vf) } }, { sep: true },
      { t: "Já confirmou: lançar HE", act: "pend-he", d: { ...dd, nat: "he" } }, { t: "Já confirmou: lançar como BH+", act: "pend-he", d: { ...dd, nat: "bh" } },
      { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, el, {});
    return;
  }
  fecharEditor();
  if (modo === "padrao") { colocarNoPadrao(x.gm, ctx.posto, ctx.per); return; }
  if (modo === "add") {
    const [vi, vf] = ctx.ini != null ? [ctx.ini, ctx.fim] : intervaloVaga(ctx.posto, ctx.turno), pn = postoPorId(ctx.posto).nome;
    if (x.via === "rem") {
      const op = secaoOperacao(data, ctx.posto), parcial = op ? { ini: fmtHm(Math.max(vi, x.ini)), fim: fmtHm(Math.min(vf, x.fim)) } : {};
      mudar(`${nomeGm(X)} remanejado para ${pn}${op ? ` (${parcial.ini}–${parcial.fim})` : ""}${x.daEscala ? ` · abre vaga em ${x.origem}` : ""}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: X, de: ui.dia, ate: ui.dia, posto: ctx.posto, ...parcial }));
    } else lancarHE(X, vi, vf, ctx.posto, ctx.nat, reqEd);
    return;
  }
  if (ehHeLancada(d)) { mudar(`Hora extra passou para ${nomeGm(X)}`, () => { data.ocorrencias.find((o) => o.id === d.origem).gm = X; }); return; }
  if (d.nat === "troca") { mudar(`Troca: agora ${nomeGm(X)} cobre ${nomeGm(d.titular)}`, () => { data.ocorrencias.find((o) => o.id === d.origem).substituto = X; }); return; }
  const T = nomeGm(d.gm), r = el.getBoundingClientRect();
  abrirMenu([
    { t: `O que aconteceu com ${T}?`, act: "ed-nada", desab: true },
    { sep: true },
    { t: "Trocaram de serviço (sem hora extra)", act: "ed-motivo", d: { m: "TROCA" } },
    { t: "Folga", act: "ed-motivo", d: { m: "FOLGA" } },
    { t: "Faltou", act: "ed-motivo", d: { m: "FALTA" } },
    { t: "Atestado", act: "ed-motivo", d: { m: "ATESTADO" } },
    { t: "Compensação de banco de horas", act: "ed-motivo", d: { m: "BH_COMP" } },
    { sep: true }, { t: "Cancelar", act: "dr-cancelar" },
  ], r.left, r.bottom + 2, el, { des: d, escolhido: X, via: x.via });
}

// teclado dentro do editor
document.addEventListener("keydown", (e) => {
  if (!ed.modo || e.target.id !== "ed-in") return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fecharEditor(true); return; }
  if (ed.modo !== "hora" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && ui.copiado && !e.target.value) {
    e.preventDefault(); const alvo = ed.el; fecharEditor(); colar(alvo); return; // colar o GM copiado nesta célula
  }
  if (ed.modo === "secao") {
    if (e.key === "Enter") {
      e.preventDefault();
      const nome = e.target.value.trim().toUpperCase(), sec = data.secoes.find((x) => x.id === ed.ctx.secao);
      fecharEditor();
      if (nome && nome !== sec.nome) mudar(`Seção renomeada para ${nome}`, () => { sec.nome = nome; });
    }
    return;
  }
  if (ed.modo === "hora") {
    if (e.key === "Enter") {
      e.preventDefault();
      const f = parseFaixa(e.target.value);
      if (!f) { atualizarDicaHora(); return; }
      const m = $("#ed-modo"), sem = m && !m.hidden && m.querySelector("[value=sem]").checked;
      const d = ed.d, junto = ed.ctx?.junto; fecharEditor();
      if (junto) aplicarHorarioJunto(d, junto, f[0], f[1]); else aplicarHorario(d, f[0], f[1], sem);
    }
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (ed.lista.length) { ed.sel = (ed.sel + (e.key === "ArrowDown" ? 1 : -1) + ed.lista.length) % ed.lista.length; atualizarLista(); } }
  else if (e.key === "Enter") { e.preventDefault(); escolherEditor(ed.sel); }
}, true);
document.addEventListener("input", (e) => {
  if (e.target.id === "bg-in") { ui.pop.q = e.target.value; ui.pop.gm = null; $("#bg-res").innerHTML = resultadosBuscaGm(e.target.value); return; }
  if (e.target.id === "ef-busca") { ui.efetivo.busca = e.target.value; render(); const i = $("#ef-busca"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
  if (e.target.id === "fr-busca") { ui.frota.busca = e.target.value; render(); const i = $("#fr-busca"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); return; }
  if (e.target.id === "ng-nome") {
    const g = data.gms.find((x) => norm(x.nome) === norm(e.target.value.trim()));
    $("#ng-info").textContent = !e.target.value.trim() ? "" : g ? `Já cadastrado: ${rotuloEquipe(equipe(vigente(g, ui.dia).equipe))} · ${rotuloLotacao(g)}. Será transferido.` : "GM novo: será cadastrado.";
    return;
  }
  if (e.target.closest?.(".form-hf")) { previaHorarioFixo(); return; }
  if (e.target.name === "ed-m") { atualizarDicaHora(true); $("#ed-in").focus(); return; }
  if (e.target.id !== "ed-in") return;
  if (ed.modo === "hora") atualizarDicaHora(); else if (ed.modo !== "secao") { ed.sel = 0; atualizarLista(); }
});
document.addEventListener("mousedown", (e) => {
  const li = e.target.closest("#ed-lista li[data-i]");
  if (li) { e.preventDefault(); if (e.button === 0) escolherEditor(Number(li.dataset.i)); return; } // botão direito: menu (contextmenu)
  if (ed.modo && !e.target.closest("#inline, #menu")) fecharEditor();
});
window.addEventListener("scroll", () => { if (ed.modo && Date.now() - ed.aberto > 400) fecharEditor(); }, { passive: true });
document.addEventListener("scroll", (e) => { if (ed.modo && e.target !== document && !e.target.closest?.("#inline")) fecharEditor(); }, { passive: true, capture: true });

// navegação e atalhos na planilha
function focaveisPlanilha() { return [...document.querySelectorAll("table.quadro button.chip[data-des], table.quadro td[data-posto]")].filter((el) => el.tagName !== "TD" || !el.querySelector("button.chip")); }
function moverSelecao(dir) {
  const atual = document.activeElement, r0 = atual.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let melhor = null, nota = Infinity;
  for (const el of focaveisPlanilha()) {
    if (el === atual) continue;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
    const [prim, sec] = dir === "ArrowDown" ? [dy, dx] : dir === "ArrowUp" ? [-dy, dx] : dir === "ArrowRight" ? [dx, dy] : [-dx, dy];
    if (prim <= 4) continue;
    const n = prim + Math.abs(sec) * 3;
    if (n < nota) { nota = n; melhor = el; }
  }
  if (melhor) { melhor.focus(); melhor.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
function copiar(d) {
  ui.copiado = { ...d }; ui.colando = true;
  const f = $("#colando");
  f.innerHTML = `<span><b>${esc(nomeGm(d.gm))}</b> copiado. Clique na célula onde quer colar.</span><button class="link" data-act="colar-cancelar">Cancelar (Esc)</button>`;
  f.hidden = false;
  document.body.classList.add("modo-colar");
}
function pararColar() { ui.colando = false; $("#colando").hidden = true; document.body.classList.remove("modo-colar"); }
function colar(alvoEl) {
  const td = alvoEl.closest("td[data-posto]");
  if (!ui.copiado || !td) return;
  pararColar();
  const alvo = { td, posto: td.dataset.posto, turno: td.dataset.turno, des: null };
  const itens = opcoesSoltar(ui.copiado, alvo, true);
  const r = td.getBoundingClientRect();
  if (itens.length) abrirMenu(itens, r.left + 8, r.top + 18, td, { des: ui.copiado, drop: alvo });
  else toast(`${nomeGm(ui.copiado.gm)} já está aqui nesse horário.`);
}
document.addEventListener("keydown", (e) => {
  if (ed.modo || !$("#menu").hidden || ui.pop) return;
  const el = document.activeElement;
  if (!el?.closest?.("table.quadro")) return;
  const chipEl = el.matches("button.chip[data-des]") ? el : null, td = el.matches("td[data-posto]") ? el : null;
  if (!chipEl && !td) return;
  if (e.key.startsWith("Arrow")) { e.preventDefault(); moverSelecao(e.key); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "c" && chipEl) { e.preventDefault(); copiar(ui.desMap.get(chipEl.dataset.des)); return; }
  if (ctrl && e.key.toLowerCase() === "v") { e.preventDefault(); colar(el); return; }
  if (ctrl || e.altKey) return;
  if (chipEl) {
    const d = ui.desMap.get(chipEl.dataset.des);
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); abrirPop("card", chipEl, { des: d }); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const r = chipEl.getBoundingClientRect();
      if (ehHeLancada(d)) abrirMenu([...itensRemoverHE(d, chipEl.closest("td[data-turno]")?.dataset.turno), { sep: true }, { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, chipEl, { des: d });
      else abrirMenu([{ t: `Tirar ${nomeGm(d.gm)} do dia:`, act: "ed-nada", desab: true }, { sep: true }, ...[["FOLGA", "Folga"], ["FALTA", "Faltou"], ["ATESTADO", "Atestado"], ["BH_COMP", "Compensação de banco de horas"]].map(([m, t]) => ({ t, act: "mn-tirar", d: { m } })), { sep: true }, { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, chipEl, { des: d });
    }
    return;
  }
  if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); abrirEditor("add", td, { posto: td.dataset.posto, turno: td.dataset.turno }); }
  else if (e.key.length === 1 && /\p{L}/u.test(e.key)) { e.preventDefault(); abrirEditor("add", td, { posto: td.dataset.posto, turno: td.dataset.turno, inicial: e.key }); }
});

// ---------- HE FIXA COMO NO PADRÃO, ÍCONES, SEÇÕES, ESTENDER ----------
// "FULANO (13:00/19:00) 3HE": o trecho normal e a HE fixa colada nele aparecem juntos, com o número em vermelho.
const fmtHE = (min) => `${String(Math.round((min / 60) * 10) / 10).replace(".", ",")}HE`;
// Serviço que atravessa turnos (ex.: 18–06 + HE fixa 06–07): o número vermelho fica na coluna onde o serviço COMEÇA,
// e o horário estendido (…/07:00) na coluna onde termina.
function totalHeFixaColada(d, todas) {
  if (!todas.some((x) => x.gm === d.gm && x.fixa && !x.recorrente && x.ini === d.fim)) return 0;
  return todas.filter((x) => x.gm === d.gm && x.fixa && !x.recorrente).reduce((s, x) => s + x.fim - x.ini, 0);
}
function numeroHeNaColuna(d, t, junto, todas) {
  const ps = partesVisuais(d);
  if (ps.length < 2) return junto?.total || 0;
  return ps[0].t === t ? totalHeFixaColada(d, todas) : 0;
}
function juntarHeFixa(lista, t, todas) {
  const fora = new Set(), junto = new Map();
  for (const he of lista.filter((d) => d.fixa && !d.recorrente)) {
    const normal = lista.find((d) => d.gm === he.gm && d.nat !== "he" && partesVisuais(d).find((p) => p.t === t)?.fim === he.ini);
    if (normal) {
      fora.add(he);
      const total = todas.filter((x) => x.gm === he.gm && x.fixa && !x.recorrente).reduce((s, x) => s + x.fim - x.ini, 0);
      junto.set(normal, { he, total });
    }
  }
  return { mostrar: lista.filter((d) => !fora.has(d)), junto };
}
const ICONES = {
  vtr: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11h.5A1.5 1.5 0 0 1 21 12.5V17h-2v1.5a1 1 0 0 1-2 0V17H7v1.5a1 1 0 0 1-2 0V17H3v-4.5A1.5 1.5 0 0 1 4.5 11zm2.2 0h9.6l-1.2-3.3a.5.5 0 0 0-.5-.3H8.9a.5.5 0 0 0-.5.3zM6.5 15a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm11 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"/><rect x="10" y="3" width="4" height="1.6" rx=".5"/></svg>`,
  moto: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-1.8a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zm14 1.8a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-1.8a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM13.5 6h2.2l1.6 4.2 1 .1-.6 1.6-2-.2-1.6 3.3H9.8l-2-3H4.5V10h4.2l1.7 2.4h2.1L14 9.5z"/></svg>`,
  grupo: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5zm0 4.2l-1.3 2.7-3 .4 2.2 2.1-.5 3L12 13l2.6 1.4-.5-3 2.2-2.1-3-.4z"/></svg>`,
};
const iconePosto = (p) => (p.tipo === "moto" ? ICONES.moto : p.tipo === "vtr" ? ICONES.vtr : "");

// intervalo padrão para cobrir uma vaga: o do reforço do posto (ex.: EJA 19–23) ou o do turno
function intervaloVaga(postoId, turnoId) {
  const p = postoPorId(postoId), t = TURNOS.find((x) => x.id === turnoId);
  if (p?.reforco) { const [a, b] = intervalo(p.reforco.ini, p.reforco.fim); if (sobrepoe(a, b, t.ini, t.fim) > 0) return [a, b]; }
  // padrão de 12h (período inteiro); só 6h se a outra metade do período já tem gente
  const [x, y] = periodoDoTurno(turnoId), outro = TURNOS.find((o) => o.id !== turnoId && o.ini >= x && o.fim <= y);
  const furos = calcularDia(data, ui.dia).furos;
  return outro && furos.some((f) => f.posto === postoId && f.turno === outro.id) || !outro || !postoPorId(postoId)?.vagas?.[outro.id] ? [x, y] : [t.ini, t.fim];
}
const periodoDoTurno = (turnoId) => (["t2", "t3"].includes(turnoId) ? [420, 1140] : [1140, 1860]);
// opções de horário para pôr alguém numa vaga: 12h, 6h do turno, e o reforço do posto
function opcoesVaga(postoId, turnoId) {
  const t = TURNOS.find((x) => x.id === turnoId), [x, y] = periodoDoTurno(turnoId), p = postoPorId(postoId);
  const ops = [[x, y, "12h"], [t.ini, t.fim, "6h"]];
  if (p?.reforco) { const [a, b] = intervalo(p.reforco.ini, p.reforco.fim); ops.unshift([a, b, fmtHoras(b - a)]); }
  return ops.filter(([a, b], i, arr) => arr.findIndex(([c, d]) => c === a && d === b) === i);
}
// ---------- HE OFERECIDA (WhatsApp) ----------
// Vermelho = ninguém sabe da vaga; laranja = HE oferecida, aguardando resposta; preenchida = resolvido.
// OFERTA: { posto, de, ini, fim, nat, vagas, gms: [{ gm, estado: "oferecida" | "confirmou" | "recusou" }], fechada }
const ofertasAbertas = (dia) => data.ocorrencias.filter((o) => o.tipo === "OFERTA" && o.de === dia && !o.fechada);
function ofertaDaVaga(posto, turno, dia) {
  const t = TURNOS.find((x) => x.id === turno);
  return ofertasAbertas(dia).find((o) => o.posto === posto && (!t || sobrepoe(...intervalo(o.ini, o.fim), t.ini, t.fim) > 0));
}
const aguardando = (o) => o.gms.filter((g) => g.estado === "oferecida");
function mensagemOferta(o) {
  const p = postoPorId(o.posto);
  return `${o.nat === "bh" ? "BH+" : "HE"} disponível: ${p.nome} · ${SEMANA[diaSemana(o.de)].toLowerCase()} ${ddmm(o.de)} · ${o.ini}–${o.fim}. Confirma?`;
}
function copiarTexto(txt) {
  const ok = () => toast("Mensagem copiada. É só colar no WhatsApp.");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(ok, () => fallback()); else fallback();
  function fallback() { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); ok(); } catch { prompt("Copie a mensagem:", txt); } t.remove(); }
}
function ofertar(posto, dia, ini, fim, gms, nat = "he") {
  const [a, b] = typeof ini === "number" ? [ini, fim] : intervalo(ini, fim), I = fmtHm(a), F = fmtHm(b);
  const furos = calcularDia(data, dia).furos.filter((f) => f.posto === posto && sobrepoe(a, b, ...[TURNOS.find((t) => t.id === f.turno)].map((t) => [t.ini, t.fim]).flat()) > 0);
  const vagas = Math.max(1, ...furos.map((f) => f.faltam));
  let o = ofertasAbertas(dia).find((x) => x.posto === posto && sobrepoe(...intervalo(x.ini, x.fim), a, b) > 0); // mesma vaga: entra na oferta já aberta
  const novos = gms.filter((g) => !o?.gms.some((x) => x.gm === g));
  if (!novos.length) { toast("Já foi oferecida a esses GMs."); return null; }
  mudar(`HE oferecida a ${novos.map(nomeGm).join(", ")} · ${postoPorId(posto).nome} ${I}–${F} (${ddmm(dia)})`, () => {
    if (!o) { o = { id: novoId(), tipo: "OFERTA", posto, de: dia, ini: I, fim: F, nat, vagas, gms: [], criada: new Date().toISOString() }; data.ocorrencias.push(o); }
    for (const g of novos) o.gms.push({ gm: g, estado: "oferecida", em: new Date().toISOString() });
  });
  return o;
}
function responderOferta(id, gm, estado) {
  const o = data.ocorrencias.find((x) => x.id === id), g = o?.gms.find((x) => x.gm === gm);
  if (!g) return;
  if (estado === "recusou" || estado === "cancelada") {
    mudar(estado === "recusou" ? `${nomeGm(gm)} recusou a HE` : `Envio para ${nomeGm(gm)} cancelado`, () => { g.estado = estado; if (!aguardando(o).length) o.fechada = true; });
    return;
  }
  const conf = o.gms.filter((x) => x.estado === "confirmou").length + 1;
  const [a, b] = horarioProposto(data, o.de, gm, o.posto, ...intervalo(o.ini, o.fim));
  const [oa, ob] = intervalo(o.ini, o.fim), parte = b - a < ob - oa;
  mudar(`${nomeGm(gm)} confirmou: ${o.nat === "bh" ? "BH+" : "HE"} ${fmtHm(a)}–${fmtHm(b)} em ${postoPorId(o.posto).nome}${parte ? ` (estende 6h; o resto continua vaga)` : conf >= o.vagas ? " · vaga preenchida" : ` · falta${o.vagas - conf === 1 ? "" : "m"} ${o.vagas - conf}`}${aguardando(o).length > 1 ? ` · ${aguardando(o).length - 1} ainda aguardando resposta` : ""}`, () => {
    g.estado = "confirmou";
    data.ocorrencias.push({ id: novoId(), tipo: o.nat === "bh" ? "BH_MAIS" : "HE", gm, de: o.de, ini: fmtHm(a), fim: fmtHm(b), posto: o.posto, req: "", oferta: o.id });
    if (!aguardando(o).length) o.fechada = true; // só fecha quando todos tiverem resposta (confirmou, recusou ou envio cancelado)
  });
}
// menu da vaga oferecida: confirmar / recusar cada um, oferecer a mais, copiar mensagem
function menuOferta(o, el) {
  const r = el.getBoundingClientRect(), ag = aguardando(o);
  abrirMenu([{ t: `HE oferecida · ${postoPorId(o.posto).nome} ${o.ini}–${o.fim}${o.vagas > 1 ? ` · ${o.vagas} vagas` : ""}`, act: "ed-nada", desab: true }, { sep: true },
    ...(() => { const cheia = o.gms.filter((x) => x.estado === "confirmou").length >= o.vagas;
      return ag.map((g) => ({ t: `${nomeGm(g.gm)} · aguardando`, sub: [
        { t: `✓ Confirmou${cheia ? " (vaga já preenchida: lança mesmo assim)" : ""}`, act: "of-resp", d: { id: o.id, gm: g.gm, e: "confirmou" } },
        { t: "✗ Recusou", act: "of-resp", d: { id: o.id, gm: g.gm, e: "recusou" } },
        { t: "Cancelei o envio para ele", act: "of-resp", d: { id: o.id, gm: g.gm, e: "cancelada" } }] })); })(),
    ...o.gms.filter((g) => g.estado !== "oferecida").map((g) => ({ t: `${nomeGm(g.gm)}: ${{ confirmou: "✓ confirmou", recusou: "✗ recusou", cancelada: "envio cancelado" }[g.estado] || g.estado}`, act: "ed-nada", desab: true })),
    { sep: true }, { t: "Copiar mensagem para o WhatsApp", act: "of-copiar", d: { id: o.id } },
    { t: "Oferecer a mais GMs…", act: "of-mais", d: { id: o.id } },
    { t: ag.length ? "Cancelar o envio para todos que faltam responder" : "Encerrar a oferta", act: "of-cancelar", d: { id: o.id } }], r.left, r.bottom + 2, el, {});
}
// Dispensa a vaga descoberta só neste dia (reduz as vagas do turno), e ela sai dos avisos
function deixarSemGm(postoId, turnos, dia) {
  const p = postoPorId(postoId), cd = calcularDia(data, dia), aj = cd.ajustesPosto.get(postoId)?.vagas;
  const furos = cd.furos.filter((f) => f.posto === postoId && turnos.includes(f.turno));
  if (!furos.length) return;
  const base = { ...(aj?.vagas || p.vagas) };
  for (const f of furos) base[f.turno] = Math.max(0, (base[f.turno] || 0) - f.faltam);
  const nomes = furos.map((f) => TURNOS.find((t) => t.id === f.turno).nome.split(" ")[0]).join(" e ");
  mudar(`${p.nome}: ${nomes} turno sem GM em ${ddmm(dia)} (vaga dispensada)`, () => {
    if (aj && aj.de === dia && (aj.ate || aj.de) === dia) aj.vagas = base;
    else data.ocorrencias.push({ id: novoId(), tipo: "VAGAS", posto: postoId, de: dia, ate: dia, vagas: base, obs: "vaga dispensada" });
  });
}
// Lança HE numa vaga. Quem já trabalha hoje colado à vaga só estende 6h; o resto continua vaga a cobrir.
function lancarHE(X, ini, fim, posto, nat = "he", req = "") {
  const eja = horarioEja(data, ui.dia, X, posto, ini, fim);
  const [a, b] = eja || limitarExtensao(data, ui.dia, X, ini, fim), pn = postoPorId(posto).nome, resto = eja ? 0 : fim - ini - (b - a);
  const bh = nat === "bh";
  mudar(`${nomeGm(X)} com ${bh ? "banco de horas (BH+)" : "hora extra"} ${fmtHm(a)}–${fmtHm(b)} em ${pn}${req ? ` · REQ ${req}` : ""}${eja && a !== ini ? ` (começa quando termina o serviço dele; clique no horário para mudar)` : ""}${resto ? ` (estende ${fmtHoras(b - a)}; faltam ${fmtHoras(resto)} a cobrir)` : ""}`,
    () => data.ocorrencias.push({ id: novoId(), tipo: bh ? "BH_MAIS" : "HE", gm: X, de: ui.dia, ini: fmtHm(a), fim: fmtHm(b), posto, req }));
}
// Tirar uma hora extra: só o turno clicado ou ela toda
function itensRemoverHE(d, turnoId) {
  const o = data.ocorrencias.find((x) => x.id === d.origem), t = TURNOS.find((x) => x.id === turnoId);
  const [a, b] = o ? intervalo(o.ini, o.fim) : [d.ini, d.fim];
  const toda = { t: `Remover toda a hora extra (${fmtHm(a)}–${fmtHm(b)})`, act: "mn-remover-he" };
  if (!t || !o || o.tipo !== "HE" || sobrepoe(a, b, t.ini, t.fim) >= b - a) return [{ ...toda, t: "Remover esta hora extra", padrao: true }];
  const [x, y] = [Math.max(a, t.ini), Math.min(b, t.fim)];
  return [{ t: `Remover só o ${t.nome.toLowerCase()} (${fmtHm(x)}–${fmtHm(y)})`, act: "mn-remover-turno", d: { turno: turnoId }, padrao: true }, toda];
}
function removerTurnoHE(d, turnoId) {
  const o = data.ocorrencias.find((x) => x.id === d.origem), t = TURNOS.find((x) => x.id === turnoId);
  const [a, b] = intervalo(o.ini, o.fim), x = Math.max(a, t.ini), y = Math.min(b, t.fim);
  mudar(`Hora extra de ${nomeGm(d.gm)}: tirado ${fmtHm(x)}–${fmtHm(y)}`, () => {
    const i = data.ocorrencias.indexOf(o), partes = [[a, x], [y, b]].filter(([p, q]) => q > p);
    const novas = partes.map(([p, q], k) => ({ ...o, id: k ? novoId() : o.id, ini: fmtHm(p), fim: fmtHm(q) }));
    data.ocorrencias.splice(i, 1, ...novas);
  });
}
// nome dos turnos que um horário cobre: "3º e 4º turno"
function turnosDe(a, b) {
  const ts = TURNOS.filter((t) => sobrepoe(a, b, t.ini, t.fim) >= 60).map((t) => t.nome.split(" ")[0]);
  return ts.length > 1 ? `${ts.slice(0, -1).join(", ")} e ${ts.at(-1)} turno` : `${ts[0] || ""} turno`;
}
// HE fixa (semanal) colada ao serviço normal: estender aumenta a própria HE fixa, sem criar outra HE por cima
function parFixa(d) {
  const todas = [...(ui.desMap?.values() || [])].filter((x) => x.gm === d.gm);
  if (d.fixa && !d.recorrente) { const n = todas.find((x) => !x.fixa && x.nat !== "he" && x.fim === d.ini); return n ? { normal: n, he: d } : null; }
  const he = todas.find((x) => x.fixa && !x.recorrente && x.ini === d.fim);
  return he ? { normal: d, he } : null;
}
function itensEstender(d) {
  if (ehHeLancada(d) || d.recorrente) return [];
  const pf = parFixa(d);
  const [, b0] = pf ? [0, pf.he.fim] : (d.alvo || `${d.ini}-${d.fim}`).split("-").map(Number);
  return [{ t: "Estender horário", sub: [
    { t: `+6h (até ${fmtHm(b0 + 360)}) · hora extra`, act: "mn-estender", d: { fim: fmtHm(b0 + 360) }, padrao: true },
    { sep: true },
    ...[60, 120, 180].map((m) => ({ t: `+${m / 60}h (até ${fmtHm(b0 + m)}) · hora extra`, act: "mn-estender", d: { fim: fmtHm(b0 + m) } })),
    { sep: true }, { t: "Outro horário…", act: "mn-outro-horario" },
  ] }];
}

// seção: renomear ali mesmo
function abrirEditorSecao(el, secaoId) {
  fecharMenu(); fecharPop(); fecharEditor();
  const r = el.getBoundingClientRect(), box = $("#inline"), s = data.secoes.find((x) => x.id === secaoId);
  Object.assign(ed, { modo: "secao", el, ctx: { secao: secaoId }, d: null, aberto: Date.now() });
  box.innerHTML = `<input id="ed-in" class="ed-in" value="${esc(s.nome)}" aria-label="Nome da seção" autocomplete="off"><div class="ed-dica">Enter salva · Esc cancela · botão direito: mais opções</div>`;
  box.hidden = false;
  box.style.left = Math.max(4, r.left - 2) + "px"; box.style.top = r.top - 2 + "px"; box.style.minWidth = Math.max(r.width + 40, 280) + "px";
  $("#ed-in").focus(); $("#ed-in").select();
}

// ---------- HORÁRIO FIXO / LOTAÇÃO (formulário único) ----------
const DIAS_SEM = ["D", "S", "T", "Q", "Q", "S", "S"];
function mudarLotacao(g, mudancas, desde, msg) {
  const antes = vigente(g, somaDias(desde, -1));
  mudar(msg, () => {
    g.historico = [...(g.historico || []).filter((h) => h.ate < somaDias(desde, -1)), { ate: somaDias(desde, -1), equipe: antes.equipe, lotacao: antes.lotacao, dias: antes.dias }];
    Object.assign(g, mudancas);
    if (mudancas.dias === undefined && mudancas.equipe && equipe(mudancas.equipe)?.tipo !== "semanal") delete g.dias;
  });
}
function textoHorario(segs) {
  const { faixas, heMin } = descreverSegmentos(segs || []);
  return `${faixas.replace(/-/g, "–").replace(/ /g, " + ")}${heMin ? ` · ${fmtHE(heMin)}` : ""}`;
}
function formHorarioFixo(g, desde) {
  const lot = g.lotacao || { posto: data.postos[0].id, funcao: "", segmentos: [] };
  const atual = descreverSegmentos(lot.segmentos), alt = lot.alternativa ? descreverSegmentos(lot.alternativa.segmentos) : null;
  const sem = equipe(g.equipe)?.tipo === "semanal", dias = g.dias || [1, 2, 3, 4, 5];
  const futuras = (g.historico || []).filter((h) => h.ate >= somaDias(desde, -1));
  return `<div class="form form-hf">
    <label>Vale a partir de <input type="date" id="hf-desde" value="${desde}"></label>
    ${futuras.length ? `<p class="aviso">Já existe mudança em ${futuras.map((h) => ddmm(somaDias(h.ate, 1))).join(", ")}. Salvar com data anterior substitui.</p>` : ""}
    <div class="linha"><label>Escala <select id="hf-eq">${data.equipes.map((e) => `<option value="${e.id}" ${e.id === g.equipe ? "selected" : ""}>${esc(rotuloEquipe(e, desde))}</option>`).join("")}</select></label>
      <label>Função <input id="hf-fn" value="${esc(lot.funcao || "")}" placeholder="Motorista, Patrulheiro…" size="12"></label></div>
    <label>Posto ou viatura <select id="hf-posto">${opcoesPosto(lot.posto)}</select></label>
    <div class="modelos-hf"><span class="rot">Modelos</span>${modelosHorario().map((m, i) => `<button type="button" class="ed-chip" data-act="hf-modelo" data-i="${i}" title="${esc(m.hor)}${m.he ? ` · ${m.he}HE` : ""}">${esc(m.nome)}</button>`).join("")}<button type="button" class="link" data-act="hf-salvar-modelo">+ salvar este como modelo</button></div>
    <div class="linha"><label class="cresce">Horário <input id="hf-hor" value="${esc(atual.faixas)}" placeholder="ex.: 07-12 13-19" autocomplete="off"></label>
      <label>HE fixa por dia (h) <input id="hf-he" type="number" min="0" max="12" step="0.5" value="${atual.heMin / 60}" size="4"></label></div>
    <div id="hf-dias" class="dias-sem" ${sem ? "" : "hidden"}><span class="rot">Dias</span>${[1, 2, 3, 4, 5, 6, 0].map((n) => `<label class="dia-chk"><input type="checkbox" value="${n}" ${dias.includes(n) ? "checked" : ""}>${DIAS_SEM[n]}</label>`).join("")}</div>
    <label class="toggle"><input type="checkbox" id="hf-alt" ${alt ? "checked" : ""}> Horário diferente nos dias do padrão par</label>
    <div class="linha" id="hf-alt-campos" ${alt ? "" : "hidden"}><label class="cresce">Horário (padrão par) <input id="hf-alt-hor" value="${esc(alt?.faixas || "")}" placeholder="ex.: 11-12 13-23"></label>
      <label>HE fixa (h) <input id="hf-alt-he" type="number" min="0" max="12" step="0.5" value="${(alt?.heMin || 0) / 60}" size="4"></label></div>
    <p id="hf-previa" class="previa"></p>
    <button class="btn pri" data-act="hf-salvar">Salvar</button></div>`;
}
// Adicionar GM: novo cadastro ou GM que já existe, com escala, posto, horário, HE fixa e dias
function drawerGmNovo(d) {
  const eq = equipe(d.equipe) || data.equipes.find((e) => e.tipo === "semanal") || data.equipes[0];
  const g0 = { nome: "", equipe: eq.id, dias: [1, 2, 3, 4, 5], lotacao: { posto: d.posto || data.postos.find((p) => p.ativo !== false)?.id, funcao: "", segmentos: eq.tipo === "semanal" ? [{ ini: "07:00", fim: "12:00" }, { ini: "13:00", fim: "19:00" }] : eq.periodo === "noite" ? [{ ini: "19:00", fim: "07:00" }] : [{ ini: "07:00", fim: "19:00" }] } };
  return `<div class="dw-head"><div><p class="eyebrow">Padrões</p><h2>Adicionar GM</h2><p class="meta">Escreva o nome de guerra. Se o GM já existir, ele é transferido para cá a partir da data escolhida; se não, é cadastrado.</p></div>
    <button class="ic" data-act="fechar" aria-label="Fechar">×</button></div>
  <div class="dw-body">
    <label class="campo-nome">Nome do GM <input id="ng-nome" list="ng-lista" placeholder="ex.: SILVA" autocomplete="off" value="${esc(d.nome || "")}"></label>
    <datalist id="ng-lista">${data.gms.filter((g) => g.ativo !== false).map((g) => `<option value="${esc(g.nome)}">`).join("")}</datalist>
    <p class="meta" id="ng-info"></p>
    ${formHorarioFixo(g0, ui.padrao?.desde || ui.dia).replace('data-act="hf-salvar">Salvar', 'data-act="ng-salvar">Adicionar')}
  </div>`;
}
// Modelos de horário (12h dia, 12h noite, noite com HE fixa no fim…); dá para salvar novos
const MODELOS_PADRAO = [
  { nome: "12h dia (07–19)", hor: "07-19", he: 0 }, { nome: "12h noite (19–07)", hor: "19-07", he: 0 },
  { nome: "Noite 18–06 + 1HE (06–07)", hor: "18-07", he: 1 }, { nome: "Dia 06–18", hor: "06-18", he: 0 },
  { nome: "Expediente 07–12 · 13–16 + 2HE", hor: "07-12 13-18", he: 2 },
];
const modelosHorario = () => [...MODELOS_PADRAO, ...(data.config.modelosHorario || [])];
function previaHorarioFixo() {
  const el = $("#hf-previa");
  if (!el) return null;
  const f = lerFaixas($("#hf-hor").value), heMin = Math.round(Number($("#hf-he").value || 0) * 60);
  $("#hf-dias").hidden = equipe($("#hf-eq").value)?.tipo !== "semanal";
  $("#hf-alt-campos").hidden = !$("#hf-alt").checked;
  if (!f) { el.innerHTML = `<span class="falta-txt">Escreva o horário como 07-12 13-19</span>`; return null; }
  const segs = montarSegmentos(f, heMin);
  let alt = null;
  if ($("#hf-alt").checked) {
    const fa = lerFaixas($("#hf-alt-hor").value);
    if (!fa) { el.innerHTML = `<span class="falta-txt">Escreva o horário do padrão par (ex.: 11-12 13-23)</span>`; return null; }
    alt = { quando: data.equipes.filter((e) => e.tipo === "alternado" && padraoNoMes(e.id, $("#hf-desde").value || ui.dia) === "par").map((e) => e.id), segmentos: montarSegmentos(fa, Math.round(Number($("#hf-alt-he").value || 0) * 60)) };
  }
  const desc = (ss) => ss.map((s) => `${s.ini}–${s.fim}${s.tipo === "he" ? ` <b class="he-num">HE</b>` : ""}`).join(" + ");
  el.innerHTML = `Fica: ${desc(segs)}${heMin ? ` · <b class="he-num">${fmtHE(heMin)}</b> por dia` : ""}${alt ? `<br>Dias do padrão par: ${desc(alt.segmentos)}` : ""}`;
  return { segs, alt };
}

// ---------- ABA PADRÕES ----------
function equipesDoPadrao(qual, mes) {
  const imp = calcularDia(data, `${mes}-01`).equipes;
  return data.equipes.filter((e) => e.tipo === "alternado" && (qual === "impar") === imp.includes(e.id)).map((e) => e.id);
}
function vPadroes() {
  const pd = (ui.padrao ||= { aba: "impar", mes: mesDe(ui.dia), desde: ui.dia });
  const ref = pd.desde, mes = pd.mes;
  const ativos = data.gms.filter((g) => g.ativo !== false).map((g) => ({ g, v: vigente(g, ref) }));
  const eqImp = equipesDoPadrao("impar", mes), eqPar = equipesDoPadrao("par", mes);
  const conta = (eqs, per) => ativos.filter(({ v }) => eqs.includes(v.equipe) && equipe(v.equipe).periodo === per).length;
  const sem = ativos.filter(({ v }) => equipe(v.equipe)?.tipo === "semanal");
  const abas = [["impar", `Padrão ímpar · ${conta(eqImp, "dia")} dia / ${conta(eqImp, "noite")} noite`], ["par", `Padrão par · ${conta(eqPar, "dia")} dia / ${conta(eqPar, "noite")} noite`], ["semanal", `Semanal · ${sem.length}`], ["inspetores", "Inspetores de serviço"], ["efetivo", `Efetivo · ${data.gms.filter((g) => g.ativo !== false).length}${semPadrao(ref).length ? ` · ${semPadrao(ref).length} sem posto` : ""}`]];
  let corpo;
  if (pd.aba === "efetivo") corpo = tabelaEfetivo(ref);
  else if (pd.aba === "inspetores") corpo = tabelaInspetores(mes);
  else if (pd.aba === "semanal") {
    const livro = livroMes(data, mes);
    corpo = `<div class="tabela-wrap"><table class="lanc pad-sem"><thead><tr><th>GM</th><th>Posto</th><th>Dias</th><th>Horário fixo</th><th>Padrão par</th><th>HE fixa no mês</th></tr></thead><tbody>
      ${sem.sort((a, b) => a.g.nome.localeCompare(b.g.nome)).map(({ g, v }) => `<tr><td><button class="link" data-act="pad-gm" data-gm="${g.id}">${esc(g.nome)}</button></td><td>${esc(postoPorId(v.lotacao?.posto)?.nome || "—")}</td>
        <td class="num">${(v.dias || [1, 2, 3, 4, 5]).map((n) => DIAS_SEM[n]).join(" ")}</td><td class="num">${textoHorario(v.lotacao?.segmentos)}</td>
        <td class="num">${v.lotacao?.alternativa ? textoHorario(v.lotacao.alternativa.segmentos) : "—"}</td><td class="num">${fmtHoras(livro.get(g.id)?.heFixa || 0)}</td></tr>`).join("")}
      </tbody></table></div>`;
  } else {
    const eqs = pd.aba === "impar" ? eqImp : eqPar, outros = pd.aba === "impar" ? eqPar : eqImp;
    const pessoa = ({ g, v }, extra = "") => `<button class="pgm ${extra}" data-act="pad-gm" data-gm="${g.id}" title="Clique ou botão direito para editar">${v.lotacao?.funcao && (emVtr(v.lotacao.posto) || !ICO_FUNCAO[v.lotacao.funcao]) ? `<small title="${esc(v.lotacao.funcao)}">${icoFuncao(v.lotacao.funcao) || esc(v.lotacao.funcao)}</small> ` : ""}${esc(g.nome)}${extra === "sem" ? ` <span class="tag rem">seg–sex</span>` : ""}<span class="num">${textoHorario(v.lotacao?.segmentos)}</span></button>`;
    const periodoDe = (segs) => { const [a] = segs?.length ? intervalo(segs[0].ini, segs[0].fim) : [420]; return a >= 900 || a < 300 ? "noite" : "dia"; };
    corpo = data.secoes.filter((s) => !s.operacao).map((s) => {
      const abre = ui.padVazios?.has(s.id); let escondidos = 0;
      const linhas = data.postos.filter((p) => p.secao === s.id && p.ativo !== false && !p.so && !p.de && !s.operacao && (!p.equipes?.length || p.equipes.some((e) => eqs.includes(e)))).map((p) => {
        let tem = 0;
        const cel = (per) => {
          const aqui = ativos.filter(({ v }) => eqs.includes(v.equipe) && equipe(v.equipe).periodo === per && v.lotacao?.posto === p.id);
          const semanais = sem.filter(({ v }) => v.lotacao?.posto === p.id && periodoDe(v.lotacao.segmentos) === per);
          const rec = ativos.filter(({ g }) => (g.heRecorrente || []).some((r) => r.posto === p.id && periodoDe(r.segmentos) === per));
          const no = ativos.filter(({ v }) => outros.includes(v.equipe) && equipe(v.equipe).periodo === per && v.lotacao?.posto === p.id).length;
          const dif = aqui.length !== no && !(p.secao && data.secoes.find((x) => x.id === p.secao)?.grupamento);
          const [ra, rb] = p.reforco ? intervalo(p.reforco.ini, p.reforco.fim) : [];
          const reforco = p.reforco && periodoDe([p.reforco]) === per;
          tem += aqui.length + semanais.length + rec.length;
          const vazio = !aqui.length && !semanais.length && !rec.length && !reforco;
          const ts = per === "dia" ? ["t2", "t3"] : ["t4", "t1"], vagas = p.rondas ? 0 : Math.max(0, ...ts.map((t) => p.vagas?.[t] || 0));
          const faltam = Math.max(0, vagas - aqui.length - semanais.length);
          return `<td class="${per} ${dif ? "dif" : ""}" data-pposto="${p.id}" data-pper="${per}">${aqui.map((x) => pessoa(x)).join("")}${semanais.map((x) => pessoa(x, "sem")).join("")}
            ${rec.map(({ g }) => `<button class="pgm he" data-act="pad-gm" data-gm="${g.id}">${esc(g.nome)} <b class="he-num">HE+</b><span class="num">${g.heRecorrente.filter((r) => r.posto === p.id).flatMap((r) => r.segmentos).map((x) => x.ini + "–" + x.fim).join(" + ")} · dias úteis</span></button>`).join("")}
            ${reforco ? `<span class="vaga-ref">Vaga de reforço ${fmtHm(ra)}–${fmtHm(rb)} · HE${p.dias ? " · dias úteis" : ""}</span>` : ""}
            ${vazio && p.rondas ? `<span class="rondas">VTR/RONDAS FREQUENTES</span>` : ""}
            ${faltam ? `<span class="furo-pad" title="O posto tem ${vagas} vaga${vagas === 1 ? "" : "s"} neste período">Vaga sem GM · falta ${faltam}<button class="link" data-act="pad-semvaga" data-posto="${p.id}" data-per="${per}">não usar ${per === "dia" ? "de dia" : "à noite"}</button></span>` : ""}
            ${dif ? `<span class="dif-txt" title="No outro padrão há ${no}">${aqui.length < no ? "▲" : "▼"} outro padrão: ${no}</span>` : ""}
            <button class="add" data-act="pad-add" data-posto="${p.id}" data-per="${per}">+ pôr GM</button></td>`;
        };
        const soUm = p.equipes?.length ? `<span class="selo-so-pad" title="Este posto só existe no padrão ${pd.aba === "impar" ? "ímpar" : "par"}">só ${pd.aba === "impar" ? "ímpar" : "par"}</span>` : "";
        const html = `<tr class="${s.grupamento ? "em-grupo" : ""} ${s.grupamento && !tem ? "grupo-vazio" : ""}"><th scope="row" class="posto"><button class="posto-btn" data-act="pad-posto" data-posto="${p.id}" title="Clique para editar · botão direito: mais opções"><span class="pn">${iconePosto(p)}${esc(p.nome)}</span>${soUm}${p.sub ? `<span class="ps">${esc(p.sub)}</span>` : ""}${p.obs ? `<span class="po">(${esc(p.obs)})</span>` : ""}${s.grupamento && !tem ? `<span class="po">sem GM neste padrão: não aparece no quadro</span>` : ""}<span class="lapis" aria-hidden="true">✎</span></button></th>${cel("dia")}${cel("noite")}</tr>`;
        if (s.grupamento && !tem && !abre) { escondidos++; return ""; } // grupamento sem ninguém neste padrão fica recolhido
        return html;
      }).join("");
      const botaoVazios = s.grupamento && (escondidos || abre) && data.postos.some((p) => p.secao === s.id && p.ativo !== false)
        ? `<button class="link add-sec" data-act="pad-vazios" data-secao="${s.id}">${abre ? "esconder os sem GM" : `mostrar ${escondidos} sem GM neste padrão`}</button>` : "";
      return `<tr class="secao ${s.grupamento ? "grupo" : ""}"><th colspan="3"><button class="secao-btn" data-act="secao-nome" data-secao="${s.id}" title="Clique para renomear · botão direito: mais opções">${s.grupamento ? ICONES.grupo : ""}${esc(s.nome)} <span class="lapis" aria-hidden="true">✎</span></button>${s.grupamento ? `<span class="selo-grupo">GRUPAMENTO</span>` : ""}<button class="link add-sec" data-act="pad-novo" data-secao="${s.id}">+ posto/viatura</button>${botaoVazios}</th></tr>${linhas}`;
    }).join("");
    corpo = `<div class="tabela-wrap"><table class="quadro padrao"><colgroup><col class="c-posto"><col><col></colgroup>
      <thead><tr><th>POSTO</th><th class="dia">DIA (2º e 3º turno)</th><th class="noite">NOITE (4º e 1º turno)</th></tr></thead><tbody>${corpo}</tbody></table></div>`;
  }
  return `<div class="pad-fixo"><div class="faixa-modelo"><b>Modelo da escala</b><span>Aqui você muda o <u>padrão</u>: vale para <b style="all:unset;font-weight:700">todos os dias a partir de ${ddmm(pd.desde)}</b>. Para mexer só num dia, use o Quadro do dia.</span><a class="link" href="#quadro" data-nav="quadro">ir para o Quadro do dia</a></div><div class="barra"><div class="datas"><button class="ic" data-act="pad-mes" data-n="-1" aria-label="Mês anterior">‹</button><h2 class="titulo-mes">${nomeMes(mes)}</h2><button class="ic" data-act="pad-mes" data-n="1" aria-label="Próximo mês">›</button></div>
    <button class="btn" data-act="busca-gm" title="Onde está um GM (Ctrl+F)">🔍 Buscar GM</button>
    ${postosExcluidos().length ? `<button class="link" data-act="ex-abrir">Postos excluídos (${postosExcluidos().length})</button>` : ""}
    <label class="desde">Mudanças valem a partir de <input type="date" id="pad-desde" value="${pd.desde}"></label></div>
  <div class="abas-pad" role="tablist">${abas.map(([k, t]) => `<button role="tab" aria-selected="${pd.aba === k}" data-act="pad-aba" data-aba="${k}">${t}</button>`).join("")}
    ${pd.aba === "inspetores" ? "" : `<span class="add-gm"><button class="btn" data-act="pad-novo">+ Posto / viatura / seção</button><button class="btn pri" data-act="pad-novo-gm">+ Adicionar GM${pd.aba === "semanal" ? " na semanal" : ""}</button></span>`}</div></div>
  ${["impar", "par", "semanal"].includes(pd.aba) && semPadrao(ref).length ? `<p class="aviso-falta">${semPadrao(ref).length} GM${semPadrao(ref).length === 1 ? "" : "s"} sem posto no padrão (fora da escala): ${semPadrao(ref).slice(0, 8).map((g) => `<b>${esc(g.nome)}</b>`).join(", ")}${semPadrao(ref).length > 8 ? "…" : ""} <button class="link" data-act="pad-aba" data-aba="efetivo">ver no Efetivo</button></p>` : ""}
  <p class="dica">${pd.aba === "efetivo" ? "Cadastro de todos os GMs. Mude direto na linha: escala, posto, função, grupamentos (ex.: GESCOM) e CNH. Os grupamentos fazem o GM aparecer primeiro nas sugestões de HE das vagas daquele grupamento." : pd.aba === "inspetores" ? "Escala mensal dos inspetores de serviço. Clique no nome para trocar (vale só para aquele dia e período). Para férias ou curso, use “Substituir no período”." : pd.aba === "semanal" ? "Quem trabalha de segunda a sexta, com o horário fixo e a HE fixa de cada um. Clique no nome para editar." : `Composição do padrão ${pd.aba === "impar" ? "ímpar" : "par"} em ${nomeMes(mes).toLowerCase()} (quem trabalha nos dias ${pd.aba === "impar" ? "ímpares" : "pares"}), sem folgas e afastamentos. Clique no GM, no posto ou na seção para editar; o botão direito mostra mais opções (novo posto, subir/descer, desativar). Em vermelho: vaga sem GM ou quantidade diferente do outro padrão.`}</p>
  ${corpo}`;
}
// ---------- EFETIVO (cadastro de todos os GMs) ----------
// "Sem posto no padrão": ativo, mas sem lotação, com posto excluído ou sem escala — ficaria fora da escala sem ninguém perceber
function semPadrao(dia) {
  return data.gms.filter((g) => { if (g.ativo === false) return false; const v = vigente(g, dia), p = v.lotacao?.posto && postoPorId(v.lotacao.posto); return !p || p.ativo === false || !equipe(v.equipe); });
}
const nomesGrupos = () => [...new Set([...data.secoes.filter((s) => !s.operacao).map((s) => s.nome), ...data.gms.flatMap((g) => g.grupos || [])])].sort();
function tabelaEfetivo(ref) {
  const f = (ui.efetivo ||= { busca: "", so: "" }), limbo = new Set(semPadrao(ref).map((g) => g.id));
  const lista = data.gms.filter((g) => (f.so === "sem" ? limbo.has(g.id) : f.so === "inativos" ? g.ativo === false : g.ativo !== false))
    .filter((g) => !f.busca || norm(`${g.nome} ${(g.grupos || []).join(" ")} ${postoPorId(vigente(g, ref).lotacao?.posto)?.nome || ""}`).includes(norm(f.busca)))
    .sort((a, b) => limbo.has(b.id) - limbo.has(a.id) || a.nome.localeCompare(b.nome));
  const sel = (g, campo, ops, val) => `<select class="ef-in" data-ef="${g.id}" data-campo="${campo}">${ops.map(([v, t]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  return `<div class="ef-barra"><input type="search" id="ef-busca" value="${esc(f.busca)}" placeholder="Buscar nome, posto ou grupamento" aria-label="Buscar GM">
      ${[["", "Ativos"], ["sem", `Sem posto (${limbo.size})`], ["inativos", "Desativados"]].map(([k, t]) => `<button class="btn ${f.so === k ? "pri" : ""}" data-act="ef-filtro" data-so="${k}">${t}</button>`).join("")}
      <button class="btn" data-act="pad-novo-gm">+ Adicionar GM</button></div>
    <datalist id="ef-grupos">${nomesGrupos().map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
    <div class="tabela-wrap"><table class="lanc efetivo"><thead><tr><th>GM</th><th>Escala</th><th>Posto</th><th>Função</th><th>Grupamentos</th><th>CNH</th><th>Observação</th><th></th></tr></thead><tbody>
    ${lista.map((g) => { const v = vigente(g, ref);
      return `<tr class="${limbo.has(g.id) ? "limbo" : ""} ${g.ativo === false ? "inativo" : ""}"><td><button class="link" data-act="abrir-ficha" data-gm="${g.id}">${esc(g.nome)}</button>${limbo.has(g.id) ? ` <span class="tag furo">sem posto</span>` : ""}</td>
        <td>${sel(g, "equipe", [["", "—"], ...data.equipes.map((e) => [e.id, rotuloEquipe(e, ref, true)])], v.equipe || "")}</td>
        <td><select class="ef-in" data-ef="${g.id}" data-campo="posto"><option value="">— sem posto —</option>${opcoesPosto(v.lotacao?.posto || "")}</select></td>
        <td>${sel(g, "funcao", [["", "—"], ["Motorista", "Motorista"], ["Patrulheiro", "Patrulheiro"]], v.lotacao?.funcao || "")}</td>
        <td><input class="ef-in" data-ef="${g.id}" data-campo="grupos" list="ef-grupos" value="${esc((g.grupos || []).join(", "))}" placeholder="ex.: GESCOM"></td>
        <td>${sel(g, "cnh", [["", "—"], ["A", "A (moto)"], ["B", "B"], ["AB", "AB"], ["D", "D"], ["AD", "AD"]], g.cnh || "")}</td>
        <td><input class="ef-in" data-ef="${g.id}" data-campo="obs" value="${esc(g.obs || "")}" placeholder="opcional"></td>
        <td>${g.ativo === false ? `<button class="link" data-act="ef-reativar" data-gm="${g.id}">reativar</button>` : `<button class="link" data-act="pad-gm" data-gm="${g.id}">mais…</button>`}</td></tr>`; }).join("")}
    </tbody></table></div>`;
}
// ---------- INSPETORES DE SERVIÇO (escala mensal) ----------
// inspetor de um dia/período: escala mensal; sem ela, o da equipe que trabalha no dia
function inspetorDe(dia, per) {
  const cd = calcularDia(data, dia);
  const x = data.inspetores?.[dia];
  if (x && per in x) return x[per];
  return cd.equipes.map(equipe).filter((e) => e.periodo === per).map((e) => cd.inspetores.get(e.id) || e.inspetor).filter(Boolean)[0] || "";
}
const afastInsp = () => data.inspetores?._afast || [];
const afastDoInspetor = (nome, dia) => afastInsp().find((a) => norm(a.nome) === norm(nome) && a.de <= dia && dia <= a.ate);
const nomesInspetores = () => [...new Set([...Object.entries(data.inspetores || {}).filter(([k]) => /^\d{4}-/.test(k)).flatMap(([, x]) => [x.dia, x.noite]), ...afastInsp().map((a) => a.nome), ...data.equipes.map((e) => e.inspetor), ...(data.config.rodizioInsp?.dia || []), ...(data.config.rodizioInsp?.noite || [])].filter(Boolean))].sort();
function tabelaInspetores(mes) {
  const dias = diasDoMes(mes), rod = data.config.rodizioInsp || {}, nomes = nomesInspetores();
  const afastado = (nome, dia) => { const a = afastDoInspetor(nome, dia); if (a) return { tipo: a.tipo }; const g = data.gms.find((x) => norm(x.nome) === norm(nome)); return g && afastamentoNoDia(data, g.id, dia); };
  const quemFalta = (dia) => afastInsp().filter((a) => a.de <= dia && dia <= a.ate).map((a) => `${a.nome} (${(TIPOS[a.tipo] || a.tipo).toLowerCase()})`).join(", ");
  const conta = {};
  let faltam = 0;
  for (const d of dias) for (const per of ["dia", "noite"]) { const n = inspetorDe(d, per); if (n) conta[n] = (conta[n] || 0) + 1; else if (data.inspetores?.[d] && per in data.inspetores[d]) faltam++; }
  const cel = (d, per) => { const n = inspetorDe(d, per), x = data.inspetores?.[d], proprio = !!(x && per in x), af = n && afastado(n, d), falta = proprio && !n;
    return `<td class="insp-${per} ${af ? "insp-af" : ""} ${falta ? "insp-falta" : ""}"><input class="insp-in ${proprio ? "" : "herdado"}" list="insp-nomes" data-insp-dia="${d}" data-insp-per="${per}" value="${esc(n)}" placeholder="${falta ? `falta inspetor${quemFalta(d) ? ` · ${esc(quemFalta(d))}` : ""}` : ""}" aria-label="Inspetor ${per} ${ddmm(d)}" title="${af ? `${esc(n)} está afastado neste dia (${esc(TIPOS[af.tipo] || af.tipo)})` : falta ? "Sem inspetor: escreva quem cobre" : proprio ? "" : "Sem escala mensal: inspetor da equipe"}"></td>`; };
  return `<div class="insp-wrap"><div class="tabela-wrap"><table class="lanc insp"><thead><tr><th>Dia</th><th class="th-d">DIA</th><th class="th-n">NOITE</th></tr></thead><tbody>
    ${dias.map((d) => `<tr class="${[0, 6].includes(diaSemana(d)) ? "fds" : ""} ${d === ui.dia ? "hoje" : ""}"><td class="num">${Number(d.slice(8))} <small>${SEMANA[diaSemana(d)].slice(0, 3).toLowerCase()}</small></td>${cel(d, "dia")}${cel(d, "noite")}</tr>`).join("")}
    </tbody></table><datalist id="insp-nomes">${nomes.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
  <aside class="insp-lado">
    <section class="painel"><h3>Preencher pelo rodízio</h3>
      <p class="dica">Os nomes na ordem em que se revezam, um por dia. Preenche ${nomeMes(mes).toLowerCase()} inteiro a partir do dia escolhido; depois dá para ajustar cada dia na tabela.</p>
      <label>Dia <input id="rod-dia" value="${esc((rod.dia || []).join(", "))}" placeholder="ex.: DIEGO, ZONATTO, GIAN"></label>
      <label>Noite <input id="rod-noite" value="${esc((rod.noite || []).join(", "))}" placeholder="ex.: RIBEIRO, PEREIRA, DA CRUZ"></label>
      <label>A partir do dia <input type="date" id="rod-de" value="${mes}-01"></label>
      <button class="btn pri" data-act="insp-rodizio">Preencher o mês</button></section>
    ${faltam ? `<p class="aviso-falta"><b>${faltam}</b> serviço${faltam === 1 ? "" : "s"} sem inspetor neste mês (em vermelho na tabela). Escreva quem cobre em cada um.</p>` : ""}
    <section class="painel"><h3>Férias, curso, afastamento</h3>
      <p class="dica">Tira o inspetor da escala nesses dias. Os serviços dele ficam em vermelho para você escolher quem cobre, dia a dia (pode ser um chefe do dia cobrindo a noite).</p>
      <label>Inspetor <input id="af-quem" list="insp-nomes" placeholder="nome"></label>
      <div class="linha"><label>Motivo <select id="af-tipo">${["FERIAS", "CURSO", "LICENCA", "ATESTADO", "FOLGA"].map((t) => `<option value="${t}">${esc(TIPOS[t])}</option>`).join("")}</select></label>
        <label>De <input type="date" id="af-de" value="${ui.dia.startsWith(mes) ? ui.dia : mes + "-01"}"></label><label>Até <input type="date" id="af-ate" value="${dias.at(-1)}"></label></div>
      <button class="btn pri" data-act="insp-afastar">Lançar</button>
      ${afastInsp().filter((a) => a.ate >= mes + "-01" && a.de <= dias.at(-1)).length ? `<ul class="lista-oc">${afastInsp().filter((a) => a.ate >= mes + "-01" && a.de <= dias.at(-1)).map((a) => `<li><span><b>${esc(a.nome)}</b> · ${esc(TIPOS[a.tipo] || a.tipo)} · ${ddmm(a.de)} a ${ddmm(a.ate)}</span><button class="link" data-act="insp-afast-del" data-id="${a.id}" title="Tira o registro; os nomes já colocados na tabela continuam">remover</button></li>`).join("")}</ul>` : ""}</section>
    <section class="painel"><h3>Serviços no mês</h3><ul class="insp-conta">${Object.entries(conta).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<li><b>${esc(n)}</b> <span class="num">${c}</span></li>`).join("") || "<li class='meta'>—</li>"}</ul></section>
  </aside></div>`;
}
function itensPadraoGm(g) {
  const v = vigente(g, ui.padrao.desde), eq = equipe(v.equipe);
  const outro = eq?.tipo === "alternado" ? data.equipes.find((e) => e.tipo === "alternado" && e.periodo === eq.periodo && e.id !== eq.id) : null;
  return [
    { t: "Lotação e horário fixo…", act: "pad-editar", d: { gm: g.id }, padrao: true },
    ...(!emVtr(v.lotacao?.posto) ? [] : [{ t: `Função${v.lotacao?.funcao ? ` (${v.lotacao.funcao.toLowerCase()})` : ""}`, sub: [["Motorista", "Motorista"], ["Patrulheiro", "Patrulheiro"], ["", "Sem função"]].map(([f, t]) => ({ t: `${(v.lotacao?.funcao || "") === f ? "✓ " : ""}${t}`, act: "pad-funcao", d: { gm: g.id, f } })) }]),
    ...(outro ? [{ t: `Passar para o padrão ${padraoNoMes(outro.id, ui.padrao.mes + "-01")} (${eq.periodo})`, act: "pad-trocar", d: { gm: g.id, eq: outro.id } }] : []),
    ...(eq?.tipo === "alternado" ? [{ t: `Passar para a ${eq.periodo === "dia" ? "noite" : "dia"} (mesmo padrão)`, act: "pad-trocar", d: { gm: g.id, eq: data.equipes.find((e) => e.tipo === "alternado" && e.periodo !== eq.periodo && padraoNoMes(e.id, ui.padrao.mes + "-01") === padraoNoMes(eq.id, ui.padrao.mes + "-01"))?.id } }] : []),
    { sep: true },
    { t: "Ver ficha do GM", act: "pad-ficha", d: { gm: g.id } },
    { t: "Desativar (saiu da escala)…", act: "pad-desativar", d: { gm: g.id } },
  ];
}

function colocarNoPadrao(g, postoId, per) {
  const pd = ui.padrao, v = vigente(g, pd.desde), eqAtual = equipe(v.equipe);
  const eqs = equipesDoPadrao(pd.aba, pd.mes), eqNovo = eqAtual?.tipo === "semanal" ? eqAtual.id : data.equipes.find((e) => eqs.includes(e.id) && e.periodo === per).id;
  const mudouPeriodo = equipe(eqNovo).periodo !== eqAtual?.periodo || eqAtual?.tipo === "semanal" && eqNovo !== eqAtual.id;
  const segs = mudouPeriodo || !v.lotacao ? [{ ini: per === "dia" ? "07:00" : "19:00", fim: per === "dia" ? "19:00" : "07:00", tipo: "normal" }] : v.lotacao.segmentos;
  const lot = { ...(v.lotacao || {}), posto: postoId, funcao: v.lotacao?.posto === postoId ? v.lotacao.funcao : "", segmentos: segs };
  mudarLotacao(g, { equipe: eqNovo, lotacao: lot }, pd.desde, `${g.nome} no ${postoPorId(postoId).nome} (${rotuloEquipe(equipe(eqNovo), pd.desde)}) a partir de ${ddmm(pd.desde)}`);
}
document.addEventListener("contextmenu", (e) => {
  const b = e.target.closest(".pgm[data-gm]");
  if (!b) return;
  e.preventDefault(); e.stopImmediatePropagation();
  abrirMenu(itensPadraoGm(gmPorId(b.dataset.gm)), e.clientX || b.getBoundingClientRect().left, e.clientY || b.getBoundingClientRect().bottom, b, { gm: b.dataset.gm });
}, true);

// ---------- eventos ----------
function abrirFuro(posto, turno) {
  const t = TURNOS.find((x) => x.id === turno);
  ui.drawer = { tipo: "furo", posto, turno, ini: fmtHm(t.ini), fim: fmtHm(t.fim), nat: "HE", req: "" };
  render();
}
document.addEventListener("click", (e) => {
  if (ui.colando && e.target.closest("table.quadro td[data-posto]") && !e.target.closest("#menu, #pop, #inline")) { e.preventDefault(); colar(e.target.closest("td[data-posto]")); return; }
  if (ui.ignorarClique) { const recente = Date.now() - ui.ignorarClique < 400; ui.ignorarClique = 0; if (recente && !e.target.closest("#menu")) return; } // o clique que encerra um arrasto não abre o cartão
  const noMenu = e.target.closest("#menu");
  if (!noMenu) fecharMenu();
  else {
    const sub = e.target.closest(".mn-sub > .mn-item");
    if (sub) { const aberto = sub.parentElement.classList.toggle("aberto"); sub.setAttribute("aria-expanded", String(aberto)); if (aberto) sub.nextElementSibling.querySelector(".mn-item")?.focus(); return; }
    const it = e.target.closest(".mn-item[data-act]");
    if (it && !it.dataset.act.startsWith("mn-")) setTimeout(fecharMenu);
  }
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
    case "pop-add": abrirEditor("add", el, { posto: el.dataset.posto, turno: el.dataset.turno }); return;
    case "pop-fechar": fecharPop(); return;
    case "pad-aba": ui.padrao.aba = el.dataset.aba; render(); return;
    case "pad-mes": { const pd = ui.padrao; pd.mes = Number(el.dataset.n) > 0 ? mesSeguinte(pd.mes) : mesAnterior(pd.mes); if (pd.desde.slice(0, 7) < pd.mes) pd.desde = `${pd.mes}-01`; render(); return; }
    case "pad-gm": { const r = el.getBoundingClientRect(); abrirMenu(itensPadraoGm(gmPorId(el.dataset.gm)), r.left, r.bottom + 2, el, { gm: el.dataset.gm }); return; }
    case "pad-editar": { const g = el.dataset.gm; fecharMenu(); ui.drawer = { tipo: "gm", gm: g, acao: "lotacao", desde: ui.padrao?.desde || ui.dia }; render(); setTimeout(previaHorarioFixo); return; }
    case "pad-ficha": { const g = el.dataset.gm; fecharMenu(); ui.gm = g; ui.view = "ficha"; location.hash = "ficha"; render(); return; }
    case "pad-trocar": {
      const g = gmPorId(el.dataset.gm), eqNovo = el.dataset.eq, v = vigente(g, ui.padrao.desde);
      fecharMenu();
      if (!eqNovo) return;
      const per = equipe(eqNovo).periodo, mudouPer = per !== equipe(v.equipe).periodo;
      const lot = mudouPer ? { ...v.lotacao, segmentos: [{ ini: per === "dia" ? "07:00" : "19:00", fim: per === "dia" ? "19:00" : "07:00", tipo: "normal" }] } : v.lotacao;
      mudarLotacao(g, { equipe: eqNovo, lotacao: lot }, ui.padrao.desde, `${g.nome} passa para ${rotuloEquipe(equipe(eqNovo), ui.padrao.desde)} a partir de ${ddmm(ui.padrao.desde)}`);
      return;
    }
    case "pad-desativar": {
      const g = gmPorId(el.dataset.gm), r = ui.menu.alvo.getBoundingClientRect();
      fecharMenu();
      abrirMenu([{ t: `Desativar ${g.nome}? Ele sai de todas as escalas.`, act: "ed-nada", desab: true }, { sep: true }, { t: "Sim, desativar", act: "pad-desativar-ok", d: { gm: g.id } }, { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, null, {});
      return;
    }
    case "pad-desativar-ok": { const g = gmPorId(el.dataset.gm); fecharMenu(); mudar(`${g.nome} desativado`, () => { g.ativo = false; }); return; }
    case "pad-add": abrirEditor("padrao", el, { posto: el.dataset.posto, per: el.dataset.per }); return;
    case "hf-modelo": { const m = modelosHorario()[Number(el.dataset.i)]; $("#hf-hor").value = m.hor; $("#hf-he").value = m.he; previaHorarioFixo(); return; }
    case "hf-salvar-modelo": {
      const hor = $("#hf-hor").value.trim(), he = Number($("#hf-he").value || 0);
      if (!lerFaixas(hor)) { toast("Escreva um horário válido antes (ex.: 18-07)."); return; }
      const nome = prompt("Nome do modelo", `${hor.replace(/ /g, " · ")}${he ? ` + ${he}HE` : ""}`)?.trim(); if (!nome) return;
      mudar(`Modelo "${nome}" salvo`, () => { data.config.modelosHorario = [...(data.config.modelosHorario || []), { nome, hor, he }]; });
      previaHorarioFixo(); return;
    }
    case "hf-salvar": {
      const g = gmPorId(ui.drawer.gm), r = previaHorarioFixo(), desde = $("#hf-desde").value;
      if (!r) return;
      if (!desde) { toast("Informe a partir de quando vale."); return; }
      const eqId = $("#hf-eq").value, semanal = equipe(eqId)?.tipo === "semanal";
      const lot = { posto: $("#hf-posto").value, funcao: $("#hf-fn").value.trim(), segmentos: r.segs, ...(r.alt ? { alternativa: r.alt } : {}) };
      const dias = semanal ? [...document.querySelectorAll("#hf-dias input:checked")].map((i) => Number(i.value)) : undefined;
      if (semanal && !dias.length) { toast("Marque pelo menos um dia."); return; }
      ui.drawer = null;
      mudarLotacao(g, { equipe: eqId, lotacao: lot, ...(semanal ? { dias } : {}) }, desde, `${g.nome}: ${textoHorario(lot.segmentos)} em ${postoPorId(lot.posto).nome}, a partir de ${ddmm(desde)}`);
      return;
    }
    case "dr-cancelar": fecharMenu(); return;
    case "dr-rem": case "dr-rem-parcial": {
      const { des: d, drop } = ui.menu, p = postoPorId(drop.posto), t = TURNOS.find((x) => x.id === drop.turno), parcial = el.dataset.act === "dr-rem-parcial";
      fecharMenu();
      const oc = { id: novoId(), tipo: "REMANEJ", gm: d.gm, de: ui.dia, ate: ui.dia, posto: p.id };
      if (parcial) { oc.ini = fmtHm(Math.max(d.ini, t.ini)); oc.fim = fmtHm(Math.min(d.fim, t.fim)); }
      mudar(`${nomeGm(d.gm)} remanejado para ${p.nome}${parcial ? ` (${oc.ini}–${oc.fim})` : ""}`, () => data.ocorrencias.push(oc));
      return;
    }
    case "dr-trocar-lugar": {
      const { des: d, drop } = ui.menu, o = drop.des;
      fecharMenu();
      mudar(`${nomeGm(d.gm)} e ${nomeGm(o.gm)} trocaram de lugar`, () => {
        data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: d.gm, de: ui.dia, ate: ui.dia, posto: o.posto, funcao: o.funcao || "", obs: "Troca de lugar no quadro" });
        data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: o.gm, de: ui.dia, ate: ui.dia, posto: d.posto, funcao: d.funcao || "", obs: "Troca de lugar no quadro" });
      });
      return;
    }
    case "dr-mover-he": {
      const { des: d, drop } = ui.menu, p = postoPorId(drop.posto);
      fecharMenu();
      mudar(`Hora extra de ${nomeGm(d.gm)} movida para ${p.nome} ${el.dataset.ini}–${el.dataset.fim}`, () => Object.assign(data.ocorrencias.find((o) => o.id === d.origem), { posto: p.id, ini: el.dataset.ini, fim: el.dataset.fim }));
      return;
    }
    case "dr-he": {
      const { des: d, drop } = ui.menu, p = postoPorId(drop.posto), t = TURNOS.find((x) => x.id === drop.turno);
      fecharMenu();
      mudar(`${nomeGm(d.gm)} com hora extra em ${p.nome} ${fmtHm(t.ini)}–${fmtHm(t.fim)}`, () => data.ocorrencias.push({ id: novoId(), tipo: "HE", gm: d.gm, de: ui.dia, ini: fmtHm(t.ini), fim: fmtHm(t.fim), posto: p.id, req: "" }));
      return;
    }
    case "dr-deslocar": {
      const { des: d, drop } = ui.menu, ini = el.dataset.ini, fim = el.dataset.fim, p = postoPorId(drop.posto);
      fecharMenu();
      const alvo = d.alvo || `${d.ini}-${d.fim}`, quem = d.titular || d.gm;
      const atual = data.ocorrencias.find((o) => o.tipo === "HORARIO" && o.gm === quem && o.de === ui.dia && o.alvo === alvo);
      mudar(`${nomeGm(d.gm)} trabalha ${ini}–${fim}${d.posto !== p.id ? ` em ${p.nome}` : ""}, sem hora extra`, () => {
        if (atual) Object.assign(atual, { ini, fim, semHE: true }); else data.ocorrencias.push({ id: novoId(), tipo: "HORARIO", gm: quem, de: ui.dia, alvo, ini, fim, semHE: true });
        if (d.posto !== p.id) data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: d.gm, de: ui.dia, ate: ui.dia, posto: p.id });
      });
      return;
    }
    case "dr-hora": {
      const { des: d, drop } = ui.menu, t = TURNOS.find((x) => x.id === drop.turno);
      fecharMenu();
      const alvo = d.alvo || `${d.ini}-${d.fim}`, quem = d.titular || d.gm, ini = el.dataset.ini || fmtHm(t.ini), fim = el.dataset.fim || fmtHm(t.fim);
      const atual = data.ocorrencias.find((o) => o.tipo === "HORARIO" && o.gm === quem && o.de === ui.dia && o.alvo === alvo);
      mudar(`${nomeGm(d.gm)}: horário ${ini}–${fim}`, () => { if (atual) Object.assign(atual, { ini, fim }); else data.ocorrencias.push({ id: novoId(), tipo: "HORARIO", gm: quem, de: ui.dia, alvo, ini, fim }); });
      return;
    }
    case "mn-card": abrirPop("card", ui.menu.alvo, { des: ui.menu.des }); fecharMenu(); return;
    case "mn-trocar": abrirPop("gm", ui.menu.alvo, { des: ui.menu.des }); fecharMenu(); return;
    case "mn-tirar": { const d = ui.menu.des; fecharMenu(); tirarDoDia(d, el.dataset.m); return; }
    case "mn-converter": { const d = ui.menu.des, o = data.ocorrencias.find((x) => x.id === d.origem); fecharMenu(); if (!o) return; const bh = o.tipo !== "BH_MAIS"; mudar(`${nomeGm(o.gm)}: ${bh ? "agora é banco de horas (BH+)" : "agora é hora extra"} ${o.ini}–${o.fim}`, () => { o.tipo = bh ? "BH_MAIS" : "HE"; }); return; }
    case "mn-remover-turno": { const d = ui.menu.des, t = el.dataset.turno; fecharMenu(); removerTurnoHE(d, t); return; }
    case "mn-remover-he": { const d = ui.menu.des; fecharMenu(); mudar(`Hora extra de ${nomeGm(d.gm)} removida`, () => { data.ocorrencias = data.ocorrencias.filter((o) => o.id !== d.origem); }); return; }
    case "mn-drawer": { const d = ui.menu.des; fecharMenu(); ui.drawer = { tipo: "gm", gm: d.gm, acao: el.dataset.acao }; render(); if (el.dataset.acao === "lotacao") previaHorarioFixo(); return; }
    case "mn-ficha": { const d = ui.menu.des; fecharMenu(); ui.gm = d.gm; ui.mes = mesDe(ui.dia); ui.view = "ficha"; ui.drawer = null; location.hash = "ficha"; render(); window.scrollTo(0, 0); return; }
    case "mn-req": { const r = el.dataset.req; fecharMenu(); ui.filtroLanc.req = r; ui.view = "lancamentos"; location.hash = "lancamentos"; render(); return; }
    case "mn-posto": { const alvo = ui.menu.alvo, posto = ui.menu.posto; fecharMenu(); abrirPop("posto", alvo, { posto, aba: el.dataset.aba }); return; }
    case "mn-fechar": { const p = postoPorId(ui.menu.posto), tipo = el.dataset.tipo; fecharMenu(); mudar(`${p.nome} ${tipo === "FA" ? "em manutenção" : "fechado"} neste dia. Quem estava lá foi para À disposição.`, () => data.ocorrencias.push({ id: novoId(), tipo, posto: p.id, de: ui.dia, ate: ui.dia })); return; }
    case "mn-reabrir": { const p = postoPorId(ui.menu.posto), oc = data.ocorrencias.find((o) => o.id === el.dataset.oc); fecharMenu(); mudar(`${p.nome} volta a funcionar a partir de ${ddmm(ui.dia)}`, () => encerrarEm(oc, ui.dia)); return; }
    case "mn-mover": {
      const p = postoPorId(ui.menu.posto), d = Number(el.dataset.d), irmaos = data.postos.filter((x) => x.secao === p.secao), viz = irmaos[irmaos.indexOf(p) + d];
      fecharMenu();
      if (viz) mudar(`${p.nome} ${d < 0 ? "subiu" : "desceu"} na escala`, () => { const a = data.postos.indexOf(p), b = data.postos.indexOf(viz); [data.postos[a], data.postos[b]] = [data.postos[b], data.postos[a]]; });
      return;
    }
    case "mn-add": { const alvo = ui.menu.alvo; fecharMenu(); abrirEditor("add", alvo, { posto: el.dataset.posto, turno: el.dataset.turno, nat: el.dataset.nat || "he", ...(el.dataset.ini ? { ini: Number(el.dataset.ini), fim: Number(el.dataset.fim) } : {}) }); return; }
    case "mn-est-cel": { const d = ui.desMap.get(el.dataset.des); fecharMenu(); if (d) aplicarHorario(d, valoresCartao(d).ini, el.dataset.fim); return; }
    case "mn-cedo-cel": { const d = ui.desMap.get(el.dataset.des); fecharMenu(); if (d) aplicarHorario(d, el.dataset.ini, valoresCartao(d).fim); return; }
    case "ed-oferecer": {
      ed.oferta = new Set();
      const box = $(".ed-lista-box"); if (box && !$("#ed-of-rodape")) box.insertAdjacentHTML("beforeend", `<div id="ed-of-rodape" class="ed-of-rodape"></div>`);
      el.remove(); atualizarLista(); atualizarRodapeOferta(); $("#ed-in").focus(); return;
    }
    case "ed-copiar": case "ed-ofertar": {
      const { posto, turno } = ed.ctx, [vi, vf] = ed.ctx.ini != null ? [ed.ctx.ini, ed.ctx.fim] : intervaloVaga(posto, turno), nat = ed.ctx.nat || "he";
      const fake = { posto, de: ui.dia, ini: fmtHm(vi), fim: fmtHm(vf), nat };
      if (el.dataset.act === "ed-copiar") { copiarTexto(mensagemOferta(fake)); return; }
      const gms = [...ed.oferta]; fecharEditor(); ofertar(posto, ui.dia, vi, vf, gms, nat); return;
    }
    case "oferta-abrir": { const o = data.ocorrencias.find((x) => x.id === el.dataset.id); if (o) menuOferta(o, el); return; }
    case "of-resp": fecharMenu(); responderOferta(el.dataset.id, el.dataset.gm, el.dataset.e); return;
    case "of-copiar": { const o = data.ocorrencias.find((x) => x.id === el.dataset.id); fecharMenu(); copiarTexto(mensagemOferta(o)); return; }
    case "of-cancelar": { const o = data.ocorrencias.find((x) => x.id === el.dataset.id); fecharMenu(); mudar("Oferta encerrada: envio cancelado para quem não respondeu", () => { for (const g of aguardando(o)) g.estado = "cancelada"; o.fechada = true; }); return; }
    case "of-mais": {
      const o = data.ocorrencias.find((x) => x.id === el.dataset.id), alvo = ui.menu.alvo; fecharMenu();
      const t = TURNOS.find((x) => sobrepoe(...intervalo(o.ini, o.fim), x.ini, x.fim) > 0);
      if (ui.view === "quadro" && alvo?.closest("td")) { abrirEditor("add", alvo.closest("td"), { posto: o.posto, turno: t.id, ini: intervalo(o.ini, o.fim)[0], fim: intervalo(o.ini, o.fim)[1], nat: o.nat }); $("[data-act=ed-oferecer]")?.click(); }
      else { ui.dia = o.de; ui.view = "quadro"; location.hash = "quadro"; render(); }
      return;
    }
    case "pend-oferecer": { fecharMenu(); const x = el.dataset; ofertar(x.posto, x.dia, x.ini, x.fim, [x.gm], x.nat || "he"); return; }
    case "pend-copiar": { fecharMenu(); const x = el.dataset; copiarTexto(mensagemOferta({ posto: x.posto, de: x.dia, ini: x.ini, fim: x.fim, nat: "he" })); return; }
    case "ed-semgm": { const { posto, turno } = ed.ctx; fecharEditor(); deixarSemGm(posto, [turno], ui.dia); return; }
    case "pend-semgm": fecharMenu(); deixarSemGm(el.dataset.posto, el.dataset.turnos.split(","), el.dataset.dia); return;
    case "ed-nat": { ed.ctx.nat = el.dataset.nat; document.querySelectorAll(".ed-nat .ed-chip").forEach((c) => { c.classList.toggle("on", c === el); c.classList.toggle("bh", c === el && el.dataset.nat === "bh"); c.classList.toggle("rem", c === el && el.dataset.nat === "rem"); }); ed.sel = 0; atualizarLista(); $("#ed-in").focus(); return; }
    case "ed-dur": { ed.ctx.ini = Number(el.dataset.ini); ed.ctx.fim = Number(el.dataset.fim); document.querySelectorAll(".ed-dur .ed-chip").forEach((c) => c.classList.toggle("on", c === el)); ed.sel = 0; atualizarLista(); $("#ed-in").focus(); return; }
    case "mn-secao": { const alvo = ui.menu.alvo; fecharMenu(); abrirPop("secao", alvo, { secao: el.dataset.secao, excluir: !!el.dataset.excluir }); return; }
    case "card": {
      const d = ui.desMap.get(el.dataset.des);
      if (!d) return;
      if (e.target.closest(".nm")) abrirEditor("nome", e.target.closest(".nm"), { des: d });
      else if (e.target.closest(".hr")) { const hr = e.target.closest(".hr"); abrirEditor("hora", hr, { des: d, junto: hr.dataset.junto ? ui.desMap.get(hr.dataset.junto) : null }); }
      else abrirPop("card", el, { des: d });
      return;
    }
    case "ed-mais": { const { modo, el: alvo, ctx, d } = ed; fecharEditor(); if (modo === "add") { const t = TURNOS.find((x) => x.id === ctx.turno); abrirPop("add", alvo, { posto: ctx.posto, turno: t.id, ini: fmtHm(t.ini), fim: fmtHm(t.fim) }); } else abrirPop("gm", alvo, { des: d }); return; }
    case "ed-motivo": { const { des, escolhido, via } = ui.menu; fecharMenu(); substituirGm(des, escolhido, via, el.dataset.m); return; }
    case "ed-nada": return;
    case "mn-copiar": { const d = ui.menu.des; fecharMenu(); copiar(d); return; }
    case "colar-cancelar": pararColar(); return;
    case "mn-colar": { const alvo = ui.menu.alvo; fecharMenu(); colar(alvo); return; }
    case "card-trocar": ui.pop.modo = "gm"; desenharPop(); return;
    case "card-tirar": {
      const d = ui.pop.des;
      if (d.recorrente) { fecharPop(); mudar(`${nomeGm(d.gm)}: HE recorrente suspensa em ${ddmm(ui.dia)}`, () => data.ocorrencias.push({ id: novoId(), tipo: "SEM_HE_REC", gm: d.gm, de: ui.dia })); return; }
      const opsHE = ehHeLancada(d) ? itensRemoverHE(d, ui.pop.turno) : [];
      if (opsHE.length > 1) { const r = el.getBoundingClientRect(); fecharPop(); abrirMenu([...opsHE, { sep: true }, { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, null, { des: d }); return; }
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
        const rem = d.remanej && !d.ajuste ? data.ocorrencias.find((x) => x.id === d.remanej) : null;
        if (rem && (rem.ini || (a === d.ini && b === d.fim))) { // REQ/observação (e horário, se parcial) ficam no próprio remanejamento
          if (rem.ini) { rem.ini = ini; rem.fim = fim; }
          rem.req = req; rem.obs = obs; return;
        }
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
        else { if (atual) data.ocorrencias = data.ocorrencias.filter((o) => o !== atual); data.inspetores ||= {}; (data.inspetores[ui.dia] ||= {})[eq.periodo] = nome; }
      });
      return;
    }
    case "pop-posto": abrirPop("posto", el, { posto: el.dataset.posto, aba: "dia" }); return;
    case "pad-novo-gm": {
      const pd = ui.padrao, eqs = pd.aba === "semanal" ? [] : equipesDoPadrao(pd.aba, pd.mes);
      const eq = pd.aba === "semanal" ? data.equipes.find((e) => e.tipo === "semanal") : data.equipes.find((e) => eqs.includes(e.id) && e.periodo === "dia");
      ui.drawer = { tipo: "gmnovo", equipe: eq?.id }; render(); previaHorarioFixo(); $("#ng-nome")?.focus(); return;
    }
    case "ng-salvar": {
      const nome = $("#ng-nome").value.trim().toUpperCase(), r = previaHorarioFixo(), desde = $("#hf-desde").value;
      if (!nome) { toast("Escreva o nome do GM."); $("#ng-nome").focus(); return; }
      if (!r) return;
      const eqId = $("#hf-eq").value, semanal = equipe(eqId)?.tipo === "semanal";
      const lot = { posto: $("#hf-posto").value, funcao: $("#hf-fn").value.trim(), segmentos: r.segs, ...(r.alt ? { alternativa: r.alt } : {}) };
      const dias = semanal ? [...document.querySelectorAll("#hf-dias input:checked")].map((i) => Number(i.value)) : undefined;
      if (semanal && !dias.length) { toast("Marque pelo menos um dia."); return; }
      const existe = data.gms.find((g) => norm(g.nome) === norm(nome));
      ui.drawer = null;
      if (existe) { if (existe.ativo === false) existe.ativo = true; mudarLotacao(existe, { equipe: eqId, lotacao: lot, ...(semanal ? { dias } : {}) }, desde || ui.dia, `${existe.nome} passa para ${rotuloEquipe(equipe(eqId), desde)} · ${textoHorario(lot.segmentos)} em ${postoPorId(lot.posto).nome}`); return; }
      mudar(`${nome} cadastrado: ${textoHorario(lot.segmentos)} em ${postoPorId(lot.posto).nome}`, () => data.gms.push({ id: novoId(), nome, equipe: eqId, lotacao: lot, ...(semanal ? { dias } : {}) }));
      return;
    }
    case "mn-excluir-posto": {
      const p = postoPorId(ui.menu.posto), r = ui.menu.alvo.getBoundingClientRect(), alvo = ui.menu.alvo;
      const lot = data.gms.filter((g) => g.ativo !== false && vigente(g, ui.dia).lotacao?.posto === p.id).length;
      fecharMenu();
      abrirMenu([{ t: `Excluir ${p.nome}?${lot ? ` ${lot} GM${lot === 1 ? " lotado" : "s lotados"} aqui ${lot === 1 ? "vai" : "vão"} para À disposição.` : ""}`, act: "ed-nada", desab: true }, { sep: true },
        { t: "Sim, excluir", act: "mn-excluir-ok", padrao: true }, { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, alvo, { posto: p.id });
      return;
    }
    case "mn-excluir-ok": { const p = postoPorId(ui.menu.posto); fecharMenu(); mudar(`${p.nome} excluído (desfazer volta ele)`, () => { p.ativo = false; }); return; }
    case "mn-funcao": {
      const d = ui.menu.des, f = el.dataset.f, quem = d.titular || d.gm, g = gmPorId(quem); fecharMenu();
      if (el.dataset.escopo === "sempre") { const v = vigente(g, ui.dia); mudarLotacao(g, { lotacao: { ...v.lotacao, funcao: f } }, ui.dia, `${g.nome}: ${f || "sem função"} no padrão a partir de ${ddmm(ui.dia)}`); return; }
      mudar(`${nomeGm(d.gm)}: ${f ? f.toLowerCase() : "sem função"} em ${ddmm(ui.dia)}`, () => {
        data.ocorrencias = data.ocorrencias.filter((o) => !(o.tipo === "FUNCAO" && o.gm === d.gm && o.de === ui.dia));
        if (f !== (vigente(gmPorId(d.gm), ui.dia).lotacao?.funcao || "")) data.ocorrencias.push({ id: novoId(), tipo: "FUNCAO", gm: d.gm, de: ui.dia, funcao: f });
      });
      return;
    }
    case "pad-funcao": { const g = gmPorId(el.dataset.gm), f = el.dataset.f, v = vigente(g, ui.padrao.desde); fecharMenu(); mudarLotacao(g, { lotacao: { ...v.lotacao, funcao: f } }, ui.padrao.desde, `${g.nome}: ${f || "sem função"} no padrão a partir de ${ddmm(ui.padrao.desde)}`); return; }
    case "insp-rodizio": {
      const lista = (id) => $(id).value.split(/[,;\n]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      const rd = lista("#rod-dia"), rn = lista("#rod-noite"), de = $("#rod-de").value, mes = ui.padrao.mes;
      if (!rd.length && !rn.length) { toast("Escreva os nomes do rodízio."); return; }
      const dias = diasDoMes(mes).filter((d) => d >= de);
      mudar(`Inspetores de ${nomeMes(mes).toLowerCase()} preenchidos pelo rodízio a partir de ${ddmm(de)}`, () => {
        data.inspetores ||= {}; data.config.rodizioInsp = { dia: rd, noite: rn };
        const nome = (n, d) => (afastDoInspetor(n, d) ? "" : n); // quem está afastado não entra: o serviço fica "falta inspetor"
        dias.forEach((d, i) => { const x = (data.inspetores[d] ||= {}); if (rd.length) x.dia = nome(rd[i % rd.length], d); if (rn.length) x.noite = nome(rn[i % rn.length], d); });
        data.ocorrencias = data.ocorrencias.filter((o) => !(o.tipo === "INSPETOR" && dias.includes(o.de)));
      });
      return;
    }
    case "insp-afastar": {
      const quem = $("#af-quem").value.trim().toUpperCase(), tipo = $("#af-tipo").value, de = $("#af-de").value, ate = $("#af-ate").value || de;
      if (!quem || !de) { toast("Informe o inspetor e o período."); return; }
      const alvo = [];
      for (let d = de; d <= ate; d = somaDias(d, 1)) for (const per of ["dia", "noite"]) if (norm(inspetorDe(d, per)) === norm(quem)) alvo.push([d, per]);
      mudar(`${quem}: ${TIPOS[tipo].toLowerCase()} de ${ddmm(de)} a ${ddmm(ate)}${alvo.length ? ` · ${alvo.length} serviço${alvo.length === 1 ? "" : "s"} ficaram sem inspetor` : ""}`, () => {
        data.inspetores ||= {};
        (data.inspetores._afast ||= []).push({ id: novoId(), nome: quem, tipo, de, ate });
        for (const [d, per] of alvo) (data.inspetores[d] ||= {})[per] = "";
      });
      return;
    }
    case "insp-afast-del": { const id = el.dataset.id; mudar("Registro de afastamento removido", () => { data.inspetores._afast = afastInsp().filter((a) => a.id !== id); }); return; }
    case "fr-sit": { const v = data.frota.find((x) => x.id === el.dataset.fr), k = el.dataset.sit; if (v.situacao === k) return; mudar(`Viatura ${v.prefixo}: ${SIT[k][0]}`, () => { v.situacao = k; }); return; }
    case "fr-filtro": ui.frota.sit = ui.frota.sit === el.dataset.sit ? "" : el.dataset.sit; render(); return;
    case "fr-add": { const id = novoId(); mudar(`Nova viatura em ${el.dataset.modelo}`, () => (data.frota ||= []).push({ id, prefixo: "", modelo: el.dataset.modelo, situacao: "QAP", finalidade: "", guarnicao: "" })); document.querySelector(`[data-fr="${id}"][data-campo=prefixo]`)?.focus(); return; }
    case "fr-del": { const v = data.frota.find((x) => x.id === el.dataset.fr); if (!confirm(`Excluir a viatura ${v.prefixo || "(sem prefixo)"} (${v.modelo})?`)) return; mudar(`Viatura ${v.prefixo} excluída`, () => { data.frota = data.frota.filter((x) => x !== v); }); return; }
    case "fr-novo": { const m = $("#fr-nm").value.trim().toUpperCase(), pf = $("#fr-np").value.trim(); if (!m) { toast("Escreva o modelo."); return; } mudar(`Modelo ${m} adicionado`, () => (data.frota ||= []).push({ id: novoId(), prefixo: pf, modelo: m, situacao: "QAP", finalidade: "", guarnicao: "" })); return; }
    case "fr-renomear": { const m = el.dataset.modelo, novo = prompt("Nome do modelo", m)?.trim().toUpperCase(); if (!novo || novo === m) return; mudar(`Modelo ${m} → ${novo}`, () => { for (const v of data.frota) if ((v.modelo || "SEM MODELO") === m) v.modelo = novo; }); return; }
    case "pad-novo": abrirPop("novo", el, { secao: el.dataset.secao }); $("#np-nome")?.focus(); return;
    case "lanc-aba": ui.lanc.aba = el.dataset.aba; ui.lanc.sel = []; render(); return;
    case "lg-tirar": ui.lanc.sel = ui.lanc.sel.filter((g) => g !== el.dataset.gm); redesenharSel(); return;
    case "lg-lancar": {
      const tipo = el.dataset.tipo === "ATESTADO" ? $("#la-tipo").value : el.dataset.tipo, L = ui.lanc;
      const pend = $("#lg-gm")?.value.trim(); if (pend) { const g = data.gms.find((x) => norm(x.nome) === norm(pend)); if (g && !L.sel.includes(g.id)) L.sel.push(g.id); }
      const de = $("#lg-de").value, ate = tipo === "FOLGA" ? de : $("#lg-ate")?.value || de, req = $("#lg-req")?.value.trim() || "", obs = $("#lg-obs")?.value.trim() || "";
      const curso = $("#lc-nome")?.value.trim().toUpperCase() || "", local = $("#lc-local")?.value.trim() || "";
      if (!L.sel.length) { toast("Escolha pelo menos um GM."); $("#lg-gm")?.focus(); return; }
      if (!de || ate < de) { toast("Confira o período."); return; }
      if (tipo === "CURSO" && !curso) { toast("Escreva o nome do curso."); $("#lc-nome").focus(); return; }
      const gms = [...L.sel];
      mudar(`${TIPOS[tipo]}${curso ? ` ${curso}` : ""}: ${gms.length === 1 ? nomeGm(gms[0]) : `${gms.length} GMs`} · ${ddmm(de)}${ate !== de ? ` a ${ddmm(ate)}` : ""}`, () => {
        for (const g of gms) data.ocorrencias.push({ id: novoId(), tipo, gm: g, de, ...(tipo === "FOLGA" ? {} : { ate }), ...(req ? { req } : {}), ...(obs ? { obs } : {}), ...(curso ? { curso } : {}), ...(local ? { local } : {}) });
        L.sel = [];
      });
      return;
    }
    case "tr-lancar": {
      const t = ui.lanc.troca, a = acharGmPorNome($("#tr-a").value)?.id, b = acharGmPorNome($("#tr-b").value)?.id, d1 = $("#tr-dia1").value, volta = $("#tr-volta").checked, d2 = $("#tr-dia2")?.value, req = $("#tr-req").value.trim();
      if (!a || !b || a === b) { toast("Escolha os dois GMs."); return; }
      if (!d1) { toast("Informe o dia do serviço."); return; }
      if (!servicoDe(a, d1).length) { toast(`${nomeGm(a)} não está escalado em ${ddmm(d1)}.`); return; }
      if (volta && !d2) { toast("Informe o dia da devolução (ou desmarque “com devolução”)."); return; }
      if (volta && !servicoDe(b, d2).length) { toast(`${nomeGm(b)} não está escalado em ${ddmm(d2)}.`); return; }
      const par = novoId();
      mudar(`Troca: ${nomeGm(b)} cobre ${nomeGm(a)} em ${ddmm(d1)}${volta ? ` e ${nomeGm(a)} devolve em ${ddmm(d2)}` : ""}${req ? ` · REQ ${req}` : ""}`, () => {
        data.ocorrencias.push({ id: novoId(), tipo: "TROCA", gm: a, substituto: b, de: d1, par, ...(req ? { req } : {}) });
        if (volta) data.ocorrencias.push({ id: novoId(), tipo: "TROCA", gm: b, substituto: a, de: d2, par, ...(req ? { req } : {}) });
        if (req) { data.requerimentos ||= {}; data.requerimentos[req] ||= { tipo: "TROCA" }; }
        ui.lanc.troca = {}; void t;
      });
      return;
    }
    case "tr-apagar": { const par = el.dataset.par; ui.confirmar = null; mudar("Troca excluída", () => { data.ocorrencias = data.ocorrencias.filter((o) => !(o.tipo === "TROCA" && (o.par === par || o.id === par))); }); return; }
    case "av-salvar": {
      const de = $("#av-de").value, ate = $("#av-ate").value || de, texto = $("#av-txt").value.trim(), folha = $("#av-folha").checked, ed = ui.lanc.avisoEd && data.ocorrencias.find((o) => o.id === ui.lanc.avisoEd);
      if (!texto) { toast("Escreva o aviso."); $("#av-txt").focus(); return; }
      if (!de || ate < de) { toast("Confira as datas."); return; }
      mudar(`Aviso ${ed ? "atualizado" : "lançado"} para ${ddmm(de)}${ate !== de ? ` a ${ddmm(ate)}` : ""}`, () => {
        if (ed) Object.assign(ed, { de, ate, texto, folha }); else data.ocorrencias.push({ id: novoId(), tipo: "AVISO", de, ate, texto, folha, lidos: [] });
        ui.lanc.avisoEd = null;
      });
      return;
    }
    case "av-editar": ui.lanc.avisoEd = el.dataset.id; render(); $("#av-txt")?.focus(); return;
    case "av-cancelar": ui.lanc.avisoEd = null; render(); return;
    case "av-lido": case "av-naolido": { const o = data.ocorrencias.find((x) => x.id === el.dataset.id), lido = el.dataset.act === "av-lido"; mudar(lido ? "Aviso marcado como lido" : "Aviso voltou a aparecer", () => { o.lidos = lido ? [...new Set([...(o.lidos || []), ui.dia])] : (o.lidos || []).filter((d) => d !== ui.dia); }); return; }
    case "av-ver-lidos": ui.verLidos = !ui.verLidos; render(); return;
    case "lc-mais": { const c = el.dataset.curso, o = data.ocorrencias.find((x) => x.tipo === "CURSO" && x.curso === c); ui.lanc.sel = []; redesenharSel(); $("#lc-nome").value = c; if (o) { $("#lc-local").value = o.local || ""; $("#lg-de").value = o.de; $("#lg-ate").value = o.ate || o.de; } $("#lg-gm").focus(); return; }
    case "fg-cancelar": ui.lanc.import = null; render(); return;
    case "folgas-mud": {
      if (!syncFolgas.mudancas.length && syncFolgas.prontos.length) { ui.view = "lancamentos"; location.hash = "lancamentos"; (ui.lanc ||= { aba: "folgas", sel: [] }).aba = "folgas"; ui.filtroLanc.mes = syncFolgas.prontos[0]; render(); return; }
      ui.drawer = { tipo: "folgasmud" }; render(); return;
    }
    case "fm-conferir": conferirFolgas(true).then(() => { render(); toast(`${syncFolgas.mudancas.length} alteraç${syncFolgas.mudancas.length === 1 ? "ão" : "ões"} no Sistema de Folgas`); }); return;
    case "fm-aplicar": case "fm-ignorar": {
      const x = syncFolgas.mudancas[Number(el.dataset.i)], aplicar = el.dataset.act === "fm-aplicar";
      mudar(aplicar ? `Folgas de ${nomeGm(x.gm)} atualizadas pelo Sistema de Folgas` : `Alteração de ${x.gm ? nomeGm(x.gm) : x.nome} ignorada (a escala fica como está)`, () => { if (aplicar) aplicarFolgasNaEscala(x); registrarFolgas(x); });
      syncFolgas.mudancas = syncFolgas.mudancas.filter((y) => y !== x); mostrarSeloFolgas(); render();
      return;
    }
    case "fm-todas": {
      const ms = syncFolgas.mudancas.filter((x) => x.gm);
      mudar(`${ms.length} alteraç${ms.length === 1 ? "ão" : "ões"} do Sistema de Folgas aplicada${ms.length === 1 ? "" : "s"}`, () => { for (const x of ms) { aplicarFolgasNaEscala(x); registrarFolgas(x); } });
      syncFolgas.mudancas = syncFolgas.mudancas.filter((x) => !x.gm); mostrarSeloFolgas(); render();
      return;
    }
    case "fg-buscar": {
      el.disabled = true; el.textContent = "Buscando…";
      api(`/api/folgas?mes=${ui.filtroLanc.mes}`).then(({ status, corpo }) => {
        if (status !== 200) { toast(corpo?.erro || "Não foi possível buscar no Sistema de Folgas."); render(); return; }
        ui.lanc.import = { competencia: corpo.competencia, linhas: corpo.linhas.map((x) => ({ ...x, gm: acharGmPorNome(x.nome)?.id || "" })) };
        render();
      }).catch(() => { toast("Sem conexão com o servidor."); render(); });
      return;
    }
    case "fg-aplicar": {
      const imp = ui.lanc.import, ok = imp.linhas.filter((x) => x.gm);
      const dias = new Set(ok.flatMap((x) => [...x.folgas, ...x.he])), meses = new Set([...dias].map((d) => d.slice(0, 7)));
      const nF = ok.reduce((t, x) => t + x.folgas.length, 0), nH = ok.reduce((t, x) => t + x.he.length, 0);
      mudar(`Sistema de Folgas: ${nF} folgas de ${ok.length} GMs${nH ? ` e ${nH} disponibilidades para HE` : ""}`, () => {
        data.ocorrencias = data.ocorrencias.filter((o) => !(o.origem === "folgas-gmnh" && meses.has(o.de.slice(0, 7))));
        for (const x of ok) {
          for (const d of x.folgas) if (!data.ocorrencias.some((o) => o.tipo === "FOLGA" && o.gm === x.gm && o.de === d)) data.ocorrencias.push({ id: novoId(), tipo: "FOLGA", gm: x.gm, de: d, origem: "folgas-gmnh", ...(x.protocolo ? { req: x.protocolo } : {}) });
          for (const d of x.he) data.ocorrencias.push({ id: novoId(), tipo: "DISP_HE", gm: x.gm, de: d, origem: "folgas-gmnh" });
          if (x.ferias && x.folgas[0]) data.ocorrencias.push({ id: novoId(), tipo: "DISP_FERIAS", gm: x.gm, de: x.folgas[0].slice(0, 7) + "-01", origem: "folgas-gmnh" });
        }
        if (imp.competencia) { // veio direto do sistema: guarda o retrato para avisar as próximas mudanças
          const mes = imp.competencia.mes, snap = ((data.folgasSync ||= {})[mes] = { em: new Date().toISOString(), linhas: {} });
          for (const x of imp.linhas) if (x.fgId) snap.linhas[x.fgId] = { versao: x.versao, nome: x.nome, gm: x.gm, folgas: x.folgas, he: x.he, ferias: !!x.ferias, protocolo: x.protocolo || "" };
        }
        ui.lanc.import = null;
      });
      if (imp.competencia) { syncFolgas.mudancas = syncFolgas.mudancas.filter((x) => x.mes !== imp.competencia.mes); syncFolgas.prontos = syncFolgas.prontos.filter((m) => m !== imp.competencia.mes); try { localStorage.removeItem("folgas-cache2"); } catch { /* ignora */ } mostrarSeloFolgas(); }
      return;
    }
    case "op-nova": ui.drawer = { tipo: "operacao", novas: [] }; render(); $("#op-nome")?.focus(); return;
    case "op-editar": ui.drawer = { tipo: "operacao", secao: el.dataset.secao, novas: [] }; render(); return;
    case "op-add-frota": case "op-add-outra": {
      const d = ui.drawer, campos = ["op-nome", "op-local", "op-de", "op-ate", "op-ini", "op-fim", "op-obs"].map((id) => [id, $("#" + id).value]);
      let item;
      if (el.dataset.act === "op-add-frota") {
        const pref = $("#op-frota").value; if (!pref) { toast("Escolha a viatura."); return; }
        const v = data.frota.find((x) => String(x.prefixo) === pref), cd = calcularDia(data, ui.dia);
        const u = data.postos.find((p) => p.ativo !== false && !secaoOperacao(data, p.id) && numeroDe(nomeNoDia(p, cd)) === pref && cd.designacoes.some((x) => x.posto === p.id));
        item = { nome: `${ehMoto(v?.modelo) ? "MT" : "VTR"} ${pref}`, tipo: ehMoto(v?.modelo) ? "moto" : "vtr", n: ehMoto(v?.modelo) ? 1 : 2, uso: u?.nome || "" };
      } else {
        const t = $("#op-outra").value.trim().toUpperCase(); if (!t) { toast("Escreva a viatura ou equipe."); return; }
        item = { nome: t, tipo: /^(VTR|VIATURA)/.test(t) ? "vtr" : /^(MT|MOTO)/.test(t) ? "moto" : "posto", n: /^(MT|MOTO)/.test(t) ? 1 : 2 };
      }
      d.novas = [...(d.novas || []), item]; render();
      for (const [id, v] of campos) if ($("#" + id)) $("#" + id).value = v;
      return;
    }
    case "op-nova-tirar": { const d = ui.drawer, campos = ["op-nome", "op-local", "op-de", "op-ate", "op-ini", "op-fim", "op-obs"].map((id) => [id, $("#" + id).value]); d.novas.splice(Number(el.dataset.i), 1); render(); for (const [id, v] of campos) $("#" + id).value = v; return; }
    case "op-tirar": { const p = postoPorId(el.dataset.posto); mudar(`${p.nome} saiu da operação`, () => { p.ativo = false; }); return; }
    case "op-salvar": {
      const d = ui.drawer, nome = $("#op-nome").value.trim().toUpperCase(), de = $("#op-de").value, ate = $("#op-ate").value || de, ini = $("#op-ini").value, fim = $("#op-fim").value;
      if (!nome) { toast("Dê um nome à operação."); $("#op-nome").focus(); return; }
      if (!de || ate < de) { toast("Confira as datas."); return; }
      if (!ini || !fim) { toast("Informe o horário."); return; }
      const meta = { de, ate, ini, fim, local: $("#op-local").value.trim(), obs: $("#op-obs").value.trim() };
      const s0 = d.secao ? data.secoes.find((x) => x.id === d.secao) : null;
      if (!s0 && !(d.novas || []).length) { toast("Adicione pelo menos uma viatura ou equipe."); return; }
      mudar(`Operação ${nome}${s0 ? " atualizada" : " criada"}: ${textoOp(meta)}`, () => {
        const s = s0 || { id: "s" + novoId(), nome, operacao: meta };
        if (!s0) data.secoes.push(s); else { s.nome = nome; s.operacao = meta; }
        for (const p of data.postos.filter((x) => x.secao === s.id)) { const n = Math.max(1, ...Object.values(p.vagas || {})); Object.assign(p, { de, ate, reforco: { ini, fim }, vagas: vagasDoHorario(ini, fim, n) }); }
        for (const n of d.novas || []) data.postos.push({ id: "p" + novoId(), secao: s.id, nome: n.nome, ...(n.tipo !== "posto" ? { tipo: n.tipo } : {}), vagas: vagasDoHorario(ini, fim, Number(n.n) || 1), reforco: { ini, fim }, de, ate, ...(meta.local ? { sub: meta.local.toUpperCase() } : {}) });
        ui.drawer = null;
        if (ui.dia < de || ui.dia > ate) ui.dia = de;
      });
      return;
    }
    case "disp-mandar": {
      // GM à disposição: as vagas abertas no horário dele, para mandar com um clique
      const d = ui.desMap.get(el.dataset.des), cd = calcularDia(data, ui.dia), r = el.getBoundingClientRect();
      const vagas = cd.furos.filter((f) => { const t = TURNOS.find((x) => x.id === f.turno); return sobrepoe(d.ini, d.fim, t.ini, t.fim) >= 60; });
      const porPosto = new Map(); for (const f of vagas) { if (!porPosto.has(f.posto)) porPosto.set(f.posto, []); porPosto.get(f.posto).push(f.turno); }
      const itens = [...porPosto].sort((a, b) => (a[0] === d.postoOriginal ? -1 : 0) - (b[0] === d.postoOriginal ? -1 : 0)).slice(0, 12)
        .map(([posto, ts]) => ({ t: `Mandar para ${postoPorId(posto).nome} (${ts.map((t) => TURNOS.find((x) => x.id === t).nome.split(" ")[0]).join(" e ")} turno)`, act: "disp-ir", d: { posto } }));
      const orig = d.postoOriginal && postoPorId(d.postoOriginal), faO = orig && cd.fa.find((o) => o.posto === orig.id);
      abrirMenu([{ t: `${nomeGm(d.gm)} · à disposição ${fmtHm(d.ini)}–${fmtHm(d.fim)}`, act: "ed-nada", desab: true }, { sep: true },
        ...(orig && orig.ativo === false ? [{ t: `${orig.nome} está excluída do cadastro`, act: "ed-nada", desab: true }, { t: `Reativar ${orig.nome} e voltar (vale para todos os dias)`, act: "disp-reativar", d: { posto: orig.id } }, { sep: true }]
          : orig ? [{ t: `Voltar para ${orig.nome}${faO ? ` (fica marcada ${faO.tipo === "FA" ? "em FA" : "fechada"})` : ""}`, act: "disp-voltar", d: { posto: orig.id } }, { sep: true }] : []),
        ...(itens.length ? itens : [{ t: "Nenhuma vaga aberta no horário dele", act: "ed-nada", desab: true }]),
        { sep: true }, { t: "Também dá para arrastar até qualquer posto", act: "ed-nada", desab: true }], r.left, r.bottom + 2, el, { des: d });
      return;
    }
    case "disp-reativar": { const p = postoPorId(el.dataset.posto); fecharMenu(); mudar(`${p.nome} reativada: a guarnição volta para ela`, () => { delete p.ativo; }); return; }
    case "disp-voltar": { const d = ui.menu.des, p = postoPorId(el.dataset.posto); fecharMenu(); mudar(`${nomeGm(d.gm)} voltou para ${p.nome}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: d.gm, de: ui.dia, ate: ui.dia, posto: p.id, ficaNaFA: true })); return; }
    case "disp-ir": { const d = ui.menu.des, p = postoPorId(el.dataset.posto); fecharMenu(); mudar(`${nomeGm(d.gm)} saiu de À disposição para ${p.nome}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: d.gm, de: ui.dia, ate: ui.dia, posto: p.id })); return; }
    case "ex-abrir": ui.drawer = { tipo: "excluidos" }; render(); return;
    case "ex-reativar": { const p = postoPorId(el.dataset.posto); mudar(`${p.nome} reativado`, () => { delete p.ativo; }); return; }
    case "ex-apagar": { const p = postoPorId(el.dataset.posto); mudar(`${p.nome} tirado da lista (o histórico continua)`, () => { p.apagado = true; }); return; }
    case "ex-passar": {
      const p = postoPorId(el.dataset.posto), dest = postoPorId(document.querySelector(`[data-ex-dest="${p.id}"]`).value), dia = ui.padrao?.desde || ui.dia, lot = lotadosEm(p.id, dia);
      mudar(`${lot.length} GM${lot.length === 1 ? "" : "s"} de ${p.nome} passa${lot.length === 1 ? "" : "m"} para ${dest.nome} a partir de ${ddmm(dia)}`, () => {
        for (const g of lot) { const antes = vigente(g, somaDias(dia, -1)); g.historico = [...(g.historico || []).filter((h) => h.ate < somaDias(dia, -1)), { ate: somaDias(dia, -1), equipe: antes.equipe, lotacao: antes.lotacao, dias: antes.dias }]; g.lotacao = { ...g.lotacao, posto: dest.id }; }
      });
      return;
    }
    case "tr-rever": ui.verTransporte = true; render(); return;
    case "tr-fechar": ui.verTransporte = false; render(); return;
    case "tr-confirmar": {
      const m = ui.mes, campos = [...document.querySelectorAll("[data-trgm]")], erros = campos.filter((i) => lerHoras(i.value) === null);
      if (erros.length) { toast("Confira as horas (ex.: 6 ou 6:30)."); erros[0].focus(); return; }
      const dif = campos.filter((i) => lerHoras(i.value) !== Number(i.dataset.calc)).length;
      mudar(`Horas que vieram de ${MESES[Number(anteriorDe(m).slice(5)) - 1]} confirmadas${dif ? ` (${dif} corrigida${dif === 1 ? "" : "s"})` : ""}`, () => {
        for (const i of campos) {
          const gm = i.dataset.trgm, v = lerHoras(i.value), c = Number(i.dataset.calc), ex = (data.controle ||= []).find((x) => x.tipo === "TRANSPORTE" && x.mes === m && x.gm === gm);
          if (v === c) { if (ex) data.controle = data.controle.filter((x) => x !== ex); } else if (ex) ex.min = v; else data.controle.push({ id: novoId(), tipo: "TRANSPORTE", mes: m, gm, min: v });
        }
        data.config.transporteConfirmado = { ...(data.config.transporteConfirmado || {}), [m]: { em: new Date().toISOString(), quem: window.ESCALA_SERVIDOR?.nome || "" } };
        ui.verTransporte = false;
      });
      return;
    }
    case "rst-abrir": ui.drawer = { tipo: "resetdia", fora: [] }; render(); return;
    case "rst-ok": {
      const fora = new Set(ui.drawer.fora || []), { ocs, extras } = alteracoesDoDia(ui.dia);
      const tirarOc = new Set(ocs.filter((o) => !fora.has(o.id)).map((o) => o.id)), tirarP = new Set(extras.filter((p) => !fora.has("p:" + p.id)).map((p) => p.id));
      mudar(`Escala de ${ddmm(ui.dia)}: ${tirarOc.size + tirarP.size} alteraç${tirarOc.size + tirarP.size === 1 ? "ão desfeita" : "ões desfeitas"}`, () => {
        data.ocorrencias = data.ocorrencias.filter((o) => !tirarOc.has(o.id));
        data.postos = data.postos.filter((p) => !tirarP.has(p.id));
        ui.drawer = null;
      });
      return;
    }
    case "ef-filtro": ui.efetivo.so = el.dataset.so; render(); return;
    case "ef-reativar": { const g = gmPorId(el.dataset.gm); mudar(`${g.nome} reativado`, () => { delete g.ativo; }); return; }
    case "busca-gm": abrirPop("buscagm", el, { q: "" }); setTimeout(() => $("#bg-in")?.focus(), 30); return;
    case "bg-escolher": ui.pop.gm = el.dataset.gm; $("#bg-res").innerHTML = resultadosBuscaGm("", el.dataset.gm); return;
    case "bg-limpar": ui.pop.gm = null; ui.pop.q = ""; desenharPop(); setTimeout(() => $("#bg-in")?.focus(), 30); return;
    case "bg-mostrar": { const gm = el.dataset.gm; fecharPop(); if (ui.view !== "quadro") { ui.view = "quadro"; location.hash = "quadro"; render(); } destacarGm(gm); return; }
    case "bg-lotacao": { const gm = el.dataset.gm; fecharPop(); ui.drawer = { tipo: "gm", gm, acao: "lotacao" }; render(); previaHorarioFixo(); return; }
    case "pad-posto": abrirPop("posto", el, { posto: el.dataset.posto, aba: "sempre" }); return;
    case "pad-semvaga": mudarVagasPeriodo(postoPorId(el.dataset.posto), el.dataset.per, 0); return;
    case "pad-vagas": { const p = postoPorId(ui.menu.posto); fecharMenu(); mudarVagasPeriodo(p, el.dataset.per, Number(el.dataset.n)); return; }
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
    case "posto-area": {
      const p = postoPorId(ui.pop.posto), v = $("#pp-area").value.trim().toUpperCase(), at = data.ocorrencias.find((o) => o.tipo === "AREA" && o.posto === p.id && o.de === ui.dia);
      fecharPop();
      mudar(`${p.nome} em ${ddmm(ui.dia)}: ${v || "sem complemento"}`, () => { if (at) at.sub = v; else data.ocorrencias.push({ id: novoId(), tipo: "AREA", posto: p.id, de: ui.dia, ate: ui.dia, sub: v }); });
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
      const novo = { nome, sub: $("#ps-sub").value.trim().toUpperCase(), tipo: $("#ps-tipo").value, secao: $("#ps-secao").value, vagas: lerStepper("ps-v"), rondas: $("#ps-rondas").checked, cargoProprio: $("#ps-cargo").checked, dias: $("#ps-dias").value ? [1, 2, 3, 4, 5] : undefined };
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
    case "pad-so": {
      const p = postoPorId(ui.menu.posto), q = el.dataset.qual; fecharMenu(); if (!p) return;
      const eqs = q ? equipesDoPadrao(q, ui.padrao.mes) : null;
      mudar(q ? `${p.nome} agora só existe no padrão ${q === "impar" ? "ímpar" : "par"}` : `${p.nome} agora existe nos dois padrões`, () => { if (eqs) p.equipes = eqs; else delete p.equipes; });
      return;
    }
    case "mn-nova-aba": fecharMenu(); window.open(location.pathname + location.search + el.dataset.href, "_blank"); return;
    case "mn-ed-escolher": { fecharMenu(); escolherEditor(Number(el.dataset.i)); return; }
    case "mn-proxy": { const b = ui.proxies?.[Number(el.dataset.i)]; fecharMenu(); if (b?.isConnected) b.click(); return; }
    case "mn-busca-gm": { const gm = el.dataset.gm, alvo = ui.menu?.alvo || document.body; fecharMenu(); fecharEditor(); abrirPop("buscagm", alvo, { q: "", gm, fixo: !gm }); if (!gm) setTimeout(() => $("#bg-in")?.focus(), 30); return; }
    case "mn-so-furos": fecharMenu(); ui.soFuros = !ui.soFuros; render(); return;
    case "copiar-modelo": { ui.modeloCopiado = el.dataset.id; fecharMenu(); toast(`${postoPorId(el.dataset.id).nome} copiado como modelo. Botão direito numa seção → "Colar modelo aqui", ou use "+ Posto / viatura".`); return; }
    case "colar-modelo": { const alvo = ui.menu.alvo; fecharMenu(); abrirPop("novo", alvo, { secao: el.dataset.secao, modeloPosto: "copiar:" + ui.modeloCopiado }); $("#np-nome")?.focus(); return; }
    case "pad-vazios": { const set = (ui.padVazios ||= new Set()), id = el.dataset.secao; if (set.has(id)) set.delete(id); else set.add(id); render(); return; }
    case "posto-desativar": ui.pop.confirmarDesativar = true; desenharPop(); return;
    case "posto-desativar-ok": { const p = postoPorId(ui.pop.posto); fecharPop(); mudar(`${p.nome} desativado`, () => { p.ativo = false; }); return; }
    case "posto-reativar": { const p = postoPorId(el.dataset.posto); fecharPop(); mudar(`${p.nome} reativado`, () => { delete p.ativo; }); return; }
    case "posto-criar": {
      const sec = $("#np-secao")?.value || ui.pop.secao, nome = $("#np-nome").value.trim().toUpperCase();
      if (!nome) { toast("Digite o nome do posto ou viatura."); return; }
      const igual = data.postos.find((x) => x.ativo === false && !x.apagado && !x.so && !x.de && norm(x.nome) === norm(nome));
      if (igual && !$("#np-so")?.checked) {
        const lot = lotadosEm(igual.id, ui.padrao?.desde || ui.dia).length;
        if (confirm(`Já existe "${igual.nome}" excluída${lot ? ` (com ${lot} GM${lot === 1 ? "" : "s"} lotado${lot === 1 ? "" : "s"} nela)` : ""}.\n\nOK = reativar a antiga (recomendado: mantém a guarnição e o histórico)\nCancelar = criar uma nova mesmo assim`)) {
          fecharPop(); mudar(`${igual.nome} reativada`, () => { delete igual.ativo; }); return;
        }
      }
      const soPad = document.querySelector("input[name=np-pad]:checked")?.value || "", eqsPad = soPad ? equipesDoPadrao(soPad, ui.padrao?.mes || mesDe(ui.dia)) : null;
      const tipo = $("#np-tipo").value, nd = Number($("#np-dia")?.value) || 0, nn = Number($("#np-noite")?.value) || 0, sub = $("#np-sub")?.value.trim().toUpperCase() || "", so = $("#np-so")?.checked ? ui.dia : "";
      const mod = modeloDoPosto($("#np-modelo")?.value) || {};
      let reforco = null, dias = null;
      if ($("#np-ri")) {
        const ri = normHora($("#np-ri").value), rf = normHora($("#np-rf").value);
        if (!ri || !rf) { toast("Horário do reforço inválido. Ex.: 19:00 às 23:00"); return; }
        reforco = { ini: ri, fim: rf }; dias = [...document.querySelectorAll(".np-dias input:checked")].map((x) => Number(x.value)).sort();
        if (!dias.length) { toast("Marque pelo menos um dia da semana."); return; }
      }
      const nRef = Number($("#np-n")?.value) || 1;
      fecharPop();
      (ui.padVazios ||= new Set()).add(sec);
      mudar(`${nome} criado${so ? ` só para ${ddmm(so)}` : soPad ? ` só no padrão ${soPad === "impar" ? "ímpar" : "par"}` : reforco ? ` (reforço ${reforco.ini}–${reforco.fim})` : " nos dois padrões"}. Clique em "+ pôr GM" para escalar alguém.`, () => {
        const p = { id: "p" + novoId(), secao: sec, nome, vagas: reforco ? vagaDoReforco(reforco.ini, reforco.fim, nRef) : { t2: nd, t3: nd, t4: nn, t1: nn } };
        if (reforco) { p.reforco = reforco; if (dias.length < 7) p.dias = dias; if (mod.rondas) p.rondas = true; }
        if (mod.obs) p.obs = mod.obs;
        if (eqsPad?.length && !so) p.equipes = eqsPad;
        if (tipo !== "posto") p.tipo = tipo;
        if (sub) p.sub = sub;
        if (so) p.so = so;
        const ult = data.postos.map((x, i) => [x, i]).filter(([x]) => x.secao === sec).pop();
        data.postos.splice(ult ? ult[1] + 1 : data.postos.length, 0, p);
      });
      return;
    }
    case "secao-salvar": { const sec = data.secoes.find((x) => x.id === ui.pop.secao), nome = $("#sc-nome").value.trim().toUpperCase(), grupo = $("#sc-grupo")?.checked; if (!nome) { toast("O nome não pode ficar vazio."); return; } fecharPop(); mudar(`Seção ${nome} salva`, () => { sec.nome = nome; if (grupo) sec.grupamento = true; else delete sec.grupamento; }); return; }
    case "secao-mover": {
      const sec = data.secoes.find((x) => x.id === ui.pop.secao), i = data.secoes.indexOf(sec), j = i + Number(el.dataset.d);
      if (j < 0 || j >= data.secoes.length) return;
      fecharPop();
      mudar(`Seção ${sec.nome} movida`, () => { [data.secoes[i], data.secoes[j]] = [data.secoes[j], data.secoes[i]]; });
      return;
    }
    case "secao-nome": abrirEditorSecao(el, el.dataset.secao); return;
    case "mn-secao-nome": { const alvo = ui.menu.alvo, id = el.dataset.secao; fecharMenu(); abrirEditorSecao(alvo, id); return; }
    case "ord-sec": fecharMenu(); moverSecao(el.dataset.id, el.dataset.antes); return;
    case "ord-posto": fecharMenu(); moverPosto(el.dataset.id, el.dataset.sec, el.dataset.antes); return;
    case "mn-secao-mover": {
      const sec = data.secoes.find((x) => x.id === el.dataset.secao), i = data.secoes.indexOf(sec), j = i + Number(el.dataset.d);
      fecharMenu();
      if (j >= 0 && j < data.secoes.length) mudar(`Seção ${sec.nome} movida`, () => { [data.secoes[i], data.secoes[j]] = [data.secoes[j], data.secoes[i]]; });
      return;
    }
    case "secao-grupo": {
      const sec = data.secoes.find((x) => x.id === (el.dataset.secao || ui.pop?.secao));
      fecharMenu(); fecharPop();
      mudar(sec.grupamento ? `${sec.nome} não é mais grupamento` : `${sec.nome} destacada como grupamento`, () => { if (sec.grupamento) delete sec.grupamento; else sec.grupamento = true; });
      return;
    }
    case "secao-excluir": {
      const sec = data.secoes.find((x) => x.id === ui.pop.secao), destino = $("#sc-destino")?.value;
      fecharPop();
      mudar(`Seção ${sec.nome} excluída`, () => {
        if (destino) for (const p of data.postos) if (p.secao === sec.id) p.secao = destino;
        data.secoes = data.secoes.filter((x) => x !== sec);
      });
      return;
    }
    case "mn-estender": {
      const d = ui.menu.des; fecharMenu();
      const pf = parFixa(d);
      if (pf) { aplicarHorarioJunto(pf.normal, pf.he, valoresCartao(pf.normal).ini, el.dataset.fim); return; }
      aplicarHorario(d, valoresCartao(d).ini, el.dataset.fim); return;
    }
    case "mn-outro-horario": { const d = ui.menu.des, alvo = ui.menu.alvo; fecharMenu(); abrirEditor("hora", alvo.querySelector(".hr") || alvo, { des: d }); return; }
    case "mn-sem-rec": { const d = ui.menu.des; fecharMenu(); mudar(`${nomeGm(d.gm)}: HE recorrente suspensa em ${ddmm(ui.dia)}`, () => data.ocorrencias.push({ id: novoId(), tipo: "SEM_HE_REC", gm: d.gm, de: ui.dia })); return; }
    case "ed-estender": { const inp = $("#ed-in"), f = parseFaixa(inp.value); if (f) { inp.value = `${f[0]}–${el.dataset.fim}`; atualizarDicaHora(); } inp.focus(); return; }
    case "secao-criar": {
      const nome = $("#ns-nome").value.trim().toUpperCase(), i = ui.pop.modo === "novo" ? data.secoes.length - 1 : data.secoes.findIndex((x) => x.id === ui.pop.secao), grupo = !!$("#ns-grupo")?.checked;
      if (!nome) { toast("Digite o nome da seção."); return; }
      fecharPop();
      mudar(`${grupo ? "Grupamento" : "Seção"} ${nome} criad${grupo ? "o" : "a"}. Use "+ posto/viatura" nela para pôr postos.`, () => data.secoes.splice(i + 1, 0, { id: "s" + novoId(), nome, ...(grupo ? { grupamento: true } : {}) }));
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
        if (via === "rem") mudar(`${nomeGm(X)} remanejado para ${pn}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: X, de: ui.dia, ate: ui.dia, posto: s.posto }));
        else { const [a, b] = intervalo(s.ini, s.fim); lancarHE(X, a, b, s.posto); }
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
        else { const [a, b] = limitarExtensao(data, ui.dia, X, d.ini, d.fim); data.ocorrencias.push({ id: novoId(), tipo: "HE", gm: X, de: ui.dia, ini: fmtHm(a), fim: fmtHm(b), posto: d.posto, req: "" }); }
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
    case "remanejar": mudar(`${nomeGm(el.dataset.gm)} remanejado para ${postoPorId(d.posto).nome}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: el.dataset.gm, de: ui.dia, ate: ui.dia, posto: d.posto }); ui.drawer = null; }); break;
    case "pend-rem": fecharMenu(); mudar(`${nomeGm(el.dataset.gm)} remanejado para ${postoPorId(el.dataset.posto).nome} em ${ddmm(el.dataset.dia)}`, () => data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: el.dataset.gm, de: el.dataset.dia, ate: el.dataset.dia, posto: el.dataset.posto })); break;
    case "pend-he": fecharMenu(); mudar(`${el.dataset.nat === "bh" ? "BH+" : "HE"}: ${nomeGm(el.dataset.gm)} ${el.dataset.ini}–${el.dataset.fim} em ${postoPorId(el.dataset.posto).nome} (${ddmm(el.dataset.dia)})`, () => data.ocorrencias.push({ id: novoId(), tipo: el.dataset.nat === "bh" ? "BH_MAIS" : "HE", gm: el.dataset.gm, de: el.dataset.dia, ini: el.dataset.ini, fim: el.dataset.fim, posto: el.dataset.posto, req: el.dataset.req || "" })); break;
    case "pend-mais": { const k = el.dataset.k; ui.pendMais.has(k) ? ui.pendMais.delete(k) : ui.pendMais.add(k); render(); return; }
    case "pend-pergunta": {
      const x = el.dataset, r = el.getBoundingClientRect(), p = postoPorId(x.posto)?.nome;
      const txt = x.via === "rem" ? `Remanejar ${nomeGm(x.gm)} para ${p} em ${ddmm(x.dia)}?` : `${nomeGm(x.gm)} · ${p} ${x.ini}–${x.fim} (${ddmm(x.dia)})`;
      const dd = { dia: x.dia, posto: x.posto, gm: x.gm, ini: x.ini || "", fim: x.fim || "" };
      abrirMenu([{ t: txt, act: "ed-nada", desab: true }, { sep: true },
        ...(x.via === "rem" ? [{ t: "Sim, remanejar", act: "pend-rem", d: dd, padrao: true }]
          : [{ t: "📲 Oferecer a ele (WhatsApp)", act: "pend-oferecer", d: dd, padrao: true }, { t: "Copiar mensagem da vaga", act: "pend-copiar", d: dd }, { sep: true },
            { t: "Já confirmou: lançar HE", act: "pend-he", d: dd }, { t: "Já confirmou: lançar como BH+", act: "pend-he", d: { ...dd, nat: "bh" } }]),
        ...(x.via === "rem" ? [] : [{ t: "Mudar o horário antes…", act: "pend-abrir", d: { dia: x.dia, posto: x.posto, turno: TURNOS.find((t) => sobrepoe(intervalo(x.ini, x.fim)[0], intervalo(x.ini, x.fim)[1], t.ini, t.fim) > 0)?.id || "t2" } }]),
        { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, el, {});
      return;
    }
    case "pend-aceitar-pergunta": {
      const r = el.getBoundingClientRect(), d = el.dataset.dia;
      abrirMenu([{ t: `Lançar as ${el.dataset.n} sugestões de ${ddmm(d)}?`, act: "ed-nada", desab: true }, { sep: true }, { t: "Sim, lançar todas", act: "pend-aceitar-dia", d: { dia: d }, padrao: true }, { t: "Cancelar", act: "dr-cancelar" }], r.left, r.bottom + 2, el, {});
      return;
    }
    case "pend-aceitar-dia": {
      fecharMenu();
      const d = el.dataset.dia, plano = juntarPlano(planejarCobertura(data, [d])).filter((x) => x.tipo);
      mudar(`${plano.length} vaga${plano.length === 1 ? "" : "s"} de ${ddmm(d)} resolvida${plano.length === 1 ? "" : "s"}`, () => {
        for (const x of plano) data.ocorrencias.push(x.tipo === "REMANEJ" ? { id: novoId(), tipo: "REMANEJ", gm: x.gm, de: d, ate: d, posto: x.posto } : { id: novoId(), tipo: "HE", gm: x.gm, de: d, ini: fmtHm(x.ini), fim: fmtHm(x.fim), posto: x.posto, req: "" });
      });
      return;
    }
    case "ir-mes-fin": ui.view = "mes"; ui.mes = mesDe(ui.dia); location.hash = "mes"; render(); $("[data-act=fin-pendentes]")?.click(); return;
    case "so-furos": ui.soFuros = true; render(); return;
    case "lemb-todos": { const k = el.dataset.k, a = (ui.lembAberto ||= new Set()); a.has(k) ? a.delete(k) : a.add(k); render(); return; }
    case "ir-efetivo": ui.view = "padroes"; (ui.padrao ||= { aba: "efetivo", mes: mesDe(ui.dia), desde: ui.dia }).aba = "efetivo"; ui.efetivo = { busca: "", so: "sem" }; location.hash = "padroes"; render(); return;
    case "ir-frota": ui.view = "frota"; location.hash = "frota"; render(); return;
    case "ir-insp": ui.view = "padroes"; (ui.padrao ||= { aba: "impar", mes: mesDe(ui.dia), desde: ui.dia }).aba = "inspetores"; location.hash = "padroes"; render(); return;
    case "pend-abrir": fecharMenu(); ui.dia = el.dataset.dia; ui.mes = mesDe(ui.dia); ui.view = "quadro"; location.hash = "quadro"; abrirFuro(el.dataset.posto, el.dataset.turno); break;
    case "ir-hoje": ui.dia = hojeBase(); ui.mes = mesDe(ui.dia); render(); break;
    case "cmd-ex": $("#cmd").value = el.dataset.txt; $("#cmd").focus(); previaComando(el.dataset.txt); return;
    case "cmd-lancar": lancarComando(); return;
    case "salvar-ajustes": {
      const teto = Number($("#aj-teto").value);
      if (!(teto > 0)) { toast("Informe um teto de HE válido."); break; }
      data.config.ancora = { data: $("#aj-data").value, equipes: [$("#aj-dia").value, $("#aj-noite").value] };
      const linhasCab = $("#aj-cab").value.split("\n").map((x) => x.trim()).filter(Boolean);
      data.config.tetoHE = teto; data.config.cabecalhoLinhas = linhasCab; data.config.cabecalho = linhasCab.join(" · "); data.config.inspetorChefe = $("#aj-chefe").value.trim().toUpperCase();
      if (ui.brasoes) { data.config.brasoes = { ...(data.config.brasoes || {}), ...ui.brasoes }; ui.brasoes = null; }
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
    case "gm-acao": d.acao = d.acao === el.dataset.acao ? "" : el.dataset.acao; render(); if (d.acao === "lotacao") previaHorarioFixo(); break;
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
      if (!postoAtivoEm(postoPorId(posto), $("#r-de").value)) { toast(`${postoPorId(posto).nome} não está ativo nesse dia. Escolha outro posto.`); return; }
      mudar(`${nomeGm(d.gm)} remanejado para ${postoPorId(posto).nome}`, () => { data.ocorrencias.push({ id: novoId(), tipo: "REMANEJ", gm: d.gm, posto, funcao: $("#r-fn").value.trim(), de: $("#r-de").value, ate: $("#r-ate").value || $("#r-de").value }); ui.drawer = null; });
      break;
    }
    case "pre-apagar": ui.confirmar = el.dataset.id; render(); break;
    case "apagar": mudar("Lançamento excluído", () => { data.ocorrencias = data.ocorrencias.filter((o) => o.id !== el.dataset.id); ui.confirmar = null; }); break;
    case "abrir-ficha": fecharEditor(); fecharPop(); ui.gm = el.dataset.gm; ui.mes = mesDe(ui.dia); ui.view = "ficha"; ui.drawer = null; location.hash = "ficha"; render(); window.scrollTo(0, 0); break;
    case "ir-dia": ui.dia = el.dataset.dia; ui.view = "quadro"; location.hash = "quadro"; render(); break;
    case "fechar": ui.drawer = null; render(); break;
    case "fin-abrir": abrirFinalizar(ui.dia); return;
    case "fin-pendentes": { const dias = diasEmAberto(data, ui.mes, somaDias(hojeBase(), -1)); if (!dias.length) { toast("Nenhum dia em aberto até ontem."); return; } ui.drawer = { tipo: "finalizar", dias, fora: [] }; render(); return; }
    case "fin-incluir": { const d = ui.drawer; d.dias = [...d.abertosAntes, ...d.dias]; d.abertosAntes = []; render(); return; }
    case "fin-ok": {
      const d = ui.drawer, fora = new Set(d.fora || []);
      const min = d.dias.flatMap((dia) => heDoDia(data, dia)).filter((h) => !fora.has(h.id)).reduce((t, h) => t + h.min, 0);
      mudar(`${d.dias.length === 1 ? `Escala de ${ddmm(d.dias[0])} finalizada` : `${d.dias.length} dias finalizados`}: ${fmtHoras(min)} de HE no controle`, () => { finalizar(d.dias, fora); ui.drawer = null; });
      return;
    }
    case "fin-reabrir": {
      const dia = ui.dia, editados = (data.controle || []).filter((c) => c.dia === dia && c.editado && !c.manual).length;
      if (editados && !confirm(`${editados} lançamento(s) deste dia foram corrigidos no controle. Reabrir apaga essas correções. Continuar?`)) return;
      mudar(`Escala de ${ddmm(dia)} reaberta: as HEs do dia saíram do controle até finalizar de novo`, () => { data.controle = (data.controle || []).filter((c) => c.dia !== dia || c.manual); });
      return;
    }
    case "abrir-controle": ui.drawer = { tipo: "controle", gm: el.dataset.gm, mes: ui.mes }; render(); return;
    case "ctl-del": { const c = data.controle.find((x) => x.id === el.dataset.ctl); mudar(`Controle: lançamento de ${nomeGm(c.gm)} em ${ddmm(c.dia)} retirado`, () => { data.controle = data.controle.filter((x) => x !== c); }); return; }
    case "ctl-add": {
      const dia = $("#ctl-dia").value, min = lerHoras($("#ctl-h").value), obs = $("#ctl-o").value.trim(), g = ui.drawer.gm;
      if (!dia || min === null || !min) { toast("Informe o dia e as horas (ex.: 6 ou -6)."); return; }
      mudar(`Controle: ajuste de ${fmtHoras(Math.abs(min))}${min < 0 ? " a menos" : ""} para ${nomeGm(g)}`, () => { (data.controle ||= []).push({ id: novoId(), tipo: "HE", manual: true, dia, gm: g, min, obs }); });
      return;
    }
    case "srv-exemplo": {
      el.disabled = true; el.textContent = "Carregando…";
      const est = criarExemplo(); delete est._versao;
      api("/api/importar", { method: "POST", body: JSON.stringify({ estado: est }) })
        .then(({ status, corpo }) => { if (status !== 200) throw new Error(corpo.erro); return carregarDoServidor(); })
        .then(() => toast("Dados de exemplo carregados"))
        .catch((e) => { el.disabled = false; el.textContent = "Começar com dados de exemplo"; toast("Não deu certo: " + (e.message || "erro")); });
      return;
    }
    case "desfazer": if (SERVIDOR && desfazer.length) srv.resumos.push("Desfez a última alteração");
      if (desfazer.length) { const u = JSON.parse(desfazer.pop()); data.ocorrencias = u.o; data.postos = u.p; data.secoes = u.s; data.gms = u.g; data.requerimentos = u.r; data.equipes = u.e; data.controle = u.c || []; data.inspetores = u.i || {}; data.frota = u.f || []; data.folgasSync = u.fs || {}; data._versao++; ui.plano = null; salvar(); render(); toast("Última alteração desfeita"); } break;
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
  if (id === "np-modelo" && ui.pop) { const nome = $("#np-nome")?.value || "", sec = $("#np-secao")?.value; ui.pop.modeloPosto = v; if (sec && ui.pop.modo === "novo") ui.pop.secao = sec; desenharPop(); const n = $("#np-nome"); if (n) { n.value = nome; n.focus(); } return; }
  if (id === "pad-desde" && v) { ui.padrao.desde = v; ui.padrao.mes = mesDe(v); render(); return; }
  if (e.target.closest?.(".form-hf")) { previaHorarioFixo(); return; }
  if (e.target.dataset?.cgm) { salvarCelHoras(e.target); return; }
  if (e.target.classList?.contains("lg-data")) {
    const o = data.ocorrencias.find((x) => x.id === e.target.dataset.oc), campo = e.target.dataset.campo;
    if (!o || !v) return;
    const de = campo === "de" ? v : o.de, ate = campo === "ate" ? v : o.ate || o.de;
    if (ate < de) { toast("A data final não pode ser antes da inicial."); render(); return; }
    mudar(`${TIPOS[o.tipo]} de ${nomeGm(o.gm)}: ${ddmm(de)} a ${ddmm(ate)}`, () => { o.de = de; o.ate = ate; });
    return;
  }
  if (e.target.id === "fg-arq") {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then((txt) => { const r = lerCsvFolgas(txt); if (!r || !r.linhas.length) { toast("Não reconheci o arquivo. Use o CSV exportado pelo Sistema de Folgas."); return; } ui.lanc.import = r; render(); });
    return;
  }
  if (["tr-a", "tr-b", "tr-dia1", "tr-dia2", "tr-req", "tr-volta"].includes(e.target.id)) {
    const t = (ui.lanc.troca ||= {});
    t.a = acharGmPorNome($("#tr-a").value)?.id; t.b = acharGmPorNome($("#tr-b").value)?.id; t.dia1 = $("#tr-dia1").value; t.dia2 = $("#tr-dia2")?.value; t.req = $("#tr-req").value; t.volta = $("#tr-volta").checked;
    $("#tr-volta-campos").hidden = !t.volta; $("#tr-chk1").textContent = checarTroca(t.a, t.b, t.dia1); $("#tr-chk2").textContent = checarTroca(t.b, t.a, t.dia2);
    return;
  }
  if (e.target.dataset?.imp) { ui.lanc.import.linhas[Number(e.target.dataset.imp)].gm = v; render(); return; }
  if (e.target.id === "lg-gm" && v.trim()) { const g = data.gms.find((x) => norm(x.nome) === norm(v.trim())); if (g && !ui.lanc.sel.includes(g.id)) ui.lanc.sel.push(g.id); if (g) { e.target.value = ""; redesenharSel(); e.target.focus(); } return; }
  if (e.target.dataset?.fr && e.target.dataset.campo) {
    const x = data.frota.find((y) => y.id === e.target.dataset.fr), campo = e.target.dataset.campo, val = campo === "prefixo" ? v.trim() : v.trim();
    if (!x || (x[campo] || "") === val) return;
    mudar(`Viatura ${x.prefixo || val}: ${campo} atualizado`, () => { x[campo] = val; });
    return;
  }
  if (e.target.dataset?.ef) {
    const g = gmPorId(e.target.dataset.ef), campo = e.target.dataset.campo, desde = ui.padrao.desde, v0 = vigente(g, desde);
    if (campo === "equipe") { mudarLotacao(g, { equipe: v || undefined, lotacao: v0.lotacao }, desde, `${g.nome}: ${v ? rotuloEquipe(equipe(v), desde) : "sem escala"} a partir de ${ddmm(desde)}`); return; }
    if (campo === "posto") { mudarLotacao(g, { equipe: v0.equipe, lotacao: { ...(v0.lotacao || { segmentos: [{ ini: "07:00", fim: "19:00" }] }), posto: v || "" } }, desde, `${g.nome}: ${v ? postoPorId(v).nome : "sem posto"} a partir de ${ddmm(desde)}`); return; }
    if (campo === "funcao") { mudarLotacao(g, { equipe: v0.equipe, lotacao: { ...v0.lotacao, funcao: v } }, desde, `${g.nome}: ${v || "sem função"} a partir de ${ddmm(desde)}`); return; }
    mudar(`${g.nome}: ${campo === "grupos" ? "grupamentos" : campo === "cnh" ? "CNH" : "observação"} atualizado`, () => {
      if (campo === "grupos") { const l = v.split(/[,;]/).map((x) => x.trim().toUpperCase()).filter(Boolean); if (l.length) g.grupos = l; else delete g.grupos; }
      else if (v.trim()) g[campo] = v.trim(); else delete g[campo];
    });
    return;
  }
  if (e.target.dataset?.inspDia) {
    const dia = e.target.dataset.inspDia, per = e.target.dataset.inspPer, nome = v.trim().toUpperCase();
    mudar(`Inspetor ${per === "dia" ? "do dia" : "da noite"} em ${ddmm(dia)}: ${nome || "da equipe"}`, () => {
      data.inspetores ||= {};
      if (nome) (data.inspetores[dia] ||= {})[per] = nome; else if (data.inspetores[dia]) { delete data.inspetores[dia][per]; if (!Object.keys(data.inspetores[dia]).length) delete data.inspetores[dia]; }
      const eqs = data.equipes.filter((x) => x.periodo === per).map((x) => x.id);
      data.ocorrencias = data.ocorrencias.filter((o) => !(o.tipo === "INSPETOR" && o.de === dia && eqs.includes(o.equipe)));
    });
    return;
  }
  if (e.target.dataset?.opn) { ui.drawer.novas[Number(e.target.dataset.opn)].n = Number(v) || 1; return; }
  if (e.target.dataset?.rst) {
    const f = new Set(ui.drawer.fora || []); if (e.target.checked) f.delete(e.target.dataset.rst); else f.add(e.target.dataset.rst); ui.drawer.fora = [...f];
    const n = document.querySelectorAll("[data-rst]:checked").length; $("[data-act=rst-ok]").textContent = `Desfazer ${n} alteraç${n === 1 ? "ão" : "ões"}`; return;
  }
  if (e.target.dataset?.fin) { // confirmação da finalização: marca/desmarca sem redesenhar
    const fora = new Set(ui.drawer.fora); if (e.target.checked) fora.delete(e.target.dataset.fin); else fora.add(e.target.dataset.fin); ui.drawer.fora = [...fora];
    const min = [...document.querySelectorAll("[data-fin]:checked")].reduce((t, x) => t + Number(x.dataset.min), 0);
    $("#fin-ok").textContent = `Finalizar e lançar ${fmtHoras(min)} no controle`; return;
  }
  if (e.target.dataset?.ctl && e.target.matches(".ctl-h, .ctl-o")) {
    const c = data.controle.find((x) => x.id === e.target.dataset.ctl); if (!c) return;
    if (e.target.matches(".ctl-h")) {
      const min = lerHoras(v); if (min === null) { toast("Horas inválidas. Use, por exemplo, 6 ou 6:30."); render(); return; }
      mudar(`Controle: ${nomeGm(c.gm)} em ${ddmm(c.dia)} passa para ${fmtHoras(min)}`, () => { c.min = min; c.editado = true; });
    } else mudar(`Controle: observação de ${nomeGm(c.gm)} em ${ddmm(c.dia)}`, () => { c.obs = v.trim(); c.editado = true; });
    return;
  }
  if (id === "aj-bras-esq" || id === "aj-bras-dir") {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => { // reduz para no máximo 240 px de altura, para a folha carregar rápido
      const k = Math.min(1, 240 / img.height), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      ui.brasoes = { ...(ui.brasoes || {}), [id === "aj-bras-esq" ? "esq" : "dir"]: c.toDataURL("image/png") };
      URL.revokeObjectURL(url);
      toast("Imagem pronta. Clique em Salvar ajustes.");
    };
    img.src = url;
    return;
  }
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
  if (e.key === "Escape" && ui.colando && $("#menu").hidden && !ed.modo) { pararColar(); return; }
  if (e.key === "Escape" && ui.pop) { fecharPop(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f" && ["quadro", "padroes"].includes(ui.view) && ui.pop?.modo !== "buscagm") {
    e.preventDefault(); fecharMenu(); abrirPop("buscagm", $("[data-act=busca-gm]") || document.body, { q: "", fixo: true }); setTimeout(() => $("#bg-in")?.focus(), 30); return; // Ctrl+F de novo = busca normal do navegador
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("#btn-desfazer").click(); return; }
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
window.addEventListener("beforeunload", (e) => { if (SERVIDOR && ui.pronto && !ui.vazio && (srv.enviando || diferenca().length)) { e.preventDefault(); e.returnValue = ""; } });
render();
if (SERVIDOR) iniciarServidor();
