# Plugin Market

Marketplace de extensões com autenticação, papéis de usuário, moderação, armazenamento SQLite e uma vitrine web responsiva. O projeto requer Node.js 22.5 ou mais recente porque usa `node:sqlite`.

## Início rápido com Docker

```bash
cp .env.example .env
# Edite JWT_SECRET e PLUGIN_ADMIN_PASSWORD com valores próprios e fortes.
docker compose up --build
```

A interface fica em `http://localhost:3900`. Por padrão, o Compose publica a porta apenas no loopback e persiste o banco no volume `plugin-market-data`.

Para executar sem Docker:

```bash
npm ci
export JWT_SECRET="use-aqui-um-segredo-aleatorio-com-pelo-menos-32-bytes"
export PLUGIN_ADMIN_EMAIL="admin@example.com"
export PLUGIN_ADMIN_PASSWORD="uma-senha-forte-com-12-a-200-caracteres"
npm start
```

`DATABASE_PATH` define o arquivo SQLite e `PORT` define a porta HTTP. O servidor encerra a inicialização se a chave ou a conta administrativa não estiverem configuradas corretamente. A senha administrativa deve ter de 12 a 200 caracteres e é provisionada a partir do ambiente em cada inicialização.

## Contas e papéis

- Uma conta nova começa como `user` e pode instalar e avaliar plugins aprovados.
- A conta administrativa inicial, definida por `PLUGIN_ADMIN_EMAIL` e `PLUGIN_ADMIN_PASSWORD`, pode promover contas para `publisher` e aprovar ou rejeitar publicações.
- `publisher` pode enviar plugins para revisão e executar os próprios plugins aprovados.
- Os tokens Bearer expiram em oito horas. A interface os mantém apenas na sessão atual do navegador.

Rotas principais:

| Método e rota | Acesso | Uso |
|---|---|---|
| `POST /api/auth/register` | Público, limitado por IP | Criar conta (`email`, `senha`) |
| `POST /api/auth/login` | Público, limitado por IP | Entrar e receber token |
| `GET /api/plugins` | Público | Listar apenas plugins aprovados |
| `POST /api/plugins` | Publisher ou admin | Enviar `{ "manifest": {...}, "codigo": "..." }` para revisão |
| `POST /api/plugins/:nome/instalar` | Conta autenticada | Instalar plugin aprovado |
| `POST /api/plugins/:nome/estrela` | Conta autenticada | Avaliar de 1 a 5; uma avaliação por conta |
| `POST /api/plugins/:nome/executar` | Publisher ou admin | Executar handler do host, com `{ "gancho": "...", "evento": {...} }` |
| `GET /api/plugins/:nome/metricas` | Publisher responsável ou admin | Consultar contagem, taxa de sucesso e latências |
| `GET /api/admin/users` | Admin | Consultar contas |
| `POST /api/admin/users/:id/publisher` | Admin | Promover uma conta |
| `GET /api/admin/plugins` | Admin | Ver publicações pendentes e rejeitadas |
| `POST /api/admin/plugins/:nome/revisao` | Admin | Definir `status` como `aprovado` ou `rejeitado` |

Envie o token no cabeçalho `Authorization: Bearer <token>`. Publicações novas ou alteradas ficam `pendente`; somente plugins aprovados aparecem na vitrine, aceitam instalação ou podem ser executados.

## Execução de handlers

Uma função JavaScript não atravessa JSON. Por isso `/executar` aceita apenas dados: o nome do gancho e o evento. Campos `handler` ou `codigo` no corpo são recusados. O servidor procura a função no registro interno de handlers.

Para integrar um handler, importe o módulo revisado em `src/host-handlers.js` e registre a função confiável:

```js
import { registrarHandler } from './sandbox.js';

registrarHandler('contador-cards', function manipular(gancho, evento) {
  return { recebeu: gancho, titulo: evento.payload?.titulo ?? null };
});
```

Ao publicar, o campo `codigo` precisa corresponder ao texto retornado por `handler.toString()` para que o hash SHA-256 do manifesto e do código verifique a integridade. O código enviado é armazenado como artefato de revisão; ele nunca é importado, avaliado ou executado pela API. A execução só funciona quando o handler confiável correspondente foi carregado no host e o plugin está instalado e aprovado.

O executor clona dados JSON, congela o evento profundamente, verifica o gancho declarado e a permissão, captura erros e limita o tempo de espera de handlers assíncronos. Esse timeout não interrompe um loop síncrono. Portanto, handlers precisam ser código mantido e revisado pelo host. Executar código de terceiros exige isolamento real de processo ou contêiner, que este projeto ainda não fornece.

## Segurança e operação

- Corpo JSON limitado a 256 KB; código de plugin limitado a 64 KB.
- Login, cadastro, publicação, avaliações e execução têm limites de frequência; cada plugin permite até três execuções simultâneas.
- Hash completo SHA-256 cobre o manifesto canonicalizado e o código armazenado. O banco existente recebe uma migração aditiva na inicialização.
- O servidor usa cabeçalhos de segurança e não renderiza dados de plugin como HTML.
- `npm run check` executa verificações de sintaxe. O workflow também falha se encontrar `eval(...)` ou `new Function(...)` no host.

Consulte [SECURITY.md](SECURITY.md) para o modelo de segurança e o canal de reporte.

## Desenvolvimento

```bash
npm ci
npm run check
npm test
```

O arquivo `MELHORIAS.md` registra os critérios de implementação e as verificações concluídas.

## Licença

MIT — Rodolfo Franco ([FrancosCorporation](https://github.com/FrancosCorporation)).
