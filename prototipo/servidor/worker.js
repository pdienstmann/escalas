// Servidor do piloto da escala: entrega a página e guarda os dados no D1.
// - Login por senha com cookie assinado (segredo SEGREDO). Senha principal (segredo SENHA) = escalante;
//   os outros perfis (inspetor, logística, reserva) têm senha definida pelo escalante em Ajustes.
// - Cada alteração é um comando com a revisão esperada; o banco recusa se outra pessoa salvou antes.
// - Histórico de alterações append-only (tabela eventos).
import pagina from "./pagina.html";

const COLECOES = ["gms", "ocorrencias", "controle"];
const DOCS = ["postos", "secoes", "equipes", "config", "requerimentos", "inspetores", "frota", "folgasSync"];
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
async function criarSessao(nome, env, perfil = "escalante", ver = "") {
  const corpo = b64u(enc.encode(JSON.stringify({ nome, perfil, ver, exp: Date.now() + 30 * DIA_SEG * 1000 })));
  return `${corpo}.${await assinar(corpo, env.SEGREDO)}`;
}
async function lerSessao(req, env) {
  const c = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sessao=([^;]+)/);
  if (!c) return null;
  const [corpo, ass] = c[1].split(".");
  if (!corpo || !ass || !iguais(ass, await assinar(corpo, env.SEGREDO))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(corpo.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0))));
    if (!(s.exp > Date.now())) return null;
    s.perfil = PERFIS[s.perfil] ? s.perfil : "escalante"; // sessões antigas (antes dos perfis) eram do escalante
    if (s.perfil !== "escalante") { const a = await lerAcesso(env, s.perfil); if (!a || a.hash.slice(0, 12) !== s.ver) return null; } // senha trocada = sai
    return s;
  } catch { return null; }
}

// ---------- perfis de acesso ----------
// O escalante entra com a senha principal (segredo SENHA) e define, em Ajustes, uma senha para cada perfil.
// As senhas ficam só como hash (PBKDF2) na tabela "acessos", que nunca vai para a tela.
const PERFIS = {
  escalante: { nome: "Escalante", edita: "tudo" },
  inspetor: { nome: "Inspetor de serviço", edita: "" },
  logistica: { nome: "Logística", edita: "frota" },
  reserva: { nome: "Reserva de armamento", edita: "" },
};
let tabelaPronta = false;
async function garantirTabela(env) {
  if (tabelaPronta) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS acessos (perfil TEXT PRIMARY KEY, hash TEXT NOT NULL, sal TEXT NOT NULL, atualizado TEXT NOT NULL, quem TEXT NOT NULL)").run();
  tabelaPronta = true;
}
const cacheAcesso = new Map(); // perfil -> { a, ate }
async function lerAcesso(env, perfil) {
  const c = cacheAcesso.get(perfil); if (c && c.ate > Date.now()) return c.a;
  await garantirTabela(env);
  const a = await env.DB.prepare("SELECT perfil, hash, sal, atualizado, quem FROM acessos WHERE perfil = ?").bind(perfil).first();
  cacheAcesso.set(perfil, { a, ate: Date.now() + 60000 });
  return a;
}
async function hashSenha(senha, sal) {
  const k = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sal), iterations: 100000 }, k, 256));
}
async function perfilDaSenha(env, senha) {
  if (iguais(await assinar(senha, env.SEGREDO), await assinar(env.SENHA, env.SEGREDO))) return { perfil: "escalante", ver: "" };
  for (const p of Object.keys(PERFIS)) {
    if (p === "escalante") continue;
    const a = await lerAcesso(env, p);
    if (a && iguais(await hashSenha(senha, a.sal), a.hash)) return { perfil: p, ver: a.hash.slice(0, 12) };
  }
  return null;
}
async function listarAcessos(env) {
  await garantirTabela(env);
  const r = await env.DB.prepare("SELECT perfil, atualizado, quem FROM acessos").all();
  const m = new Map(r.results.map((x) => [x.perfil, x]));
  return json({ perfis: Object.entries(PERFIS).filter(([k]) => k !== "escalante").map(([k, v]) => ({ perfil: k, nome: v.nome, definido: m.has(k), atualizado: m.get(k)?.atualizado || "", quem: m.get(k)?.quem || "" })) });
}
async function definirAcesso(env, sessao, corpo) {
  const perfil = String(corpo?.perfil || ""), senha = String(corpo?.senha ?? "");
  if (!PERFIS[perfil] || perfil === "escalante") return json({ erro: "Perfil inválido." }, 400);
  await garantirTabela(env);
  cacheAcesso.delete(perfil);
  if (!senha) { await env.DB.prepare("DELETE FROM acessos WHERE perfil = ?").bind(perfil).run(); return json({ ok: true }); }
  if (senha.length < 6) return json({ erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);
  if (iguais(await assinar(senha, env.SEGREDO), await assinar(env.SENHA, env.SEGREDO))) return json({ erro: "Use uma senha diferente da senha do escalante." }, 400);
  for (const p of Object.keys(PERFIS)) if (p !== perfil && p !== "escalante") { const a = await lerAcesso(env, p); if (a && iguais(await hashSenha(senha, a.sal), a.hash)) return json({ erro: `Essa senha já é a de ${PERFIS[p].nome}. Use outra.` }, 400); }
  const sal = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT INTO acessos (perfil, hash, sal, atualizado, quem) VALUES (?, ?, ?, ?, ?) ON CONFLICT (perfil) DO UPDATE SET hash = excluded.hash, sal = excluded.sal, atualizado = excluded.atualizado, quem = excluded.quem")
    .bind(perfil, await hashSenha(senha, sal), sal, agora(), sessao.nome).run();
  return json({ ok: true });
}
// Quem só visualiza não recebe o que não precisa: controle de HE, requerimentos, ligação com o sistema de folgas
// e o texto livre de atestados e licenças.
function estadoParaPerfil(r, perfil) {
  if (perfil === "escalante") return r;
  const e = { ...r.estado, controle: r.estado.controle.filter((c) => c.tipo === "FECHADO").map((c) => ({ id: c.id, tipo: c.tipo, dia: c.dia })), requerimentos: {}, folgasSync: {} }; // só quais dias foram finalizados
  e.ocorrencias = e.ocorrencias.map((o) => ["ATESTADO", "LICENCA"].includes(o.tipo) ? { id: o.id, tipo: o.tipo, gm: o.gm, de: o.de, ate: o.ate } : o);
  return { ...r, estado: e };
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
<form method="post" action="/login"><h1>Escala GM</h1><p>Entre com seu nome e a senha do seu setor (escalante, inspetor, logística ou reserva de armamento).</p>
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
  const estado = { gms: [], ocorrencias: [], controle: [], postos: [], secoes: [], equipes: [], config: {}, requerimentos: {}, inspetores: {}, frota: [], folgasSync: {} };
  for (const r of regs.results) estado[r.colecao].push(JSON.parse(r.valor));
  for (const d of docs.results) estado[d.chave] = JSON.parse(d.valor);
  return { revisao: rev.numero, estado, vazio: !estado.gms.length };
}

// Sistema de Folgas (outro app da mesma conta): só leitura, e só quando o escalante pede.
// Lê a competência e os nomes no D1 dele e as folgas no Durable Object da competência (GET /dashboard, que não grava nada).
async function lerSistemaFolgas(env, mes) {
  if (!env.FOLGAS_DB || !env.FOLGAS_COORD) return json({ erro: "Ligação com o Sistema de Folgas não configurada." }, 501);
  if (!/^\d{4}-\d{2}$/.test(mes)) return json({ erro: "Mês inválido." }, 400);
  const comp = await env.FOLGAS_DB.prepare("SELECT id, month, label, status, selection_starts_at, selection_ends_at FROM competencies WHERE month = ?").bind(mes).first();
  if (!comp) return json({ erro: `O Sistema de Folgas não tem a competência ${mes}.` }, 404);
  const [nomes, arquivados] = await Promise.all([
    env.FOLGAS_DB.prepare("SELECT id, name FROM users WHERE role = 'GM'").all(),
    env.FOLGAS_DB.prepare("SELECT id, name FROM archived_gms").all().catch(() => ({ results: [] })),
  ]);
  const nome = new Map([...arquivados.results, ...nomes.results].map((u) => [u.id, u.name]));
  const stub = env.FOLGAS_COORD.get(env.FOLGAS_COORD.idFromName(`competency:${comp.id}`));
  const r = await stub.fetch("https://coordinator/dashboard");
  if (!r.ok) return json({ erro: "O Sistema de Folgas não respondeu. Tente de novo." }, 502);
  const d = await r.json();
  const porGm = (lista, id) => (lista || []).filter((x) => x.gm_id === id).map((x) => x.date).sort();
  const linhas = (d.requests || []).map((q) => ({ fgId: q.gm_id, versao: q.version || 1, nome: nome.get(q.gm_id) || "", folgas: porGm(d.leaveDays, q.gm_id), ferias: !!q.vacation_declared, he: porGm(d.overtime, q.gm_id), protocolo: q.receipt_id || "" })).filter((x) => x.nome);
  // quem só marcou disponibilidade de HE, sem pedido de folga
  for (const id of new Set((d.overtime || []).map((x) => x.gm_id))) if (!(d.requests || []).some((q) => q.gm_id === id) && nome.get(id)) linhas.push({ fgId: id, versao: 0, nome: nome.get(id), folgas: [], ferias: false, he: porGm(d.overtime, id), protocolo: "" });
  // situação efetiva: o status pode estar "SCHEDULED" com a janela de escolha já aberta ou já encerrada
  const agora = new Date().toISOString(), ini = comp.selection_starts_at || "", fim = comp.selection_ends_at || "";
  const efetiva = comp.status === "OPEN" || (comp.status === "SCHEDULED" && ini && ini <= agora && (!fim || agora < fim)) ? "OPEN"
    : comp.status === "SCHEDULED" && fim && agora >= fim ? "CLOSED" : comp.status;
  return json({ competencia: { mes: comp.month, rotulo: comp.label, situacao: efetiva, abre: ini, fecha: fim }, linhas });
}

const GUARDA = "(SELECT valor FROM meta WHERE chave = 'revisao') = ?";
async function aplicarComando(env, sessao, corpo) {
  const { revisao, cmd, resumo, ops } = corpo || {};
  if (!Number.isInteger(revisao) || typeof cmd !== "string" || !/^[\w-]{6,64}$/.test(cmd) || !Array.isArray(ops) || ops.length > 2000) return json({ erro: "Comando inválido." }, 400);
  const pode = PERFIS[sessao.perfil]?.edita;
  if (pode !== "tudo" && !(pode === "frota" && ops.every((op) => op.t === "doc" && op.k === "frota"))) return json({ erro: "Seu acesso é só para visualizar." }, 403);
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
  for (const k of DOCS) st.push(db.prepare("INSERT INTO docs (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(estado[k] ?? (k === "requerimentos" || k === "config" || k === "inspetores" || k === "folgasSync" ? {} : []))));
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
        const acesso = nome && senha ? await perfilDaSenha(env, senha) : null;
        if (!acesso) return telaLogin("Senha incorreta. Tente de novo.", nome);
        return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `sessao=${await criarSessao(nome, env, acesso.perfil, acesso.ver)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * DIA_SEG}` } });
      }
      return telaLogin();
    }
    if (url.pathname === "/sair") return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": "sessao=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
    const sessao = await lerSessao(req, env);
    if (!sessao) return url.pathname.startsWith("/api/") ? json({ erro: "Entre novamente." }, 401) : Response.redirect(new URL("/login", url), 303);

    try {
      if (url.pathname === "/" && req.method === "GET") {
        const html = pagina.replace("</head>", `<script>window.ESCALA_SERVIDOR = ${JSON.stringify({ nome: sessao.nome, perfil: sessao.perfil })};</script></head>`);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin" } });
      }
      if (url.pathname === "/api/estado" && req.method === "GET") return json(estadoParaPerfil(await lerEstado(env), sessao.perfil));
      if (url.pathname === "/api/revisao" && req.method === "GET") return json({ revisao: (await lerRevisao(env)).numero });
      if (url.pathname === "/api/comandos" && req.method === "POST") return await aplicarComando(env, sessao, await req.json());
      if (sessao.perfil !== "escalante") return json({ erro: "Seu acesso não permite isso." }, 403);
      if (url.pathname === "/api/acessos" && req.method === "GET") return await listarAcessos(env);
      if (url.pathname === "/api/acessos" && req.method === "POST") return await definirAcesso(env, sessao, await req.json());
      if (url.pathname === "/api/importar" && req.method === "POST") return await importar(env, sessao, (await req.json()).estado);
      if (url.pathname === "/api/folgas" && req.method === "GET") return await lerSistemaFolgas(env, url.searchParams.get("mes") || "");
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
