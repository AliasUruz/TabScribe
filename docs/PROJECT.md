# Mapa do TabScribe

Atualizado em 21/10/2026. [Regras](../AGENTS.md) · [Plano](../PLANS.md) · [Uso e comandos](../README.md).

## Entradas e limites

- O Edge continua carregando a pasta raiz, onde fica `manifest.json`.
- A extensão é JavaScript nativo, sem build: service worker e popup em módulos, scripts de conteúdo clássicos em contextos separados.
- `server/` é Node/CommonJS e usa as dependências npm da raiz; não é importado pela extensão.
- A entrada antiga `tabscribe-mcp.js` apenas encaminha para `server/tabscribe-mcp.js`, preservando configurações de hosts existentes.
- `assets/` contém imagens e `vendor/` contém terceiros. Documentos, testes e verificações ficam fora de `src/`.

## Código e responsabilidades

| Caminho relativo à raiz | Responsabilidade |
| --- | --- |
| [src/background/background.js](../src/background/background.js) | Service worker: mensagens do popup, extração, regras DNR e conexão MCP. |
| [src/background/mcp-bridge.mjs](../src/background/mcp-bridge.mjs) | Cliente MCP opcional: preferência, socket, reconexão, heartbeat e respostas por conexão. |
| [src/background/mcp-commands.mjs](../src/background/mcp-commands.mjs) | Adapta comandos MCP às APIs e fluxos existentes da extensão. |
| [src/background/auto-search.js](../src/background/auto-search.js) | Orquestra consultas, janela de pesquisa, coleta, progresso, cancelamento e exportação. |
| [src/background/ai-query-pool.mjs](../src/background/ai-query-pool.mjs) | Fila de consultas IA independentes, paralelismo limitado e prompt de pesquisa. |
| [src/shared/xml-export.mjs](../src/shared/xml-export.mjs) | Serialização XML única para busca e extração manual, com escape de conteúdo. |
| [src/background/search-engine.js](../src/background/search-engine.js) | URLs, exclusões e parâmetros dos motores. |
| [src/shared/logger.js](../src/shared/logger.js) | Buffer, armazenamento e exportação de diagnóstico. |
| [src/content/content-extractor.js](../src/content/content-extractor.js) | Conteúdo principal e metadados, executado por injeção em páginas. |
| [src/content/serp-parser.js](../src/content/serp-parser.js) | Links orgânicos das páginas de resultados. |
| [src/content/ai-overview-extractor.js](../src/content/ai-overview-extractor.js) | Extrator de respostas de IA; uso efetivo no fluxo atual ainda a revisar. |
| [src/extractors/yt-extractor.js](../src/extractors/yt-extractor.js) | URLs, metadados e legendas do YouTube. |
| [src/extractors/pdf-extractor.js](../src/extractors/pdf-extractor.js) | Extração PDF; ligação com o fluxo principal ainda a revisar. |
| [vendor/pdfjs/pdf.min.mjs](../vendor/pdfjs/pdf.min.mjs) | Biblioteca PDF.js; preservar como código de terceiros. |
| [vendor/pdfjs/pdf.worker.min.mjs](../vendor/pdfjs/pdf.worker.min.mjs) | Worker PDF.js, referenciado pelo manifesto. |
| [src/popup/popup.html](../src/popup/popup.html) | Estrutura e identificadores da interface. |
| [src/popup/popup.js](../src/popup/popup.js) | Módulo ES de abas, preferências, comandos, cópia e download XML manual. |
| [src/popup/popup.css](../src/popup/popup.css) | Estilos do popup, agora no arquivo popup.css. |
| [server/tabscribe-mcp.js](../server/tabscribe-mcp.js) | Implementação única do servidor MCP stdio e WebSocket. |
| [server/bridge.js](../server/bridge.js) | Socket local, fila por conexão, UUIDs, timeout e limpeza. |
| [server/tools.js](../server/tools.js) | Catálogo, schemas e anotações das oito ferramentas. |
| [scripts/mcp-config.mjs](../scripts/mcp-config.mjs) | Imprime a configuração MCP desta máquina, sem editar o host. |
| [tests/integration/mcp-client.js](../tests/integration/mcp-client.js) | Teste manual que pode disparar buscas reais. |
| [tests/integration/search-simulation.mjs](../tests/integration/search-simulation.mjs) | Executa o orquestrador real com APIs simuladas; verifica paralelismo, cancelamento, limpeza e XML. |
| [tests/integration/mcp-smoke.js](../tests/integration/mcp-smoke.js) | Verifica o contrato MCP sem pedir buscas ou extração. |
| [tests/unit/mcp-bridge.test.mjs](../tests/unit/mcp-bridge.test.mjs) | Regressão do uso sem MCP, ciclo de conexão, preferências e comandos. |
| [scripts/check-project.mjs](../scripts/check-project.mjs) | Confere sintaxe e referências locais sem executar a extensão. |
| `assets/icons/` | Ícones de 16, 32, 48 e 128 px usados no manifesto. |
| `package.json`, `package-lock.json` | Comandos, entrada Node e dependências resolvidas. |
| `AGENTS.md`, `PLANS.md`, `docs/AI_WORKFLOW.md` | Regras, estado do trabalho e método com fontes. |

## Caminhos: três regras

| Referência | Base para resolver | Exemplo |
| --- | --- | --- |
| `import ... from` | Diretório do módulo que importa. | `../shared/logger.js` a partir de `src/background/`. |
| `chrome.scripting.executeScript({ files })` | Raiz que contém o manifesto. | `src/content/serp-parser.js`. |
| `chrome.runtime.getURL()` | Raiz que contém o manifesto. | `assets/icons/icon48.png`. |

HTML/CSS do popup usam caminhos relativos à página. Os testes MCP usam o diretório do próprio script para localizar o servidor, sem depender do diretório de trabalho.

## Contratos principais

| Fluxo | Contrato |
| --- | --- |
| Popup → background | `getTabs`, `extractSelectedTabs`, `autoSearch`, `cancelAutoSearch`, `getAutoSearchStatus` e logs. |
| Background → extratores | Injeção em aba ou chamada ao extrator YouTube; retorno com texto e metadados. |
| Busca → estado | `chrome.storage.local.autoSearch` e estado de cancelamento em memória. |
| Busca → resultado | Download; `lastAnalysisPrompt` com a opção de prompt; `lastSearchResult` para leitura MCP, com jobId. |
| IA → MCP | Oito ferramentas descritas em [MCP.md](MCP.md), com schemas em `server/tools.js`. |
| MCP → extensão | `COMMAND`/`RESPONSE` com `requestId`, comandos de extração/busca e heartbeat. |

## Verificação e pendências

`npm run check` verifica referências estáticas e sintaxe. `npm test` acrescenta os testes de regressão do cliente MCP. `npm run test:mcp` verifica inicialização, ferramentas e status do servidor. O teste manual `test:integration` é separado porque pode abrir pesquisas e gerar downloads.

Ainda precisam de verificação real no Edge: qualidade da extração, seletores atuais, cancelamento, reabertura do popup e downloads. A conexão com o ChatGPT Work também não foi validada. O status MCP indica conexão, não a conclusão de uma pesquisa.

## Preferência MCP

`chrome.storage.local.mcpBridgeEnabled` é booleana e ausente significa `false`. `mcpBridgePort` define a porta e `mcpBridgeStatus` publica o estado observado. O popup grava a escolha; o service worker acompanha `chrome.storage.onChanged`. Desativar encerra o socket, o heartbeat e a reconexão pendente. Ativar permite reconexão com espera progressiva de 5 a 60 segundos. A extensão continua independente do servidor no uso comum.

A configuração e a verificação nativa por superfície estão em [MCP.md](MCP.md). A ponte passou por chamadas reais via SDK com extensão simulada; isso não comprova descoberta nativa pelo ChatGPT nem a conexão com o Edge real.

## Fluxo de pesquisa atualizado

O guia [SEARCH.md](SEARCH.md) documenta parâmetros e limites. A fila IA abre abas independentes na janela de pesquisa, extrai cada resposta e encerra sua aba. O relatório reúne resultados por ordem original em XML dentro de `.txt`. `auto-search.js` mantém a coleta de links, identifica a pesquisa e serializa atualizações de progresso.

## Diagnóstico unificado

`scripts/validate.mjs` reúne checagem estrutural, testes unitários, busca simulada e as duas entradas MCP. `tests/unit/validation.test.mjs` verifica falhas, limite de saída, timeout e relatório. O comando `npm run validate` não modifica os fluxos da extensão. Veja [VALIDATION.md](VALIDATION.md).
