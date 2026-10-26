# Pesquisa em abas independentes e exportação XML

## Uso no Edge

1. Recarregue o TabScribe em `edge://extensions`.
2. No popup, escolha o motor e escreva uma consulta por linha. Uma URL direta continua indo para o extrator, sem virar prompt de IA.
3. Ative as respostas de IA. O fluxo é o Modo IA do Google ou a resposta IA do Brave, conforme suporte do motor. Não é uma integração com o site Gemini.
4. Ajuste **Abas de IA em paralelo**, de 1 a 6. O padrão é 3. Para receber só as respostas, ative **AI Overview Only**.
5. Inicie a busca. Uma janela dedicada agrupa as abas criadas pela extensão; cada consulta IA ganha uma aba e contexto próprios.
6. Ao terminar, procure em Downloads o arquivo `AutoSearch_...txt`. O conteúdo é XML UTF-8. Na extração manual, copiar e baixar também produzem XML; o download chama-se `tabs_content.txt`.

O paralelismo limita as abas IA, não o total de abas da janela: a coleta opcional de páginas mantém o processamento em lotes existente. As abas pessoais não são fechadas. A extensão fecha as abas/janela que criou para a execução. Se você fechar a janela de pesquisa, a execução é cancelada.

## Como a execução funciona

- A fila abre até o limite configurado. Quando uma resposta é extraída e sua aba é encerrada, entra a próxima consulta.
- O prompt de cada consulta solicita síntese, evidências, incertezas, datas relevantes e fontes. Consultas independentes não compartilham histórico.
- A coleta busca contêineres de resposta já conhecidos pelo extrator, observa sinais de geração e espera o texto permanecer estável por 1,5 segundo antes de considerá-lo concluído.
- O limite de espera pela resposta é 60 segundos, além do carregamento da aba. Texto disponível no timeout é identificado como `partial`, nunca como resposta completa.
- Cada resposta é capturada assim que termina. O download reúne os resultados ao fim da execução e mantém a ordem das consultas, mesmo quando as abas terminam fora de ordem.
- Cancelar interrompe a fila e fecha as abas IA ativas. O fluxo atual não exporta uma pesquisa cancelada.

Os seletores do Google/Brave podem mudar. Sem um contêiner reconhecido, o extrator pode não obter resposta. Login, CAPTCHA, limite do provedor e suspensão do navegador também podem impedir a coleta. Os testes automatizados usam APIs do navegador simuladas; a verificação nos sites reais permanece pendente.

## Contrato do arquivo

```xml
<?xml version="1.0" encoding="UTF-8"?>
<tabscribe_report version="1" kind="search" job_id="exemplo" generated_at="2026-10-21T00:00:00Z">
  <queries>
    <query index="1">
      <text>Consulta original</text>
      <ai_response status="complete">
        <engine>google</engine>
        <content>Resposta capturada, incluindo texto escapado como A &amp; B.</content>
        <citations>
          <citation><label>Fonte</label><url>https://example.com</url></citation>
        </citations>
      </ai_response>
      <sources/>
    </query>
  </queries>
</tabscribe_report>
```

O relatório de abas usa `kind="tabs"` e elementos `tabs/tab`, com título, URL, conteúdo e metadados disponíveis. Respostas de pesquisa têm status `complete`, `partial`, `error` ou `unavailable`. Instruções opcionais de análise ficam em `instructions`, dentro da raiz; não há preâmbulo Markdown fora do XML.

Conteúdo externo é texto: `<`, `>`, `&`, aspas e apóstrofos são escapados; caracteres inválidos em XML 1.0 são removidos. Isso preserva a estrutura, mas não garante que os fatos coletados sejam corretos.

## Preferências antigas e MCP

A preferência antiga `asMarkdown` não escolhe mais o formato de arquivo. A interface ignora esse valor salvo e usa XML em `.txt`. O protocolo de entrada `@TABSCRIBE` continua em texto, pois seu parser é separado do formato de exportação.

Pelo MCP, use `config.aiConcurrency` entre 1 e 6 e `config.format: "xml"`. O parâmetro antigo `asMarkdown` é aceito por compatibilidade e ignorado. O campo `format` do resultado salvo informa `xml`; `tabscribe_search_result` entrega páginas desse XML, identificadas por `jobId`.

Para configurar a conexão, consulte [MCP.md](MCP.md). Para localizar a fila e o serializador, veja [PROJECT.md](PROJECT.md).
