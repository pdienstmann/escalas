// Lançamento rápido por texto: "folga kraemer 28/11", "ferias lang 1/12 a 30/12",
// "he couto hoje 19-01 vtr 1317 req 1504", "troca castro por lang 29/11", "fa vtr 1281 26/11 a 30/11".
import { somaDias, hm } from "./engine.js";

export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PALAVRAS = [
  [/\bbh\s*\+|\bcredito\b/, "BH_MAIS"],
  [/\bcompensa\w*|\bbh\s*-|\bbh\b/, "BH_COMP"],
  [/\bhe\b|\bhora extra\b|\bextra\b/, "HE"],
  [/\bfolga\b/, "FOLGA"],
  [/\bferias\b/, "FERIAS"],
  [/\blicenca\b/, "LICENCA"],
  [/\batestado\b/, "ATESTADO"],
  [/\bcurso\b/, "CURSO"],
  [/\btroca\b/, "TROCA"],
  [/\bremaneja\w*/, "REMANEJ"],
  [/\bfa\b|\bfora de atividade\b|\bbaixada\b/, "FA"],
];
const PRECISA_POSTO = ["HE", "BH_MAIS", "REMANEJ", "FA"];
const PERIODO = ["FERIAS", "LICENCA", "ATESTADO", "CURSO", "REMANEJ", "FA"];
const VAZIAS = new Set(["de", "da", "do", "das", "dos", "no", "na", "em", "para", "pra", "por", "com", "o", "a", "e", "vtr", "posto", "ate", "as", "hoje", "amanha", "ontem", "noite", "dia", "turno"]);

export function interpretar(texto, data, hoje) {
  let t = " " + norm(texto).replace(/\s+/g, " ") + " ";
  const r = { faltando: [] };

  // REQ
  const mReq = t.match(/\breq\.?\s*([\w/-]+)/);
  if (mReq) { r.req = mReq[1].toUpperCase(); t = t.replace(mReq[0], " "); }

  // tipo
  for (const [re, tipo] of PALAVRAS) { const m = t.match(re); if (m) { r.tipo = tipo; t = t.replace(m[0], " "); break; } }

  // datas
  const datas = [];
  const ano = Number(hoje.slice(0, 4)), mesHoje = Number(hoje.slice(5, 7));
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (_, d, m, a) => {
    let y = a ? Number(a.length === 2 ? "20" + a : a) : ano;
    if (!a && Number(m) < mesHoje - 6) y++;
    if (!a && Number(m) > mesHoje + 6) y--;
    datas.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return " ";
  });
  t = t.replace(/\b(hoje|amanha|ontem)\b/g, (w) => { datas.push(somaDias(hoje, { hoje: 0, amanha: 1, ontem: -1 }[w])); return " "; });

  // horário
  const mH = t.match(/\b(\d{1,2})(?:[:h](\d{2}))?h?\s*(?:-|–|as|ate|a)\s*(\d{1,2})(?:[:h](\d{2}))?h?\b/);
  if (mH && Number(mH[1]) <= 24 && Number(mH[3]) <= 24) {
    const f = (h, m) => `${String(Number(h) % 24).padStart(2, "0")}:${m || "00"}`;
    r.ini = f(mH[1], mH[2]); r.fim = f(mH[3], mH[4]);
    t = t.replace(mH[0], " ");
  }

  // GMs (nome inteiro; depois prefixo com 4+ letras)
  const achados = [];
  const nomes = [...data.gms].sort((a, b) => b.nome.length - a.nome.length);
  for (const g of nomes) {
    const re = new RegExp(`(^|\\s)${escRe(norm(g.nome))}(?=\\s|$)`);
    const m = t.match(re);
    if (m) { achados.push({ g, pos: m.index }); t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length); }
  }
  if (!achados.length || (r.tipo === "TROCA" && achados.length < 2)) {
    for (const w of t.split(" ").filter((x) => x.length >= 4 && /^[a-z]+$/.test(x) && !VAZIAS.has(x))) {
      const c = data.gms.filter((g) => norm(g.nome).split(" ").some((p) => p.startsWith(w)));
      if (c.length === 1 && !achados.some((a) => a.g === c[0])) { achados.push({ g: c[0], pos: t.indexOf(w) }); t = t.replace(w, " "); }
      else if (c.length > 1) r.ambiguo = { termo: w, opcoes: c.slice(0, 5).map((g) => g.nome) };
    }
  }
  achados.sort((a, b) => a.pos - b.pos);
  if (achados[0]) r.gm = achados[0].g.id;
  if (r.tipo === "TROCA" && achados[1]) r.substituto = achados[1].g.id;

  // posto
  const resto = t.split(" ").filter((w) => w && !VAZIAS.has(w));
  if (resto.length) {
    const noturno = r.ini ? (hm(r.ini) >= 19 * 60 || hm(r.ini) < 7 * 60) : null;
    let melhor = null;
    for (const p of data.postos) {
      const palavras = new Set(norm(`${p.nome} ${p.sub || ""}`).split(/[^a-z0-9]+/).filter(Boolean));
      let s = 0;
      for (const w of resto) if (palavras.has(w)) s += /^\d+$/.test(w) ? 3 : 1;
      if (!s) continue;
      const ehNoite = /noite/.test(norm(p.nome));
      if (noturno !== null && ehNoite === noturno) s += 0.5;
      if (!melhor || s > melhor.s) melhor = { p, s };
    }
    if (melhor) r.posto = melhor.p.id;
  }

  // datas e padrões
  if (datas[0]) r.de = datas[0];
  if (datas[1]) r.ate = datas[1];
  if (!r.de) { r.de = hoje; r.dataPresumida = true; }
  if (PERIODO.includes(r.tipo) && !r.ate) r.ate = r.de;

  if (!r.tipo) r.faltando.push("tipo");
  if (r.tipo !== "FA" && !r.gm) r.faltando.push("GM");
  if (r.tipo === "TROCA" && !r.substituto) r.faltando.push("substituto");
  if (PRECISA_POSTO.includes(r.tipo) && !r.posto) r.faltando.push(r.tipo === "FA" ? "viatura" : "posto");
  if ((r.tipo === "HE" || r.tipo === "BH_MAIS") && !r.ini) r.faltando.push("horário");
  if (r.ate && r.ate < r.de) r.faltando.push("data final depois da inicial");
  r.completo = !r.faltando.length;
  return r;
}
