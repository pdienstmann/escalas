// Dados de exemplo — nomes fictícios, estrutura inspirada nas escalas reais.
import { heDoDia, indiceDia, calcularDia, diasDoMes, somaDias, trabalhaNoDia, afastamentoNoDia, intervalo, sobrepoe, TURNOS, mesDe } from "./engine.js";

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const NOMES = ["ABREU","ACOSTA","AGUIAR","ALBRECHT","AMORIM","ANSCHAU","ARRUDA","AVILA","BACKES","BAIRROS","BARBOSA","BAUER","BECKER","BERNDT","BEHLING","BOEIRA","BORBA","BRAGA","BRITO","BUENO","CABRAL","CAMPOS","CANDIDO","CAPELLARI","CARNEIRO","CASTRO","CHAVES","COSTA","COUTO","DALMOLIN","DAMASCENO","DIAS","DUARTE","EBERT","ESPINDOLA","FAGUNDES","FARIAS","FELDENS","FIGUEIRO","FISCHER","FOGAÇA","FRANCO","FREITAS","GAMA","GEHLEN","GODOY","GOMES","GRAEFF","HAUBERT","HECK","HOFFMANN","IORA","JARDIM","JUNG","KAEFER","KELLER","KLEIN","KNEBEL","KONZEN","KRAEMER","KUNZ","LACERDA","LANG","LEAL","LOPES","LUZ","MACIEL","MAGALHÃES","MALLMANN","MENDES","MENEGHETTI","MOTA","MULLER","NASCIMENTO","NEUMANN","NOGUEIRA","OSORIO","PACHECO","PAIM","PAZ","PEIXOTO","PERES","PINHEIRO","PORTO","PRESTES","QUADROS","RAMOS","RECH","REIS","RITTER","ROSSI","RUSCHEL","SAMPAIO","SCHAEFER","SCHMITT","SCHNEIDER","SCHUCH","SEIBEL","SOARES","SPOHR","STEIN","STRECK","TAVARES","TEIXEIRA","TOLEDO","TRINDADE","VARGAS","VEIGA","VENTURA","VOGT","WEBER","WEIZENMANN","WERLE","WOLF","XAVIER","ZANATTA","ZIMMER","ZORZO","BRUM","CORREA","FONTANA","GIRARDI","HAAS"];

export function criarExemplo() {
  const r = rng(20261126);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  const equipes = [
    { id: "D1", nome: "Diurno 1", tipo: "alternado", paridade: 0, periodo: "dia", inspetor: "INSP. TOLEDO" },
    { id: "D2", nome: "Diurno 2", tipo: "alternado", paridade: 1, periodo: "dia", inspetor: "INSP. RITTER" },
    { id: "N1", nome: "Noturno 1", tipo: "alternado", paridade: 0, periodo: "noite", inspetor: "INSP. PAIM" },
    { id: "N2", nome: "Noturno 2", tipo: "alternado", paridade: 1, periodo: "noite", inspetor: "INSP. GODOY" },
    { id: "SEM", nome: "Semanal / expediente", tipo: "semanal", periodo: "dia" },
  ];

  const secoes = [
    { id: "sede", nome: "SEDE DA GM" },
    { id: "cad", nome: "CENTRO ADMINISTRATIVO" },
    { id: "pracas", nome: "PRAÇAS E PARQUES" },
    { id: "diversos", nome: "POSTOS DIVERSOS" },
    { id: "vtr", nome: "VTR" },
    { id: "za", nome: "ZA PATRULHAMENTO A PÉ" },
    { id: "motos", nome: "MOTOS · ÁREA CENTRAL" },
    { id: "vtrn", nome: "VTR NOITE" },
    { id: "reserva", nome: "RESERVA TÉCNICA" },
    { id: "monit", nome: "MONITORAMENTO" },
  ];

  const T = (a, b, c, d) => ({ t2: a, t3: b, t4: c, t1: d });
  const postos = [
    { id: "sala", secao: "sede", nome: "SALA OPERAÇÕES", vagas: T(3, 3, 2, 2) },
    { id: "arm", secao: "sede", nome: "RESERVA DE ARMAMENTO", vagas: T(1, 1, 1, 1) },
    { id: "guarita", secao: "sede", nome: "ACESSO OPERACIONAL (GUARITA)", vagas: T(1, 1, 1, 1) },
    { id: "acesso", secao: "cad", nome: "ACESSO PRINCIPAL", vagas: T(1, 1, 1, 1) },
    { id: "portaria", secao: "cad", nome: "PORTARIA 2º PISO", vagas: T(1, 1, 0, 0), dias: [1, 2, 3, 4, 5], obs: "SEG A SEX" },
    { id: "estac", secao: "cad", nome: "ESTACIONAMENTO", rondas: true },
    { id: "juventude", secao: "pracas", nome: "PRAÇA DA JUVENTUDE", vagas: T(1, 1, 1, 1) },
    { id: "ceu", secao: "pracas", nome: "PRAÇA CÉU", vagas: T(1, 1, 1, 1) },
    { id: "floresta", secao: "pracas", nome: "PARQUE FLORESTA IMPERIAL", rondas: true, obs: "SEG A SEX" },
    { id: "parcao", secao: "pracas", nome: "PARCÃO HENRIQUE ROESLER", vagas: T(2, 2, 2, 2) },
    { id: "rodov", secao: "diversos", nome: "RODOVIÁRIA", vagas: T(1, 1, 0, 0) },
    { id: "cer", secao: "diversos", nome: "CER (R. BAHIA LADO USF)", vagas: T(1, 1, 1, 1) },
    { id: "lar", secao: "diversos", nome: "LAR DA MENINA", vagas: T(1, 1, 1, 1) },
    { id: "hosp", secao: "diversos", nome: "HOSPITAL MUNICIPAL", vagas: T(1, 1, 0, 0), dias: [1, 2, 3, 4, 5], obs: "SEG A SEX" },
    { id: "upac", secao: "diversos", nome: "UPA CENTRO", vagas: T(1, 1, 1, 1) },
    { id: "upacan", secao: "diversos", nome: "UPA CANUDOS", vagas: T(1, 1, 1, 1) },
    { id: "centropop", secao: "diversos", nome: "CENTRO POP", rondas: true },
    { id: "ubs", secao: "diversos", nome: "UBS SANTO AFONSO", rondas: true },
    { id: "emef1", secao: "diversos", nome: "EMEF BOA SAÚDE · EJA", rondas: true, obs: "SEG A SEX", reforco: { ini: "19:00", fim: "23:00" }, vagas: { t4: 1 }, dias: [1, 2, 3, 4, 5] },
    { id: "emef2", secao: "diversos", nome: "EMEF ARNALDO GRIN", rondas: true },
    { id: "bombas", secao: "diversos", nome: "CASA DE BOMBAS", vagas: T(0, 0, 1, 1) },
    { id: "v1319", secao: "vtr", nome: "VTR 1319", sub: "B3 DIA · INSPETOR DE SERVIÇO", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "v1317", secao: "vtr", nome: "VTR 1317", sub: "CANUDOS 1", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "v1320", secao: "vtr", nome: "VTR 1320", sub: "CENTRO", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "v1321", secao: "vtr", nome: "VTR 1321", sub: "SANTO AFONSO", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "v1281", secao: "vtr", nome: "VTR 1281", sub: "CANUDOS 2", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "v1301", secao: "vtr", nome: "VTR 1301", sub: "CENTRO 2", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "v1272", secao: "vtr", nome: "VTR 1272", sub: "CENTRO 3", tipo: "vtr", vagas: T(2, 2, 0, 0) },
    { id: "punta", secao: "za", nome: "PRAÇA PUNTA DEL ESTE", sub: "reforço · só HE" },
    { id: "imigrante", secao: "za", nome: "PRAÇA DO IMIGRANTE", sub: "reforço · só HE" },
    { id: "mt638", secao: "motos", nome: "MT 638", tipo: "moto", vagas: T(1, 1, 0, 0) },
    { id: "mt631", secao: "motos", nome: "MT 631", tipo: "moto", vagas: T(1, 1, 0, 0) },
    { id: "mt639", secao: "motos", nome: "MT 639", tipo: "moto", vagas: T(1, 1, 0, 0) },
    { id: "mt646", secao: "motos", nome: "MT 646", tipo: "moto", vagas: T(1, 1, 0, 0) },
    { id: "n1319", secao: "vtrn", nome: "NOITE VTR 1319", sub: "B3 NOITE · INSPETOR DE SERVIÇO", tipo: "vtr", vagas: T(0, 0, 2, 2) },
    { id: "n1318", secao: "vtrn", nome: "NOITE VTR 1318", sub: "NOITE CENTRO", tipo: "vtr", vagas: T(0, 0, 2, 2) },
    { id: "n1321", secao: "vtrn", nome: "NOITE VTR 1321", sub: "NOITE CANUDOS", tipo: "vtr", vagas: T(0, 0, 2, 2) },
    { id: "n1317", secao: "vtrn", nome: "NOITE VTR 1317", sub: "NOITE SANTO AFONSO", tipo: "vtr", vagas: T(0, 0, 2, 2) },
    { id: "n1320", secao: "vtrn", nome: "NOITE VTR 1320", sub: "NOITE CENTRO 2", tipo: "vtr", vagas: T(0, 0, 2, 2) },
    { id: "monit", secao: "monit", nome: "VIDEOMONITORAMENTO", obs: "SEG A SEX" },
    { id: "reserva", secao: "reserva", nome: "RESERVA TÉCNICA", sub: "cobre faltas · não ocupa posto", tipo: "reserva" },
  ];

  const DIA = [{ ini: "07:00", fim: "19:00", tipo: "normal" }];
  const NOITE = [{ ini: "19:00", fim: "07:00", tipo: "normal" }];
  const vagasDia = ["sala", "sala", "sala", "arm", "guarita", "acesso", "juventude", "ceu", "parcao", "parcao", "rodov", "cer", "lar", "upac", "upacan",
    ...["v1319", "v1317", "v1320", "v1321", "v1281", "v1301", "v1272"].flatMap((v) => [[v, "Motorista"], [v, "Patrulheiro"]]),
    "mt638", "mt631", "mt639", "mt646", "reserva"];
  const vagasNoite = ["sala", "sala", "arm", "guarita", "acesso", "juventude", "ceu", "parcao", "parcao", "cer", "lar", "upac", "upacan", "bombas",
    ...["n1319", "n1318", "n1321", "n1317", "n1320"].flatMap((v) => [[v, "Motorista"], [v, "Patrulheiro"]]), "reserva"];

  const nomes = [...NOMES];
  const gms = [];
  let n = 0;
  const novoGm = (equipe, lotacao, extra = {}) => {
    const nome = nomes.splice(Math.floor(r() * nomes.length), 1)[0];
    gms.push({ id: `g${++n}`, nome, matricula: String(1000 + Math.floor(r() * 8999)), equipe, lotacao, ...extra });
  };
  for (const eq of ["D1", "D2"]) for (const v of vagasDia) {
    const [posto, funcao] = Array.isArray(v) ? v : [v, ""];
    // deixa algumas vagas sem titular para gerar furos realistas
    if (eq === "D2" && (posto === "rodov" || (posto === "v1301" && funcao === "Patrulheiro"))) continue;
    novoGm(eq, { posto, funcao, segmentos: DIA });
  }
  for (const eq of ["N1", "N2"]) for (const v of vagasNoite) {
    const [posto, funcao] = Array.isArray(v) ? v : [v, ""];
    if (eq === "N1" && posto === "lar") continue;
    novoGm(eq, { posto, funcao, segmentos: posto === "bombas" ? [{ ini: "18:00", fim: "06:00", tipo: "normal" }] : NOITE });
  }
  novoGm("SEM", { posto: "portaria", funcao: "", segmentos: [{ ini: "06:00", fim: "12:00", tipo: "normal" }] });
  novoGm("SEM", { posto: "portaria", funcao: "", segmentos: [{ ini: "12:00", fim: "18:00", tipo: "normal" }] });
  novoGm("SEM", { posto: "hosp", funcao: "", segmentos: [{ ini: "07:00", fim: "12:00", tipo: "normal" }, { ini: "13:00", fim: "16:00", tipo: "normal" }, { ini: "16:00", fim: "18:00", tipo: "he" }] }, { obs: "HE fixa de 2h por dia" });
  novoGm("SEM", { posto: "monit", funcao: "Operador", segmentos: [{ ini: "13:30", fim: "17:30", tipo: "normal" }, { ini: "18:30", fim: "22:30", tipo: "normal" }] });
  novoGm("SEM", { posto: "monit", funcao: "Operador", segmentos: [{ ini: "22:30", fim: "01:00", tipo: "normal" }, { ini: "02:00", fim: "06:00", tipo: "normal" }] });
  gms[7].naoFazHE = true; gms[7].obs = "Não realiza HE (restrição médica)";
  gms[40].naoFazHE = true;

  const ref = "2026-11-26";
  const data = {
    config: { ancora: { data: ref, equipes: equipes.filter((e) => e.tipo === "alternado" && ((indiceDia(ref) % 2) + 2) % 2 === e.paridade).map((e) => e.id) }, tetoHE: 60, mesInicial: "2026-10", cabecalho: "GUARDA MUNICIPAL · SEÇÃO DE ESCALA", transporteInicial: {} },
    equipes, secoes, postos, gms, ocorrencias: [], _versao: 0,
  };
  let oid = 0;
  const add = (o) => { data.ocorrencias.push({ id: `x${++oid}`, ...o }); };
  const alternados = gms.filter((g) => data.equipes.find((e) => e.id === g.equipe).tipo === "alternado");
  const fim = "2026-12-31";
  const dias = [...diasDoMes("2026-10"), ...diasDoMes("2026-11"), ...diasDoMes("2026-12")];

  // Afastamentos longos
  const ferias = [["2026-10-05", "2026-10-19"], ["2026-10-12", "2026-11-10"], ["2026-11-02", "2026-11-16"], ["2026-11-16", "2026-12-15"],
    ["2026-11-20", "2026-12-04"], ["2026-11-23", "2026-12-07"], ["2026-12-01", "2026-12-30"], ["2026-12-18", "2027-01-16"], ["2026-12-18", "2027-01-01"], ["2026-10-20", "2026-11-03"], ["2026-11-25", "2026-12-24"]];
  const usados = new Set();
  const sorteiaGm = (filtro = () => true) => { for (let i = 0; i < 500; i++) { const g = pick(alternados); if (!usados.has(g.id) && filtro(g)) { usados.add(g.id); return g; } } return pick(alternados); };
  for (const [de, ate] of ferias) add({ tipo: "FERIAS", gm: sorteiaGm().id, de, ate, req: String(1400 + Math.floor(r() * 400)) });
  add({ tipo: "LICENCA", gm: sorteiaGm().id, de: "2026-09-08", ate: "2027-03-08", obs: "Licença interesse" });
  add({ tipo: "LICENCA", gm: sorteiaGm().id, de: "2026-11-11", ate: "2027-01-11", obs: "Licença saúde" });
  for (const [de, ate] of [["2026-10-14", "2026-10-17"], ["2026-11-03", "2026-11-05"], ["2026-11-24", "2026-11-28"], ["2026-12-02", "2026-12-04"]])
    add({ tipo: "ATESTADO", gm: sorteiaGm().id, de, ate });
  add({ tipo: "CURSO", gm: sorteiaGm().id, de: "2026-11-23", ate: "2026-11-27", obs: "Curso de tiro" });

  // Folgas: duas por mês para quem é 12x36 (em dezembro, alguns ainda sem a segunda)
  for (const mes of ["2026-10", "2026-11", "2026-12"]) for (const g of alternados) {
    const ds = diasDoMes(mes).filter((d) => trabalhaNoDia(data, g, d) && !afastamentoNoDia(data, g.id, d));
    const qtd = mes === "2026-12" && r() < 0.3 ? 1 : 2;
    for (let i = 0; i < qtd && ds.length; i++) add({ tipo: "FOLGA", gm: g.id, de: ds.splice(Math.floor(r() * ds.length), 1)[0] });
  }

  // Banco de horas, trocas, remanejamentos
  for (let i = 0; i < 6; i++) { const g = pick(alternados); const ds = dias.filter((d) => trabalhaNoDia(data, g, d) && !afastamentoNoDia(data, g.id, d)); add({ tipo: "BH_COMP", gm: g.id, de: pick(ds), req: String(1400 + Math.floor(r() * 400)) }); }
  for (let i = 0; i < 6; i++) {
    const g = pick(alternados); const eq = data.equipes.find((e) => e.id === g.equipe);
    const par = gms.filter((x) => { const e = data.equipes.find((q) => q.id === x.equipe); return e.tipo === "alternado" && e.periodo === eq.periodo && e.id !== eq.id; });
    const ds = dias.filter((d) => trabalhaNoDia(data, g, d) && !afastamentoNoDia(data, g.id, d));
    add({ tipo: "TROCA", gm: g.id, substituto: pick(par).id, de: pick(ds), req: String(1400 + Math.floor(r() * 400)) });
  }
  add({ tipo: "REMANEJ", gm: gms.find((g) => g.lotacao.posto === "mt646").id, de: "2026-11-26", ate: "2026-11-30", posto: "v1301", funcao: "Patrulheiro", obs: "Moto em revisão" });
  add({ tipo: "FA", posto: "v1281", de: "2026-11-24", ate: "2026-11-30", obs: "Aguardando peça (embreagem)" });

  // Reforço de ZA só com HE, e três GMs que fazem muita HE (para mostrar o teto de 60h e o transporte)
  const avidos = [gms[20], gms[75], gms[52]];
  data.config.transporteInicial[avidos[0].id] = 14;
  for (const d of dias) {
    if (d > "2026-11-29") break;
    const ds = new Date(d + "T12:00:00Z").getUTCDay();
    if (ds === 5 || ds === 6) for (const [i, posto] of [[0, "punta"], [1, "punta"], [2, "imigrante"]]) {
      const g = avidos[i];
      if (!afastamentoNoDia(data, g.id, d) && !trabalhaNoDia(data, g, d)) add({ tipo: "HE", gm: g.id, de: d, ini: "10:00", fim: "19:00", posto, req: "OS 7792" });
    }
  }

  // Escalante cobrindo furos com HE até 29/11 (os dias seguintes ficam em aberto)
  const heMes = new Map();
  const conta = (g, d, min) => { const k = g + mesDe(d); heMes.set(k, (heMes.get(k) || 0) + min); };
  for (const d of dias) {
    if (d > "2026-11-29") break;
    data._versao++;
    const cd = calcularDia(data, d);
    const ontem = calcularDia(data, somaDias(d, -1));
    const ocup = new Map();
    const marca = (g, a, b) => { if (!ocup.has(g)) ocup.set(g, []); ocup.get(g).push([a, b]); };
    for (const x of cd.designacoes) marca(x.gm, x.ini, x.fim);
    for (const x of ontem.designacoes) if (x.fim > 1440) marca(x.gm, x.ini - 1440, x.fim - 1440);
    const afastHoje = new Set(gms.filter((g) => afastamentoNoDia(data, g.id, d)).map((g) => g.id));
    const pedidos = [];
    for (const f of cd.furos) for (let k = 0; k < f.faltam; k++) pedidos.push({ ...f });
    // primeiro a reserva técnica: remaneja para o posto descoberto, sem HE
    for (const rv of cd.designacoes.filter((x) => x.posto === "reserva")) {
      if (r() < (d >= "2026-11-26" ? 0.7 : 0.2)) continue;
      const turnos = rv.ini < 1140 ? ["t2", "t3"] : ["t4", "t1"];
      const p = pedidos.find((x) => !x.usado && x.turno === turnos[0]);
      if (!p) continue;
      p.usado = true;
      const p2 = pedidos.find((x) => !x.usado && x.posto === p.posto && x.turno === turnos[1]);
      if (p2) p2.usado = true;
      add({ tipo: "REMANEJ", gm: rv.gm, de: d, ate: d, posto: p.posto, obs: "Da reserva técnica" });
    }
    // junta 2º+3º e 4º+1º do mesmo posto em serviços de 12h quando sorteado
    const vistos = new Set();
    for (const f of pedidos) {
      if (f.usado) continue;
      if (r() < (d >= "2026-11-26" ? 0.55 : 0.1)) continue; // alguns furos ficam descobertos (mais nos próximos dias)
      const t = TURNOS.find((x) => x.id === f.turno);
      let [a, b] = [t.ini, t.fim];
      const parId = { t2: "t3", t3: null, t4: "t1", t1: null }[f.turno];
      const chave = f.posto + f.turno + vistos.size;
      if (parId && r() < 0.5 && pedidos.some((p) => p.posto === f.posto && p.turno === parId && !p.usado)) {
        const p = pedidos.find((p) => p.posto === f.posto && p.turno === parId && !p.usado); p.usado = true;
        b = TURNOS.find((x) => x.id === parId).fim;
      }
      vistos.add(chave);
      const cands = gms.filter((g) => !g.naoFazHE && !afastHoje.has(g.id) && !(ocup.get(g.id) || []).some(([x, y]) => sobrepoe(x, y, a - 60, b + 60) > 0) && !avidos.includes(g));
      if (!cands.length) continue;
      cands.sort((x, y) => (heMes.get(x.id + mesDe(d)) || 0) - (heMes.get(y.id + mesDe(d)) || 0) + (r() - 0.5) * 600);
      const g = cands[0];
      const fmt = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:00`;
      add({ tipo: "HE", gm: g.id, de: d, ini: fmt(a), fim: fmt(b), posto: f.posto, funcao: "", req: r() < 0.85 ? String(1100 + Math.floor(r() * 500)) : "" });
      marca(g.id, ...intervalo(fmt(a), fmt(b)));
      conta(g.id, d, b - a);
    }
  }
  // BH+ (serviço extra creditado no banco)
  for (const [d, posto] of [["2026-11-06", "n1318"], ["2026-11-14", "n1320"], ["2026-11-21", "n1317"]]) {
    data._versao++;
    const cd = calcularDia(data, d);
    const livres = gms.filter((g) => !g.naoFazHE && !afastamentoNoDia(data, g.id, d) && !cd.designacoes.some((x) => x.gm === g.id) && g.equipe.startsWith("N"));
    add({ tipo: "BH_MAIS", gm: pick(livres).id, de: d, ini: "19:00", fim: "01:00", posto, req: String(1400 + Math.floor(r() * 400)) });
  }
  void fim;
  data._versao++;
  // frota da logística (exemplo): as viaturas dos postos + algumas fora de uso
  const modeloDe = (p) => (p.tipo === "moto" ? "XRE300" : /^\D*12/.test(p.nome) ? "COBALT" : "DUSTER");
  const vistos = new Set();
  data.frota = [];
  for (const p of data.postos.filter((x) => x.tipo === "vtr" || x.tipo === "moto")) {
    const n = (p.nome.match(/\b(\d{3,4})\b/) || [])[1];
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    data.frota.push({ id: `fr${n}`, prefixo: n, modelo: modeloDe(p), situacao: "QAP", finalidade: p.sub ? p.sub.split(" · ")[0] : "Convencional", guarnicao: "" });
  }
  data.frota.push(
    { id: "fr1296", prefixo: "1296", modelo: "COBALT", situacao: "FA", finalidade: "Administrativo", guarnicao: "" },
    { id: "fr1323", prefixo: "1323", modelo: "COBALT", situacao: "FAP", finalidade: "", guarnicao: "" },
    { id: "fr521", prefixo: "521", modelo: "VAN", situacao: "FAP", finalidade: "", guarnicao: "" },
    { id: "fr522", prefixo: "522", modelo: "VAN", situacao: "QAP", finalidade: "Transporte", guarnicao: "" },
    { id: "fr1303", prefixo: "1303", modelo: "L200", situacao: "QAP", finalidade: "Gescom", guarnicao: "" },
  );
  const f1320 = data.frota.find((v) => v.prefixo === "1320"); if (f1320) Object.assign(f1320, { situacao: "FA", finalidade: "Oficina" });
  // escala mensal dos inspetores de serviço (exemplo, rodízio de 3)
  data.config.rodizioInsp = { dia: ["MOREIRA", "TEIXEIRA", "CAMPOS"], noite: ["VIEIRA", "PINTO", "ROCHA"] };
  data.inspetores = {};
  diasDoMes("2026-11").forEach((d, i) => { data.inspetores[d] = { dia: data.config.rodizioInsp.dia[i % 3], noite: data.config.rodizioInsp.noite[i % 3] }; });
  // escalas já finalizadas até o dia anterior a 26/11: a HE delas está no controle
  data.controle = [];
  for (let d = (data.config.mesInicial || "2026-11") + "-01"; d < "2026-11-26"; d = somaDias(d, 1)) {
    data.controle.push({ id: `f${d.replaceAll("-", "")}`, tipo: "FECHADO", dia: d, quando: d + "T08:00:00.000Z" }, ...heDoDia(data, d));
  }
  // exemplo de correção do RH: um GM não compareceu a uma HE
  const corr = data.controle.find((c) => c.tipo === "HE" && !c.fixa && c.dia >= "2026-11-10");
  if (corr) Object.assign(corr, { min: 0, editado: true, obs: "RH: não compareceu" });
  data._versao++;
  return data;
}
