-- Banco do piloto da escala. Aplicado por migração (wrangler d1 execute), nunca em requisição.
CREATE TABLE IF NOT EXISTS registros (
  colecao TEXT NOT NULL,          -- gms | ocorrencias
  id TEXT NOT NULL,
  valor TEXT NOT NULL,            -- JSON do registro
  atualizado TEXT NOT NULL,
  PRIMARY KEY (colecao, id)
);
CREATE TABLE IF NOT EXISTS docs (
  chave TEXT PRIMARY KEY,         -- postos | secoes | equipes | config | requerimentos
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
-- revisão da escala inteira: "numero:id-do-comando" (controle de edição simultânea)
INSERT OR IGNORE INTO meta (chave, valor) VALUES ('revisao', '0:inicio');
-- histórico append-only
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT NOT NULL,
  quem TEXT NOT NULL,
  resumo TEXT NOT NULL,
  revisao INTEGER NOT NULL,
  alteracoes INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS eventos_sem_update BEFORE UPDATE ON eventos BEGIN SELECT RAISE(ABORT, 'historico nao pode ser alterado'); END;
CREATE TRIGGER IF NOT EXISTS eventos_sem_delete BEFORE DELETE ON eventos BEGIN SELECT RAISE(ABORT, 'historico nao pode ser apagado'); END;
-- senhas dos perfis (inspetor, logística, reserva): só o hash PBKDF2; o escalante define em Ajustes
CREATE TABLE IF NOT EXISTS acessos (perfil TEXT PRIMARY KEY, hash TEXT NOT NULL, sal TEXT NOT NULL, atualizado TEXT NOT NULL, quem TEXT NOT NULL);
