import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DURACAO_TOKEN_SEG = 8 * 60 * 60;

function erro(res, status, codigo, mensagem) {
  return res.status(status).json({ erro: { codigo, mensagem } });
}

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

export function validarConfiguracaoAuth({ jwtSecret, adminEmail, adminPassword }) {
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 bytes');
  if (typeof adminEmail !== 'string' || adminEmail.length > 254 || !EMAIL_RE.test(adminEmail)) throw new Error('PLUGIN_ADMIN_EMAIL deve ser um e-mail válido');
  if (typeof adminPassword !== 'string' || adminPassword.length < 12 || adminPassword.length > 200) {
    throw new Error('PLUGIN_ADMIN_PASSWORD deve ter entre 12 e 200 caracteres');
  }
}

async function gerarHashSenha(senha) {
  const salt = randomBytes(16);
  const hash = await scrypt(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(hash).toString('base64url')}`;
}

async function verificarSenha(senha, registro) {
  const [algoritmo, saltTexto, hashTexto] = String(registro || '').split('$');
  const salt = saltTexto ? Buffer.from(saltTexto, 'base64url') : Buffer.alloc(0);
  const esperado = hashTexto ? Buffer.from(hashTexto, 'base64url') : Buffer.alloc(0);
  if (algoritmo !== 'scrypt' || salt.length !== 16 || esperado.length !== 64) {
    // Mantém custo semelhante para e-mails inexistentes e evita enumeração por tempo.
    await scrypt(senha, Buffer.from('MDEyMzQ1Njc4OWFiY2RlZg', 'base64url'), 64, { N: 16384, r: 8, p: 1 });
    return false;
  }
  const recebido = Buffer.from(await scrypt(senha, salt, esperado.length, { N: 16384, r: 8, p: 1 }));
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export function criarAuth(loja, { jwtSecret, adminEmail, adminPassword }) {
  validarConfiguracaoAuth({ jwtSecret, adminEmail, adminPassword });

  function assinar(payload) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const corpo = base64url(JSON.stringify(payload));
    const assinatura = createHmac('sha256', jwtSecret).update(`${header}.${corpo}`).digest('base64url');
    return `${header}.${corpo}.${assinatura}`;
  }

  function decodificar(token) {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const partes = token.split('.');
    if (partes.length !== 3) return null;
    const [headerTexto, payloadTexto, assinaturaTexto] = partes;
    try {
      const header = JSON.parse(Buffer.from(headerTexto, 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(payloadTexto, 'base64url').toString('utf8'));
      if (header.alg !== 'HS256' || typeof payload.sub !== 'string' || !Number.isInteger(payload.exp)) return null;
      const assinatura = Buffer.from(assinaturaTexto, 'base64url');
      const esperada = createHmac('sha256', jwtSecret).update(`${headerTexto}.${payloadTexto}`).digest();
      if (assinatura.length !== esperada.length || !timingSafeEqual(assinatura, esperada)) return null;
      if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function emitirToken(usuario) {
    const agora = Math.floor(Date.now() / 1000);
    return assinar({ sub: usuario.id, iat: agora, exp: agora + DURACAO_TOKEN_SEG });
  }

  async function provisionarAdmin() {
    const senhaHash = await gerarHashSenha(adminPassword);
    loja.provisionarAdmin(adminEmail.trim().toLowerCase(), senhaHash);
  }

  async function registrar(req, res) {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const senha = req.body?.senha;
    if (email.length > 254 || !EMAIL_RE.test(email) || typeof senha !== 'string' || senha.length < 12 || senha.length > 200) {
      return erro(res, 400, 'dados-invalidos', 'informe um e-mail válido e senha com 12 a 200 caracteres');
    }
    try {
      const senhaHash = await gerarHashSenha(senha);
      const usuario = loja.criarUsuario(email, senhaHash);
      return res.status(201).json({ usuario, token: emitirToken(usuario) });
    } catch (falha) {
      if (String(falha.message).includes('UNIQUE constraint failed')) return erro(res, 409, 'email-existente', 'já existe uma conta com este e-mail');
      throw falha;
    }
  }

  async function login(req, res) {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const usuario = email.length <= 254 ? loja.buscarUsuarioPorEmail(email) : null;
    const dentroDoLimite = senha.length <= 200;
    const valido = await verificarSenha(dentroDoLimite ? senha : '', usuario?.senha_hash);
    if (!usuario || !dentroDoLimite || !valido) return erro(res, 401, 'credenciais-invalidas', 'e-mail ou senha inválidos');
    return res.json({ usuario: { id: usuario.id, email: usuario.email, papel: usuario.papel }, token: emitirToken(usuario) });
  }

  function exigirToken(req, res, next) {
    identificarOpcional(req, res, (falha) => {
      if (falha) return next(falha);
      if (!req.usuario) return erro(res, 401, 'nao-autenticado', 'token ausente, inválido ou expirado');
      return next();
    });
  }

  function identificarOpcional(req, res, next) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    const payload = match && decodificar(match[1]);
    const usuario = payload && loja.buscarUsuarioPorId(payload.sub);
    if (usuario) req.usuario = usuario;
    return next();
  }

  function exigirPapel(...papeis) {
    return (req, res, next) => {
      if (!req.usuario) return erro(res, 401, 'nao-autenticado', 'autenticação obrigatória');
      if (!papeis.includes(req.usuario.papel)) return erro(res, 403, 'sem-permissao', 'papel não autorizado para esta ação');
      return next();
    };
  }

  return { provisionarAdmin, registrar, login, identificarOpcional, exigirToken, exigirPapel };
}
