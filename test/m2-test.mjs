// Testes M2 do Plugin Market — persistência sob restart + telemetria com p50/p95.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarLojaPersistente } from '../src/loja.js';
import { MANIFEST_EXEMPLO } from '../src/sandbox.js';

const novaLoja = () => criarLojaPersistente(join(mkdtempSync(join('/media/servidor/nvme_data/tmp-opencode', 'pm-')), 't.db'));

test('M2: publicar + instalar persistem no sqlite', () => {
  const loja = novaLoja();
  const r = loja.publicar(MANIFEST_EXEMPLO);
  assert.equal(r.publicada, true);
  assert.equal(loja.instalar(MANIFEST_EXEMPLO.nome), true);
  const lista = loja.listar();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].instalado, true);
  assert.equal(lista[0].manifest.nome, 'meu-plugin');
});

test('M2: PERSISTÊNCIA REAL — nova instância do banco vê os mesmos dados (restart)', () => {
  const caminho = join(mkdtempSync(join('/media/servidor/nvme_data/tmp-opencode', 'pm2-')), 't.db');
  const loja1 = criarLojaPersistente(caminho);
  loja1.publicar(MANIFEST_EXEMPLO);
  loja1.instalar(MANIFEST_EXEMPLO.nome);
  loja1.estrela(MANIFEST_EXEMPLO.nome, 5);
  // "restart": NOVA instância no MESMO arquivo
  const loja2 = criarLojaPersistente(caminho);
  const lista = loja2.listar();
  assert.equal(lista.length, 1, 'plugin sobreviveu ao restart');
  assert.equal(lista[0].instalado, true, 'instalação sobreviveu');
  const m = loja2.estrela(MANIFEST_EXEMPLO.nome, 4);
  assert.ok(Math.abs(m.media - 4.5) < 1e-9, 'estrelas persistiram (5+4)/2');
});

test('M2: publicar versão nova (hash diferente) substitui', () => {
  const loja = novaLoja();
  loja.publicar(MANIFEST_EXEMPLO);
  const v2 = { ...MANIFEST_EXEMPLO, versao: '2.0.0' };
  const r = loja.publicar(v2);
  assert.equal(r.publicada, true, 'versão nova substitui');
  const lista = loja.listar();
  assert.equal(lista.length, 1, 'não duplica');
  assert.equal(lista[0].manifest.versao, '2.0.0');
});

test('M2: telemetria com p50/p95 e taxa de sucesso', async () => {
  const loja = novaLoja();
  loja.publicar(MANIFEST_EXEMPLO);
  for (let i = 0; i < 20; i++) {
    const inicio = Date.now();
    await new Promise((r) => setTimeout(r, 5 + (i % 3))); // 5-7ms
    loja.telemetria(MANIFEST_EXEMPLO.nome, 'card-criado', i !== 3, Date.now() - inicio); // 1 falha
  }
  const m = loja.metricasTelemetria(MANIFEST_EXEMPLO.nome);
  assert.equal(m.execucoes, 20);
  assert.ok(Math.abs(m.taxaOk - 95) < 0.1, `19/20 ok = 95%: ${m.taxaOk}`);
  assert.ok(m.p50 >= 5 && m.p50 <= 8);
  assert.ok(m.p95 >= m.p50, 'p95 >= p50');
});
