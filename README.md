# TabScribe

Extensão Manifest V3 para reunir conteúdo de abas e pesquisas em arquivos `.txt` com conteúdo XML, com foco no uso diário no Microsoft Edge e no envio desse material a assistentes de IA.

O projeto veio do Antigravity. O alvo de continuidade é Windows 11, Edge e ChatGPT Work. Funcionalidade presente no código não significa validação concluída nesse ambiente.

## Comece por aqui

| Preciso entender… | Leia |
| --- | --- |
| Instalação e uso | Este README |
| Abas de IA, paralelismo e formato XML | [Guia de pesquisa](docs/SEARCH.md) |
| Configuração e limites da integração MCP | [Guia MCP](docs/MCP.md) |
| Onde está cada parte | [Mapa do projeto](docs/PROJECT.md) |
| Como uma IA deve trabalhar aqui | [AGENTS.md](AGENTS.md) |
| Plano atual e pendências | [PLANS.md](PLANS.md) |
| Método reutilizável e referências | [Fluxo com IA](docs/AI_WORKFLOW.md) |

## Funcionalidades presentes no código

- Seleção e filtro de abas HTTP/HTTPS da janela em foco.
- Extração completa ou do conteúdo principal, com título e URL.
- Cópia em XML e download `.txt` com XML UTF-8, tanto nas abas quanto nas pesquisas.
- Pesquisas em lote por Google, Google Scholar, Brave Search e YouTube.
- Respostas de IA Google/Brave em abas independentes, com 1 a 6 em paralelo (padrão 3), conforme disponibilidade do site.
- Extração especializada de metadados e legendas do YouTube.
- Progresso, cancelamento, tratamento de CAPTCHA e exportação de logs.
- Ponte MCP local para solicitações de IA à extensão.

Há um módulo PDF, mas sua ligação com a busca precisa ser confirmada. Não considerar PDF, Reddit ou integrações externas como suporte validado apenas pela existência de arquivos ou comentários.

## Instalação local no Edge

1. Abra `edge://extensions` e ative o **Modo de desenvolvedor**.
2. Selecione **Carregar sem compactação** e escolha a pasta que contém `manifest.json`.
3. Fixe o TabScribe na barra do navegador, se desejar.
4. Após mudanças de código, recarregue a extensão nessa mesma tela.

Não há build configurado: o Edge carrega os arquivos diretamente. Node.js e dependências npm são necessários para o servidor MCP, não para carregar o popup.

Referência: [instalação local de extensões, Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

## Uso

### Extrair abas

Abra o popup, selecione as abas, escolha o modo e use copiar ou baixar. O modo inteligente tenta remover navegação e elementos periféricos. Confira o resultado em páginas dinâmicas, com login ou paywall.

### Pesquisar

Na área de pesquisa, escolha o motor, informe uma consulta ou URL por linha e ajuste as opções. A implementação cria uma janela e abre uma aba independente por consulta de IA, com limite configurável de 1 a 6 simultâneas, padrão 3. Cada resposta é extraída ao terminar e reunida em XML em um `.txt` em Downloads. A coleta de links continua em lotes. Veja [operação e limites](docs/SEARCH.md). Os sites reais ainda precisam de validação após esta atualização.

O campo também reconhece este protocolo existente:

```text
@TABSCRIBE engine=google links=3
primeira consulta
segunda consulta
```

Não substituir esse formato por XML sem adaptar o parser. O protocolo de entrada continua em texto; os arquivos exportados e os repasses estruturados para IAs usam XML.

## Integração MCP local

`server/tabscribe-mcp.js` recebe MCP por **stdio** e conversa com a extensão por **WebSocket na porta 3031**. A conexão em `ws://127.0.0.1:3031` é opcional e vem desativada por padrão. No popup, abra **Integração MCP local** e ative a conexão depois que o host iniciar o servidor. A preferência fica salva; desative quando não estiver usando MCP para evitar tentativas contra um servidor desligado. A entrada antiga `tabscribe-mcp.js`, na raiz, continua funcionando como encaminhamento para preservar configurações existentes.

Para preparar as dependências, numa etapa de ação autorizada:

```powershell
npm ci
```

Configure um host MCP com suporte a stdio para iniciar `node` com o caminho absoluto de `server/tabscribe-mcp.js`. O host precisa gerenciar a entrada e a saída padrão. Executar o servidor no terminal, sozinho, não conecta o ChatGPT.

| Ferramenta | Contrato atual |
| --- | --- |
| `tabscribe_status` | Conexão, porta e pedidos pendentes, em JSON. |
| `tabscribe_list_tabs` | IDs, títulos e URLs das abas HTTP/HTTPS da janela focada. |
| `tabscribe_extract_tabs` | Extração de abas com paginação e snapshot. |
| `tabscribe_extract_youtube` | Extração de vídeo pelo fluxo especializado. |
| `tabscribe_auto_search` | Início de uma busca, com `jobId`; não é resultado final. |
| `tabscribe_search_status` | Progresso e conclusão da pesquisa. |
| `tabscribe_cancel_search` | Cancelamento cooperativo. |
| `tabscribe_search_result` | Resultado salvo, identificado e paginado. |

A conexão nativa com o ChatGPT Work ainda depende do registro no host e de teste com o Edge real. Veja [configuração e limites MCP](docs/MCP.md), incluindo valores prontos desta máquina. Chamadas MCP por STDIO/WebSocket foram verificadas com extensão simulada.

## Verificação e limites conhecidos

- `npm test` verifica estrutura e sintaxe e executa testes de regressão MCP, concorrência, XML e integração da busca com APIs do navegador simuladas. Os testes não substituem a validação da interface e da extração no Edge.
- `tests/integration/mcp-client.js` pode disparar pesquisas reais; ler antes de executar. O teste `mcp-smoke.js` usa o servidor real e simula a extensão, sem acessar abas reais.
- Seletores e APIs de Google, Brave e YouTube podem mudar e precisam de verificação atual.
- Versão atual da extensão e do pacote: `2.1.0`. O histórico remoto e a licença MIT foram preservados.
- O plano de revisão de bugs e validação no Edge está em [PLANS.md](PLANS.md).

## Desenvolvimento

Preserve alterações locais existentes. Siga [AGENTS.md](AGENTS.md) e mantenha o plano atualizado. O [mapa](docs/PROJECT.md) localiza os módulos e seus contratos. Os ícones do manifesto ficam em `assets/icons/`, nos tamanhos 16, 32, 48 e 128 px.

### Organização

| Diretório | Conteúdo |
| --- | --- |
| `src/background/` | Service worker, execução de buscas e configuração dos motores. |
| `src/popup/` | HTML, JavaScript e CSS do popup. |
| `src/content/` | Scripts injetados para ler páginas e resultados. |
| `src/extractors/` | Extração especializada de YouTube e PDF. |
| `src/shared/` | Recursos compartilhados, atualmente o logger. |
| `assets/`, `vendor/` | Ícones e bibliotecas de terceiros, separados do código próprio. |
| `server/`, `tests/`, `scripts/` | Ponte MCP, testes e checagem do projeto. |

O manifesto permanece na raiz. Continue carregando essa mesma pasta no Edge e use **Recarregar** após esta reorganização.

### Comandos

| Comando | Efeito |
| --- | --- |
| `npm run check` | Confere sintaxe, imports, injeções, recursos do manifesto, dependências Node e links locais. Não executa o app. |
| `npm test` | Executa checagem, testes unitários e integração da busca com APIs simuladas; inclui WebSocket real em loopback. Não abre abas. |
| `npm run test:search` | Executa o orquestrador real com APIs do navegador simuladas. Não acessa Edge ou Google. |
| `npm run start:mcp` | Inicia a ponte em stdio; a conexão à IA depende de um host MCP. |
| `npm run test:mcp` | Servidor real e extensão simulada em porta temporária: descoberta, status, validação e comando/resposta. |
| `npm run test:mcp -- --legacy` | Verifica a entrada MCP antiga da raiz. |
| `npm run test:integration` | Teste manual com extensão conectada; pode abrir pesquisas e gerar downloads. |

Use Node.js 20 ou posterior para as ferramentas de desenvolvimento. Os testes de integração da busca usam a opção experimental `--experimental-vm-modules` do Node. Não é necessário instalar um bundler ou framework para esse fluxo. As dependências npm ficam restritas ao servidor e aos testes MCP.

### Erros antigos de conexão MCP

Após atualizar, recarregue a extensão em `edge://extensions` e limpe os erros antigos. Sem ativar MCP no popup, o uso normal não deve tentar acessar a porta 3031. Se ativar a integração com o servidor desligado, o navegador ainda poderá registrar a falha de conexão; inicie o servidor ou desative a opção.

### Diagnóstico silencioso

Use `npm run validate` para conferir tudo que pode ser testado localmente sem abrir o Edge, abas ou pop-ups. Executa uma etapa por vez, sem instalar dependências e sem serviço permanente. A saída tem duas linhas; o relatório XML UTF-8 fica em `logs/validation/latest.txt`, substituído a cada execução. [Detalhes e limites](docs/VALIDATION.md).
