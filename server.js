// API do marketplace. Plugins só executam se um handler confiável do host estiver registrado.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarLojaPersistente } from './src/loja.js';
import { criarAuth } from './src/auth.js';
import { obterHandler, executarSandbox, hashPlugin, validarManifest } from './src/sandbox.js';
import './src/host-handlers.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3900);
const DB_PATH = process.env.DATABASE_PATH || 'plugin-market.db';
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT inválida');

const loja = criarLojaPersistente(DB_PATH);
const auth = criarAuth(loja, {
  jwtSecret: process.env.JWT_SECRET,
  adminEmail: process.env.PLUGIN_ADMIN_EMAIL,
  adminPassword: process.env.PLUGIN_ADMIN_PASSWORD
});
await auth.provisionarAdmin();

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '256kb', strict: true }));

function responderErro(res, status, codigo, mensagem) {
  return res.status(status).json({ erro: { codigo, mensagem } });
}

// Rate limiter simples por processo, com janela fixa, limpeza e limite de memória.
function criarRateLimitador({ max, janelaMs, chave }) {
  const buckets = new Map();
  let requisicoes = 0;
  return (req, res, next) => {
    const agora = Date.now();
    if (++requisicoes % 100 === 0) {
      for (const [id, bucket] of buckets) if (bucket.fim <= agora) buckets.delete(id);
    }
    const id = chave(req);
    let bucket = buckets.get(id);
    if (!bucket || bucket.fim <= agora) {
      if (buckets.size >= 20000) buckets.delete(buckets.keys().next().value);
      bucket = { total: 0, fim: agora + janelaMs };
      buckets.set(id, bucket);
    }
    bucket.total += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.total)));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.fim / 1000)));
    if (bucket.total > max) return responderErro(res, 429, 'limite-excedido', 'limite de requisições atingido; tente novamente depois');
    return next();
  };
}

const porIp = (req) => req.ip || req.socket.remoteAddress || 'desconhecido';
const limiteAuth = criarRateLimitador({ max: 20, janelaMs: 15 * 60_000, chave: porIp });
const limitePublicacao = criarRateLimitador({ max: 10, janelaMs: 60 * 60_000, chave: (req) => req.usuario.id });
const limiteEstrela = criarRateLimitador({ max: 30, janelaMs: 60 * 60_000, chave: (req) => req.usuario.id });
const limiteExecucao = criarRateLimitador({ max: 100, janelaMs: 60_000, chave: (req) => `${req.usuario.id}:${req.params.nome}` });
const execucoesAtivas = new Map();

app.post('/api/auth/register', limiteAuth, auth.registrar);
app.post('/api/auth/login', limiteAuth, auth.login);
app.get('/api/auth/me', auth.exigirToken, (req, res) => {
  const { id, email, papel } = req.usuario;
  res.json({ usuario: { id, email, papel } });
});

app.get('/api/plugins', auth.identificarOpcional, (req, res) => {
  const plugins = loja.listar({ usuarioId: req.usuario?.id || '__anonimo__' });
  res.json(plugins.map(({ manifest, hash, instalado, mediaEstrelas, totalEstrelas }) => ({
    nome: manifest.nome,
    versao: manifest.versao,
    descricao: manifest.descricao || '',
    ganchos: manifest.ganchos,
    permissao: manifest.permissao,
    hash,
    instalado,
    mediaEstrelas,
    totalEstrelas
  })));
});

app.post('/api/plugins', auth.exigirToken, auth.exigirPapel('publisher', 'admin'), limitePublicacao, (req, res) => {
  const manifest = req.body?.manifest || req.body;
  const codigo = req.body?.manifest ? req.body.codigo : (typeof req.body?.codigo === 'string' ? req.body.codigo : '');
  if (typeof codigo !== 'string' || Buffer.byteLength(codigo) > 64 * 1024) {
    return responderErro(res, 400, 'codigo-invalido', 'codigo deve ser texto com até 64 KB');
  }
  const erros = validarManifest(manifest);
  if (erros.length) return responderErro(res, 400, 'manifest', erros.join('; '));
  const resultado = loja.publicar(manifest, codigo, { status: 'pendente', publicadoPor: req.usuario.id });
  return res.status(resultado.publicada ? 201 : 200).json(resultado);
});

app.post('/api/plugins/:nome/instalar', auth.exigirToken, (req, res) => {
  if (!loja.instalar(req.params.nome, req.usuario.id)) {
    return responderErro(res, 404, 'plugin-indisponivel', 'plugin não existe ou ainda não foi aprovado');
  }
  return res.json({ instalado: true, nome: req.params.nome });
});

app.post('/api/plugins/:nome/estrela', auth.exigirToken, limiteEstrela, (req, res) => {
  const nota = Number(req.body?.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return responderErro(res, 400, 'nota-invalida', 'nota deve ser um inteiro entre 1 e 5');
  const resultado = loja.estrela(req.params.nome, nota, req.usuario.id);
  if (!resultado) return responderErro(res, 404, 'plugin-indisponivel', 'plugin não existe ou ainda não foi aprovado');
  return res.json(resultado);
});

app.post('/api/plugins/:nome/executar', auth.exigirToken, auth.exigirPapel('publisher', 'admin'), limiteExecucao, async (req, res) => {
  if (Object.hasOwn(req.body || {}, 'handler') || Object.hasOwn(req.body || {}, 'codigo')) {
    return responderErro(res, 400, 'handler-remoto', 'handlers e código enviados pela requisição não são aceitos');
  }
  const plugin = loja.buscarPlugin(req.params.nome);
  if (!plugin || plugin.status !== 'aprovado') return responderErro(res, 404, 'plugin-indisponivel', 'plugin não existe ou ainda não foi aprovado');
  if (req.usuario.papel !== 'admin' && plugin.publicado_por !== req.usuario.id) {
    return responderErro(res, 403, 'sem-permissao', 'publisher só pode executar os próprios plugins');
  }
  if (!loja.estaInstalado(plugin.nome, req.usuario.id)) return responderErro(res, 409, 'nao-instalado', 'instale antes de executar');
  const gancho = req.body?.gancho;
  if (typeof gancho !== 'string' || !plugin.manifest.ganchos.includes(gancho)) {
    return responderErro(res, 400, 'gancho-invalido', 'informe um gancho declarado no manifest');
  }
  const evento = req.body?.evento ?? {};
  if (!evento || typeof evento !== 'object' || Array.isArray(evento)) return responderErro(res, 400, 'evento-invalido', 'evento deve ser um objeto JSON');
  const handler = obterHandler(plugin.nome);
  if (!handler) return responderErro(res, 409, 'handler-nao-registrado', 'o host não registrou um handler confiável para este plugin');
  if (hashPlugin(plugin.manifest, handler.toString()) !== plugin.hash) {
    return responderErro(res, 409, 'integridade', 'o handler registrado não corresponde ao artefato publicado');
  }
  const ativas = execucoesAtivas.get(plugin.nome) || 0;
  if (ativas >= 3) return responderErro(res, 429, 'concorrencia', 'limite de execuções simultâneas deste plugin atingido');

  execucoesAtivas.set(plugin.nome, ativas + 1);
  let liberado = false;
  const liberarExecucao = () => {
    if (liberado) return;
    liberado = true;
    const restante = (execucoesAtivas.get(plugin.nome) || 1) - 1;
    if (restante > 0) execucoesAtivas.set(plugin.nome, restante);
    else execucoesAtivas.delete(plugin.nome);
  };
  const inicio = performance.now();
  let resultado;
  try {
    resultado = await executarSandbox(
      { manifest: plugin.manifest, manipular: handler }, gancho, evento,
      { onHandlerSettled: liberarExecucao }
    );
  } catch {
    liberarExecucao();
    resultado = { ok: false, erro: 'falha interna ao executar o handler' };
  }
  try {
    loja.telemetria(plugin.nome, gancho, resultado.ok, performance.now() - inicio);
  } catch (falha) {
    console.error('Falha ao gravar telemetria:', falha?.message || falha);
  }
  return res.status(resultado.ok ? 200 : 422).json(resultado);
});

app.get('/api/plugins/:nome/metricas', auth.exigirToken, auth.exigirPapel('publisher', 'admin'), (req, res) => {
  const plugin = loja.buscarPlugin(req.params.nome);
  if (!plugin) return responderErro(res, 404, 'plugin-inexistente', 'plugin não encontrado');
  if (req.usuario.papel !== 'admin' && plugin.publicado_por !== req.usuario.id) return responderErro(res, 403, 'sem-permissao', 'métricas disponíveis apenas ao publisher responsável');
  return res.json(loja.metricasTelemetria(req.params.nome));
});

app.get('/api/admin/users', auth.exigirToken, auth.exigirPapel('admin'), (req, res) => res.json(loja.listarUsuarios()));
app.post('/api/admin/users/:id/publisher', auth.exigirToken, auth.exigirPapel('admin'), (req, res) => {
  if (!loja.promoverPublisher(req.params.id)) return responderErro(res, 404, 'usuario-invalido', 'usuário não encontrado ou já é publisher');
  return res.json({ promovido: true, id: req.params.id, papel: 'publisher' });
});
app.get('/api/admin/plugins', auth.exigirToken, auth.exigirPapel('admin'), (req, res) => {
  res.json(loja.listar({ incluirPendentes: true, incluirCodigo: true }).filter((plugin) => plugin.status !== 'aprovado'));
});
app.post('/api/admin/plugins/:nome/revisao', auth.exigirToken, auth.exigirPapel('admin'), (req, res) => {
  const { status } = req.body || {};
  if (!['aprovado', 'rejeitado'].includes(status)) return responderErro(res, 400, 'status-invalido', 'status deve ser aprovado ou rejeitado');
  if (!loja.definirStatusPlugin(req.params.nome, status, req.usuario.id)) return responderErro(res, 404, 'plugin-inexistente', 'plugin não encontrado');
  return res.json({ nome: req.params.nome, status });
});

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
app.use('/api', (req, res) => responderErro(res, 404, 'rota-inexistente', 'rota da API não encontrada'));
app.use(async (req, res) => {
  const raizPublica = resolve(ROOT, 'public');
  let caminho;
  try {
    const caminhoSolicitado = decodeURIComponent(req.path);
    caminho = caminhoSolicitado === '/' ? resolve(raizPublica, 'index.html') : resolve(raizPublica, `.${caminhoSolicitado}`);
  } catch {
    return res.status(400).end();
  }
  const relativo = relative(raizPublica, caminho);
  if (relativo.startsWith(`..${sep}`) || relativo === '..' || caminho === raizPublica) {
    return res.status(404).end();
  }
  try {
    const arquivo = await readFile(caminho);
    return res.type(MIME[extname(caminho)] || 'application/octet-stream').send(arquivo);
  } catch {
    if (extname(req.path)) return res.status(404).end();
    const indice = await readFile(resolve(raizPublica, 'index.html'));
    return res.type(MIME['.html']).send(indice);
  }
});

app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  if (erro?.type === 'entity.too.large') return responderErro(res, 413, 'payload-grande', 'o corpo da requisição excede 256 KB');
  if (erro instanceof SyntaxError && erro.status === 400) return responderErro(res, 400, 'json-invalido', 'corpo JSON inválido');
  console.error('Falha na requisição:', erro?.message || erro);
  return responderErro(res, 500, 'erro-interno', 'erro interno do servidor');
});

const server = http.createServer(app);
export { app, server, loja };

if (!process.env.NO_LISTEN) server.listen(PORT, () => console.log(`Plugin Market em http://localhost:${PORT}`));
