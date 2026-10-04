# MELHORIAS — plugin-market

> **Gerado por análise de código em 2026-10-02** · Stack: Node 22 (Express + `node:sqlite`), zero dependências de runtime
> Branch `main` · 258 LOC (3 arquivos) · **3 suites de teste** · sem CI
>
> **Este arquivo é um plano de execução.** Cada item tem ID, `arquivo:linha`, mudança exata,
> critério de aceite e comando de verificação.

---

## 0. Como usar este documento

1. Execute na ordem **P0 → P1 → P2 → P3**, respeitando as ondas da §8.
2. Ao terminar um item: marque `- [x]`, rode o **Verificação**, comite `fix(<ID>): descrição`.
3. **O desenho do sandbox é correto e deve ser preservado.** `src/sandbox.js:40-68` é uma das poucas
   implementações honestas: sem `eval`, plugin é **função hospedeira**, evento congelado, timeout,
   permissão checada. O teste `test/market-test.mjs:55-58` prova que handler-string é rejeitado.
   **Não "conserte" adicionando `eval` ou `new Function`.**
4. **O problema deste projeto não é RCE — é que o marketplace inteiro não tem auth e a rota de
   execução não funciona.** Trate nessa ordem (§3).
5. **Idioma:** português; commits em inglês com `fix:`/`feat:`/`docs:`.

---

## 1. Diagnóstico executivo

Marketplace de plugins com SDK, validação de manifest, compatibilidade semver, execução "sandboxed",
revisões e telemetria. Três testes cobrem bem o núcleo.

**O que está bem (não reaça):**

| Item | Evidência |
|---|---|
| **Sem `eval`/`new Function`** — plugin é função hospedeira | `sandbox.js:44` (comentário explícito) |
| Evento **congelado** (imutável) para o plugin | `sandbox.js:54` (`Object.freeze`) |
| Timeout no handler (plugin travado não derruba o host) | `sandbox.js:62` (`Promise.race` + timeout) |
| Permissão `leitura`/`escrita` checada antes de executar | `sandbox.js:56-58` |
| Saída do plugin é re-serializada (não vaza referência interna) | `sandbox.js:66` |
| Manifest validado com **allowlist** de ganchos | `sandbox.js:34-35` (`GANCHOS_VALIDOS`) |
| Semver validado e compatibilidade checada | `sandbox.js:14-25` |
| Erro do plugin truncado (não despeja stack) | `sandbox.js:67` (`slice(0,200)`) |
| Tester **rejeita** handler-string explicitamente | `test/market-test.mjs:55-58` |
| SQL parametrizado | `loja.js:39-42,47,54` |
| Nota de estrela com CHECK 1-5 | `loja.js:20` |

**O que está quebrado:**

1. **Marketplace inteiro sem autenticação**: publicar, instalar, avaliar e executar são rotas
   públicas (`server.js:30,42,49,59`). Qualquer um publica plugin e o executa.
2. **A rota `/executar` é estruturalmente inalcançável** (`server.js:66`):
   ```javascript
   const handler = req.body?.handler;
   if (typeof handler !== 'function') { return res.status(400) ... }
   ```
   Via JSON, **nunca** vem função — o teste inclusive confirma (`400`). Então: ou o handler é
   registrado em processo (falta o registro — o comentário da linha 58 diz "M2: registrado no SDK",
   mas não existe), ou a rota está morta.
3. **`hashPlugin` assina só o manifest, não o código** (`sandbox.js:73-75`): alterar a lógica do
   plugin mantendo o manifest não muda o hash — "integridade" é ilusória.

---

## 2. Tabela de prioridades

| ID | Título | Sev | Arquivo | Depende de |
|---|---|---|---|---|
| SEC-01 | Marketplace sem auth (publicar/instalar/executar) | **P0** | `server.js:30,42,49,59` | SEC-05 |
| SEC-02 | `/executar` exige função via JSON — rota inalcançável | **P0** | `server.js:65-68` | — |
| SEC-03 | `hashPlugin` não cobre o código do plugin | **P1** | `src/sandbox.js:73-75` | — |
| SEC-04 | `express.json()` sem limite | **P1** | `server.js:17` | — |
| SEC-05 | Sem auth (falta JWT/BCrypt no projeto) | **P0** | `package.json` | — |
| SEC-06 | Sem rate limit em publicar/executar | **P1** | `server.js:30,59` | SEC-01 |
| BUG-01 | `publicar` apaga o plugin anterior (DELETE sem transação) | **P2** | `loja.js:41-42` | — |
| BUG-02 | `instalar`/`estrela` não validam existência no M2 (db) | **P2** | `loja.js:46,53` | — |
| BUG-03 | Sandbox: `executarSandbox` só aceita `manipular`, ignora ganchos | **P1** | `sandbox.js:46-51` | — |
| BUG-04 | Sem `TELA` de execução: plugin malicioso roda sem limite de frequência | **P1** | `server.js:59` | — |
| IMP-01 | `Map` em memória (M1) vs SQLite (M2) não conectados no server | **P2** | `server.js:13` | — |
| IMP-02 | Telemetria não é usada pelo painel do server | **P3** | `loja.js:60` | — |
| IMP-03 | Sem revisão/`moderacao` de plugin publicado | **P3** | `server.js:30` | — |
| TEST-01 | Sem teste de rota HTTP (auth) | **P1** | `test/*.mjs` | SEC-01, SEC-05 |
| TEST-02 | Sem teste de hash cobrindo código | **P2** | novo `test/` | SEC-03 |
| DEVOPS-01 | Sem CI | **P2** | *(ausente)* `.github/workflows/` | — |
| DEVOPS-02 | Sem `.env.example` | **P2** | *(ausente)* | SEC-05 |
| DOC-01 | README não explica que /executar precisa de registro | **P2** | `README.md` | SEC-02 |
| DOC-02 | Falta `SECURITY.md` (sandbox é a promessa do projeto) | **P3** | *(ausente)* | — |

**Placar: 3 P0 · 7 P1 · 5 P2 · 3 P3 = 18 itens.**

---

## 3. Segurança
### SEC-05 · Sem auth (falta JWT/BCrypt no projeto) · [P0]

- **Arquivo:** `package.json` · `server.js` (nenhum middleware)
- **Evidência:** dependências são apenas `express` (zero JWT/BCrypt); nenhuma rota tem middleware de
  autenticação.
- **Impacto:** raiz de `SEC-01`. Um marketplace sem auth é um **repositório de código arbitrário**
  executado por qualquer pessoa que alcance a porta.
- **Mudança:** (1) adicionar `jsonwebtoken` + `bcryptjs` (mesmo padrão da casa); (2) `src/auth.js`
  com `registrar`/`login`/`exigirToken`/`exigirAdmin` (fail-fast no segredo, como nos irmãos);
  (3) papéis: publicar/executar exige `admin` ou `publisher`; instalar/avaliar pode exigir `user`.
- **Aceite:** todas as rotas de escrita exigem token; sem token → `401`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3900/api/plugins \
    -H 'Content-Type: application/json' -d '{"nome":"x"}'   # 401
  ```

### SEC-01 · Marketplace sem auth (publicar/instalar/executar) · [P0]

- **Arquivo:** `server.js:30` (publicar), `:42` (instalar), `:49` (avaliar), `:59` (executar)
- **Evidência:** as quatro rotas são públicas; `publicar` valida o manifest (bom) mas **não quem
  publica**.
- **Impacto:** qualquer pessoa: (a) **publica** plugin com nome malicioso que o painel vai listar
  ( phishing de plugin); (b) **executa** código de plugin contra eventos (o `BUG-04` agrava: sem teto);
  (c) **inunda** estrelas (falso rating). Num marketplace real, publicar/executar é ato
  privilegiado — precisa de auth.
- **Mudança:** (requer `SEC-05`) `exigirPublisher` em `publicar`; `exigirToken` em `instalar`/`avaliar`;
  `exigirPublisher` em `executar`. `GET /api/plugins` pode seguir público (vitrine).
- **Aceite:** publicar/executar sem token de publisher → `401`/`403`.
- **Verificação:**
  ```bash
  for r in publicar instalar executar; do
    curl -s -o /dev/null -w "$r -> %{http_code}\n" -X POST "http://localhost:3900/api/plugins/x/$r" \
      -H 'Content-Type: application/json' -d '{}'
  done   # todos 401 (hoje: 201/200)
  ```

### SEC-02 · `/executar` exige função via JSON — rota inalcançável · [P0]

- **Arquivo:** `server.js:65-68`
- **Evidência:**
  ```javascript
  const handler = req.body?.handler;
  if (typeof handler !== 'function') {
    return res.status(400).json({ erro: { codigo: 'handler', mensagem: 'handler (função) obrigatório no corpo' } });
  }
  ```
  Via HTTP, `req.body` é JSON — uma **função nunca sobrevive** à serialização. O teste
  `test/market-test.mjs:55-58` confirma: envia handler como **string** e espera `400`. O comentário
  da linha 58 diz "M2: registrado no SDK", mas **não existe** registro de handler em processo.
- **Impacto:** a rota central do produto está **morta**: nenhum plugin executa pela API. Quem tentar
  usar recebe `400` sempre. É "seguro por acidente" (impossível chegar ao sandbox por HTTP), mas é
  **funcionalidade inexistente** — o marketplace não executa nada. E cria uma armadilha: alguém pode
  "resolver" adicionando `eval(handler)` (o próprio teste menciona "eval é inseguro") e transformar
  isto em **RCE remoto**.
- **Mudança:** (1) **não** aceitar `handler` no corpo. Registrar handlers **em processo**, no
  registro do SDK: `registrarHandler(nomePlugin, gancho, fn)` num `Map` interno, alimentado no
  boot a partir de módulos **confiáveis** do próprio host (não do cliente); (2) a rota
  `/executar` recebe `{gancho, evento}` (dados) e busca o handler no registro; (3) se o plugin veio de
  fonte externa, exigir **assinatura** e carregar em **worker/vm isolado** (Node `vm` + `worker_threads`,
  não `eval` no processo principal). (4) Documentar que executar código de terceiro **exige** isolamento
  de processo — o `sandbox.js` atual (função hospedeira) só é seguro porque o código **já era do host**.
- **Aceite:** plugin registrado no boot executa via `/executar` com `{gancho,evento}`; **nenhum**
  caminho aceita função vinda do cliente.
- **Verificação:**
  ```bash
  # handler no corpo deve ser REJEITADO (400) mesmo sendo string
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3900/api/plugins/x/executar \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    -d '{"handler":"()=>({ok:1})"}'   # 400
  # e via registro: funciona com {gancho,evento}
  ```

### SEC-03 · `hashPlugin` não cobre o código do plugin · [P1]

- **Arquivo:** `src/sandbox.js:73-75`
- **Evidência:**
  ```javascript
  export function hashPlugin(manifest) {
    return createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
  }
  ```
  Assina **só o manifest** (`nome`, `versao`, `ganchos`, `permissao`). O **código** do plugin não
  entra no hash. E `publicar` (`loja.js:38`, `server.js:34`) compara hash para decidir "idêntico".
- **Impacto:** "integridade" é **ilusória**: alguém republica o mesmo plugin com a **mesma lógica
  alterada** (ou pior, com comportamento malicioso) e o **hash não muda** se o manifest não mudou.
  Como a permissão (`leitura`/`escrita`) está **dentro** do manifest, um atacante pode manter
  `permissao: 'leitura'` no manifest e executar lógica de escrita — o hash não detecta, porque não
  cobre o código que faz a escrita.
- **Mudança:** (1) calcular o hash sobre **manifest + código** (canonicalizar — `JSON.stringify` com
  chaves ordenadas — do manifest **mais** o código-fonte/timestamp do módulo); (2) usar os **64 bits
  completos** (hoje trunca para 16 hex = 64 bits, ver `BUG-03` de outros projetos — aqui também é
  curto para marketplace); (3) do hash ao **usuário do marketplace** (quem publica), não só ao
  manifest; (4) re-publicação com hash diferente deve exigir revisão (ver `IMP-03`).
- **Aceite:** alterar a lógica mantendo o manifest muda o hash.
- **Verificação:**
  ```bash
  node -e "import('./src/sandbox.js').then(m=>{
  const a=m.hashPlugin({nome:'p',versao:'1.0.0',ganchos:['card-criado'],permissao:'leitura'});
  console.log('hash so do manifest:', a); })"
  # apos SEC-03, hash deve incluir codigo e mudar quando o codigo muda
  ```

### SEC-04 · `express.json()` sem limite · [P1]

- **Arquivo:** `server.js:17`
- **Evidência:** `app.use(express.json());` sem `{ limit }`.
- **Impacto:** payload ilimitado em memória por requisição. Com `SEC-01` fechado, o risco cai, mas
  um publicador legítimo (ou com credencial vazada) envia um JSON gigante e estoura o processo.
- **Mudança:** `app.use(express.json({ limit: '256kb' }));` (manifest é pequeno).
- **Aceite:** payload > 256 KB → `413`.
- **Verificação:**
  ```bash
  head -c 500000 /dev/zero | tr '\0' 'a' > /tmp/big.json
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3900/api/plugins \
    -H 'Content-Type: application/json' --data-binary @/tmp/big.json   # 413
  ```

### SEC-06 · Sem rate limit em publicar/executar · [P1]

- **Arquivo:** `server.js:30,59`
- **Evidência:** nenhuma das duas rotas tem limite.
- **Impacto:** (a) `publicar` em laço inunda a vitrine; (b) `executar` em laço consome CPU (cada
  execução roda código + telemetria) — combinado com o `BUG-04`, é um DoS trivial. (c) spam de
  estrelas (`avaliar`) distorce o rating.
- **Mudança:** rate limit por token/usuário em `publicar`/`avaliar` (ex.: 10/h) e em `executar`
  (ex.: 100/min); teto de execuções por plugin.
- **Aceite:** 11ª publicação na hora → `429`.
- **Verificação:**
  ```bash
  for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3900/api/plugins \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
    -d "{\"nome\":\"p$i\",\"versao\":\"1.0.0\",\"ganchos\":[\"card-criado\"],\"permissao\":\"leitura\"}"; done; echo
  ```
---

## 4. Bugs e defeitos funcionais

### BUG-03 · Sandbox só aceita `manipular`, ignora ganchos · [P1]

- **Arquivo:** `src/sandbox.js:46-51`
- **Evidência:**
  ```javascript
  if (!plugin || typeof plugin[ganchosFn(plugin)[0]] !== 'function' && !plugin.manipular) {
    // aceita plugin com método manipular(gancho, evento) ou handlers por gancho
  }
  if (typeof plugin.manipular !== 'function') {
    return { ok: false, erro: 'plugin sem método manipular(gancho, evento)' };
  }
  ```
  O primeiro `if` tem corpo **vazio** (só comentário) e expressão com precedência confusa
  (`&&` antes de `||` sem parênteses). O segundo `if` **só** aceita `manipular` — um plugin com
  handlers por gancho (`plugin['card-criado']`) é rejeitado, apesar do comentário dizer que é aceito.
- **Impacto:** plugins escritos no estilo "um handler por gancho" (o do `MANIFEST_EXEMPLO`, que lista
  `ganchos: ['card-criado','card-movido']`) **não rodam**. O contrato do SDK é ambíguo entre
  "manipular único" e "handler por gancho". E o `if` morto esconde o problema (não executa nada).
- **Mudança:** (1) definir **um** contrato claro e documentar (recomendado: `manipular(gancho, evento)`
  único, já que o `server.js:70` monta assim); (2) remover o `if` morto (linhas 46-48); (3) validar
  que o gancho pedido está no `manifest.ganchos` antes de executar (hoje **não** — `server.js:71` usa
  `req.body?.gancho || p.manifest.ganchos[0]`, então um cliente pode pedir gancho **não declarado**).
- **Aceite:** plugin só executa gancho declarado no manifest; o `if` morto não existe mais.
- **Verificação:**
  ```bash
  # executar com gancho nao declarado no manifest -> recusado
  grep -n 'gancho.*manifest.ganchos\|includes(gancho)' src/sandbox.js   # deve validar
  ```

### BUG-04 · Sem limite de frequência de execução · [P1]

- **Arquivo:** `server.js:59` · `sandbox.js:62`
- **Evidência:** cada `POST /executar` roda `plugin.manipular` (async, com timeout de 2 s). Não há
  teto por plugin, por token, nem global.
- **Impacto:** um plugin registrado pode ser executado em laço — 2 s de timeout por execução é
  exatamente o que torna isso caro: N execuções × 2 s = CPU eevent loop saturado (o handler é sync no
  event loop até o primeiro `await`). Com `SEC-01` fechado, ainda é DoS por plugin legítimo bugado.
- **Mudança:** (1) rate limit em `/executar` por token e por plugin (ex.: 100/min por plugin);
  (2) teto de concorrência (não mais que K execuções simultâneas do mesmo plugin); (3) registrar
  `execucoes`/`taxaOk` na telemetria (a infra **já existe**: `loja.js:60-70`) e alertar se `taxaOk`
  despencar.
- **Aceite:** 101ª execução do mesmo plugin na hora → `429`.
- **Verificação:**
  ```bash
  for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code} " -X POST \
    "http://localhost:3900/api/plugins/x/executar" -H "Authorization: Bearer $T" \
    -H 'Content-Type: application/json' -d '{"gancho":"card-criado","evento":{}}'; done; echo
  ```

### BUG-01 · `publicar` apaga o plugin anterior sem transação · [P2]

- **Arquivo:** `src/loja.js:41-42`
- **Evidência:** `if (existe) db.prepare('DELETE FROM plugins WHERE nome = ?').run(...)` e depois
  `INSERT` — duas operações, sem transação; e `instalacoes`/`estrelas` do plugin antigo **não** são
  limpas nem migradas.
- **Impacto:** republicação com manifest diferente **apaga** o plugin; se o `INSERT` falhar (ex.: nome
  duplicado em corrida), fica **sem plugin** mas com `instalacoes`/`estrelas` órfãs. E as estrelas do
  plugin antigo somem do rating do novo (ou pior, ficam).
- **Mudança:** (1) envolver em transação; (2) decidir o destino das estrelas/instalacoes na
  republicação (migrar? zerar? versionar por hash?) e **documentar**.
- **Aceite:** republicação ou é atômica, ou não muda nada.
- **Verificação:**
  ```bash
  # forcar falha no INSERT (nome duplicado em corrida) e conferir que o plugin antigo permanece
  ```

### BUG-02 · `instalar`/`estrela` no M2 não refletem o estado do M1 · [P2]

- **Arquivo:** `src/loja.js:46,53` vs `server.js:13-14`
- **Evidência:** o `server.js` usa `plugins` (Map) e `instalados` (Set) **em memória** (linhas 13-14),
  ignorando completamente `criarLojaPersistente` (M2, `loja.js`), que tem as tabelas `plugins`,
  `instalacoes`, `estrelas`, `telemetria`. O servidor **nunca importa** a loja persistente.
- **Impacto:** (a) tudo se perde no restart; (b) a telemetria (M2) **nunca** é alimentada (ver
  `IMP-02`); (c) dois caminhos de verdade (M1 em memória, M2 em disco) divergem — bug de um não
  aparece no outro.
- **Mudança:** ligar o `server.js` à loja persistente (`criarLojaPersistente`), usar o `db` como fonte
  única, e alimentar `telemetria` a cada `executar` (já que a função existe). Remover os `Map`/`Set`
  duplicados do server.
- **Aceite:** reiniciar mantém plugins, instalações, estrelas e telemetria.
- **Verificação:**
  ```bash
  # publicar, reiniciar, e conferir que /api/plugins ainda lista
  ```

### IMP-01 · Dois caminhos de estado (Map vs SQLite) · [P2]

- **Arquivo:** `server.js:13-14` · `src/loja.js:5`
- **Evidência:** ver `BUG-02` — o servidor usa Map, a loja M2 existe mas não é usada.
- **Impacto:** é a **causa-raiz** do `BUG-02`. Manter dois caminhos é dívida que já custou uma
  funcionalidade (telemetria) e uma garantia (persistência).
- **Mudança:** uma fonte de verdade (SQLite, padrão da casa). Tratar junto com o `BUG-02`.
- **Aceite:** não existe mais `Map`/`Set` de estado no `server.js`; todo estado vem do SQLite.
- **Verificação:**
  ```bash
  grep -n 'new Map()\|new Set()' server.js && echo 'FALHA: ainda estado em memoria' || echo OK
  ```

---

## 5. Qualidade: testes, arquitetura e observabilidade

### TEST-01 · Sem teste de rota HTTP (auth) · [P1]

- **Arquivo:** `test/market-test.mjs` (usa `chamar` helper — bom) · `test/sandbox-test.mjs` · `test/m2-test.mjs`
- **Evidência:** os testes exercitam o núcleo bem (sandbox, M2) e **um** contrato de rota
  (`/executar` com handler-string, `market-test.mjs:43-58`). Mas **não** há teste de que publicar/
  instalar/avaliar exigem token — porque hoje não exigem.
- **Impacto:** os 3 P0 vivem nas rotas, sem teste. Mesmo padrão dos outros projetos da Wave 2.
- **Mudança:** após `SEC-05`/`SEC-01`, adicionar: publicar sem token → 401; instalar sem token → 401;
  publicar com token → 201; `/executar` sem handler registrado → erro claro (não 400 genérico).
- **Aceite:** `npm test` inclui os 4 casos e falha se um middleware for removido.
- **Verificação:**
  ```bash
  npm test 2>&1 | tail -3
  ```

### TEST-02 · Sem teste de hash cobrindo código · [P2]

- **Arquivo:** novo `test/hash-test.mjs`
- **Evidência:** nenhum teste verifica que o hash muda quando o **código** muda (só o manifest é
  assinado — `SEC-03`).
- **Impacto:** o `SEC-03` pode voltar sem teste que pegue (é uma linha).
- **Mudança:** publicar plugin com mesmo manifest e código diferente → hash **diferente`.
- **Aceite:** o teste falha se o hash voltar a depender só do manifest.
- **Verificação:**
  ```bash
  npm test 2>&1 | tail -2
  ```

### IMP-02 · Telemetria não alimentada pelo painel · [P3]

- **Arquivo:** `src/loja.js:60-70` · `server.js` (não chama `telemetria`)
- **Evidência:** `telemetria()` e `metricasTelemetria()` existem e são testados no M2, mas o `server.js`
  não usa a loja persistente (ver `BUG-02`), então **nada** alimenta a telemetria.
- **Impacto:** o painel M2 não tem dado real — e telemetria é o sinal que detectaria plugin instável
  (útil para o `BUG-04`).
- **Mudança:** alimentar `telemetria` a cada execução (duração + ok), depois que o `BUG-02` ligar o
  server à loja.
- **Aceite:** `metricasTelemetria` devolve `execucoes > 0` após executar um plugin.
- **Verificação:**
  ```bash
  # executar 1x e conferir /api/metricas (ou a rota de telemetria) com execucoes > 0
  ```

### IMP-03 · Sem moderação de plugin publicado · [P3]

- **Arquivo:** `server.js:30`
- **Evidência:** `publicar` valida o manifest (formato) mas não há revisão/aprovação, nem lista de
  bloqueio, nem verificação de comportamento.
- **Impacto:** num marketplace real, qualquer publisher coloca plugin na vitrine (phishing de nome,
  comportamento enganoso). Mitigado por `SEC-01` (só publisher publica) e `BUG-03` (gancho validado).
- **Mudança:** (1) estado do plugin (`pendente`/`aprovado`/`rejeitado`) com aprovação por admin; (2)
  só executável se aprovado; (3) futuramente, verificar hash contra allowlist.
- **Aceite:** plugin não aprovado não aparece na vitrine nem executa.
- **Verificação:**
  ```bash
  # publicar como publisher -> status 'pendente'; executar -> recusado ate aprovacao
  ```

---

## 6. DevOps / Infra

### DEVOPS-01 · Sem CI · [P2]

- **Arquivo:** *(ausente)* `.github/workflows/`
- **Evidência:** nenhum workflow (irmãos da Wave 2 têm `ci.yml`).
- **Impacto:** o sandbox é a **promessa central** do projeto (executar código de terceiro sem
  quebrar o host) — e nada garante que uma alteração futura não introduza `eval`, remova o freeze ou
  o timeout. Regressão silenciosa da propriedade de segurança.
- **Mudança:** `ci.yml`: `node --check src/*.js server.js`, `npm ci`, `npm test`, e **barreira grep**
  que falha se `eval(`/`new Function(` aparecer em `src/` (a garantia central do projeto, verificada
  no CI).
- **Aceite:** PR que introduz `eval` no sandbox ou remove o timeout é bloqueado.
- **Verificação:**
  ```bash
  node --check server.js src/sandbox.js src/loja.js && npm test
  grep -rn 'eval(\|new Function(' src/ && echo 'FALHA: eval no sandbox' || echo OK
  ```

### DEVOPS-02 · Sem `.env.example` · [P2]

- **Arquivo:** *(ausente)* `.env.example` · `server.js:10`
- **Evidência:** lê `PORT`; após `SEC-05`, também `JWT_SECRET` e seeds de admin.
- **Impacto:** evita adivinhação após `SEC-05`.
- **Mudança:** `.env.example` com `PORT`, `JWT_SECRET` (mín 32 bytes), `PLUGIN_ADMIN_EMAIL`,
  `PLUGIN_ADMIN_PASSWORD`.
- **Aceite:** exemplo versionado cobre todas as `process.env.*`.
- **Verificação:** `diff` entre `process.env.*` e as chaves do exemplo.

---

## 7. Documentação

### DOC-01 · README não explica que `/executar` precisa de registro · [P2]

- **Arquivo:** `README.md`
- **Evidência:** o README descreve o marketplace; não diz que (a) `/executar` **nunca** aceita
  função via HTTP (e por quê — o teste `market-test.mjs:55-58` diz "M1: função não atravessa JSON"), e
  (b) como um plugin é registrado no host para poder rodar.
- **Impacto:** quem integra tenta chamar `/executar` com o handler no corpo e recebe `400` sem saber
  que o desenho correto é registro no SDK.
- **Mudança:** seção "Como executar um plugin": registro no boot (`registrarHandler`), chamada da
  rota com `{gancho,evento}`, e o aviso de que **executar código de terceiro exige isolamento de
  processo** (não é só o sandbox atual).
- **Aceite:** a seção explica o fluxo correto e por que função não vem no corpo.
- **Verificação:** `grep -ni 'registro\|handler\|executar' README.md`.

### DOC-02 · Falta `SECURITY.md` · [P3]

- **Arquivo:** *(ausente)* `SECURITY.md`
- **Evidência:** tem LICENSE/README, sem guia de reporte nem threat model do sandbox.
- **Impacto:** o sandbox é a propriedade de segurança central do projeto; suas garantias (sem eval,
  freeze, timeout, permissão) precisam estar **escritas** para não serem "otimizadas" depois.
- **Mudança:** criar com: canal; **as 4 garantias do sandbox** como invariantes; e a ameaça
  "código de plugin executa no processo do host — só código **do host** é seguro aí".
- **Aceite:** arquivo existe com as 4 invariantes.
- **Verificação:** `ls SECURITY.md`

---

## 8. Ordem de execução (waves)

### Wave 1 — Não executar nada sem controle (P0)
1. **`SEC-05`** — implementar auth (JWT + papéis).
2. **`SEC-01`** — proteger publicar/instalar/avaliar/executar.
3. **`SEC-02`** — registro de handler em processo (ou worker isolado); **nunca** `eval`.

> Depois da Wave 1, o marketplace é fechado e a execução deixa de ser um beco sem saída.

### Wave 2 — Integridade e borda (P1)
4. **`SEC-03`** — hash sobre manifest + código (64+ bits).
5. **`BUG-03`** — contrato do sandbox claro + gancho validado contra o manifest.
6. **`BUG-04`** — rate limit em executar (+ telemetria).
7. **`SEC-04`** — limite no `express.json`.
8. **`SEC-06`** — rate limit em publicar/avaliar.
9. **`TEST-01`** — testes de rota com auth.

### Wave 3 — Consolidar estado (P2)
10. **`BUG-02`**/`IMP-01` — ligar o server à loja SQLite (fonte única).
11. **`BUG-01`** — publicação atômica + destino das estrelas.
12. **`TEST-02`** — teste do hash.
13. **`DEVOPS-01`** — CI com barreira anti-`eval`.
14. **`DEVOPS-02`** — `.env.example`.

### Wave 4 — Polimento (P2/P3)
15. **`IMP-02`** (telemetria alimentada), **`IMP-03`** (moderação), **`DOC-01`**, **`DOC-02`**.

**Dependências que não podem ser invertidas:**
`SEC-05` antes de `SEC-01` · `SEC-02` é **bloqueante** para qualquer uso real (não use `eval` como
atalho) · `SEC-03` junto com `TEST-02` · `BUG-03` antes de `BUG-04` (o contrato define o que conta
como execução) · `BUG-02`/`IMP-01` antes de `IMP-02` (telemetria precisa da loja ligada) ·
`DEVOPS-01` depois de `SEC-02` (a barreira anti-eval protege a garantia).

---

## 9. Fora de escopo / riscos

| Item | Decisão | Motivo |
|---|---|---|
| Aceitar `handler` via `eval`/`vm` no processo | **Nunca** | É RCE remoto. O próprio teste rejeita; o desenho correto é registro no host (ou worker isolado — `SEC-02`). |
| Migrar o sandbox para `vm`/worker agora | **Só se** precisar | O sandbox atual é seguro **porque** o código é do host. Mudar para executar código de verdade é feature grande (ver `SEC-02`). |
| Plugin com permissão `escrita` AGORA | **Não** | A permissão é checada (`sandbox.js:56`), mas não há como um plugin escrever de fato (não há acesso ao estado). Implementar escrita é feature. |
| Assinatura criptográfica de plugin | **Não, agora** | `SEC-03` (hash de manifest+código) cobre integridade; assinatura real é evolução. |
| Sistema de billing/ratings | **Não** | Fora do escopo. |

**Riscos desta execução:**

- **`SEC-02` é a mudança mais delicada.** Fazer sem pressa: definir o contrato de registro, testar
  (código do host), e **só depois** expor a rota. Se a pressa levar a `eval`, o projeto passa de
  "sandbox honesto" a "RCE remoto" — o oposto da proposta de valor.
- **`SEC-05`/`SEC-01` fecham o marketplace** (hoje qualquer um publica/executa). Se o objetivo
  atual for demo pública, o painel precisa de um fluxo de conta primeiro — ou expor `GET /api/plugins`
  (vitrine) público e só fechar a escrita (que é o desenho recomendado).
- **`SEC-03` muda hashes existentes** → republicar todo plugin já publicado (ou versionar por hash).
- **`BUG-02`/`IMP-01` (unificar estado) muda toda a API** se a loja persistente tiver shapes
  diferentes do Map — testar `listar()`/`instalar` antes.

---

## 10. Definição de pronto (DoD)

**Segurança**
- [ ] `SEC-05` — JWT + papéis; sem token → `401` nas rotas de escrita
- [ ] `SEC-01` — publicar/executar exigem publisher; instalar/avaliar exigem token
- [ ] `SEC-02` — `/executar` usa handler **registrado**; corpo com handler → `400`; **sem** `eval`
- [ ] `SEC-03` — hash cobre manifest + código; muda quando o código muda
- [ ] `SEC-04` — payload > 256 KB → `413`
- [ ] `SEC-06` — rate limit em publicar/avaliar/executar

**Funcional**
- [ ] `BUG-03` — contrato do sandbox claro; gancho não declarado é recusado
- [ ] `BUG-04` — 101ª execução do plugin na hora → `429`
- [ ] `BUG-01` — publicação atômica
- [ ] `BUG-02`/`IMP-01` — reinício mantém plugins/instalações/estrelas

**Testes e qualidade**
- [ ] `TEST-01` — 4 casos de rota com auth no `npm test`
- [ ] `TEST-02` — teste do hash cobrindo código
- [ ] `IMP-02` — telemetria alimentada pelo painel
- [ ] `IMP-03` — moderação/aprovação (P3)

**Infra e documentação**
- [ ] `DEVOPS-01` — CI com barreira anti-`eval`
- [ ] `DEVOPS-02` — `.env.example`
- [ ] `DOC-01` — README explica o registro de handler
- [ ] `DOC-02` — `SECURITY.md` com as 4 garantias do sandbox

**Validação final:**
```bash
npm test 2>&1 | tail -2
node --check server.js src/sandbox.js src/loja.js
grep -rn 'eval(\|new Function(' src/ && echo 'FALHA: eval no sandbox' || echo OK
```

---

*Fim do plano. Gerado por leitura direta do código em 2026-10-02. Nenhum item já estava corrigido*
*— todos apontam para defeitos ainda presentes.*
