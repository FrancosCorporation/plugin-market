// SQLite é a fonte única de plugins, usuários, instalações, avaliações e telemetria.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { hashPlugin } from './sandbox.js';

function garantirColuna(db, tabela, coluna, definicao) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (!colunas.some((item) => item.name === coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

export function criarLojaPersistente(caminhoDb = 'plugin-market.db') {
  const caminho = resolve(caminhoDb);
  mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
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
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      papel TEXT NOT NULL CHECK (papel IN ('admin', 'publisher', 'user')),
      senha_hash TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS instalacoes_usuario (
      usuario_id TEXT NOT NULL,
      nome TEXT NOT NULL,
      instalado_em TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (usuario_id, nome)
    );
  `);
  // Migração aditiva: bancos M2 existentes e seus dados continuam válidos.
  garantirColuna(db, 'plugins', 'codigo', "TEXT NOT NULL DEFAULT ''");
  garantirColuna(db, 'plugins', 'status', "TEXT NOT NULL DEFAULT 'aprovado'");
  garantirColuna(db, 'plugins', 'publicado_por', 'TEXT');
  garantirColuna(db, 'plugins', 'revisado_por', 'TEXT');
  garantirColuna(db, 'plugins', 'revisado_em', 'TEXT');
  garantirColuna(db, 'estrelas', 'usuario_id', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS estrelas_por_usuario ON estrelas(nome, usuario_id);');
  for (const plugin of db.prepare('SELECT nome, manifest, codigo, hash FROM plugins').all()) {
    const novoHash = hashPlugin(JSON.parse(plugin.manifest), plugin.codigo || '');
    if (plugin.hash !== novoHash) db.prepare('UPDATE plugins SET hash = ? WHERE nome = ?').run(novoHash, plugin.nome);
  }

  return {
    db,

    buscarUsuarioPorEmail(email) {
      return db.prepare('SELECT id, email, papel, senha_hash, criado_em FROM usuarios WHERE email = ? COLLATE NOCASE').get(email);
    },

    buscarUsuarioPorId(id) {
      return db.prepare('SELECT id, email, papel, criado_em FROM usuarios WHERE id = ?').get(id);
    },

    provisionarAdmin(email, senhaHash) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // A conta definida pelo ambiente é a única conta administrativa ativa.
        db.prepare("UPDATE usuarios SET papel = 'user' WHERE papel = 'admin' AND email <> ? COLLATE NOCASE").run(email);
        const existente = db.prepare('SELECT id FROM usuarios WHERE email = ? COLLATE NOCASE').get(email);
        if (existente) {
          db.prepare("UPDATE usuarios SET papel = 'admin', senha_hash = ? WHERE id = ?").run(senhaHash, existente.id);
          db.exec('COMMIT');
          return existente.id;
        }
        const id = randomUUID();
        db.prepare("INSERT INTO usuarios (id, email, papel, senha_hash) VALUES (?, ?, 'admin', ?)").run(id, email, senhaHash);
        db.exec('COMMIT');
        return id;
      } catch (erro) {
        db.exec('ROLLBACK');
        throw erro;
      }
    },

    criarUsuario(email, senhaHash) {
      const id = randomUUID();
      db.prepare("INSERT INTO usuarios (id, email, papel, senha_hash) VALUES (?, ?, 'user', ?)").run(id, email, senhaHash);
      return { id, email, papel: 'user' };
    },

    listarUsuarios() {
      return db.prepare('SELECT id, email, papel, criado_em FROM usuarios ORDER BY criado_em, email').all();
    },

    promoverPublisher(id) {
      return db.prepare("UPDATE usuarios SET papel = 'publisher' WHERE id = ? AND papel = 'user'").run(id).changes > 0;
    },

    publicar(manifest, codigo = '', { status = 'aprovado', publicadoPor = null } = {}) {
      if (!['pendente', 'aprovado', 'rejeitado'].includes(status)) throw new TypeError('status de publicação inválido');
      const hash = hashPlugin(manifest, codigo);
      const publicar = db.prepare('SELECT hash, status FROM plugins WHERE nome = ?').get(manifest.nome);
      if (publicar?.hash === hash) return { publicada: false, motivo: 'idêntico', status: publicar.status, hash };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO plugins (nome, manifest, hash, codigo, status, publicado_por, revisado_por, revisado_em)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
          ON CONFLICT(nome) DO UPDATE SET manifest = excluded.manifest, hash = excluded.hash,
            codigo = excluded.codigo, status = excluded.status, publicado_por = excluded.publicado_por,
            revisado_por = NULL, revisado_em = NULL, publicado_em = datetime('now')`)
          .run(manifest.nome, JSON.stringify(manifest), hash, codigo, status, publicadoPor);
        db.exec('COMMIT');
      } catch (erro) {
        db.exec('ROLLBACK');
        throw erro;
      }
      return { publicada: true, nome: manifest.nome, hash, status };
    },

    buscarPlugin(nome) {
      const linha = db.prepare('SELECT nome, manifest, hash, codigo, status, publicado_por, publicado_em FROM plugins WHERE nome = ?').get(nome);
      return linha ? { ...linha, manifest: JSON.parse(linha.manifest) } : null;
    },

    definirStatusPlugin(nome, status, adminId) {
      if (!['aprovado', 'rejeitado'].includes(status)) throw new TypeError('status inválido');
      return db.prepare('UPDATE plugins SET status = ?, revisado_por = ?, revisado_em = datetime(\'now\') WHERE nome = ?')
        .run(status, adminId, nome).changes > 0;
    },

    instalar(nome, usuarioId = null) {
      const p = db.prepare("SELECT nome FROM plugins WHERE nome = ? AND status = 'aprovado'").get(nome);
      if (!p) return false;
      if (usuarioId) {
        db.prepare('INSERT OR IGNORE INTO instalacoes_usuario (usuario_id, nome) VALUES (?, ?)').run(usuarioId, nome);
      } else {
        db.prepare('INSERT OR IGNORE INTO instalacoes (nome) VALUES (?)').run(nome);
      }
      return true;
    },

    estaInstalado(nome, usuarioId = null) {
      return Boolean(usuarioId
        ? db.prepare('SELECT nome FROM instalacoes_usuario WHERE usuario_id = ? AND nome = ?').get(usuarioId, nome)
        : db.prepare('SELECT nome FROM instalacoes WHERE nome = ?').get(nome));
    },

    estrela(nome, nota, usuarioId = null) {
      if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new RangeError('nota deve ser um inteiro entre 1 e 5');
      const plugin = db.prepare("SELECT nome FROM plugins WHERE nome = ? AND status = 'aprovado'").get(nome);
      if (!plugin) return null;
      if (usuarioId) {
        db.prepare(`INSERT INTO estrelas (nome, nota, usuario_id) VALUES (?, ?, ?)
          ON CONFLICT(nome, usuario_id) DO UPDATE SET nota = excluded.nota, criado_em = datetime('now')`)
          .run(nome, nota, usuarioId);
      } else {
        db.prepare('INSERT INTO estrelas (nome, nota) VALUES (?, ?)').run(nome, nota);
      }
      const media = db.prepare('SELECT AVG(nota) AS media FROM estrelas WHERE nome = ?').get(nome).media;
      return { media };
    },

    telemetria(nome, gancho, ok, duracaoMs) {
      db.prepare('INSERT INTO telemetria (nome, gancho, ok, duracao_ms) VALUES (?, ?, ?, ?)')
        .run(nome, gancho, ok ? 1 : 0, Math.max(0, Math.round(duracaoMs)));
    },

    metricasTelemetria(nome) {
      const linhas = db.prepare('SELECT ok, duracao_ms FROM telemetria WHERE nome = ?').all(nome);
      if (!linhas.length) return { execucoes: 0, taxaOk: 0, p50: 0, p95: 0 };
      const durs = linhas.map((l) => l.duracao_ms).sort((a, b) => a - b);
      const p = (q) => durs[Math.min(Math.floor(durs.length * q), durs.length - 1)];
      const oks = linhas.filter((l) => l.ok).length;
      return { execucoes: linhas.length, taxaOk: (oks / linhas.length) * 100, p50: p(0.5), p95: p(0.95) };
    },

    listar({ usuarioId = null, incluirPendentes = false, incluirCodigo = false } = {}) {
      const sql = incluirPendentes
        ? 'SELECT nome, manifest, hash, codigo, status, publicado_por, publicado_em FROM plugins ORDER BY nome'
        : "SELECT nome, manifest, hash, codigo, status, publicado_por, publicado_em FROM plugins WHERE status = 'aprovado' ORDER BY nome";
      return db.prepare(sql).all().map((r) => {
        const instalacao = usuarioId
          ? db.prepare('SELECT nome FROM instalacoes_usuario WHERE usuario_id = ? AND nome = ?').get(usuarioId, r.nome)
          : db.prepare('SELECT nome FROM instalacoes WHERE nome = ?').get(r.nome);
        const estrelas = db.prepare('SELECT AVG(nota) AS media, COUNT(*) AS total FROM estrelas WHERE nome = ?').get(r.nome);
        return {
          nome: r.nome, manifest: JSON.parse(r.manifest), ...(incluirCodigo ? { codigo: r.codigo } : {}), hash: r.hash,
          status: r.status, publicadoPor: r.publicado_por, publicadoEm: r.publicado_em,
          instalado: Boolean(instalacao), mediaEstrelas: estrelas.media || 0, totalEstrelas: estrelas.total
        };
      });
    },

    contarExecucoes(nome) {
      return db.prepare('SELECT COUNT(*) AS n FROM telemetria WHERE nome = ?').get(nome).n;
    }
  };
}
