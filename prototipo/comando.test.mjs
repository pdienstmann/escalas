import test from "node:test";
import assert from "node:assert/strict";
import { interpretar } from "./comando.js";
import { criarExemplo } from "./seed.js";

const data = criarExemplo();
const id = (nome) => data.gms.find((g) => g.nome === nome).id;
const nomes = data.gms.map((g) => g.nome);
const [A, B] = [nomes[3], nomes[60]];
const hoje = "2026-11-26";

test("folga com data", () => {
  const r = interpretar(`folga ${A.toLowerCase()} 28/11`, data, hoje);
  assert.equal(r.tipo, "FOLGA"); assert.equal(r.gm, id(A)); assert.equal(r.de, "2026-11-28"); assert.ok(r.completo);
});
test("férias com período e acento", () => {
  const r = interpretar(`Férias ${A} 1/12 a 30/12 req 1402`, data, hoje);
  assert.deepEqual([r.tipo, r.de, r.ate, r.req], ["FERIAS", "2026-12-01", "2026-12-30", "1402"]);
});
test("HE noturna escolhe a VTR da noite", () => {
  const r = interpretar(`he ${A} hoje 19-01 vtr 1317 req 1504`, data, hoje);
  assert.deepEqual([r.tipo, r.de, r.ini, r.fim, r.posto, r.req], ["HE", hoje, "19:00", "01:00", "n1317", "1504"]);
  const d = interpretar(`he ${A} amanhã 7h às 13h vtr 1317`, data, hoje);
  assert.deepEqual([d.de, d.ini, d.fim, d.posto], ["2026-11-27", "07:00", "13:00", "v1317"]);
});
test("troca com dois GMs e posto por nome", () => {
  const r = interpretar(`troca ${A} por ${B} 29/11`, data, hoje);
  assert.deepEqual([r.tipo, r.gm, r.substituto], ["TROCA", id(A), id(B)]);
  const p = interpretar(`remanejar ${B} parcão`, data, hoje);
  assert.deepEqual([p.tipo, p.posto, p.de, p.dataPresumida], ["REMANEJ", "parcao", hoje, true]);
});
test("viatura fora de atividade e faltas", () => {
  const r = interpretar("fa vtr 1281 26/11 a 30/11", data, hoje);
  assert.deepEqual([r.tipo, r.posto, r.de, r.ate, r.completo], ["FA", "v1281", "2026-11-26", "2026-11-30", true]);
  const f = interpretar("he 19-01", data, hoje);
  assert.deepEqual(f.faltando, ["GM", "posto"]);
});
test("nome digitado pela metade", () => {
  const r = interpretar(`folga ${A.slice(0, 5).toLowerCase()} 28/11`, data, hoje);
  if (data.gms.filter((g) => g.nome.toLowerCase().startsWith(A.slice(0, 5).toLowerCase())).length === 1) assert.equal(r.gm, id(A));
});
