import test from "node:test";
import assert from "node:assert/strict";
import { calcularDia, livroMes, resumoMes, intervalo, sugerir, saldoBH, minutosNoturnos } from "./engine.js";
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

test("sugestão exclui quem está ocupado e avisa descanso curto", () => {
  const data = base();
  const d = diaDe(data, "D1");
  data.ocorrencias.push({ id: "f", tipo: "FOLGA", gm: "a", de: d }); data._versao++;
  const s = sugerir(data, d, "vtr", 420, 780);
  assert.ok(!s.some((x) => x.gm.id === "b" || x.gm.id === "a"));
  assert.equal(s[0].gm.id, "c"); // mesmo posto, outra equipe
  const nn = s.find((x) => x.gm.id === "n");
  assert.ok(nn.descansoCurto); // saiu às 07:00 do serviço noturno
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
