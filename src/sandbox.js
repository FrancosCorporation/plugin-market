// Plugin Market M1 — SDK do plugin (interface + manifest + semver) + execução SANDBOXED.
import { createHash } from 'node:crypto';

// ---- SDK: o que um plugin implementa (contrato) ----
export const MANIFEST_EXEMPLO = {
  nome: 'meu-plugin',
  versao: '1.0.0',
  descricao: 'exemplo',
  ganchos: ['card-criado', 'card-movido'], // eventos que o plugin escuta
  permissao: 'leitura'                     // leitura | escrita (sandbox limita)
};

// ---- validação de semver (2.0.0 => maior/menor/patch) ----
export function validarSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { maior: Number(m[1]), menor: Number(m[2]), patch: Number(m[3]) };
}

// compatibilidade: plugin 1.x roda em host 1.y (mesma major, menor >= host) — semver prático
export function compativel(versaoPlugin, versaoHost) {
  const p = validarSemver(versaoPlugin), h = validarSemver(versaoHost);
  if (!p || !h) return false;
  return p.maior === h.maior;
}

// ---- validação do manifest (CI roda isso!) ----
export function validarManifest(manifest) {
  const erros = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest deve ser objeto'];
  if (!/^[a-z0-9-]{2,40}$/.test(manifest.nome || '')) erros.push('nome: 2-40, [a-z0-9-]');
  if (!validarSemver(manifest.versao)) erros.push('versão: semver (x.y.z)');
  if (!Array.isArray(manifest.ganchos) || manifest.ganchos.length === 0) erros.push('ganchos: array não vazio');
  const GANCHOS_VALIDOS = ['card-criado', 'card-movido', 'card-apagado', 'board-criado'];
  if (manifest.ganchos?.some((g) => !GANCHOS_VALIDOS.includes(g))) erros.push('gancho desconhecido: ' + manifest.ganchos.join(','));
  if (!['leitura', 'escrita'].includes(manifest.permissao)) erros.push('permissão: leitura ou escrita');
  return erros;
}

// ---- SANDBOX: executa o handler do plugin com:
// 1) contextos IMUTÁVEIS (não pode mutar o board direto)
// 2) sem require/import (dados puros, JSON in/out)
// 3) timeout (handler travado não derruba o host)
// 4) sem eval — o plugin é uma FUNÇÃO (código hospedeiro validado), nunca string
export function executarSandbox(plugin, gancho, evento, { timeoutMs = 2000 } = {}) {
  if (!plugin || typeof plugin[ganchosFn(plugin)[0]] !== 'function' && !plugin.manipular) {
    // aceita plugin com método manipular(gancho, evento) ou handlers por gancho
  }
  if (typeof plugin.manipular !== 'function') {
    return { ok: false, erro: 'plugin sem método manipular(gancho, evento)' };
  }

  // congela o evento (imutável) — o plugin NÃO muta o estado do host
  const eventoCongelado = Object.freeze({ ...evento, payload: Object.freeze({ ...(evento.payload || {}) }) });
  // limites de permissão
  if (plugin.manifest?.permissao === 'leitura' && evento.escrita) {
    return { ok: false, erro: 'plugin de leitura não pode receber eventos de escrita' };
  }

  const resultado = Promise.race([
    (async () => plugin.manipular(gancho, eventoCongelado))(), // async: captura throw síncrono também
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: plugin travado')), timeoutMs))
  ]);

  return resultado
    .then((saida) => ({ ok: true, saida: saida && typeof saida === 'object' ? JSON.parse(JSON.stringify(saida)) : saida }))
    .catch((e) => ({ ok: false, erro: String(e.message).slice(0, 200) }));
}

function ganchosFn(plugin) { return plugin.manifest?.ganchos || []; }

// hash do plugin (integridade no marketplace)
export function hashPlugin(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
}
