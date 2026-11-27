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
// textos que versões antigas gravavam sozinhas no remanejamento (não são observação do escalante)
export const OBS_AUTO_REMANEJ = new Set(["Remanejado", "Da reserva técnica", "Arrastado no quadro"]);
// O que cada requerimento significa (cadastro de REQ)
export const TIPOS_REQ = { BH: "Banco de horas", TROCA: "Troca de serviço", HE: "Hora extra", FOLGA: "Folga", AFAST: "Atestado / licença", FERIAS: "Férias", OUTRO: "Outro" };

export const TIPOS = {
  ...AFASTAMENTOS,
  HE: "Hora extra",
  BH_MAIS: "Banco de horas (crédito)",
  TROCA: "Troca de serviço",
  REMANEJ: "Remanejamento",
  FA: "Viatura fora de atividade",
  FECHADO: "Posto fechado",
  PREFIXO: "Viatura substituta",
  VAGAS: "Vagas alteradas no dia",
  INSPETOR: "Inspetor do dia",
  FUNCAO: "Função no dia",
  AREA: "Área / nome no dia",
  AVISO: "Aviso / observação",
  OFERTA: "HE oferecida",
  DISP_HE: "Disponível para HE",
  DISP_FERIAS: "Declarou férias (folgas)",
  SEM_HE_REC: "HE recorrente suspensa no dia",
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
// Lotação com vigência: gm.historico guarda as lotações anteriores com a data em que terminaram,
// assim mudar alguém de posto hoje não reescreve os meses passados.
export function vigente(gm, dia) {
  if (!gm.historico?.length) return gm;
  for (const h of [...gm.historico].sort((a, b) => a.ate.localeCompare(b.ate))) if (dia <= h.ate) return { ...gm, equipe: h.equipe, lotacao: h.lotacao, dias: h.dias };
  return gm;
}
export function trabalhaNoDia(data, gmAtual, dia) {
  const gm = vigente(gmAtual, dia);
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
  const equipesHoje = equipesDoDia(data, dia);
  const semRec = new Set(ocs.filter((o) => o.tipo === "SEM_HE_REC" && o.de === dia).map((o) => o.gm));
  for (const gm of data.gms) {
    // HE recorrente: hora extra fixa em dias da semana, independente do regime (ex.: entrada e saída de escola)
    for (const r of gm.heRecorrente || []) {
      if (gm.ativo === false || semRec.has(gm.id) || !(r.dias || [1, 2, 3, 4, 5]).includes(diaSemana(dia))) continue;
      for (const s of r.segmentos) {
        const [ini, fim] = intervalo(s.ini, s.fim);
        base.push({ id: `b${seq++}`, gm: gm.id, posto: r.posto, funcao: "", ini, fim, nat: "he", fixa: true, recorrente: true, req: "HE recorrente", origem: "base" });
      }
    }
    if (!trabalhaNoDia(data, gm, dia)) continue;
    const lot = vigente(gm, dia).lotacao;
    if (!lot) continue;
    // horário que alterna: em dias de certas equipes (ex.: padrão par) o semanal cumpre outro horário
    const segs = lot.alternativa && lot.alternativa.quando.some((e) => equipesHoje.includes(e)) ? lot.alternativa.segmentos : lot.segmentos;
    let ultimoFim = null;
    for (const s of segs) {
      let [ini, fim] = intervalo(s.ini, s.fim);
      // trecho depois da meia-noite de um serviço noturno (ex.: 18–06 + HE 06–07): é na manhã seguinte
      if (ultimoFim !== null && ini < ultimoFim && ini + 1440 >= ultimoFim) { ini += 1440; fim += 1440; }
      ultimoFim = fim;
      base.push({ id: `b${seq++}`, gm: gm.id, posto: lot.posto, funcao: lot.funcao || "", ini, fim,
        nat: s.tipo === "he" ? "he" : "normal", fixa: s.tipo === "he", req: s.tipo === "he" ? "HE fixa" : "", origem: "base" });
    }
  }

  // 1b. Horário alterado no dia: o que ficar fora do horário normal vira HE automaticamente
  for (const oc of ocs.filter((o) => o.tipo === "HORARIO" && o.de === dia)) {
    const idx = base.findIndex((d) => d.gm === oc.gm && `${d.ini}-${d.fim}` === oc.alvo);
    if (idx < 0) continue;
    const d = base[idx];
    const [a, b] = intervalo(oc.ini, oc.fim);
    const marca = { alvo: oc.alvo, ajuste: oc.id, obs: oc.obs || "", alterado: a !== d.ini || b !== d.fim };
    const partes = [];
    const falta = d.fim - d.ini - Math.max(0, Math.min(b, d.fim) - Math.max(a, d.ini));
    const ehBH = oc.req && data.requerimentos?.[oc.req]?.tipo === "BH";
    if (oc.remover) { base.splice(idx, 1); continue; } // ex.: HE fixa que não acontece no dia
    if (oc.semHE) { base.splice(idx, 1, { ...d, ...marca, ini: a, fim: b, req: oc.req || d.req, deslocado: true }); continue; } // só mudou o horário: tudo continua normal (HE fixa continua HE fixa)
    if (a < d.ini) partes.push({ ...d, ...marca, id: d.id + "a", ini: a, fim: Math.min(b, d.ini), nat: "he", fixa: false, req: oc.req || "", extensao: true });
    if (Math.min(b, d.fim) > Math.max(a, d.ini)) partes.push({ ...d, ...marca, ini: Math.max(a, d.ini), fim: Math.min(b, d.fim), req: oc.req || d.req, bhDebito: ehBH && d.nat === "normal" ? falta : 0 });
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

  // 4. Remanejamentos (o REQ e a observação podem ficar no próprio remanejamento)
  // Com ini/fim, só o trecho do serviço dentro desse horário muda de posto (remanejamento parcial).
  for (const oc of ocs.filter((o) => o.tipo === "REMANEJ")) {
    const [ra, rb] = oc.ini ? intervalo(oc.ini, oc.fim) : [-Infinity, Infinity];
    const novos = [];
    for (const d of des) {
      if (d.gm !== oc.gm || d.nat === "he" || sobrepoe(d.ini, d.fim, ra, rb) <= 0) { novos.push(d); continue; }
      const mover = (x) => {
        if (oc.ficaNaFA) x.ficaNaFA = true; // voltou para a própria viatura mesmo em FA
        if (oc.levaVtr) x.levouVtr = oc.levaVtr; // foi com a própria viatura para a operação: a vaga de origem não vira furo
        x.posto = oc.posto; if (oc.funcao) x.funcao = oc.funcao; x.remanejado = true; x.remanej = oc.id;
        x.req = oc.req || x.req || "";
        if (oc.obs && !OBS_AUTO_REMANEJ.has(oc.obs)) x.obs = oc.obs;
        return x;
      };
      if (d.ini < ra) novos.push({ ...d, id: d.id + "r0", fim: ra });
      novos.push(mover({ ...d, id: d.ini < ra || d.fim > rb ? d.id + "r1" : d.id, ini: Math.max(d.ini, ra), fim: Math.min(d.fim, rb), bhDebito: d.fim <= rb ? d.bhDebito : 0 }));
      if (d.fim > rb) novos.push({ ...d, id: d.id + "r2", ini: rb });
    }
    des = novos;
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
  for (const oc of ocs.filter((o) => o.tipo === "FA" || o.tipo === "FECHADO")) fa.set(oc.posto, oc);
  for (const p of data.postos) if (!postoAtivoEm(p, dia) || (p.equipes?.length && !p.equipes.some((e) => equipesHoje.includes(e)))) fa.set(p.id, { tipo: "INATIVO", posto: p.id, de: dia }); // só de um padrão; extras de um dia ("so") e de operação (de/ate)
  // ajustes do dia em postos: viatura substituta e vagas diferentes
  const ajustesPosto = new Map();
  for (const oc of ocs.filter((o) => o.tipo === "PREFIXO" || o.tipo === "VAGAS" || o.tipo === "AREA")) {
    const a = ajustesPosto.get(oc.posto) || {};
    if (oc.tipo === "PREFIXO") a.prefixo = oc; else if (oc.tipo === "AREA") a.area = oc; else a.vagas = oc;
    ajustesPosto.set(oc.posto, a);
  }
  for (const d of des) if (d.posto && fa.has(d.posto) && !(d.ficaNaFA && fa.get(d.posto).tipo !== "INATIVO")) { d.postoOriginal = d.posto; d.posto = null; }

  // 6b. Função no dia (motorista / patrulheiro) só para aquele dia
  for (const oc of ocs.filter((o) => o.tipo === "FUNCAO")) for (const d of des) if (d.gm === oc.gm && d.nat !== "he") d.funcao = oc.funcao || "";
  // HE sem função escolhida, estendendo o próprio serviço na mesma viatura: fica com a função que ele já tem ali
  for (const d of des) if (d.nat === "he" && !d.funcao) { const m = des.find((x) => x !== d && x.gm === d.gm && x.posto === d.posto && x.funcao); if (m) d.funcao = m.funcao; }

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
    if (fa.has(p.id) || !(ajustesPosto.get(p.id)?.vagas || p.vagas)) continue;
    if (p.dias && !p.dias.includes(diaSemana(dia))) continue;
    for (const t of TURNOS) {
      const vagas = (ajustesPosto.get(p.id)?.vagas?.vagas || p.vagas)[t.id] || 0;
      if (!vagas) continue;
      const ocupantes = new Set(des.filter((d) => (d.posto === p.id || d.levouVtr === p.id) && sobrepoe(d.ini, d.fim, t.ini, t.fim) >= 60).map((d) => d.gm));
      if (ocupantes.size < vagas) furos.push({ posto: p.id, turno: t.id, faltam: vagas - ocupantes.size });
    }
  }

  const inspetores = new Map();
  for (const oc of ocs.filter((o) => o.tipo === "INSPETOR")) inspetores.set(oc.equipe, oc.nome);
  // escala mensal dos inspetores de serviço (dia e noite)
  const escInsp = data.inspetores?.[dia];
  if (escInsp) for (const e of data.equipes) if (e.periodo && e.periodo in escInsp && !inspetores.has(e.id)) inspetores.set(e.id, escInsp[e.periodo]); // "" = sem inspetor (afastado)
  const res = { dia, inspetores, designacoes: des, afastados, furos, alertas, fa: [...fa.values()].filter((o) => o.tipo !== "INATIVO"), ajustesPosto,
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
// Ordem de prioridade para HE:
// 0) lotado neste posto e de folga hoje (a escala oposta do posto);
// 1) lotado neste posto e trabalhando hoje no período oposto (pode estender);
// 2) demais, por necessidade: menos HE no mês (contando o que veio do mês anterior);
// quem já passou do teto vai para o fim; reserva técnica / à disposição ficam por último.
// Ordem: 0 escala oposta do mesmo posto e do mesmo turno (dia/noite) · 1 quem já está no posto hoje (estende)
// · 2 outros GMs do mesmo turno · 3 mesmo posto, turno oposto · 4 o resto. Dentro de cada grupo: abaixo do teto e menos horas.
export function prioridadeHE(x, teto) {
  const grupo = x.doGrupo ? -2 : x.eja ? -1 : x.estende ? (x.noPostoHoje ? -0.6 : -0.5) : x.noPostoHoje ? 1 : x.mesmoPosto && x.mesmoPeriodo ? 0 : x.mesmoPeriodo ? 2 : x.mesmoPosto ? 3 : 4;
  return [x.bloqueado ? 1 : 0, grupo, x.disponivel ? 0 : 1, x.heMes + x.transporte >= teto ? 1 : 0, x.heMes + x.transporte];
}
// dia (07–19) ou noite (19–07) de um horário em minutos
export const periodoDoHorario = (m) => { const x = ((m % 1440) + 1440) % 1440; return x >= 420 && x < 1140 ? "dia" : "noite"; };
export function mesmoPeriodo(data, gm, dia, ini) {
  const eq = data.equipes.find((e) => e.id === vigente(gm, dia).equipe);
  return !!eq?.periodo && eq.periodo === periodoDoHorario(ini);
}
// Vaga de reforço (EJA): quem cobre normalmente é o GM do dia que estende. A HE começa quando o serviço dele termina
// (06–18 → EJA a partir das 18h; 07–19 → a partir das 19h), com a mesma duração do reforço.
export function horarioEja(data, dia, gmId, postoId, ini, fim) {
  const p = data.postos.find((x) => x.id === postoId);
  if (!p?.reforco || secaoOperacao(data, postoId)) return null; // operação tem horário próprio
  const [ri, rf] = intervalo(p.reforco.ini, p.reforco.fim);
  if (sobrepoe(ini, fim, ri, rf) <= 0) return null;
  const d = calcularDia(data, dia).designacoes.filter((x) => x.gm === gmId && x.nat !== "he" && x.nat !== "bh" && x.fim <= ri && ri - x.fim <= 120 && x.ini < ri - 240).sort((a, b) => b.fim - a.fim)[0];
  return d ? [d.fim, d.fim + (fim - ini)] : null;
}
// Horário proposto para um GM numa vaga: EJA a partir do fim do serviço dele; senão, no máximo 6h para quem já trabalha colado.
export function horarioProposto(data, dia, gmId, postoId, ini, fim) {
  return horarioEja(data, dia, gmId, postoId, ini, fim) || limitarExtensao(data, dia, gmId, ini, fim);
}
// Quem já trabalha hoje colado ao horário da vaga só estende 6h (um turno): ninguém faz 12h normais + 12h extras.
export function limitarExtensao(data, dia, gmId, ini, fim, max = 360) {
  if (fim - ini <= max) return [ini, fim];
  const minhas = calcularDia(data, dia).designacoes.filter((d) => d.gm === gmId && d.nat !== "he" && d.nat !== "bh");
  if (minhas.some((d) => d.fim <= ini && ini - d.fim < 60)) return [ini, ini + max];
  if (minhas.some((d) => d.ini >= fim && d.ini - fim < 60)) return [fim - max, fim];
  return [ini, fim];
}
const compararPrioridade = (teto) => (a, b) => {
  const pa = prioridadeHE(a, teto), pb = prioridadeHE(b, teto);
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return a.gm.nome.localeCompare(b.gm.nome);
};
// Posto de outro cargo (ex.: videomonitoramento, operadores que não são guardas): quem é lotado ali só faz HE ali.
// Guardas podem cobrir esse posto normalmente.
export const cargoProprio = (p) => !!p && (p.cargoProprio ?? /VIDEOMONITORAMENTO/i.test(p.nome || ""));
export function podeCobrir(data, gm, dia, postoId) {
  const lot = vigente(gm, dia).lotacao?.posto;
  if (lot === postoId) return true;
  return !cargoProprio(data.postos.find((x) => x.id === lot));
}
// Grupamento de um posto (ex.: motos do GESCOM): o do posto, o da seção, ou o nome da seção marcada como grupamento
export function grupoDoPosto(data, postoId) {
  const p = data.postos.find((x) => x.id === postoId); if (!p) return "";
  const s = (data.secoes || []).find((x) => x.id === p.secao);
  return p.grupo || s?.grupo || s?.nome || "";
}
const normG = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
export const gmDoGrupo = (gm, grupo) => !!grupo && (gm.grupos || []).some((g) => normG(g) === normG(grupo) || normG(grupo).includes(normG(g)));
// Posto existe neste dia? (desativado, extra de um dia só, ou equipe de operação com período)
export const postoAtivoEm = (p, dia) => p.ativo !== false && (!p.so || p.so === dia) && (!p.de || p.de <= dia) && (!p.ate || dia <= p.ate);
// Seção de operação (anexa à escala, com período e horário próprios)
export const secaoOperacao = (data, postoId) => { const p = data.postos.find((x) => x.id === postoId); return p ? (data.secoes || []).find((s) => s.id === p.secao && s.operacao) : null; };
// Duas saídas: remanejar quem está na reserva técnica / à disposição (sem custo) ou chamar HE.
export function sugerir(data, dia, postoId, ini, fim) {
  const mes = mesDe(dia);
  const livro = horasParaSugestao(data, mes);
  const cd = calcularDia(data, dia);
  const reserva = new Set(data.postos.filter((p) => p.tipo === "reserva").map((p) => p.id));
  const livreParaRemanejar = (d) => d.nat !== "he" && d.nat !== "bh" && (d.posto === null || reserva.has(d.posto));
  // numa operação dá para puxar gente da própria escala do dia (o posto de origem fica com vaga)
  const op = secaoOperacao(data, postoId), grupoVaga = grupoDoPosto(data, postoId);
  const daEscala = (d) => op && d.nat !== "he" && d.nat !== "bh" && d.posto && d.posto !== postoId && !secaoOperacao(data, d.posto);
  const remanejar = [], he = [];
  const afastados = new Set(data.ocorrencias.filter((o) => (["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && ocorrenciaCobre(o, dia)) || (DE_UM_DIA.includes(o.tipo) && o.de === dia)).map((o) => o.gm));
  const ontem = calcularDia(data, somaDias(dia, -1)).designacoes;
  const ontemNoite = ontem.filter((d) => d.fim - 1440 > ini && d.ini - 1440 < fim).map((d) => d.gm);
  for (const gm of data.gms) {
    if (gm.ativo === false) continue;
    if (afastados.has(gm.id)) continue;
    if (!podeCobrir(data, gm, dia, postoId)) continue;
    const disponivel = data.ocorrencias.some((o) => o.tipo === "DISP_HE" && o.gm === gm.id && o.de === dia);
    const doGrupo = gmDoGrupo(gm, grupoVaga);
    const minhas = cd.designacoes.filter((d) => d.gm === gm.id);
    const l = livro.get(gm.id) || { he: 0, transporte: 0 };
    const lotPosto = vigente(gm, dia).lotacao?.posto;
    const base = { gm, heMes: l.he, transporte: l.transporte, mesmoPosto: lotPosto === postoId, noPostoHoje: minhas.some((d) => d.posto === postoId && d.nat !== "he"), mesmoPeriodo: !minhas.length && mesmoPeriodo(data, gm, dia, ini), disponivel, doGrupo };
    const sobre = minhas.filter((d) => sobrepoe(d.ini, d.fim, ini, fim) > 0);
    if (sobre.length) {
      if (sobre.every(livreParaRemanejar)) {
        const d = sobre[0];
        remanejar.push({ ...base, origem: d.posto === null ? "À disposição" : data.postos.find((p) => p.id === d.posto)?.nome, ini: d.ini, fim: d.fim });
      } else if (sobre.every(daEscala)) {
        const d = sobre[0];
        remanejar.push({ ...base, origem: data.postos.find((p) => p.id === d.posto)?.nome, ini: d.ini, fim: d.fim, daEscala: true });
      }
      continue;
    }
    if (ontemNoite.includes(gm.id)) continue;
    const teto = (data.config?.tetoHE ?? 60) * 60, total = base.heMes + base.transporte;
    const notas = [];
    const eja = op ? null : horarioEja(data, dia, gm.id, postoId, ini, fim);
    const [ea, eb] = eja || limitarExtensao(data, dia, gm.id, ini, fim);
    // vaga curta (até 6h) colada no serviço dele: quem termina na hora em que ela começa (ou entra quando ela acaba) estende.
    // Vale também para quem trabalhou a noite anterior e sai às 07h (estende de manhã). Em operação, aceita até 2h de intervalo.
    const folga = op ? 120 : 0, regular = (d) => d.nat !== "he" && d.nat !== "bh" && d.posto !== null;
    const colado = fim - ini <= 360 && (minhas.find((d) => regular(d) && ((d.fim <= ini && ini - d.fim <= folga) || (d.ini >= fim && d.ini - fim <= folga)))
      || ontem.find((d) => d.gm === gm.id && regular(d) && d.fim - 1440 <= ini && ini - (d.fim - 1440) <= folga && d.fim > 1440));
    if (colado && !eja) { base.estende = true; if (!base.noPostoHoje) notas.push(colado.dia === "ontem" || ontem.includes(colado) ? `trabalhou a noite · sai às ${fmtHm(colado.fim)} · estende até ${fmtHm(fim)}` : colado.fim <= ini ? `termina às ${fmtHm(colado.fim)} · ${colado.fim === ini ? "estende" : "emenda"} até ${fmtHm(fim)}` : `entra às ${fmtHm(colado.ini)} · começa às ${fmtHm(ini)}`); }
    if (eja) { base.eja = eja; notas.push(`do dia · estende ${fmtHm(eja[0])}–${fmtHm(eja[1])}`); }
    else if (base.mesmoPosto && !base.noPostoHoje) notas.push(base.mesmoPeriodo ? "escala oposta deste posto" : "deste posto · turno oposto");
    else if (base.mesmoPeriodo) notas.push("de folga · mesmo turno");
    if (base.noPostoHoje) notas.push(eb - ea < fim - ini ? `já está neste posto hoje · estende ${fmtHm(ea)}–${fmtHm(eb)}` : "já está neste posto hoje · estende");
    else if (eb - ea < fim - ini && !base.estende) notas.push(`trabalha hoje · estende ${fmtHm(ea)}–${fmtHm(eb)}`);
    if (disponivel) notas.unshift("se ofereceu para HE");
    if (doGrupo) notas.unshift(`do ${grupoVaga}`);
    if (total >= teto) notas.push("já passou do teto de HE");
    else if (total + (fim - ini) > teto) notas.push("vai passar do teto de HE");
    if (gm.naoFazHE) notas.push("não realiza HE");
    he.push({ ...base, notas, bloqueado: !!gm.naoFazHE });
  }
  he.sort(compararPrioridade((data.config?.tetoHE ?? 60) * 60));
  remanejar.sort((a, b) => (a.daEscala ? 1 : 0) - (b.daEscala ? 1 : 0) || (a.origem === "À disposição" ? 0 : 1) - (b.origem === "À disposição" ? 0 : 1) || a.gm.nome.localeCompare(b.gm.nome));
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
      else { x.normal += min; x.bhMenos += d.bhDebito || 0; trabalhouNormal.add(d.gm); if (d.nat === "troca") marca.push("TR"); else marca.push("S"); }
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

// ---------- controle de horas extras ----------
// A escala calcula a HE prevista; o controle só recebe o que foi confirmado ao finalizar a escala do dia,
// e cada lançamento pode ser corrigido depois (o RH é quem sabe se o GM compareceu).
// data.controle: { id, tipo: "FECHADO", dia, quando } e { id, tipo: "HE", dia, gm, min, posto, ini, fim, fixa, manual, obs }
export const diaFinalizado = (data, dia) => (data.controle || []).some((c) => c.tipo === "FECHADO" && c.dia === dia);
// HE do dia como vai para o controle (uma linha por trecho de HE)
export function heDoDia(data, dia) {
  return calcularDia(data, dia).designacoes.filter((d) => d.nat === "he" && d.gm).map((d) => ({
    id: `h${dia.replaceAll("-", "")}${d.id}`, tipo: "HE", dia, gm: d.gm, min: d.fim - d.ini, posto: d.posto, ini: fmtHm(d.ini), fim: fmtHm(d.fim),
    fixa: !!(d.fixa || d.recorrente), req: d.fixa ? "" : d.req || "",
  }));
}
// Dias do mês até `ate` que ainda não foram finalizados
export function diasEmAberto(data, mes, ate) {
  return diasDoMes(mes).filter((d) => d <= ate && !diaFinalizado(data, d));
}
// HE confirmada no controle, com o teto e o que passa para o mês seguinte (mesma regra de livroMes)
export function controleMes(data, mes) {
  const teto = (data.config?.tetoHE ?? 60) * 60, ctl = (data.controle || []).filter((c) => c.tipo === "HE");
  // valores digitados à mão no mês (o controle é só uma referência; o RH é quem fecha)
  const fixo = (tipo, mes, gm) => (data.controle || []).find((c) => c.tipo === tipo && c.mes === mes && c.gm === gm);
  let m = data.config?.mesInicial || mes;
  if (mes < m) m = mes;
  const transporte = new Map(Object.entries(data.config?.transporteInicial || {}).map(([k, v]) => [k, v * 60]));
  let livro;
  for (let guarda = 0; guarda < 240; guarda++) {
    const he = new Map(), fixa = new Map();
    for (const c of ctl) if (c.dia.startsWith(m)) { he.set(c.gm, (he.get(c.gm) || 0) + Number(c.min || 0)); if (c.fixa) fixa.set(c.gm, (fixa.get(c.gm) || 0) + Number(c.min || 0)); }
    livro = new Map();
    for (const gm of data.gms) {
      const ft = fixo("TRANSPORTE", m, gm.id), fp = fixo("PAGA", m, gm.id);
      const anterior = ft ? Number(ft.min) : transporte.get(gm.id) || 0, x = he.get(gm.id) || 0, total = anterior + x;
      const paga = fp ? Math.max(0, Number(fp.min)) : Math.max(0, Math.min(teto, total));
      livro.set(gm.id, { he: x, heFixa: fixa.get(gm.id) || 0, transporte: anterior, total, paga, proximo: Math.max(0, total - paga), manual: { transporte: !!ft, paga: !!fp } });
    }
    if (m >= mes) break;
    for (const [id, l] of livro) transporte.set(id, l.proximo);
    m = mesSeguinte(m);
  }
  return livro;
}
// Horas para escolher quem chamar: o que já está no controle (com as correções) + o previsto nos dias em aberto
const cacheSug = new WeakMap();
export function horasParaSugestao(data, mes) {
  const chave = `${data._versao}|${mes}`, c0 = cacheSug.get(data);
  if (c0?.chave === chave) return c0.r;
  const r0 = horasSugestaoCalc(data, mes); cacheSug.set(data, { chave, r: r0 }); return r0;
}
function horasSugestaoCalc(data, mes) {
  const ctl = controleMes(data, mes), prev = previstaMes(data, mes), r = new Map();
  for (const g of data.gms) { const c = ctl.get(g.id) || {}; r.set(g.id, { he: (c.he || 0) + (prev.get(g.id) || 0), transporte: c.transporte || 0 }); }
  return r;
}
// HE prevista pela escala nos dias do mês que ainda não foram finalizados
export function previstaMes(data, mes) {
  const r = new Map();
  for (const d of diasDoMes(mes)) if (!diaFinalizado(data, d)) for (const h of heDoDia(data, d)) r.set(h.gm, (r.get(h.gm) || 0) + h.min);
  return r;
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
    // posto de reforço (ex.: EJA 19–23) cobre só o horário do reforço
    const [ri, rf] = p.reforco ? intervalo(p.reforco.ini, p.reforco.fim) : [t0.ini, t1.fim];
    out.push({ dia, posto: p.id, per, turnos: fs.map((f) => f.turno), faltam: Math.max(...fs.map((f) => f.faltam)), ini: ri, fim: rf });
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
    const livro = horasParaSugestao(data, mesDe(dia));
    const afast = new Set(data.ocorrencias.filter((o) => (["FERIAS", "LICENCA", "ATESTADO", "CURSO"].includes(o.tipo) && ocorrenciaCobre(o, dia)) || (DE_UM_DIA.includes(o.tipo) && o.de === dia)).map((o) => o.gm));
    const ocup = new Map();
    const marca = (g, a, b) => { if (!ocup.has(g)) ocup.set(g, []); ocup.get(g).push([a, b]); };
    for (const d of cd.designacoes) marca(d.gm, d.ini, d.fim);
    for (const d of calcularDia(data, somaDias(dia, -1)).designacoes) if (d.fim > 1440) marca(d.gm, d.ini - 1440, d.fim - 1440);
    const livres = cd.designacoes.filter((d) => d.nat === "normal" && (d.posto === null || reserva.has(d.posto)));
    const usados = new Set();
    const teto = (data.config?.tetoHE ?? 60) * 60;
    for (const pend of pendencias(data, dia)) for (let k = 0; k < pend.faltam; k++) {
      const fila = [[pend.ini, pend.fim]];
      while (fila.length) {
      const [ini, fim] = fila.shift(), p = { ...pend, ini, fim };
      const mes = mesDe(dia);
      let melhor = null;
      for (const gm of data.gms) {
        if (gm.ativo === false || gm.naoFazHE || afast.has(gm.id) || !podeCobrir(data, gm, dia, p.posto)) continue;
        if ((ocup.get(gm.id) || []).some(([a, b]) => sobrepoe(a, b, p.ini, p.fim) > 0)) continue;
        const l = livro.get(gm.id) || { he: 0, transporte: 0 };
        const x = { gm, heMes: l.he + (heExtra.get(gm.id + mes) || 0), transporte: l.transporte, mesmoPosto: vigente(gm, dia).lotacao?.posto === p.posto,
          noPostoHoje: cd.designacoes.some((d) => d.gm === gm.id && d.posto === p.posto && d.nat !== "he"), bloqueado: false,
          mesmoPeriodo: !cd.designacoes.some((d) => d.gm === gm.id) && mesmoPeriodo(data, gm, dia, p.ini), eja: !!horarioEja(data, dia, gm.id, p.posto, p.ini, p.fim),
          disponivel: data.ocorrencias.some((o) => o.tipo === "DISP_HE" && o.gm === gm.id && o.de === dia), doGrupo: gmDoGrupo(gm, grupoDoPosto(data, p.posto)) };
        if (!melhor || compararPrioridade(teto)(x, melhor) < 0) melhor = x;
      }
      // reserva técnica / à disposição só se ninguém puder fazer HE
      const rv = !melhor && livres.find((d) => !usados.has(d.gm) && sobrepoe(d.ini, d.fim, p.ini, p.fim) >= Math.min(360, p.fim - p.ini));
      if (rv) {
        usados.add(rv.gm);
        plano.push({ dia, posto: p.posto, tipo: "REMANEJ", gm: rv.gm, ini: rv.ini, fim: rv.fim, de: rv.posto === null ? "à disposição" : "reserva técnica" });
        continue;
      }
      if (!melhor) { plano.push({ dia, posto: p.posto, tipo: null, ini: p.ini, fim: p.fim }); continue; }
      // quem já trabalha colado só estende 6h; o resto da vaga vai para outro GM
      const ej = horarioEja(data, dia, melhor.gm.id, p.posto, p.ini, p.fim);
      const [ea, eb] = ej || limitarExtensao(data, dia, melhor.gm.id, p.ini, p.fim);
      if (!ej) { if (ea > p.ini) fila.push([p.ini, ea]); if (eb < p.fim) fila.push([eb, p.fim]); }
      melhor.horas = melhor.heMes + melhor.transporte; melhor.mesmo = melhor.mesmoPosto;
      marca(melhor.gm.id, ea, eb);
      heExtra.set(melhor.gm.id + mes, (heExtra.get(melhor.gm.id + mes) || 0) + eb - ea);
      plano.push({ dia, posto: p.posto, tipo: "HE", gm: melhor.gm.id, ini: ea, fim: eb, horasNoMes: melhor.horas, conhecePosto: !!melhor.mesmo });
      }
    }
  }
  return plano;
}

// Monta o horário fixo a partir de faixas ("07-12 13-19") e das horas de HE fixa por dia:
// as últimas N horas viram hora extra fixa, como no padrão impresso ("13:00/19:00 3HE").
export function montarSegmentos(faixas, heMin = 0) {
  let partes = faixas.map(([i, f]) => intervalo(i, f)).sort((x, y) => x[0] - y[0]);
  if (partes.length && partes[0][0] < 420 && partes.some(([a]) => a >= 900)) partes = partes.map(([a, b]) => (a < 420 ? [a + 1440, b + 1440] : [a, b])).sort((x, y) => x[0] - y[0]);
  const unidos = [];
  for (const [a, b] of partes) { if (unidos.length && a <= unidos.at(-1)[1]) unidos.at(-1)[1] = Math.max(b, unidos.at(-1)[1]); else unidos.push([a, b]); }
  const segs = unidos.map(([a, b]) => ({ a, b, tipo: "normal" }));
  let resto = heMin;
  for (let i = segs.length - 1; i >= 0 && resto > 0; i--) {
    const s = segs[i], dur = s.b - s.a;
    if (dur <= resto) { s.tipo = "he"; resto -= dur; }
    else { segs.splice(i + 1, 0, { a: s.b - resto, b: s.b, tipo: "he" }); s.b -= resto; resto = 0; }
  }
  return segs.map((s) => ({ ini: fmtHm(s.a), fim: fmtHm(s.b), tipo: s.tipo }));
}
// "07-12 13-19" ou "7h às 12h e 13h às 19h" → [["07:00","12:00"],["13:00","19:00"]]
export function lerFaixas(txt) {
  const nums = [...String(txt).matchAll(/(\d{1,2})(?:[:hH.]?(\d{2}))?/g)].map(([, h, m]) => (Number(h) > 24 || Number(m || 0) > 59 ? null : `${String(Number(h) % 24).padStart(2, "0")}:${m || "00"}`));
  if (nums.length < 2 || nums.length % 2 || nums.includes(null)) return null;
  const out = [];
  for (let i = 0; i < nums.length; i += 2) { if (nums[i] === nums[i + 1]) return null; out.push([nums[i], nums[i + 1]]); }
  return out;
}
// Descreve o horário fixo de volta: { faixas: "07:00-12:00 13:00-19:00", heMin: 180 }
export function descreverSegmentos(segs) {
  const parts = segs.map((s) => intervalo(s.ini, s.fim)).sort((x, y) => x[0] - y[0]);
  const heMin = segs.filter((s) => s.tipo === "he").reduce((t, s) => { const [a, b] = intervalo(s.ini, s.fim); return t + b - a; }, 0);
  const unidos = [];
  for (const [a, b] of parts) { if (unidos.length && a === unidos.at(-1)[1]) unidos.at(-1)[1] = b; else unidos.push([a, b]); }
  return { faixas: unidos.map(([a, b]) => `${fmtHm(a)}-${fmtHm(b)}`).join(" "), heMin };
}
