# Plugin Market — Extensible Plugin Marketplace

![Status](https://img.shields.io/badge/M1-funcionando%20(13%2F13%20testes)-brightgreen)
![CI](https://img.shields.io/badge/CI-test%20%2B%20license%20check-blue)
![Node](https://img.shields.io/badge/Node-%3E%3D18-green?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

An extensible plugin ecosystem: JS plugin SDK (interface, manifest, semver versioning),
marketplace API, install/uninstall panel with reviews, and SANDBOXED plugin execution
(iframe/worker — never direct eval), with usage telemetry and manifest validation CI.

> 🇧🇷 Ecossistema de plugins: SDK JS (interface, manifest, semver), API de marketplace,
> painel de instalação com reviews e execução SANDBOXED de plugins, telemetria de uso
> e CI de validação de manifest.

## Features

- [x] **M1a** — Plugin SDK: semver (compatibilidade de major), manifest validation (a MESMA roda no CI e na API), hash de integridade
- [x] **M1b** — Marketplace API: publicar (idempotente por hash), instalar, estrelas com média, execução SANDBOXED
- [x] **SANDBOX provado (8/8):** evento congelado (mutação não vaza), timeout mata plugin travado, permissão leitura bloqueia escrita, erro capturado
- [x] Painel web com cards, permissões e estrelas
- [ ] **M2** — execução de plugins PERSISTIDOS (SDK registra handlers), telemetria de uso, sqlite

## Quick start

```bash
docker compose up   # http://localhost:3900
```

```bash
# publica e instala um plugin
curl -X POST http://localhost:3900/api/plugins -H "Content-Type: application/json" \
  -d '{"nome":"contador","versao":"1.0.0","ganchos":["card-criado"],"permissao":"leitura"}'
curl -X POST http://localhost:3900/api/plugins/contador/instalar
```

## Built with

- API/JWT/queue patterns from my projects (webhook-relay events delivery)
- Modeling reference: [open-saas](https://github.com/wasp-lang/open-saas) (MIT);
  Extension SDK: [vscode-extension-samples](https://github.com/microsoft/vscode-extension-samples) (MIT)

## License

MIT — Rodolfo Franco ([FrancosCorporation](https://github.com/FrancosCorporation))
