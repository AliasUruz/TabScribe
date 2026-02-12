# TabScribe: Extract & Archive Tab Text

Uma extensão para navegador que permite selecionar abas e extrair o texto delas para copiar ou baixar em arquivo .txt.

## Recursos

- Selecione abas válidas (http/https) 
- Extração inteligente do conteúdo principal
- Dois modos de extração (Inteligente ou Completo)
- Extraia o texto completo das páginas
- Visualize miniaturas e favicons das abas
- Copie para a área de transferência
- Baixe como arquivo .txt
- Interface compacta e moderna

## Instruções de uso

1. Clique na extensão para abrir o popup
2. Escolha o modo de extração:
   - **Modo Completo**: Extrai todo o texto da página
   - **Modo Inteligente**: Tenta extrair apenas o conteúdo principal da notícia/artigo
3. Marque as abas das quais deseja extrair o texto
4. Você pode usar a opção "Selecionar todas" para marcar todas as abas de uma vez
5. Escolha entre copiar o texto para a área de transferência ou baixar como arquivo .txt
6. Os textos extraídos incluirão o título e URL de cada página

## Sobre o Modo Inteligente

O modo inteligente utiliza um algoritmo avançado para identificar o conteúdo principal de artigos e notícias, removendo menus, barras laterais, anúncios e outros elementos irrelevantes. Ele funciona através de:

- Identificação de tags semânticas HTML5 (article, main)
- Análise de densidade de texto e links
- Reconhecimento de padrões comuns de classes e IDs
- Heurísticas específicas para sites brasileiros

Este modo é ideal para extrair apenas o texto relevante de notícias, artigos de blog e outros conteúdos editoriais, oferecendo uma experiência de leitura mais limpa.

## Estrutura do projeto

- `manifest.json` - Configurações da extensão
- `popup.html` - Interface do usuário
- `popup.js` - Lógica da interface
- `style.css` - Estilos da interface
- `background.js` - Script de fundo para processamento das abas
- `content-extractor.js` - Algoritmo de extração inteligente
- `icons/` - Ícones da extensão

## Ícones personalizados

Para criar seus próprios ícones para a extensão:

1. Abra o arquivo `icon-generator.html` no navegador
2. Siga as instruções para salvar os ícones nos tamanhos corretos
3. Coloque os ícones na pasta `icons/` com os nomes corretos

---

Desenvolvido para organizar e arquivar o conteúdo de múltiplas abas do navegador. 