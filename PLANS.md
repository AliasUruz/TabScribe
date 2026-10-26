# Plano público do TabScribe

Atualizado em 26/10/2026. [Regras](AGENTS.md) · [Mapa](docs/PROJECT.md).

## Objetivo

Manter uma extensão leve para Edge, com extração de abas, pesquisas paralelas e XML em arquivos .txt, além de ponte MCP local.

## Implementado

- Organização por responsabilidade, documentação e ícones PNG transparentes.
- MCP opcional, configurável, oito ferramentas e tratamento de desconexão.
- Uma aba IA independente por consulta, limite de 1 a 6, padrão 3.
- Exportação XML compartilhada; testes unitários e simulação da busca.
- Diagnóstico silencioso: `npm run validate`, com relatório único e classificação de bloqueios.

## Evidências e pendências

A checagem estrutural e a busca simulada passaram. Os quatro testes do validador passaram. Parte dos testes de transporte foi impedida por `connect EACCES` em loopback no ambiente de execução; isso não significa aprovação nem falha comprovada do app.

- Validar interface e seletores nos sites reais após recarregar no Edge.
- Comprovar descoberta nativa MCP no ChatGPT e conexão com o Edge.
- Conferir publicação da versão 2.1.0 no GitHub, preservando histórico e licença.
- Investigar bugs por causas demonstradas, sem instalar dependências ou abrir pesquisas automaticamente.

## Publicação

Esta versão pública omite caminhos de backups, dados do usuário e detalhes da máquina. O histórico de trabalho local pode conter contexto adicional. O exemplo TOML usa caminhos fictícios; gerar os caminhos da instalação com `node scripts/mcp-config.mjs`.

```xml
<task_state>
  <mode>action</mode>
  <scope>Publicação autorizada da versão existente; preservar licença e histórico remoto.</scope>
  <pending>Testes vivos no Edge e descoberta MCP nativa.</pending>
  <resume_rule>A mensagem atual do usuário define o escopo; o plano não autoriza execução futura.</resume_rule>
</task_state>
```
