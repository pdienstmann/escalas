// Servidor do piloto da escala: entrega a página e guarda os dados no D1.
// - Login simples por senha (segredo SENHA) com cookie assinado (segredo SEGREDO).
// - Cada alteração é um comando com a revisão esperada; o banco recusa se outra pessoa salvou antes.
// - Histórico de alterações append-only (tabela eventos).
import pagina from "./pagina.html";

const COLECOES = ["gms", "ocorrencias", "controle"];
const DOCS = ["postos", "secoes", "equipes", "config", "requerimentos", "inspetores", "frota"];
const DIA_SEG = 60 * 60 * 24;
const enc = new TextEncoder();

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const agora = () => new Date().toISOString();

// ---------- sessão ----------
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function assinar(texto, segredo) {
  const k = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(texto)));
}
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function criarSessao(nome, env) {
  const corpo = b64u(enc.encode(JSON.stringify({ nome, exp: Date.now() + 30 * DIA_SEG * 1000 })));
  return `${corpo}.${await assinar(corpo, env.SEGREDO)}`;
}
async function lerSessao(req, env) {
  const c = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sessao=([^;]+)/);
  if (!c) return null;
  const [corpo, ass] = c[1].split(".");
  if (!corpo || !ass || !iguais(ass, await assinar(corpo, env.SEGREDO))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(corpo.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0))));
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

// ---------- páginas ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function telaLogin(erro = "", nome = "") {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · Escala GM</title><style>
:root{--bg:#eef1f5;--s:#fff;--i:#17212d;--m:#5a6778;--l:#b9c3cf;--a:#1d4f91;--r:#b8232a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e131a;--s:#161d27;--i:#e5eaf1;--m:#95a2b4;--l:#3a4657;--a:#82b2f2;--r:#ff8086;color-scheme:dark}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--i);font:17px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
form{background:var(--s);border:1px solid var(--l);border-radius:12px;padding:28px;width:min(380px,100%);display:grid;gap:14px}
h1{margin:0;font-size:1.4rem}p{margin:0;color:var(--m)}label{display:grid;gap:4px;font-weight:600}
input{font:inherit;padding:10px 12px;border:1px solid var(--l);border-radius:8px;background:var(--s);color:var(--i)}
button{font:inherit;font-weight:700;padding:12px;border:0;border-radius:8px;background:var(--a);color:var(--s);cursor:pointer}
.erro{color:var(--r);font-weight:600}</style></head><body>
<form method="post" action="/login"><h1>Escala GM</h1><p>Entre com seu nome e a senha da escala.</p>
${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
<label>Seu nome <input name="nome" autocomplete="name" required value="${esc(nome)}" autofocus></label>
<label>Senha <input name="senha" type="password" autocomplete="current-password" required></label>
<button type="submit">Entrar</button></form></body></html>`, { status: erro ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// ---------- dados ----------
async function lerRevisao(env) {
  const v = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'revisao'").first("valor");
  return { bruto: v, numero: Number(String(v).split(":")[0]) };
}
async function lerEstado(env) {
  const [regs, docs, rev] = await Promise.all([
    env.DB.prepare("SELECT colecao, valor FROM registros ORDER BY rowid").all(),
    env.DB.prepare("SELECT chave, valor FROM docs").all(),
    lerRevisao(env),
  ]);
  const estado = { gms: [], ocorrencias: [], controle: [], postos: [], secoes: [], equipes: [], config: {}, requerimentos: {}, inspetores: {}, frota: [] };
  for (const r of regs.results) estado[r.colecao].push(JSON.parse(r.valor));
  for (const d of docs.results) estado[d.chave] = JSON.parse(d.valor);
  return { revisao: rev.numero, estado, vazio: !estado.gms.length };
}

const GUARDA = "(SELECT valor FROM meta WHERE chave = 'revisao') = ?";
async function aplicarComando(env, sessao, corpo) {
  const { revisao, cmd, resumo, ops } = corpo || {};
  if (!Number.isInteger(revisao) || typeof cmd !== "string" || !/^[\w-]{6,64}$/.test(cmd) || !Array.isArray(ops) || ops.length > 2000) return json({ erro: "Comando inválido." }, 400);
  const atual = await lerRevisao(env);
  if (atual.bruto.endsWith(":" + cmd)) return json({ revisao: atual.numero, repetido: true }); // mesmo comando reenviado
  if (atual.numero !== revisao) return json({ erro: "conflito", revisao: atual.numero }, 409);
  const novo = `${atual.numero + 1}:${cmd}`, quando = agora();
  const db = env.DB, st = [db.prepare("UPDATE meta SET valor = ? WHERE chave = 'revisao' AND valor = ?").bind(novo, atual.bruto)];
  for (const op of ops) {
    if (op.t === "put" && COLECOES.includes(op.c) && typeof op.id === "string" && op.v && typeof op.v === "object")
      st.push(db.prepare(`INSERT INTO registros (colecao, id, valor, atualizado) SELECT ?, ?, ?, ? WHERE ${GUARDA}
        ON CONFLICT (colecao, id) DO UPDATE SET valor = excluded.valor, atualizado = excluded.atualizado`).bind(op.c, op.id, JSON.stringify(op.v), quando, novo));
    else if (op.t === "del" && COLECOES.includes(op.c) && typeof op.id === "string")
      st.push(db.prepare(`DELETE FROM registros WHERE colecao = ? AND id = ? AND ${GUARDA}`).bind(op.c, op.id, novo));
    else if (op.t === "doc" && DOCS.includes(op.k))
      st.push(db.prepare(`INSERT INTO docs (chave, valor) SELECT ?, ? WHERE ${GUARDA} ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`).bind(op.k, JSON.stringify(op.v ?? null), novo));
    else return json({ erro: "Operação inválida." }, 400);
  }
  st.push(db.prepare(`INSERT INTO eventos (quando, quem, resumo, revisao, alteracoes) SELECT ?, ?, ?, ?, ? WHERE ${GUARDA}`)
    .bind(quando, sessao.nome, String(resumo || "Alteração").slice(0, 300), atual.numero + 1, ops.length, novo));
  await db.batch(st);
  const depois = await lerRevisao(env);
  if (depois.bruto !== novo) return json({ erro: "conflito", revisao: depois.numero }, 409);
  return json({ revisao: depois.numero });
}

async function importar(env, sessao, estado) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM registros").first("n");
  if (n > 0) return json({ erro: "O banco já tem dados." }, 409);
  if (!estado || !Array.isArray(estado.gms) || !Array.isArray(estado.ocorrencias)) return json({ erro: "Dados inválidos." }, 400);
  const db = env.DB, st = [], quando = agora();
  for (const c of COLECOES) {
    const linhas = (estado[c] || []).map((v) => [c, String(v.id), JSON.stringify(v), quando]);
    for (let i = 0; i < linhas.length; i += 24) {
      const lote = linhas.slice(i, i + 24);
      st.push(db.prepare(`INSERT INTO registros (colecao, id, valor, atualizado) VALUES ${lote.map(() => "(?, ?, ?, ?)").join(", ")}`).bind(...lote.flat()));
    }
  }
  for (const k of DOCS) st.push(db.prepare("INSERT INTO docs (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(estado[k] ?? (k === "requerimentos" || k === "config" || k === "inspetores" ? {} : []))));
  st.push(db.prepare("UPDATE meta SET valor = '1:importacao' WHERE chave = 'revisao'"));
  st.push(db.prepare("INSERT INTO eventos (quando, quem, resumo, revisao, alteracoes) VALUES (?, ?, ?, 1, ?)").bind(quando, sessao.nome, `Carga inicial: ${estado.gms.length} GMs e ${estado.ocorrencias.length} lançamentos`, estado.gms.length + estado.ocorrencias.length));
  await db.batch(st);
  return json({ revisao: 1 });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.SENHA || !env.SEGREDO) return new Response("Servidor sem senha configurada.", { status: 500 });
    if (url.pathname === "/login") {
      if (req.method === "POST") {
        const f = await req.formData();
        const nome = String(f.get("nome") || "").trim().slice(0, 60), senha = String(f.get("senha") || "");
        if (!nome || !iguais(await assinar(senha, env.SEGREDO), await assinar(env.SENHA, env.SEGREDO))) return telaLogin("Senha incorreta. Tente de novo.", nome);
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `sessao=${await criarSessao(nome, env)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * DIA_SEG}` } });
      }
      return telaLogin();
    }
    if (url.pathname === "/sair") return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": "sessao=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
    const sessao = await lerSessao(req, env);
    if (!sessao) return url.pathname.startsWith("/api/") ? json({ erro: "Entre novamente." }, 401) : Response.redirect(new URL("/login", url), 303);

    try {
      if (url.pathname === "/" && req.method === "GET") {
        const html = pagina.replace("</head>", `<script>window.ESCALA_SERVIDOR = ${JSON.stringify({ nome: sessao.nome })};</script></head>`);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin" } });
      }
      if (url.pathname === "/api/estado" && req.method === "GET") return json(await lerEstado(env));
      if (url.pathname === "/api/comandos" && req.method === "POST") return await aplicarComando(env, sessao, await req.json());
      if (url.pathname === "/api/importar" && req.method === "POST") return await importar(env, sessao, (await req.json()).estado);
      if (url.pathname === "/api/eventos" && req.method === "GET") {
        const r = await env.DB.prepare("SELECT quando, quem, resumo, revisao, alteracoes FROM eventos ORDER BY id DESC LIMIT 60").all();
        return json({ eventos: r.results });
      }
      return json({ erro: "Não encontrado." }, 404);
    } catch (e) {
      console.error(JSON.stringify({ rota: url.pathname, erro: String(e?.message || e) }));
      return json({ erro: "Erro no servidor. Tente de novo." }, 500);
    }
  },
};
