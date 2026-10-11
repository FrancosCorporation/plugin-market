# Segurança

## Reportar uma vulnerabilidade

Reporte vulnerabilidades de forma privada por [GitHub Security Advisories](https://github.com/FrancosCorporation/plugin-market/security/advisories/new). Inclua os passos para reprodução, versão afetada e impacto. Evite abrir uma issue pública antes de combinarmos a divulgação.

## Limites e garantias do executor

O executor só chama funções confiáveis que o host importa e registra em `src/host-handlers.js`.

- A API não aceita handlers ou código executável no corpo da requisição; `eval` e `new Function` são proibidos.
- O evento JSON é copiado sem referências ao host e congelado profundamente antes de chegar ao handler.
- O handler só recebe ganchos declarados no manifesto; plugins de leitura não recebem eventos de escrita.
- Erros do handler são capturados e a espera por resultado assíncrono tem um limite de tempo.

O limite de tempo não interrompe trabalho síncrono que bloqueia o event loop. Handlers executam no processo do servidor, por isso precisam ser mantidos e revisados como código do host. O código submetido ao marketplace é armazenado para revisão e integridade, mas não é carregado nem executado. Para executar código de terceiros, seria necessário isolamento de processo ou contêiner com limites de recursos.

As contas usam senhas derivadas com scrypt e tokens assinados com HMAC-SHA-256. Configure `JWT_SECRET` com pelo menos 32 bytes aleatórios e mantenha `PLUGIN_ADMIN_PASSWORD` fora do controle de versão. O acesso administrativo é provisionado pelo ambiente de execução.
