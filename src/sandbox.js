// Contrato do SDK. Handlers são funções confiáveis registradas pelo host; código HTTP nunca é avaliado.
import { createHash } from 'node:crypto';

export const MANIFEST_EXEMPLO = {
  nome: 'meu-plugin',
  versao: '1.0.0',
  descricao: 'exemplo',
  ganchos: ['card-criado', 'card-movido'],
  permissao: 'leitura'
};

const GANCHOS_VALIDOS = ['card-criado', 'card-movido', 'card-apagado', 'board-criado'];
const handlers = new Map();

export function validarSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { maior: Number(m[1]), menor: Number(m[2]), patch: Number(m[3]) };
}

export function compativel(versaoPlugin, versaoHost) {
  const p = validarSemver(versaoPlugin), h = validarSemver(versaoHost);
  return Boolean(p && h && p.maior === h.maior);
}

export function validarManifest(manifest) {
  const erros = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest deve ser objeto'];
  if (!/^[a-z0-9-]{2,40}$/.test(manifest.nome || '')) erros.push('nome: 2-40, [a-z0-9-]');
  if (!validarSemver(manifest.versao)) erros.push('versão: semver (x.y.z)');
  if (!Array.isArray(manifest.ganchos) || manifest.ganchos.length === 0) erros.push('ganchos: array não vazio');
  else if (manifest.ganchos.some((g) => !GANCHOS_VALIDOS.includes(g)) || new Set(manifest.ganchos).size !== manifest.ganchos.length) {
    erros.push('ganchos: valores permitidos e sem duplicatas (' + GANCHOS_VALIDOS.join(', ') + ')');
  }
  if (!['leitura', 'escrita'].includes(manifest.permissao)) erros.push('permissão: leitura ou escrita');
  if (manifest.descricao !== undefined && (typeof manifest.descricao !== 'string' || manifest.descricao.length > 500)) erros.push('descrição: texto de até 500 caracteres');
  return erros;
}

// Registra somente funções importadas por código do host. O nome é associado ao artefato armazenado.
export function registrarHandler(nomePlugin, handler) {
  if (!/^[a-z0-9-]{2,40}$/.test(nomePlugin) || typeof handler !== 'function') {
    throw new TypeError('nome de plugin e handler confiável são obrigatórios');
  }
  if (handlers.has(nomePlugin)) throw new Error(`handler já registrado para ${nomePlugin}`);
  handlers.set(nomePlugin, handler);
}

export function obterHandler(nomePlugin) {
  return handlers.get(nomePlugin);
}

function canonicalizar(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonicalizar).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((chave) => `${JSON.stringify(chave)}:${canonicalizar(valor[chave])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function hashPlugin(manifest, codigo = '') {
  if (typeof codigo !== 'string') throw new TypeError('codigo deve ser texto');
  return createHash('sha256').update(canonicalizar(manifest)).update('\0').update(codigo).digest('hex');
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const filho of Object.values(valor)) congelarProfundo(filho);
    Object.freeze(valor);
  }
  return valor;
}

export async function executarSandbox(plugin, gancho, evento, { timeoutMs = 2000, onHandlerSettled } = {}) {
  let timer;
  let handlerIniciado = false;
  let notificouConclusao = false;
  const avisarConclusao = () => {
    if (notificouConclusao) return;
    notificouConclusao = true;
    onHandlerSettled?.();
  };
  try {
    const manifest = plugin?.manifest;
    if (!manifest || !Array.isArray(manifest.ganchos) || !manifest.ganchos.includes(gancho)) {
      return { ok: false, erro: 'gancho não declarado no manifest' };
    }
    if (typeof plugin.manipular !== 'function') return { ok: false, erro: 'plugin sem handler confiável registrado' };
    if (manifest.permissao === 'leitura' && evento?.escrita) {
      return { ok: false, erro: 'plugin de leitura não pode receber eventos de escrita' };
    }
    // Eventos HTTP são JSON. A cópia remove protótipos e referências do host antes do congelamento.
    const eventoSeguro = JSON.parse(JSON.stringify(evento ?? {}));
    congelarProfundo(eventoSeguro);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout: handler não respondeu')), timeoutMs);
    });
    const handler = Promise.resolve().then(() => {
      handlerIniciado = true;
      return plugin.manipular(gancho, eventoSeguro);
    });
    handler.then(avisarConclusao, avisarConclusao);
    const saida = await Promise.race([handler, timeout]);
    const saidaJson = saida === undefined ? null : JSON.parse(JSON.stringify(saida));
    return { ok: true, saida: saidaJson };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : 'erro no handler';
    return { ok: false, erro: String(mensagem).slice(0, 200) };
  } finally {
    clearTimeout(timer);
    if (!handlerIniciado) avisarConclusao();
  }
}
