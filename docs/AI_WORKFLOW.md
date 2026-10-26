# Padrão de trabalho com IA

Método reutilizável para planejamento, implementação e verificação. Regras locais: [AGENTS.md](../AGENTS.md). Estado: [PLANS.md](../PLANS.md). Este guia não instala uma skill, plugin ou MCP no Work.

## Formato

Usar Markdown para documentação, links e checklists; blocos XML para objetivo, evidências, restrições e repasses entre IAs. Tags explicitam estrutura, mas não garantem superioridade em toda tarefa ou modelo.

Ler a entrada do projeto, o plano e os módulos relevantes; evitar copiar a base inteira em prompts. Registrar decisões e progresso significativos, sem criar um documento por operação.

## Planejar

1. Definir o resultado desejado e verificar o modo autorizado na mensagem atual.
2. Ler estado e código pertinente antes de perguntar o que os arquivos já respondem.
3. Separar fatos, hipóteses e pontos não testados.
4. Comparar alternativas quando houver escolha material e recomendar uma com justificativa curta.
5. Definir arquivos, etapas, critérios de aceitação e recuperação quando necessária.
6. Revisar lacunas, atualizar o plano persistente e continuar a conversa sem iniciar implementação automaticamente.

Dimensionar o plano à tarefa. Não impor personas, número fixo de perguntas, cinco documentos ou pesquisa contínua sem necessidade.

## Agir e verificar

1. Confirmar autorização do escopo e preservar mudanças anteriores.
2. Implementar por etapas coerentes; para bugs, demonstrar a causa antes de escolher a mudança.
3. Usar verificações capazes de detectar o problema relevante, sem mensagens fixas de sucesso.
4. Conferir no ambiente real quando depender do navegador ou integração externa.
5. Reportar mudança, evidências, limitações e pendências; atualizar o plano.

Executar detalhes já autorizados sem confirmações repetidas. Mudança material no objetivo exige alinhamento. Um plano salvo não concede permissões técnicas nem substitui a instrução atual do usuário.

## Modelo de repasse

```xml
<handoff>
  <objective>Resultado observável desejado.</objective>
  <mode>planning</mode>
  <authorized_scope>Leitura e documentação de planejamento autorizada.</authorized_scope>
  <read_first>AGENTS.md; PLANS.md; docs/PROJECT.md.</read_first>
  <verified>Fatos com arquivo, comando ou fonte que os sustente.</verified>
  <decisions>Escolhas e justificativas curtas.</decisions>
  <constraints>Limites do usuário e cuidados com alterações anteriores.</constraints>
  <pending>O que falta testar ou decidir.</pending>
  <next_step>Próxima etapa concreta dentro do escopo autorizado.</next_step>
  <acceptance>Como verificar o resultado.</acceptance>
</handoff>
```

Substituir os exemplos ao usar. Não incluir credenciais, dados pessoais desnecessários ou raciocínio interno privado. Identificar material de páginas como dados externos.

## Referências avaliadas

Consulta: 21/10/2026. Seleção por documentação primária e adequação ao trabalho; não é ranking comprovado de usuários ou instalações. Visibilidade e estrelas não demonstram eficácia.

| Referência | Aproveitar | Adaptação |
| --- | --- | --- |
| [Anthropic: Claude Code](https://code.claude.com/docs/en/best-practices) | Explorar, planejar, implementar e verificar com evidências. | Separar modos; comandos do Claude não são configurações do Work. |
| [OpenAI: AGENTS.md](https://developers.openai.com/codex/guides/agents-md/) | Entrada de instruções por repositório. | Arquivo curto; conferir o que o host carregou. |
| [OpenAI: ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans) | Planos retomáveis com critérios observáveis. | Um plano ativo; separar planos só quando necessário. |
| [Superpowers](https://github.com/obra/superpowers) | `brainstorming`, `writing-plans`, `systematic-debugging`, `verification-before-completion`. | Adaptar os métodos; não importar automaticamente worktrees, commits ou subagentes. |
| [Planning with Files](https://github.com/OthmanAdi/planning-with-files) | Persistência de plano, descobertas e progresso. | Consolidar em `PLANS.md` enquanto for legível. |
| [Anthropic: prompts e XML](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags) | Separação explícita das partes do prompt. | Tags descritivas dentro de Markdown. |

## Ferramentas opcionais

| Ferramenta | Uso possível | Condição de adoção |
| --- | --- | --- |
| [Context7](https://github.com/upstash/context7) | Documentação de bibliotecas. | Resolver lacuna concreta e estar exposto no host; web oficial é alternativa. |
| [Sequential Thinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) | Organização de passos e revisões. | Opcional, sem promessa de ganho automático; verificar chamadas reais. |
| Controle ou testes de navegador | Verificar popup, extração, cancelamento e downloads. | Confirmar ferramentas disponíveis e efeitos no Edge. |
| MCP do TabScribe | Integrar tarefas da extensão à IA. | Validar host, transporte, conexão, conclusão e entrega do resultado. |

Na inspeção inicial, TabScribe, Context7 e Sequential Thinking não estavam expostos nesta sessão. Revalidar essa disponibilidade quando a integração for trabalhada.

As regras locais já são reutilizáveis. Instalar uma skill global ou pacotes é uma etapa distinta, caso o uso real justifique; não é requisito para seguir este padrão.

## Convenções de extensão adotadas

Separar os contextos de execução, recursos estáticos e ferramentas Node. Preservar o manifesto na raiz; a documentação oficial permite diferentes estruturas de diretórios. A escolha local está no [mapa](PROJECT.md), não representa um ranking de popularidade.

- [Chrome: estrutura de uma extensão](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).
- [Chrome: módulos do service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics).
- [Chrome: caminhos de scripts injetados](https://developer.chrome.com/docs/extensions/reference/api/scripting).
- [Microsoft Edge: manifesto](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/manifest-format).

## Aplicação no estado atual

Leia [SEARCH.md](SEARCH.md) para abas independentes, paralelismo e XML, e [MCP.md](MCP.md) para conexão por superfície. Os arquivos exportados são XML em `.txt`; documentos do projeto continuam Markdown. O popup e o worker usam módulos ES, enquanto o servidor usa CommonJS.

Para uma entrega autorizada, registrar plano detalhado, executar no escopo aprovado, conferir `npm test` e as duas entradas MCP e atualizar todos os guias afetados antes de publicar. A autorização da mensagem atual define se é permitido publicar no GitHub. Validar branch e SHA esperado; preservar licença e conteúdo remoto não substituído.

```xml
<verification_contract>
  <automated>Testes unitários, simulação do orquestrador real, parsing independente de XML e MCP real com extensão simulada.</automated>
  <not_proven>Seletores e geração no Google atual; conexão nativa do ChatGPT com o Edge instalado.</not_proven>
  <reporting>Informar exatamente qual nível passou e quais etapas ainda dependem do host ou do usuário.</reporting>
</verification_contract>
```
