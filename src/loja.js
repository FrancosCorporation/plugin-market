// Plugin Market M2 — persistência sqlite (plugins/instalações/telemetria sobrevivem a restarts).
import { DatabaseSync } from 'node:sqlite';
import { hashPlugin } from './sandbox.js';

export function criarLojaPersistente(caminhoDb = 'plugin-market.db') {
  const db = new DatabaseSync(caminhoDb);
  db.exec(`
  CREATE TABLE IF NOT EXISTS plugins (
    nome TEXT PRIMARY KEY,
    manifest TEXT NOT NULL,
    hash TEXT NOT NULL,
    publicado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS instalacoes (
    nome TEXT PRIMARY KEY,
    instalado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS estrelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS telemetria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    gancho TEXT NOT NULL,
    ok INTEGER NOT NULL,
    duracao_ms INTEGER NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  return {
    db,

    publicar(manifest) {
      const hash = hashPlugin(manifest);
      const existe = db.prepare('SELECT hash FROM plugins WHERE nome = ?').get(manifest.nome);
      if (existe?.hash === hash) return { publicada: false, motivo: 'idêntico' };
      if (existe) db.prepare('DELETE FROM plugins WHERE nome = ?').run(manifest.nome);
      db.prepare('INSERT INTO plugins (nome, manifest, hash) VALUES (?, ?, ?)').run(manifest.nome, JSON.stringify(manifest), hash);
      return { publicada: true, nome: manifest.nome, hash };
    },

    instalar(nome) {
      const p = db.prepare('SELECT nome FROM plugins WHERE nome = ?').get(nome);
      if (!p) return false;
      db.prepare('INSERT OR REPLACE INTO instalacoes (nome) VALUES (?)').run(nome);
      return true;
    },

    estrela(nome, nota) {
      db.prepare('INSERT INTO estrelas (nome, nota) VALUES (?, ?)').run(nome, nota);
      const m = db.prepare('SELECT AVG(nota) AS media FROM estrelas WHERE nome = ?').get(nome).media;
      return { media: m };
    },

    // telemetria de execução (duração + sucesso — para o painel M2)
    telemetria(nome, gancho, ok, duracaoMs) {
      db.prepare('INSERT INTO telemetria (nome, gancho, ok, duracao_ms) VALUES (?, ?, ?, ?)').run(nome, gancho, ok ? 1 : 0, duracaoMs);
    },

    metricasTelemetria(nome) {
      const linhas = db.prepare('SELECT ok, duracao_ms FROM telemetria WHERE nome = ?').all(nome);
      if (!linhas.length) return { execucoes: 0, taxaOk: 0, p50: 0, p95: 0 };
      const durs = linhas.map((l) => l.duracao_ms).sort((a, b) => a - b);
      const p = (q) => durs[Math.min(Math.floor(durs.length * q), durs.length - 1)];
      const oks = linhas.filter((l) => l.ok).length;
      return { execucoes: linhas.length, taxaOk: (oks / linhas.length) * 100, p50: p(0.5), p95: p(0.95) };
    },

    listar() {
      return db.prepare('SELECT nome, manifest, hash, publicado_em FROM plugins ORDER BY nome').all()
        .map((r) => ({ ...r, manifest: JSON.parse(r.manifest), instalado: !!db.prepare('SELECT nome FROM instalacoes WHERE nome = ?').get(r.nome) }));
    },

    contarExecucoes(nome) {
      return db.prepare('SELECT COUNT(*) AS n FROM telemetria WHERE nome = ?').get(nome).n;
    }
  };
}
