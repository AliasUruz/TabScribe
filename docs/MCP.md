# TabScribe no ChatGPT Work

Verificado em 21/10/2026. O servidor está preparado para uso local; seu registro nativo no ChatGPT e o teste com o Edge instalado continuam pendentes.

## O que já foi comprovado

- O servidor inicia por STDIO e anuncia oito ferramentas, incluindo controle de busca e leitura de resultados XML.
- Chamadas reais pelo SDK MCP atravessam STDIO e WebSocket e recebem respostas. O teste automatizado simula a extensão, sem ler abas reais.
- Desconexão, timeout, troca de socket, pedidos simultâneos e reconexão têm testes de regressão.
- Não foi encontrada uma ferramenta TabScribe registrada nesta sessão nem uma entrada TabScribe na configuração MCP local consultada. A busca no diretório de plugins não encontrou uma integração correspondente; a busca não é exaustiva.
- Rodar testes pelo terminal do Work não equivale a disponibilizar as ferramentas ao modelo como MCP nativo.

## Configuração recomendada: desktop local

A documentação oficial informa suporte a STDIO no app desktop, CLI e IDE para o mesmo host. Isso não garante disponibilidade em toda conta, versão ou conversa hospedada.

1. Recarregue a extensão em `edge://extensions` para carregar o código novo.
2. No app ChatGPT desktop, abra **Settings → MCP servers → Add server**.
3. Nome: `tabscribe`. Transporte: **STDIO**.
4. Comando: `C:\Program Files\nodejs\node.exe`.
5. Argumento: `C:\CAMINHO\TabScribe\server\tabscribe-mcp.js`.
6. Diretório de trabalho, se solicitado: `C:\CAMINHO\TabScribe`.
7. Salve e use **Restart** na configuração MCP. No popup do TabScribe, mantenha a porta `3031` e ative a conexão. O estado deve passar a **Conectado ao servidor local**.
8. Em uma conversa local, confira `/mcp` quando disponível e solicite `tabscribe_status`. O retorno precisa conter `connected: true`.
9. Só então teste `tabscribe_list_tabs`, compare os IDs/títulos com o Edge e extraia uma aba escolhida. Esse é o teste que comprova a integração nativa completa.

O arquivo [mcp-config.toml](mcp-config.toml) contém a configuração de exemplo. Para obter os caminhos atuais após mover o projeto ou trocar o Node, rode `node scripts/mcp-config.mjs` na raiz. O gerador apenas imprime TOML. Importar/copiar o arquivo é uma etapa explícita de configuração, não acontece ao abrir o projeto.

O perfil de arquivos desta sessão permite ler, mas não gravar a configuração global do app. Ela não foi alterada.

## ChatGPT web e conversas hospedadas

O ChatGPT web não lê o `config.toml` local. Para usar MCP no chat hospedado, a documentação prevê conexão por plugin remoto ou **Secure MCP Tunnel**. Um servidor STDIO com uma porta WebSocket local não é, por si só, um endpoint MCP remoto.

Esta etapa não publica servidor, não cria túnel e não confirma elegibilidade da conta para servidores personalizados. Sem instalação/conexão confirmadas e uma chamada nativa bem-sucedida, não declarar que o chat comum já controla o Edge.

## Ferramentas e sequência

| Ferramenta | Uso |
| --- | --- |
| `tabscribe_status` | Conexão da ponte, porta e pedidos pendentes. Não é status da pesquisa. |
| `tabscribe_list_tabs` | Abas HTTP/HTTPS da janela Edge mais recentemente focada. |
| `tabscribe_extract_tabs` | IDs de até 20 abas, extração inteligente opcional e texto paginado. |
| `tabscribe_extract_youtube` | Transcrição do vídeo informado; pode acionar o fluxo especializado existente. |
| `tabscribe_auto_search` | Inicia uma pesquisa, devolve `jobId` e confirmação inicial. |
| `tabscribe_search_status` | Progresso, erros, conclusão e identificação da pesquisa. |
| `tabscribe_cancel_search` | Pede cancelamento cooperativo; confirmar depois pelo status. |
| `tabscribe_search_result` | Último resultado salvo, com `jobId`, formato e paginação. |

Busca: iniciar uma vez, consultar progresso, aguardar conclusão e ler resultado com o mesmo `jobId`. Resultado antigo pode permanecer disponível durante uma busca nova ou sem conteúdo; conferir a identidade. Não repetir automaticamente ações após timeout, pois elas podem ter começado.

A paginação devolve `text`, `offset`, `nextOffset` e `totalChars`. Use `nextOffset` até receber `null`. Extração de abas reaproveita um snapshot em memória para as próximas páginas com os mesmos IDs/opções; `offset: 0` refaz a extração. Reiniciar o worker perde esse snapshot. Resultados de busca ficam no armazenamento local até serem substituídos; se faltar espaço, o download existente continua e o resultado MCP anterior é removido.

## Ajustes e limites

| Configuração | Padrão | Onde mudar |
| --- | --- | --- |
| Conexão opcional | Desativada | Popup, Integração MCP local. |
| Porta WebSocket | `3031` | Popup e `TABSCRIBE_WS_PORT` no host, ambos iguais; entre 1024 e 65535. |
| Espera por resposta | 60 s | `TABSCRIBE_REQUEST_TIMEOUT_MS`, entre 1000 e 300000 ms. |
| Timeout do host | 90 s | `tool_timeout_sec`; manter acima do timeout da ponte. |
| Página de texto | 20.000 caracteres | `limit` na chamada, máximo 50.000. |

A ponte escuta somente `127.0.0.1`. Aceita origens de extensões Chromium, não páginas web comuns. Isso não autentica exclusivamente a identidade desta extensão: não é um transporte para exposição à rede. Uma única instância do servidor deve possuir a porta. Não inicie um servidor no terminal quando o host MCP já o gerencia; duas instâncias geram conflito de porta. Uma conexão nova substitui a antiga e rejeita seus pedidos pendentes.

O cliente verifica PONG, encerra conexões sem resposta e tenta reconectar com espera de 5 a 60 segundos. Desativar cancela os temporizadores. Navegador/PC fechados ou suspensos impedem o controle; o próximo acionamento do worker restaura a preferência. Não foi adicionado serviço do Windows, inicialização automática ou transporte remoto.

As ferramentas cobrem leitura, extração e controle da busca existente. Não oferecem navegação arbitrária, clique em páginas, configuração completa de todos os controles do popup nem automação de qualquer parte do Edge.

## Verificação

- `npm test`: estrutura, sintaxe, regressão MCP, fila IA, XML e integração da busca com APIs simuladas.
- `npm run test:mcp`: servidor real e extensão simulada, em porta temporária. Não dispara pesquisas nem acessa dados do Edge.
- `npm run test:mcp -- --legacy`: mesma verificação pela entrada antiga.
- `npm run test:integration`: teste manual legado com pesquisas reais. Não usar como diagnóstico inofensivo.

## Fontes oficiais

- [MCP: configuração por superfície, app desktop e limitações do web](https://learn.chatgpt.com/docs/extend/mcp).
- [Conectar e testar plugins e Secure MCP Tunnel](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- [Plugins desktop com MCP local e exigências para publicação](https://developers.openai.com/plugins/deploy/desktop-only).

```xml
<mcp_handoff>
  <verified>Servidor STDIO e transporte WebSocket testados com extensão simulada.</verified>
  <pending>Registro no host, descoberta nativa nesta conversa e chamada com o Edge real.</pending>
  <acceptance>Ferramenta nativa tabscribe_status com connected true; listagem real de abas conferida pelo usuário.</acceptance>
  <constraint>Não confundir teste via terminal com instalação de plugin ou descoberta nativa do MCP.</constraint>
</mcp_handoff>
```

## Pesquisa e arquivos a partir da versão 2.1.0

Use `config.aiConcurrency` (1 a 6, padrão 3) para abas IA independentes. `config.format` aceita `xml`; `asMarkdown` é legado e não altera a saída. Arquivos baixados são `.txt` com conteúdo XML e `tabscribe_search_result` informa `format: xml`. Detalhes em [SEARCH.md](SEARCH.md). A paginação de extração de abas pelo MCP continua retornando um snapshot JSON; o formato XML é aplicado ao copiar/baixar manualmente e ao relatório da busca.

## Diagnóstico sem interação visual

`npm run validate` também testa as duas entradas MCP com extensão simulada em portas temporárias. Não ocupa intencionalmente a porta configurada no popup nem tenta registrar o servidor no ChatGPT. Conexão local negada pelo ambiente é registrada como bloqueio, não como aprovação. Veja [VALIDATION.md](VALIDATION.md).
