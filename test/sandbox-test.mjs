// Testes do Plugin Market — semver, manifest, SANDBOX (timeout, imutabilidade, permissões).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarSemver, compativel, validarManifest, executarSandbox, hashPlugin, MANIFEST_EXEMPLO } from '../src/sandbox.js';

test('semver: parse e compatibilidade de major', () => {
  assert.deepEqual(validarSemver('1.2.3'), { maior: 1, menor: 2, patch: 3 });
  assert.equal(validarSemver('1.2'), null);
  assert.equal(validarSemver('abc'), null);
  assert.equal(compativel('1.5.0', '1.9.0'), true, 'mesma major = compatível');
  assert.equal(compativel('2.0.0', '1.9.0'), false, 'major diferente = incompatível');
});

test('manifest: validação completa (CI roda isso)', () => {
  assert.deepEqual(validarManifest(MANIFEST_EXEMPLO), []);
  const erros = validarManifest({ nome: 'X', versao: '1.0', ganchos: [], permissao: 'admin' });
  assert.ok(erros.length >= 3, 'nome/versão/ganchos/permissão rejeitados');
  assert.ok(validarManifest({ nome: 'ok', versao: '1.0.0', ganchos: ['gancho-falso'], permissao: 'leitura' }).some((e) => e.includes('gancho desconhecido')));
});

test('SANDBOX: executa handler e congela o evento (imutável)', async () => {
  const plugin = {
    manifest: { nome: 'contador', versao: '1.0.0', ganchos: ['card-criado'], permissao: 'leitura' },
    manipular(gancho, evento) {
      // tenta mutar (não pode!)
      try { evento.payload.titulo = 'HACKEADO'; } catch { /* congelado */ }
      return { contou: true, titulo: evento.payload.titulo };
    }
  };
  const r = await executarSandbox(plugin, 'card-criado', { payload: { titulo: 'original' } });
  assert.equal(r.ok, true);
  assert.equal(r.saida.titulo, 'original', 'evento congelado: mutação não vaza');
});

test('SANDBOX: timeout mata plugin travado (2s)', async () => {
  const plugin = {
    manifest: { nome: 'travado', versao: '1.0.0', ganchos: ['card-movido'], permissao: 'leitura' },
    manipular() { return new Promise(() => {}); } // nunca resolve
  };
  const r = await executarSandbox(plugin, 'card-movido', {}, { timeoutMs: 500 });
  assert.equal(r.ok, false);
  assert.ok(r.erro.includes('timeout'));
});

test('SANDBOX: permissão leitura bloqueia evento de escrita', async () => {
  const plugin = {
    manifest: { nome: 'so-leitura', versao: '1.0.0', ganchos: ['card-movido'], permissao: 'leitura' },
    manipular() { return { ok: true }; }
  };
  const r = await executarSandbox(plugin, 'card-movido', { escrita: true });
  assert.equal(r.ok, false);
  assert.ok(r.erro.includes('leitura'));
});

test('SANDBOX: plugin sem manipular rejeitado', async () => {
  const r = await executarSandbox({ manifest: MANIFEST_EXEMPLO }, 'card-criado', {});
  assert.equal(r.ok, false);
  assert.ok(r.erro.includes('manipular'));
});

test('SANDBOX: erro dentro do handler capturado (não derruba o host)', async () => {
  const plugin = {
    manifest: { nome: 'quebra', versao: '1.0.0', ganchos: ['card-criado'], permissao: 'leitura' },
    manipular() { throw new Error('bug do plugin'); }
  };
  const r = await executarSandbox(plugin, 'card-criado', {});
  assert.equal(r.ok, false);
  assert.ok(r.erro.includes('bug do plugin'));
});

test('hash do manifest: determinístico e curto', () => {
  const h1 = hashPlugin(MANIFEST_EXEMPLO);
  const h2 = hashPlugin(MANIFEST_EXEMPLO);
  assert.equal(h1, h2);
  assert.equal(h1.length, 16);
});
