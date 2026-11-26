import test from "node:test";
import assert from "node:assert/strict";
import { calcularDia, livroMes, resumoMes, intervalo, sugerir, saldoBH, minutosNoturnos, planejarCobertura } from "./engine.js";
import { criarExemplo } from "./seed.js";

const base = () => ({
  config: { tetoHE: 60, mesInicial: "2026-11" },
  equipes: [
    { id: "D1", tipo: "alternado", paridade: 0 }, { id: "D2", tipo: "alternado", paridade: 1 },
    { id: "N1", tipo: "alternado", paridade: 0 }, { id: "SEM", tipo: "semanal" },
  ],
  postos: [
    { id: "vtr", nome: "VTR 1317", vagas: { t2: 2, t3: 2 } },
    { id: "noite", nome: "NOITE VTR 1318", vagas: { t4: 1, t1: 1 } },
    { id: "hosp", nome: "HOSPITAL", vagas: { t2: 1, t3: 1 } },
  ],
  gms: [
    { id: "a", nome: "A", equipe: "D1", lotacao: { posto: "vtr", funcao: "Motorista", segmentos: [{ ini: "07:00", fim: "19:00" }] } },
    { id: "b", nome: "B", equipe: "D1", lotacao: { posto: "vtr", funcao: "Patrulheiro", segmentos: [{ ini: "07:00", fim: "19:00" }] } },
    { id: "c", nome: "C", equipe: "D2", lotacao: { posto: "vtr", funcao: "Motorista", segmentos: [{ ini: "07:00", fim: "19:00" }] } },
    { id: "n", nome: "N", equipe: "N1", lotacao: { posto: "noite", segmentos: [{ ini: "19:00", fim: "07:00" }] } },
    { id: "h", nome: "H", equipe: "SEM", lotacao: { posto: "hosp", segmentos: [{ ini: "07:00", fim: "12:00" }, { ini: "13:00", fim: "16:00" }, { ini: "16:00", fim: "18:00", tipo: "he" }] } },
  ],
  ocorrencias: [], _versao: 0,
});
// 2026-11-26 tem índice par? descobre o dia de D1
function diaDe(data, eq) { for (let d = 1; d < 5; d++) { const s = `2026-11-0${d}`; if (calcularDia(data, s).designacoes.some((x) => data.gms.find((g) => g.id === x.gm).equipe === eq)) return s; } }

test("intervalos atravessam a meia-noite", () => {
  assert.deepEqual(intervalo("19:00", "07:00"), [1140, 1860]);
  assert.deepEqual(intervalo("19:00", "01:00"), [1140, 1500]);
  assert.deepEqual(intervalo("01:00", "07:00"), [1500, 1860]);
  assert.deepEqual(intervalo("06:00", "12:00"), [360, 720]);
  assert.deepEqual(intervalo("18:00", "06:00"), [1080, 1800]);
  assert.equal(minutosNoturnos(1140, 1860), 420); // 22h–05h
});

test("12x36 alterna dias e folga retira o GM e abre furo", () => {
  const data = base();
  const d = diaDe(data, "D1");
  let cd = calcularDia(data, d);
  assert.equal(cd.furos.filter((f) => f.posto === "vtr").length, 0);
  data.ocorrencias.push({ id: "f", tipo: "FOLGA", gm: "a", de: d }); data._versao++;
  cd = calcularDia(data, d);
  assert.ok(!cd.designacoes.some((x) => x.gm === "a"));
  assert.deepEqual(cd.furos.filter((f) => f.posto === "vtr").map((f) => f.turno), ["t2", "t3"]);
  assert.equal(cd.afastados[0].tipo, "FOLGA");
});

test("HE cobre o furo, conta só no turno certo e soma no livro", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "f", tipo: "FOLGA", gm: "a", de: d }, { id: "he", tipo: "HE", gm: "c", de: d, ini: "07:00", fim: "13:00", posto: "vtr" });
  data._versao++;
  const cd = calcularDia(data, d);
  assert.deepEqual(cd.furos.filter((f) => f.posto === "vtr").map((f) => f.turno), ["t3"]);
  const l = livroMes(data, "2026-11").get("c");
  assert.equal(l.he, 360);
});

test("HE fixa da escala semanal: 2h por dia útil", () => {
  const data = base();
  const r = resumoMes(data, "2026-11").get("h");
  assert.equal(r.servicos, 21);            // dias úteis de nov/2026
  assert.equal(r.heFixa, 21 * 120);
  assert.equal(r.normal, 21 * 8 * 60);
});

test("teto de 60h pagas: excedente vai para o mês seguinte", () => {
  const data = base();
  for (let i = 1; i <= 10; i++) data.ocorrencias.push({ id: "h" + i, tipo: "HE", gm: "n", de: `2026-11-${String(i * 2).padStart(2, "0")}`, ini: "07:00", fim: "15:00", posto: "vtr" });
  data._versao++;
  const nov = livroMes(data, "2026-11").get("n");
  assert.equal(nov.he, 80 * 60); assert.equal(nov.paga, 60 * 60); assert.equal(nov.proximo, 20 * 60);
  const dez = livroMes(data, "2026-12").get("n");
  assert.equal(dez.transporte, 20 * 60); assert.equal(dez.paga, 20 * 60); assert.equal(dez.proximo, 0);
});

test("troca: substituto assume o serviço sem gerar HE", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "t", tipo: "TROCA", gm: "a", substituto: "c", de: d }); data._versao++;
  const cd = calcularDia(data, d);
  const x = cd.designacoes.find((x) => x.gm === "c");
  assert.equal(x.nat, "troca"); assert.equal(x.posto, "vtr");
  assert.equal(livroMes(data, "2026-11").get("c").he, 0);
});

test("viatura em FA manda a guarnição para à disposição", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "fa", tipo: "FA", posto: "vtr", de: d }); data._versao++;
  const cd = calcularDia(data, d);
  assert.equal(cd.disposicao.length, 2);
  assert.ok(!cd.furos.some((f) => f.posto === "vtr"));
});

test("sugestão: reserva técnica primeiro (remanejar), depois HE por menos horas", () => {
  const data = base();
  data.postos.push({ id: "res", nome: "RESERVA TÉCNICA", tipo: "reserva" });
  data.gms.push({ id: "r", nome: "R", equipe: "D1", lotacao: { posto: "res", segmentos: [{ ini: "07:00", fim: "19:00" }] } });
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "f", tipo: "FOLGA", gm: "a", de: d }); data._versao++;
  assert.ok(!calcularDia(data, d).furos.some((f) => f.posto === "res"), "reserva não gera furo");
  const s = sugerir(data, d, "vtr", 420, 780);
  assert.deepEqual(s.remanejar.map((x) => x.gm.id), ["r"]);
  assert.ok(!s.he.some((x) => ["a", "b", "r"].includes(x.gm.id)));
  assert.equal(s.he[0].gm.id, "c"); // mesmo posto, outra equipe
  data.ocorrencias.push({ id: "rm", tipo: "REMANEJ", gm: "r", de: d, ate: d, posto: "vtr" }); data._versao++;
  assert.ok(!calcularDia(data, d).furos.some((f) => f.posto === "vtr"));
  assert.equal(livroMes(data, "2026-11").get("r").he, 0);
});

test("alternância definida por um único dia de referência", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.config.ancora = { data: d, equipes: ["D2"] }; data._versao++;
  const eq = calcularDia(data, d).designacoes.map((x) => data.gms.find((g) => g.id === x.gm).equipe);
  assert.ok(eq.includes("D2") && !eq.includes("D1"));
  const amanha = calcularDia(data, d.slice(0, 8) + String(Number(d.slice(8)) + 1).padStart(2, "0")).designacoes.map((x) => data.gms.find((g) => g.id === x.gm).equipe);
  assert.ok(amanha.includes("D1") && !amanha.includes("D2"));
});

test("banco de horas: crédito menos compensação", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "bh", tipo: "BH_MAIS", gm: "c", de: d, ini: "19:00", fim: "01:00", posto: "noite" }, { id: "bc", tipo: "BH_COMP", gm: "c", de: "2026-11-20" });
  data._versao++;
  assert.equal(saldoBH(data, "c", "2026-11"), 360 - (calcularDia(data, "2026-11-20").afastados.find((a) => a.gm === "c")?.minutos || 0));
});

test("dados de exemplo geram escala consistente", () => {
  const t0 = Date.now();
  const data = criarExemplo();
  const ms = Date.now() - t0;
  const cd = calcularDia(data, "2026-11-26");
  assert.ok(cd.designacoes.length > 40);
  const livro = livroMes(data, "2026-11");
  const acima = [...livro.values()].filter((l) => l.total > 3600);
  assert.ok(acima.length >= 1, "algum GM passa do teto");
  console.log(`seed ${ms}ms, ${data.gms.length} GMs, ${data.ocorrencias.length} ocorrências, furos 26/11: ${cd.furos.length}, alertas: ${cd.alertas.length}`);
});

test("horário alterado: o que passa do normal vira HE sozinho", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "h1", tipo: "HORARIO", gm: "a", de: d, alvo: "420-1140", ini: "07:00", fim: "21:00" }); data._versao++;
  const des = calcularDia(data, d).designacoes.filter((x) => x.gm === "a");
  assert.deepEqual(des.map((x) => [x.ini, x.fim, x.nat]), [[420, 1140, "normal"], [1140, 1260, "he"]]);
  assert.equal(livroMes(data, "2026-11").get("a").he, 120);
  data.ocorrencias[0].ini = "09:00"; data.ocorrencias[0].fim = "19:00"; data._versao++;
  const r = calcularDia(data, d).designacoes.filter((x) => x.gm === "a");
  assert.deepEqual(r.map((x) => [x.ini, x.fim, x.nat]), [[540, 1140, "normal"]]);
});

test("falta retira o GM e o planejador cobre a semana sem repetir pessoas", () => {
  const data = base();
  data.postos.push({ id: "res", nome: "RESERVA", tipo: "reserva" });
  data.gms.push({ id: "r", nome: "R", equipe: "D1", lotacao: { posto: "res", segmentos: [{ ini: "07:00", fim: "19:00" }] } });
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "f1", tipo: "FALTA", gm: "a", de: d }, { id: "f2", tipo: "FOLGA", gm: "b", de: d }); data._versao++;
  const plano = planejarCobertura(data, [d]).filter((x) => x.posto === "vtr");
  assert.equal(plano.length, 2);
  // primeiro quem é do posto e está de folga (escala oposta); reserva técnica só por último
  assert.deepEqual([plano[0].tipo, plano[0].gm], ["HE", "c"]);
  assert.equal(plano[1].tipo, "HE");
  // sem ninguém livre para HE, aí sim a reserva técnica
  for (const g of data.gms) if (!["r", "a", "b"].includes(g.id)) g.naoFazHE = true;
  data._versao++;
  const p2 = planejarCobertura(data, [d]).filter((x) => x.posto === "vtr");
  assert.equal(p2[0].tipo, "REMANEJ"); assert.equal(p2[0].gm, "r");
});

test("lotação com vigência: mudar de posto não reescreve o passado", () => {
  const data = base();
  const d = diaDe(data, "D1");
  const depois = d.slice(0, 8) + String(Number(d.slice(8)) + 2).padStart(2, "0");
  const a = data.gms.find((g) => g.id === "a");
  a.historico = [{ ate: d, equipe: "D1", lotacao: a.lotacao }];
  a.lotacao = { posto: "hosp", funcao: "", segmentos: [{ ini: "07:00", fim: "19:00" }] };
  data._versao++;
  assert.equal(calcularDia(data, d).designacoes.find((x) => x.gm === "a").posto, "vtr");
  assert.equal(calcularDia(data, depois).designacoes.find((x) => x.gm === "a").posto, "hosp");
});

test("ajustes do dia no posto: fechado, vagas e viatura substituta", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "v", tipo: "VAGAS", posto: "vtr", de: d, ate: d, vagas: { t2: 3, t3: 2 } },
    { id: "p", tipo: "PREFIXO", posto: "vtr", de: d, ate: d, nome: "VTR 1290" }); data._versao++;
  let cd = calcularDia(data, d);
  assert.deepEqual(cd.furos.filter((f) => f.posto === "vtr").map((f) => [f.turno, f.faltam]), [["t2", 1]]);
  assert.equal(cd.ajustesPosto.get("vtr").prefixo.nome, "VTR 1290");
  data.ocorrencias.push({ id: "f", tipo: "FECHADO", posto: "vtr", de: d, ate: d }); data._versao++;
  cd = calcularDia(data, d);
  assert.equal(cd.disposicao.length, 2);
  assert.ok(!cd.furos.some((f) => f.posto === "vtr"));
  data.postos.find((p) => p.id === "hosp").ativo = false; data._versao++;
  assert.ok(!calcularDia(data, d).furos.some((f) => f.posto === "hosp"));
});

test("saída antecipada com REQ de banco de horas desconta do banco; observação acompanha", () => {
  const data = base();
  data.requerimentos = { "12345": { tipo: "BH" } };
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "h", tipo: "HORARIO", gm: "a", de: d, alvo: "420-1140", ini: "07:00", fim: "17:00", req: "12345", obs: "consulta médica" }); data._versao++;
  const x = calcularDia(data, d).designacoes.find((y) => y.gm === "a");
  assert.deepEqual([x.fim, x.req, x.obs, x.bhDebito], [1020, "12345", "consulta médica", 120]);
  assert.equal(saldoBH(data, "a", "2026-11"), -120);
  data.requerimentos["12345"].tipo = "OUTRO"; data._versao++;
  assert.equal(saldoBH(data, "a", "2026-11"), 0);
});

test("inspetor do dia pode ser trocado só naquele dia", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "i", tipo: "INSPETOR", equipe: "D1", de: d, ate: d, nome: "INSP. X" }); data._versao++;
  assert.equal(calcularDia(data, d).inspetores.get("D1"), "INSP. X");
});

test("remanejamento parcial: só o trecho escolhido muda de posto", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "r", tipo: "REMANEJ", gm: "a", de: d, ate: d, posto: "hosp", ini: "13:00", fim: "19:00" }); data._versao++;
  const x = calcularDia(data, d).designacoes.filter((y) => y.gm === "a").map((y) => [y.posto, y.ini, y.fim]);
  assert.deepEqual(x, [["vtr", 420, 780], ["hosp", 780, 1140]]);
  assert.equal(livroMes(data, "2026-11").get("a").he, 0);
});

test("REQ e observação gravados no remanejamento aparecem no trecho remanejado", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "r", tipo: "REMANEJ", gm: "a", de: d, ate: d, posto: "hosp", ini: "13:00", fim: "19:00", req: "777", obs: "pedido da SMS" }); data._versao++;
  const x = calcularDia(data, d).designacoes.filter((y) => y.gm === "a");
  const rem = x.find((y) => y.posto === "hosp");
  assert.equal(rem.req, "777"); assert.equal(rem.obs, "pedido da SMS"); assert.equal(rem.remanej, "r");
  assert.equal(x.find((y) => y.posto === "vtr").req || "", "");
  data.ocorrencias[data.ocorrencias.length - 1].obs = "Da reserva técnica"; data._versao++;
  assert.ok(!calcularDia(data, d).designacoes.find((y) => y.posto === "hosp" && y.gm === "a").obs);
});

test("horário que alterna conforme o padrão do dia", () => {
  const data = base();
  const h = data.gms.find((g) => g.id === "h");
  h.lotacao.alternativa = { quando: ["D2"], segmentos: [{ ini: "11:00", fim: "12:00" }, { ini: "13:00", fim: "20:00" }, { ini: "20:00", fim: "23:00", tipo: "he" }] };
  data._versao++;
  const dias = ["2026-11-02", "2026-11-03"]; // seg e ter: um é dia da D1, o outro da D2
  const r = dias.map((d) => calcularDia(data, d).designacoes.filter((x) => x.gm === "h").map((x) => `${x.ini}-${x.fim}`).join(","));
  assert.notEqual(r[0], r[1]);
  assert.ok(r.some((x) => x.startsWith("660-720")));
});

test("HE recorrente em dias úteis, mesmo para quem é 12x36; pode ser suspensa num dia", () => {
  const data = base();
  const n = data.gms.find((g) => g.id === "n");
  n.heRecorrente = [{ posto: "hosp", dias: [1, 2, 3, 4, 5], segmentos: [{ ini: "07:00", fim: "08:00" }, { ini: "11:00", fim: "13:00" }] }];
  data._versao++;
  const seg = calcularDia(data, "2026-11-02").designacoes.filter((x) => x.gm === "n" && x.recorrente);
  assert.equal(seg.length, 2);
  assert.equal(calcularDia(data, "2026-11-01").designacoes.filter((x) => x.recorrente).length, 0); // domingo
  assert.equal(resumoMes(data, "2026-11").get("n").heFixa, 21 * 180);
  data.ocorrencias.push({ id: "s", tipo: "SEM_HE_REC", gm: "n", de: "2026-11-02" }); data._versao++;
  assert.equal(calcularDia(data, "2026-11-02").designacoes.filter((x) => x.recorrente).length, 0);
});

test("mudar só o horário (sem HE): 07–19 vira 13–01 normal", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "h1", tipo: "HORARIO", gm: "a", de: d, alvo: "420-1140", ini: "13:00", fim: "01:00", semHE: true }); data._versao++;
  const x = calcularDia(data, d).designacoes.filter((y) => y.gm === "a");
  assert.deepEqual(x.map((y) => [y.ini, y.fim, y.nat]), [[780, 1500, "normal"]]);
  assert.equal(livroMes(data, "2026-11").get("a").he, 0);
});

test("vaga de reforço (EJA) é coberta só no horário do reforço", () => {
  const data = base();
  data.postos.push({ id: "eja", nome: "EMEF EJA", vagas: { t4: 1 }, dias: [1, 2, 3, 4, 5], reforco: { ini: "19:00", fim: "23:00" } });
  data._versao++;
  const p = planejarCobertura(data, ["2026-11-02"]).find((x) => x.posto === "eja");
  assert.deepEqual([p.ini, p.fim], [1140, 1380]);
  assert.equal(planejarCobertura(data, ["2026-11-01"]).filter((x) => x.posto === "eja").length, 0); // domingo não
});

test("sugestão de HE: escala oposta do posto, depois quem está no posto no período oposto, depois menos horas; teto por último", () => {
  const data = base();
  data.gms.push({ id: "x", nome: "X", equipe: "N1", lotacao: { posto: "vtr", segmentos: [{ ini: "19:00", fim: "07:00" }] } });
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "f", tipo: "FOLGA", gm: "a", de: d }); data._versao++;
  const s = sugerir(data, d, "vtr", 1140, 1500).he.map((x) => x.gm.id); // furo à noite no posto vtr
  assert.equal(s[0], "c"); // lotado no vtr, de folga hoje
  assert.equal(s[1], "b"); // está no vtr hoje de dia: pode estender
});

test("horário fixo: faixas + horas de HE fixa viram segmentos como no padrão, e voltam", async () => {
  const { montarSegmentos, lerFaixas, descreverSegmentos } = await import("./engine.js");
  const segs = montarSegmentos(lerFaixas("07-12 13-19"), 180);
  assert.deepEqual(segs, [{ ini: "07:00", fim: "12:00", tipo: "normal" }, { ini: "13:00", fim: "16:00", tipo: "normal" }, { ini: "16:00", fim: "19:00", tipo: "he" }]);
  assert.deepEqual(descreverSegmentos(segs), { faixas: "07:00-12:00 13:00-19:00", heMin: 180 });
  assert.deepEqual(montarSegmentos(lerFaixas("18h às 0h e 0h às 7h"), 60).map((s) => s.ini + "-" + s.fim + s.tipo), ["18:00-06:00normal", "06:00-07:00he"]);
  assert.equal(lerFaixas("7-12 13"), null);
});

test("HE fixa estendida no dia continua HE fixa (3HE → 4HE) e pode ser removida no dia", () => {
  const data = base();
  const d = "2026-11-02";
  data.ocorrencias.push({ id: "x", tipo: "HORARIO", gm: "h", de: d, alvo: "960-1080", ini: "16:00", fim: "19:00", semHE: true }); data._versao++;
  const he = calcularDia(data, d).designacoes.filter((x) => x.gm === "h" && x.fixa);
  assert.deepEqual(he.map((x) => [x.ini, x.fim, x.nat]), [[960, 1140, "he"]]);
  data.ocorrencias[0] = { id: "x", tipo: "HORARIO", gm: "h", de: d, alvo: "960-1080", ini: "16:00", fim: "17:00", remover: true }; data._versao++;
  assert.equal(calcularDia(data, d).designacoes.filter((x) => x.gm === "h" && x.fixa).length, 0);
});
