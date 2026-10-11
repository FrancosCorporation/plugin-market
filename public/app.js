const tokenKey = 'plugin-market-token';
const pluginList = document.querySelector('#plugin-list');
const notice = document.querySelector('#notice');
let usuarioAtual = null;

function token() { return sessionStorage.getItem(tokenKey); }

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token()) headers.set('Authorization', `Bearer ${token()}`);
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(tokenKey);
    throw new Error(body.erro?.mensagem || `A solicitação falhou (${response.status})`);
  }
  return body;
}

function avisar(mensagem, tipo = '') {
  notice.textContent = mensagem;
  notice.className = `notice ${tipo}`.trim();
}

function botaoRotulo(texto, classe = 'button-secondary') {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = classe;
  botao.textContent = texto;
  return botao;
}

function atualizarSessao() {
  const session = document.querySelector('#session');
  session.replaceChildren();
  document.querySelector('#auth-panel').classList.toggle('hidden', Boolean(usuarioAtual));
  document.querySelector('#publisher-panel').classList.toggle('hidden', !['publisher', 'admin'].includes(usuarioAtual?.papel));
  document.querySelector('#admin-panel').classList.toggle('hidden', usuarioAtual?.papel !== 'admin');
  if (!usuarioAtual) return;

  const nome = document.createElement('span');
  nome.className = 'session-name';
  nome.textContent = `${usuarioAtual.email} · ${usuarioAtual.papel}`;
  const sair = botaoRotulo('Sair');
  sair.addEventListener('click', () => {
    sessionStorage.removeItem(tokenKey);
    usuarioAtual = null;
    atualizarSessao();
    atualizarTudo();
  });
  session.append(nome, sair);
}

function criarCard(plugin) {
  const card = document.createElement('article');
  card.className = 'plugin-card';

  const topo = document.createElement('div');
  topo.className = 'card-top';
  const permissao = document.createElement('span');
  permissao.className = `badge ${plugin.permissao === 'escrita' ? 'badge-write' : 'badge-read'}`;
  permissao.textContent = plugin.permissao === 'escrita' ? 'Escrita' : 'Leitura';
  const versao = document.createElement('span');
  versao.className = 'version';
  versao.textContent = `v${plugin.versao}`;
  topo.append(permissao, versao);

  const titulo = document.createElement('h3');
  titulo.textContent = plugin.nome;
  const descricao = document.createElement('p');
  descricao.className = 'description';
  descricao.textContent = plugin.descricao || 'Sem descrição.';
  const ganchos = document.createElement('p');
  ganchos.className = 'meta';
  ganchos.textContent = `Eventos: ${plugin.ganchos.join(', ')}`;
  const hash = document.createElement('p');
  hash.className = 'meta hash';
  hash.textContent = `SHA-256 ${plugin.hash.slice(0, 16)}…`;
  const rating = document.createElement('p');
  rating.className = 'rating';
  rating.textContent = `★ ${Number(plugin.mediaEstrelas || 0).toFixed(1)} · ${plugin.totalEstrelas || 0} avaliações`;
  card.append(topo, titulo, descricao, ganchos, hash, rating);

  const acoes = document.createElement('div');
  acoes.className = 'card-actions';
  if (usuarioAtual) {
    const instalar = botaoRotulo(plugin.instalado ? 'Instalado' : 'Instalar', plugin.instalado ? 'button-installed' : '');
    instalar.disabled = plugin.instalado;
    instalar.addEventListener('click', async () => {
      try {
        await api(`/api/plugins/${encodeURIComponent(plugin.nome)}/instalar`, { method: 'POST' });
        avisar(`${plugin.nome} foi instalado.`, 'success');
        await carregarPlugins();
      } catch (erro) { avisar(erro.message, 'error'); }
    });

    const nota = document.createElement('select');
    nota.setAttribute('aria-label', `Avaliação para ${plugin.nome}`);
    for (let valor = 5; valor >= 1; valor -= 1) {
      const opcao = document.createElement('option');
      opcao.value = String(valor);
      opcao.textContent = `${valor} ★`;
      nota.append(opcao);
    }
    const avaliar = botaoRotulo('Avaliar');
    avaliar.addEventListener('click', async () => {
      try {
        await api(`/api/plugins/${encodeURIComponent(plugin.nome)}/estrela`, { method: 'POST', body: JSON.stringify({ nota: Number(nota.value) }) });
        avisar('Sua avaliação foi salva.', 'success');
        await carregarPlugins();
      } catch (erro) { avisar(erro.message, 'error'); }
    });
    acoes.append(instalar, nota, avaliar);
  } else {
    const login = document.createElement('span');
    login.className = 'muted';
    login.textContent = 'Entre para instalar e avaliar';
    acoes.append(login);
  }
  card.append(acoes);
  return card;
}

async function carregarPlugins() {
  pluginList.replaceChildren();
  try {
    const plugins = await api('/api/plugins');
    if (!plugins.length) {
      const vazio = document.createElement('p');
      vazio.className = 'empty-state';
      vazio.textContent = 'Ainda não há plugins aprovados. Volte em breve.';
      pluginList.append(vazio);
      return;
    }
    for (const plugin of plugins) pluginList.append(criarCard(plugin));
  } catch (erro) { avisar(erro.message, 'error'); }
}

async function carregarAdmin() {
  if (usuarioAtual?.papel !== 'admin') return;
  const pendentes = document.querySelector('#pending-list');
  const usuarios = document.querySelector('#user-list');
  pendentes.replaceChildren();
  usuarios.replaceChildren();
  try {
    const [plugins, contas] = await Promise.all([api('/api/admin/plugins'), api('/api/admin/users')]);
    if (!plugins.length) {
      const texto = document.createElement('p');
      texto.className = 'muted';
      texto.textContent = 'Nenhum plugin pendente.';
      pendentes.append(texto);
    }
    for (const plugin of plugins) {
      const linha = document.createElement('div');
      linha.className = 'moderation-row';
      const texto = document.createElement('span');
      texto.textContent = `${plugin.nome} · ${plugin.status} · ${plugin.publicadoPor || 'sem publicador'}`;
      const detalhes = document.createElement('details');
      const resumo = document.createElement('summary');
      resumo.textContent = 'Ver manifesto e código enviado';
      const codigo = document.createElement('pre');
      codigo.className = 'review-code';
      codigo.textContent = `${JSON.stringify(plugin.manifest, null, 2)}\n\n${plugin.codigo || '(sem código enviado)'}`;
      detalhes.append(resumo, codigo);
      linha.append(texto, detalhes);
      if (plugin.status === 'pendente') {
        for (const [status, rotulo] of [['aprovado', 'Aprovar'], ['rejeitado', 'Rejeitar']]) {
          const botao = botaoRotulo(rotulo, status === 'aprovado' ? '' : 'button-danger');
          botao.addEventListener('click', async () => {
            try {
              await api(`/api/admin/plugins/${encodeURIComponent(plugin.nome)}/revisao`, { method: 'POST', body: JSON.stringify({ status }) });
              avisar(`${plugin.nome}: ${status}.`, 'success');
              await atualizarTudo();
            } catch (erro) { avisar(erro.message, 'error'); }
          });
          linha.append(botao);
        }
      }
      pendentes.append(linha);
    }
    for (const conta of contas) {
      const linha = document.createElement('div');
      linha.className = 'moderation-row';
      const texto = document.createElement('span');
      texto.textContent = `${conta.email} · ${conta.papel}`;
      linha.append(texto);
      if (conta.papel === 'user') {
        const promover = botaoRotulo('Tornar publisher');
        promover.addEventListener('click', async () => {
          try {
            await api(`/api/admin/users/${encodeURIComponent(conta.id)}/publisher`, { method: 'POST' });
            avisar(`${conta.email} agora pode enviar plugins.`, 'success');
            await carregarAdmin();
          } catch (erro) { avisar(erro.message, 'error'); }
        });
        linha.append(promover);
      }
      usuarios.append(linha);
    }
  } catch (erro) { avisar(erro.message, 'error'); }
}

async function atualizarTudo() {
  await Promise.all([carregarPlugins(), carregarAdmin()]);
}

async function autenticar(event, rota) {
  event.preventDefault();
  const dados = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const resposta = await api(rota, { method: 'POST', body: JSON.stringify(dados) });
    sessionStorage.setItem(tokenKey, resposta.token);
    usuarioAtual = resposta.usuario;
    atualizarSessao();
    avisar(`Bem-vindo, ${usuarioAtual.email}.`, 'success');
    await atualizarTudo();
  } catch (erro) { avisar(erro.message, 'error'); }
}

document.querySelector('#login-form').addEventListener('submit', (event) => autenticar(event, '/api/auth/login'));
document.querySelector('#register-form').addEventListener('submit', (event) => autenticar(event, '/api/auth/register'));
document.querySelector('#refresh-button').addEventListener('click', atualizarTudo);
document.querySelector('#publish-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  let manifest;
  try { manifest = JSON.parse(form.get('manifest')); }
  catch { avisar('O manifesto precisa ser um JSON válido.', 'error'); return; }
  try {
    const resposta = await api('/api/plugins', { method: 'POST', body: JSON.stringify({ manifest, codigo: form.get('codigo') }) });
    avisar(resposta.publicada ? 'Plugin enviado. Ele ficará oculto até a aprovação de um administrador.' : 'Este artefato já foi publicado.', 'success');
    await atualizarTudo();
  } catch (erro) { avisar(erro.message, 'error'); }
});

async function restaurarSessao() {
  if (token()) {
    try { usuarioAtual = (await api('/api/auth/me')).usuario; }
    catch { sessionStorage.removeItem(tokenKey); }
  }
  atualizarSessao();
  await atualizarTudo();
}

restaurarSessao();
