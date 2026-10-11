// Testes de integração do Plugin Market — servidor real: publicação, instalação, execução sandboxed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORTA = 3891;
const BASE = `http://localhost:${PORTA}`;
const DIRETORIO_DB = mkdtempSync(join(tmpdir(), 'plugin-market-http-'));
const servidor = spawn('node', ['server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(PORTA),
    DATABASE_PATH: join(DIRETORIO_DB, 'market.db'),
    JWT_SECRET: 'market-test-secret-with-at-least-32-bytes-long',
    PLUGIN_ADMIN_EMAIL: 'admin@example.test',
    PLUGIN_ADMIN_PASSWORD: 'senha-segura-de-teste-123'
  },
  stdio: 'ignore'
});
servidor.unref();
await new Promise((r) => setTimeout(r, 1200));
const respostaLogin = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.test', senha: 'senha-segura-de-teste-123' })
});
const tokenAdmin = (await respostaLogin.json()).token;

const chamar = (metodo, rota, corpo, token = tokenAdmin) =>
  fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  }).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));

const MANIFEST = { nome: 'contador-cards', versao: '1.0.0', descricao: 'conta cartões criados', ganchos: ['card-criado'], permissao: 'leitura' };

test('publicação valida manifest (inválido => 400)', async () => {
  const r1 = await chamar('POST', '/api/plugins', { nome: 'X', versao: '1.0', ganchos: [], permissao: 'admin' });
  assert.equal(r1.status, 400);
  const r2 = await chamar('POST', '/api/plugins', MANIFEST);
  assert.equal(r2.status, 201);
  assert.ok(r2.corpo.hash.length === 64);
  await chamar('POST', '/api/admin/plugins/contador-cards/revisao', { status: 'aprovado' });
});

test('publicação idêntica devolve 200 (não duplica)', async () => {
  const r = await chamar('POST', '/api/plugins', MANIFEST);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.publicada, false);
});

test('instalar + executar aceita apenas handlers registrados pelo host', async () => {
  // executar ANTES de instalar => 409
  const antes = await chamar('POST', '/api/plugins/contador-cards/executar', {
    handler: () => ({ ok: true }), gancho: 'card-criado', evento: { payload: { titulo: 'x' } }
  });
  assert.equal(antes.status, 409);

  await chamar('POST', '/api/plugins/contador-cards/instalar');

  // handler enviado como texto é rejeitado; a rota nunca avalia código do cliente.
  const r = await chamar('POST', '/api/plugins/contador-cards/executar', {
    handler: `(gancho, evento) => { try { evento.payload.titulo = 'HACKEADO'; } catch {} return { titulo: evento.payload.titulo }; }`,
    gancho: 'card-criado', evento: { payload: { titulo: 'original' } }
  });
  assert.equal(r.status, 400, 'handler string via JSON rejeitado');
});

test('estrelas: média calculada, nota inválida rejeitada', async () => {
  const criarConta = async (numero) => {
    const conta = await chamar('POST', '/api/auth/register', {
      email: `user-${numero}@example.test`, senha: 'senha-de-teste-com-12'
    }, null);
    return conta.corpo.token;
  };
  const tokens = await Promise.all([criarConta(1), criarConta(2), criarConta(3)]);
  await chamar('POST', '/api/plugins/contador-cards/estrela', { nota: 5 }, tokens[0]);
  await chamar('POST', '/api/plugins/contador-cards/estrela', { nota: 4 }, tokens[1]);
  const r = await chamar('POST', '/api/plugins/contador-cards/estrela', { nota: 3 }, tokens[2]);
  assert.equal(r.corpo.media, 4);
  const ruim = await chamar('POST', '/api/plugins/contador-cards/estrela', { nota: 10 });
  assert.equal(ruim.status, 400);
});

test('listagem com instalado e média', async () => {
  const r = await chamar('GET', '/api/plugins');
  const p = r.corpo.find((x) => x.nome === 'contador-cards');
  assert.ok(p);
  assert.equal(p.instalado, true);
  assert.equal(p.mediaEstrelas, 4);
});
