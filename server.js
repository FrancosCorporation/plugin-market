// Plugin Market — servidor: API do marketplace (publicação, instalação, reviews) + execução sandboxed.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarManifest, executarSandbox, hashPlugin } from './src/sandbox.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3900;

// loja em memória (M1); sqlite em M2
const plugins = new Map(); // nome -> { manifest, hash, estrelas: [] }
const instalados = new Set();

const app = express();
app.use(express.json());

// marketplace
app.get('/api/plugins', (req, res) => {
  res.json([...plugins.values()].map(({ manifest, hash, estrelas }) => ({
    nome: manifest.nome, versao: manifest.versao, descricao: manifest.descricao,
    ganchos: manifest.ganchos, permissao: manifest.permissao, hash,
    mediaEstrelas: estrelas.length ? estrelas.reduce((t, s) => t + s, 0) / estrelas.length : 0,
    instalado: instalados.has(manifest.nome)
  })));
});

// publica um plugin (valida manifest — CI roda a mesma validação!)
app.post('/api/plugins', (req, res) => {
  const manifest = req.body;
  const erros = validarManifest(manifest);
  if (erros.length) return res.status(400).json({ erro: { codigo: 'manifest', mensagem: erros.join('; ') } });
  const hash = hashPlugin(manifest);
  if (plugins.has(manifest.nome) && plugins.get(manifest.nome).hash === hash) {
    return res.status(200).json({ publicada: false, motivo: 'idêntico' });
  }
  plugins.set(manifest.nome, { manifest, hash, estrelas: [] });
  res.status(201).json({ publicada: true, nome: manifest.nome, hash });
});

app.post('/api/plugins/:nome/instalar', (req, res) => {
  const p = plugins.get(req.params.nome);
  if (!p) return res.status(404).json({ erro: { codigo: '404', mensagem: 'plugin não publicado' } });
  instalados.add(req.params.nome);
  res.json({ instalado: true, nome: p.manifest.nome });
});

app.post('/api/plugins/:nome/estrela', (req, res) => {
  const p = plugins.get(req.params.nome);
  if (!p) return res.status(404).json({ erro: { codigo: '404', mensagem: 'plugin não publicado' } });
  const nota = Number(req.body?.nota);
  if (!(nota >= 1 && nota <= 5)) return res.status(400).json({ erro: { codigo: 'nota', mensagem: 'nota 1-5' } });
  p.estrelas.push(nota);
  res.json({ media: p.estrelas.reduce((t, s) => t + s, 0) / p.estrelas.length });
});

// execução SANDBOXED de um plugin instalado (o handler chega no corpo — M2: registrado no SDK)
app.post('/api/plugins/:nome/executar', async (req, res) => {
  const p = plugins.get(req.params.nome);
  if (!p) return res.status(404).json({ erro: { codigo: '404', mensagem: 'plugin não publicado' } });
  if (!instalados.has(req.params.nome)) {
    return res.status(409).json({ erro: { codigo: 'nao-instalado', mensagem: 'instale antes de executar' } });
  }
  const handler = req.body?.handler;
  if (typeof handler !== 'function') {
    return res.status(400).json({ erro: { codigo: 'handler', mensagem: 'handler (função) obrigatório no corpo' } });
  }
  const resultado = await executarSandbox(
    { manifest: p.manifest, manipular: handler },
    req.body?.gancho || p.manifest.ganchos[0],
    req.body?.evento || {}
  );
  res.json(resultado);
});

// estático (painel)
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  try {
    let arquivo = normalize(join(ROOT, 'public', req.path));
    if (!arquivo.startsWith(ROOT)) throw new Error('fora');
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'text/html; charset=utf-8' });
    res.end(dados);
  } catch {
    try {
      const indice = await readFile(join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indice);
    } catch { res.writeHead(500); res.end('erro'); }
  }
});

const server = http.createServer(app);
export { server, plugins, instalados };

if (!process.env.NO_LISTEN) {
  server.listen(PORT, () => console.log(`Plugin Market em http://localhost:${PORT}`));
}
