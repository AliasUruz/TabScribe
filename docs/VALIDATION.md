# Validação silenciosa

Na raiz do projeto, execute:

```powershell
npm run validate
```

O comando usa o Node e as dependências já existentes. Não instala nada. Não abre navegador, abas, janela de terminal adicional ou pop-ups. Não inicia monitoramento permanente. Se você já o executar num terminal, o resumo aparece nesse terminal.

## O que verifica

Uma etapa por vez: estrutura/sintaxe/referências, testes unitários (incluindo transporte WebSocket), busca com APIs do navegador simuladas e servidor MCP pelas entradas atual e antiga. Os testes MCP usam portas temporárias e extensão simulada, sem conexão intencional à porta do host existente.

Saída de cada etapa fica limitada a 16.000 caracteres; cada etapa tem timeout de 45 segundos. No Windows, timeout encerra a árvore daquele processo, incluindo o servidor temporário. Execuções simultâneas no mesmo projeto são bloqueadas por trava temporária; a próxima execução recupera travas cujo processo já terminou.

O comando termina sozinho. Não adiciona dependências, tarefas agendadas, notificações ou mudanças na configuração do Edge/ChatGPT.

## Relatório único

`logs/validation/latest.txt` contém XML UTF-8, usando o serializador de escape compartilhado. Cada execução substitui o relatório anterior; a pasta já é ignorada pelo Git. Logs de sucesso e erro ficam no relatório, sem inundar a saída do terminal.

| Estado | Significado |
| --- | --- |
| `passed` | A etapa automatizada terminou com sucesso. |
| `failed` | Erro, teste reprovado ou limite de tempo excedido. |
| `blocked` | O ambiente negou conexão loopback com `connect EACCES`; consultar o detalhe. |
| `pending` | Verificação real ainda não exercitada. |

Código de saída: 0 para todas as etapas automatizadas aprovadas; 1 para falha; 2 para bloqueio sem outras falhas. Mesmo com código 0, o estado geral permanece `pending_live_validation`. Isso evita confundir simulação aprovada com integração completa.

## O que continua dependendo do ambiente real

- Edge/Google: apresentação, conteúdo efetivo extraído e seletores atuais. O diagnóstico não inicia pesquisas reais.
- ChatGPT: descoberta nativa das ferramentas e controle do Edge real. Servidor testado pelo terminal não comprova integração com este chat.
- GitHub: commit publicado e correspondência com a cópia local. O diagnóstico não consulta a rede nem publica arquivos.

Para investigar: ler primeiro os elementos `check` com estado `failed` ou `blocked`. Corrigir a causa demonstrada e repetir o comando. Uma conexão bloqueada precisa ser testada em um ambiente que a permita; não desativar proteções ou declarar aprovação por suposição.

```xml
<validation_handoff>
  <command>npm run validate</command>
  <report>logs/validation/latest.txt</report>
  <policy>Sem abas, pesquisas reais, instalação ou processos permanentes.</policy>
  <evidence>Relatar etapas aprovadas, falhas, bloqueios e pendências separadamente.</evidence>
</validation_handoff>
```