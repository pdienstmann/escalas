// Motor da escala — protótipo.
// Princípio: escala do dia = escala ideal (lotação + regime) + ocorrências datadas.
// Nada é copiado para os dias: tudo é calculado. As horas saem do mesmo cálculo.
//
// Tempo: cada "dia de serviço" D vai de D 07:00 até D+1 07:00.
// Horários são minutos a partir de D 00:00 (podem passar de 1440: 01:00 do dia seguinte = 1500).

export const TURNOS = [
  { id: "t2", nome: "2º TURNO", ini: 420, fim: 780 },   // 07–13
  { id: "t3", nome: "3º TURNO", ini: 780, fim: 1140 },  // 13–19
  { id: "t4", nome: "4º TURNO", ini: 1140, fim: 1500 }, // 19–01
  { id: "t1", nome: "1º TURNO", ini: 1500, fim: 1860 }, // 01–07
];

export const AFASTAMENTOS = {
  FOLGA: "Folga",
  FERIAS: "Férias",
  LICENCA: "Licença",
  ATESTADO: "Atestado",
  CURSO: "Curso",
  FALTA: "Falta",
  BH_COMP: "Banco de horas (compensação)",
};
// Afastamentos de um dia só (valem apenas se o GM estaria de serviço)
export const DE_UM_DIA = ["FOLGA", "FALTA", "BH_COMP"];

export const TIPOS = {
  ...AFASTAMENTOS,
  HE: "Hora extra",
  BH_MAIS: "Banco de horas (crédito)",
  TROCA: "Troca de serviço",
  REMANEJ: "Remanejamento",
  FA: "Viatura fora de atividade",
  HORARIO: "Horário alterado",
};

// ---------- datas ----------
const DAY = 86400000;
export function parseData(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
export function fmtData(ms) { return new Date(ms).toISOString().slice(0, 10); }
export function somaDias(s, n) { return fmtData(parseData(s) + n * DAY); }
export function diaSemana(s) { return new Date(parseData(s)).getUTCDay(); } // 0 = domingo
export function indiceDia(s) { return Math.round(parseData(s) / DAY); }
export function mesDe(s) { return s.slice(0, 7); }
export function diasDoMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}
export function mesSeguinte(mes) { const [y, m] = mes.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; }

// ---------- horários ----------
export function hm(str) { const [h, m] = str.split(":").map(Number); return h * 60 + (m || 0); }
export function fmtHm(min) { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
// Converte "19:00"–"01:00" em intervalo contínuo; horários antes das 07:00 contam como madrugada do dia seguinte
// quando o início é à noite (fim <= início).
export function intervalo(ini, fim) {
  let a = typeof ini === "number" ? ini : hm(ini);
  let b = typeof fim === "number" ? fim : hm(fim);
  if (a < 420 && b <= 420 && typeof ini === "string" && a < 360) { a += 1440; b += 1440; } // 01:00–07:00 isolado = madrugada
  if (b <= a) b += 1440;
  return [a, b];
}
export function sobrepoe(a1, b1, a2, b2) { return Math.max(0, Math.min(b1, b2) - Math.max(a1, a2)); }
export function fmtHoras(min) {
  const neg = min < 0; min = Math.abs(Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return (neg ? "−" : "") + (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`);
}
// Minutos dentro da janela noturna 22:00–05:00 (informativo para o RH).
export function minutosNoturnos(a, b) {
  let t = 0;
  for (let base = -1440; base <= 2880; base += 1440) t += sobrepoe(a, b, base + 1320, base + 1740);
  return t;
}

// ---------- regime ----------
export function trabalhaNoDia(data, gm, dia) {
  const eq = data.equipes.find((e) => e.id === gm.equipe);
  if (!eq || gm.ativo === false) return false;
  if (eq.tipo === "alternado") return trabalhaAlternado(data, eq, dia);
  if (eq.tipo === "semanal") return (gm.dias || [1, 2, 3, 4, 5]).includes(diaSemana(dia));
  return false;
}
// Alternância 12x36: basta um dia de referência dizendo quais equipes trabalham nele.
// As equipes listadas trabalham nos dias pares a partir da referência; as demais, nos ímpares.
function trabalhaAlternado(data, eq, dia) {
  const a = data.config?.ancora;
  if (a?.data && a.equipes?.length) {
    const par = (((indiceDia(dia) - indiceDia(a.data)) % 2) + 2) % 2 === 0;
    return a.equipes.includes(eq.id) === par;
  }
  return ((indiceDia(dia) % 2) + 2) % 2 === eq.paridade;
}
export function equipesDoDia(data, dia) {
  return data.equipes.filter((e) => e.tipo === "alternado" && trabalhaAlternado(data, e, dia)).map((e) => e.id);
}

function ocorrenciaCobre(oc, dia) { return oc.de <= dia && dia <= (oc.ate || oc.de); }

// ---------- escala do dia ----------
const cacheDia = new Map();
const cacheMes = new Map();
let versaoCache = null, dataCache = null;
export function limparCache() { cacheDia.clear(); cacheMes.clear(); }
function conferirVersao(data) { if (dataCache !== data || versaoCache !== (data._versao || 0)) { limparCache(); dataCache = data; versaoCache = data._versao || 0; } }

export function calcularDia(data, dia) {
  conferirVersao(data);
  const chave = dia;
  if (cacheDia.has(chave)) return cacheDia.get(chave);
  const gmPorId = new Map(data.gms.map((g) => [g.id, g]));
  const postoPorId = new Map(data.postos.map((p) => [p.id, p]));
  const ocs = data.ocorrencias.filter((o) => ocorrenciaCobre(o, dia));
  const alertas = [];
  let seq = 0;

  // 1. Base: lotação de quem trabalha no dia
  const base = [];
  for (const gm of data.gms) {
    if (!trabalhaNoDia(data, gm, dia) || !gm.lotacao) continue;
    for (const s of gm.lotacao.segmentos) {
      const [ini, fim] = intervalo(s.ini, s.fim);
      base.push({ id: `b${seq++}`, gm: gm.id, posto: gm.lotacao.posto, funcao: gm.lotacao.funcao || "", ini, fim,
        nat: s.tipo === "he" ? "he" : "normal", fixa: s.tipo === "he", req: s.tipo === "he" ? "HE fixa" : "", origem: "base" });
    }
  }

  // 1b. Horário alterado no dia: o que ficar fora do horário normal vira HE automaticamente
  for (const oc of ocs.filter((o) => o.tipo === "HORARIO" && o.de === dia)) {
    const idx = base.findIndex((d) => d.gm === oc.gm && `${d.ini}-${d.fim}` === oc.alvo);
    if (idx < 0) continue;
    const d = base[idx];
    const [a, b] = intervalo(oc.ini, oc.fim);
    const marca = { alvo: oc.alvo, ajuste: oc.id };
    const partes = [];
    if (a < d.ini) partes.push({ ...d, ...marca, id: d.id + "a", ini: a, fim: Math.min(b, d.ini), nat: "he", fixa: false, req: oc.req || "", extensao: true });
    if (Math.min(b, d.fim) > Math.max(a, d.ini)) partes.push({ ...d, ...marca, ini: Math.max(a, d.ini), fim: Math.min(b, d.fim) });
    if (b > d.fim) partes.push({ ...d, ...marca, id: d.id + "z", ini: Math.max(a, d.fim), fim: b, nat: "he", fixa: false, req: oc.req || "", extensao: true });
    base.splice(idx, 1, ...partes);
  }

  // 2. Afastamentos retiram o GM do dia
  const afastados = [];
  const afastadoHoje = new Map();
  for (const oc of ocs) {
    if (!AFASTAMENTOS[oc.tipo]) continue;
    const gm = gmPorId.get(oc.gm);
    if (!gm) continue;
    // Folga e compensação só fazem sentido em dia de serviço; afastamentos longos aparecem sempre.
    const escalado = trabalhaNoDia(data, gm, dia);
    if (DE_UM_DIA.includes(oc.tipo) && !escalado) continue;
    if (!escalado && !["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(oc.tipo)) continue;
    afastadoHoje.set(gm.id, oc);
    if (escalado) afastados.push({ gm: gm.id, tipo: oc.tipo, oc, minutos: base.filter((d) => d.gm === gm.id && d.nat === "normal").reduce((t, d) => t + d.fim - d.ini, 0) });
  }
  let des = base.filter((d) => !afastadoHoje.has(d.gm));

  // 3. Trocas: o substituto assume o serviço do titular
  for (const oc of ocs.filter((o) => o.tipo === "TROCA")) {
    const doTitular = des.filter((d) => d.gm === oc.gm);
    if (!doTitular.length) { alertas.push({ nivel: "aviso", texto: `Troca: ${nomeDoMapa(gmPorId, oc.gm)} não está escalado neste dia.` }); continue; }
    for (const d of doTitular) { d.gm = oc.substituto; d.nat = d.nat === "he" ? "he" : "troca"; d.req = oc.req || ""; d.origem = oc.id; d.titular = oc.gm; }
    afastados.push({ gm: oc.gm, tipo: "TROCA", oc, minutos: 0 });
  }

  // 4. Remanejamentos
  for (const oc of ocs.filter((o) => o.tipo === "REMANEJ")) {
    for (const d of des.filter((x) => x.gm === oc.gm && x.nat !== "he")) { d.posto = oc.posto; if (oc.funcao) d.funcao = oc.funcao; d.remanejado = true; d.req = d.req || oc.req || ""; }
  }

  // 5. Acréscimos: HE e BH+
  for (const oc of ocs.filter((o) => o.tipo === "HE" || o.tipo === "BH_MAIS")) {
    if (oc.de !== dia) continue;
    const [ini, fim] = intervalo(oc.ini, oc.fim);
    des.push({ id: `o${oc.id}`, gm: oc.gm, posto: oc.posto, funcao: oc.funcao || "", ini, fim, nat: oc.tipo === "HE" ? "he" : "bh", req: oc.req || "", origem: oc.id });
    if (afastadoHoje.has(oc.gm)) alertas.push({ nivel: "erro", texto: `${nomeDoMapa(gmPorId, oc.gm)} tem ${TIPOS[oc.tipo].toLowerCase()} mas está afastado (${TIPOS[afastadoHoje.get(oc.gm).tipo]}).` });
  }

  // 6. Viatura fora de atividade: guarnição vai para "à disposição"
  const fa = new Map();
  for (const oc of ocs.filter((o) => o.tipo === "FA")) fa.set(oc.posto, oc);
  for (const d of des) if (d.posto && fa.has(d.posto)) { d.postoOriginal = d.posto; d.posto = null; }

  // 7. Conflitos de horário do mesmo GM
  const porGm = new Map();
  for (const d of des) { if (!porGm.has(d.gm)) porGm.set(d.gm, []); porGm.get(d.gm).push(d); }
  for (const [gid, lista] of porGm) {
    lista.sort((a, b) => a.ini - b.ini);
    for (let i = 1; i < lista.length; i++) if (lista[i].ini < lista[i - 1].fim) {
      alertas.push({ nivel: "erro", texto: `${nomeDoMapa(gmPorId, gid)} está em dois lugares ao mesmo tempo (${fmtHm(lista[i].ini)}).` });
      lista[i].conflito = lista[i - 1].conflito = true;
    }
  }

  // 8. Furos: vagas por turno não preenchidas
  const furos = [];
  for (const p of data.postos) {
    if (fa.has(p.id) || !p.vagas) continue;
    if (p.dias && !p.dias.includes(diaSemana(dia))) continue;
    for (const t of TURNOS) {
      const vagas = p.vagas[t.id] || 0;
      if (!vagas) continue;
      const ocupantes = new Set(des.filter((d) => d.posto === p.id && sobrepoe(d.ini, d.fim, t.ini, t.fim) >= 60).map((d) => d.gm));
      if (ocupantes.size < vagas) furos.push({ posto: p.id, turno: t.id, faltam: vagas - ocupantes.size });
    }
  }

  const res = { dia, designacoes: des, afastados, furos, alertas, fa: [...fa.values()],
    disposicao: des.filter((d) => d.posto === null), equipes: equipesDoDia(data, dia) };
  void postoPorId;
  cacheDia.set(chave, res);
  return res;
}
function nomeDoMapa(map, id) { return map.get(id)?.nome || id; }

// Intervalos em que o GM está ocupado no dia D (inclui a noite anterior que avança sobre D).
export function ocupacao(data, gmId, dia) {
  const hoje = calcularDia(data, dia).designacoes.filter((d) => d.gm === gmId).map((d) => [d.ini, d.fim]);
  const ontem = calcularDia(data, somaDias(dia, -1)).designacoes.filter((d) => d.gm === gmId && d.fim > 1440).map((d) => [d.ini - 1440, d.fim - 1440]);
  return [...ontem, ...hoje];
}
export function afastamentoNoDia(data, gmId, dia) {
  return data.ocorrencias.find((o) => o.gm === gmId && ["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && ocorrenciaCobre(o, dia))
    || data.ocorrencias.find((o) => o.gm === gmId && DE_UM_DIA.includes(o.tipo) && o.de === dia);
}

// ---------- sugestão para cobrir furo ----------
// Duas saídas: remanejar quem está na reserva técnica / à disposição (sem custo) ou chamar HE.
export function sugerir(data, dia, postoId, ini, fim) {
  const mes = mesDe(dia);
  const livro = livroMes(data, mes);
  const cd = calcularDia(data, dia);
  const reserva = new Set(data.postos.filter((p) => p.tipo === "reserva").map((p) => p.id));
  const livreParaRemanejar = (d) => d.nat !== "he" && d.nat !== "bh" && (d.posto === null || reserva.has(d.posto));
  const remanejar = [], he = [];
  const afastados = new Set(data.ocorrencias.filter((o) => (["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && ocorrenciaCobre(o, dia)) || (DE_UM_DIA.includes(o.tipo) && o.de === dia)).map((o) => o.gm));
  const ontemNoite = calcularDia(data, somaDias(dia, -1)).designacoes.filter((d) => d.fim - 1440 > ini && d.ini - 1440 < fim).map((d) => d.gm);
  for (const gm of data.gms) {
    if (gm.ativo === false) continue;
    if (afastados.has(gm.id)) continue;
    const minhas = cd.designacoes.filter((d) => d.gm === gm.id);
    const l = livro.get(gm.id) || { he: 0, transporte: 0 };
    const base = { gm, heMes: l.he, transporte: l.transporte, mesmoPosto: gm.lotacao?.posto === postoId };
    const sobre = minhas.filter((d) => sobrepoe(d.ini, d.fim, ini, fim) > 0);
    if (sobre.length) {
      if (sobre.every(livreParaRemanejar)) {
        const d = sobre[0];
        remanejar.push({ ...base, origem: d.posto === null ? "À disposição" : data.postos.find((p) => p.id === d.posto)?.nome, ini: d.ini, fim: d.fim });
      }
      continue;
    }
    if (ontemNoite.includes(gm.id)) continue;
    const notas = [];
    if (base.mesmoPosto) notas.push("conhece o posto");
    if (gm.naoFazHE) notas.push("não realiza HE");
    he.push({ ...base, notas, bloqueado: !!gm.naoFazHE });
  }
  he.sort((a, b) => (a.bloqueado - b.bloqueado) || (b.mesmoPosto - a.mesmoPosto) || (a.heMes + a.transporte - b.heMes - b.transporte) || a.gm.nome.localeCompare(b.gm.nome));
  remanejar.sort((a, b) => (a.origem === "À disposição" ? 0 : 1) - (b.origem === "À disposição" ? 0 : 1) || a.gm.nome.localeCompare(b.gm.nome));
  return { remanejar, he };
}

// ---------- livro de horas ----------
export function resumoMes(data, mes) {
  conferirVersao(data);
  const chave = mes;
  if (cacheMes.has(chave)) return cacheMes.get(chave);
  const r = new Map();
  const get = (id) => { if (!r.has(id)) r.set(id, { servicosBase: 0, servicos: 0, folgas: 0, normal: 0, he: 0, heNoturna: 0, heFixa: 0, bhMais: 0, bhMenos: 0, trocas: 0, afastDias: 0, dias: {} }); return r.get(id); };
  for (const dia of diasDoMes(mes)) {
    const cd = calcularDia(data, dia);
    for (const gm of data.gms) if (trabalhaNoDia(data, gm, dia) && gm.lotacao) get(gm.id).servicosBase++;
    const trabalhouNormal = new Set();
    for (const d of cd.designacoes) {
      const x = get(d.gm), min = d.fim - d.ini;
      const marca = x.dias[dia] || (x.dias[dia] = []);
      if (d.nat === "he") { x.he += min; x.heNoturna += minutosNoturnos(d.ini, d.fim); if (d.fixa) x.heFixa += min; marca.push("HE"); }
      else if (d.nat === "bh") { x.bhMais += min; marca.push("BH+"); }
      else { x.normal += min; trabalhouNormal.add(d.gm); if (d.nat === "troca") marca.push("TR"); else marca.push("S"); }
    }
    for (const id of trabalhouNormal) get(id).servicos++;
    for (const a of cd.afastados) {
      const x = get(a.gm);
      (x.dias[dia] || (x.dias[dia] = [])).push(a.tipo);
      if (a.tipo === "FOLGA") x.folgas++;
      else if (a.tipo === "BH_COMP") x.bhMenos += a.minutos;
      else if (a.tipo === "TROCA") x.trocas++;
      else x.afastDias++;
    }
    // afastamentos longos em dias sem serviço
    for (const o of data.ocorrencias) if (["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && ocorrenciaCobre(o, dia)) {
      const x = get(o.gm); const m = x.dias[dia] || (x.dias[dia] = []);
      if (!m.includes(o.tipo)) m.push(o.tipo);
    }
  }
  cacheMes.set(chave, r);
  return r;
}

// Saldo de HE com teto de pagamento: o que passa do teto vai para o mês seguinte.
export function livroMes(data, mes) {
  const teto = (data.config?.tetoHE ?? 60) * 60;
  let mesAtual = data.config?.mesInicial || mes;
  if (mes < mesAtual) mesAtual = mes;
  const transporte = new Map(Object.entries(data.config?.transporteInicial || {}).map(([k, v]) => [k, v * 60]));
  let livro;
  for (let guarda = 0; guarda < 240; guarda++) {
    const r = resumoMes(data, mesAtual);
    livro = new Map();
    for (const gm of data.gms) {
      const x = r.get(gm.id) || { he: 0, bhMais: 0, bhMenos: 0 };
      const anterior = transporte.get(gm.id) || 0;
      const total = anterior + x.he;
      const paga = Math.min(teto, total);
      livro.set(gm.id, { ...x, transporte: anterior, total, paga, proximo: total - paga });
    }
    if (mesAtual >= mes) break;
    for (const [id, l] of livro) transporte.set(id, l.proximo);
    mesAtual = mesSeguinte(mesAtual);
  }
  return livro;
}

// Saldo acumulado de banco de horas até o fim do mês.
export function saldoBH(data, gmId, mes) {
  let m = data.config?.mesInicial || mes, s = 0;
  if (mes < m) m = mes;
  for (let i = 0; i < 240; i++) {
    const x = resumoMes(data, m).get(gmId);
    if (x) s += x.bhMais - x.bhMenos;
    if (m >= mes) break;
    m = mesSeguinte(m);
  }
  return s;
}

// ---------- pendências e preenchimento automático ----------
const PERIODOS_P = [["dia", ["t2", "t3"]], ["noite", ["t4", "t1"]]];
export function pendencias(data, dia) {
  const cd = calcularDia(data, dia);
  const out = [];
  for (const p of data.postos) for (const [per, ts] of PERIODOS_P) {
    const fs = cd.furos.filter((f) => f.posto === p.id && ts.includes(f.turno));
    if (!fs.length) continue;
    const t0 = TURNOS.find((x) => x.id === fs[0].turno), t1 = TURNOS.find((x) => x.id === fs[fs.length - 1].turno);
    out.push({ dia, posto: p.id, per, turnos: fs.map((f) => f.turno), faltam: Math.max(...fs.map((f) => f.faltam)), ini: t0.ini, fim: t1.fim });
  }
  return out;
}

// Propõe como cobrir todos os furos dos dias informados, sem gravar nada:
// 1º quem está na reserva técnica / à disposição (remanejar), 2º HE para quem conhece o posto e tem menos horas no mês.
export function planejarCobertura(data, dias) {
  const plano = [];
  const heExtra = new Map();
  const reserva = new Set(data.postos.filter((p) => p.tipo === "reserva").map((p) => p.id));
  for (const dia of dias) {
    const cd = calcularDia(data, dia);
    const livro = livroMes(data, mesDe(dia));
    const afast = new Set(data.ocorrencias.filter((o) => (["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && ocorrenciaCobre(o, dia)) || (DE_UM_DIA.includes(o.tipo) && o.de === dia)).map((o) => o.gm));
    const ocup = new Map();
    const marca = (g, a, b) => { if (!ocup.has(g)) ocup.set(g, []); ocup.get(g).push([a, b]); };
    for (const d of cd.designacoes) marca(d.gm, d.ini, d.fim);
    for (const d of calcularDia(data, somaDias(dia, -1)).designacoes) if (d.fim > 1440) marca(d.gm, d.ini - 1440, d.fim - 1440);
    const livres = cd.designacoes.filter((d) => d.nat === "normal" && (d.posto === null || reserva.has(d.posto)));
    const usados = new Set();
    for (const p of pendencias(data, dia)) for (let k = 0; k < p.faltam; k++) {
      const rv = livres.find((d) => !usados.has(d.gm) && sobrepoe(d.ini, d.fim, p.ini, p.fim) >= Math.min(360, p.fim - p.ini));
      if (rv) {
        usados.add(rv.gm);
        plano.push({ dia, posto: p.posto, tipo: "REMANEJ", gm: rv.gm, ini: rv.ini, fim: rv.fim, de: rv.posto === null ? "à disposição" : "reserva técnica" });
        continue;
      }
      const mes = mesDe(dia);
      let melhor = null;
      for (const gm of data.gms) {
        if (gm.ativo === false || gm.naoFazHE || afast.has(gm.id)) continue;
        if ((ocup.get(gm.id) || []).some(([a, b]) => sobrepoe(a, b, p.ini, p.fim) > 0)) continue;
        const l = livro.get(gm.id) || { he: 0, transporte: 0 };
        const horas = l.he + l.transporte + (heExtra.get(gm.id + mes) || 0);
        const mesmo = gm.lotacao?.posto === p.posto ? 1 : 0;
        if (!melhor || mesmo > melhor.mesmo || (mesmo === melhor.mesmo && horas < melhor.horas) || (mesmo === melhor.mesmo && horas === melhor.horas && gm.nome < melhor.gm.nome)) melhor = { gm, horas, mesmo };
      }
      if (!melhor) { plano.push({ dia, posto: p.posto, tipo: null, ini: p.ini, fim: p.fim }); continue; }
      marca(melhor.gm.id, p.ini, p.fim);
      heExtra.set(melhor.gm.id + mes, (heExtra.get(melhor.gm.id + mes) || 0) + p.fim - p.ini);
      plano.push({ dia, posto: p.posto, tipo: "HE", gm: melhor.gm.id, ini: p.ini, fim: p.fim, horasNoMes: melhor.horas, conhecePosto: !!melhor.mesmo });
    }
  }
  return plano;
}
