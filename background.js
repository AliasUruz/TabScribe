const CONCURRENCY_LIMIT = 5;
const MAX_RETRIES = 3;

/**
 * Função injetada na aba para extrair o texto inteiro da página.
 */
async function extractFullTextInPage() {
  const text = document.body ? document.body.innerText.trim() : "";
  return text;
}

/**
 * Função injetada na aba para extrair o conteúdo principal usando o extrator inteligente.
 */
async function extractMainContentInPage() {
  // O código do ContentExtractor será injetado automaticamente antes desta função
  try {
    const extractor = new ContentExtractor();
    const content = extractor.extract(document);
    return content;
  } catch (error) {
    console.error("Erro na extração inteligente:", error);
    // Fallback para texto completo
    return document.body ? document.body.innerText.trim() : "";
  }
}

/**
 * Tenta capturar uma miniatura da aba
 */
async function captureTabThumbnail(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 30 });
    return dataUrl;
  } catch (error) {
    console.error(`Erro ao capturar miniatura da aba ${tabId}:`, error);
    return null;
  }
}

/**
 * Processa favicons e tenta garantir URLs válidas
 */
function processTabFavIcon(tab) {
  // Se não tiver favicon ou for inválido, tenta usar uma favicon alternativa
  if (!tab.favIconUrl || tab.favIconUrl === '' || 
      !(tab.favIconUrl.startsWith('http') || 
        tab.favIconUrl.startsWith('data:') || 
        tab.favIconUrl.startsWith('chrome:'))) {
    
    // Tenta usar a favicon do domínio
    if (tab.url) {
      try {
        const url = new URL(tab.url);
        return `${url.protocol}//${url.hostname}/favicon.ico`;
      } catch (e) {
        // URL inválida, usa o ícone padrão
        return '';
      }
    }
    return '';
  }
  
  return tab.favIconUrl;
}

/**
 * Aguarda o carregamento de conteúdo dinâmico em SPAs
 * @param {number} tabId - ID da aba
 * @returns {Promise<boolean>} True se o conteúdo está estável
 */
async function waitForDynamicContent(tabId) {
  const MAX_ATTEMPTS = 5;
  const DELAY = 1000; // 1 segundo entre tentativas
  
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Verifica se há mudanças no DOM
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Verifica se há elementos carregando
          const loadingElements = document.querySelectorAll('.loading, .spinner, [aria-busy="true"]');
          if (loadingElements.length > 0) return false;
          
          // Verifica se há requisições em andamento
          const performanceEntries = performance.getEntriesByType('resource');
          const activeRequests = performanceEntries.filter(entry => 
            entry.initiatorType === 'xmlhttprequest' || 
            entry.initiatorType === 'fetch'
          );
          
          return activeRequests.length === 0;
        }
      });
      
      if (result[0].result) {
        return true;
      }
      
      // Aguarda antes da próxima tentativa
      await new Promise(resolve => setTimeout(resolve, DELAY));
    } catch (error) {
      console.error(`Erro ao verificar conteúdo dinâmico (tentativa ${attempt + 1}):`, error);
    }
  }
  
  return false;
}

/**
 * Extrai texto de uma aba com suporte a SPAs e opções avançadas
 * @param {Object} tab - A aba a ser processada
 * @param {boolean} useIntelligentExtraction - Se deve usar extração inteligente
 * @param {Object} options - Opções adicionais de extração
 */
async function extractTextFromTab(tab, useIntelligentExtraction = false, options = {}) {
  let attempt = 0;
  
  // Primeiro precisamos injetar o ContentExtractor se for usar extração inteligente
  if (useIntelligentExtraction) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-extractor.js']
      });
    } catch (err) {
      console.error(`Erro ao injetar ContentExtractor na aba ${tab.id}:`, err);
      // Fallback para extração normal se falhar
      useIntelligentExtraction = false;
    }
  }
  
  // Aguarda conteúdo dinâmico se necessário
  if (options.waitForDynamicContent) {
    const isStable = await waitForDynamicContent(tab.id);
    if (!isStable) {
      console.warn(`Conteúdo dinâmico não estabilizou na aba ${tab.id}`);
    }
  }
  
  // Função a ser usada para extração
  const extractionFunction = useIntelligentExtraction 
    ? extractMainContentInPage 
    : extractFullTextInPage;
  
  while (attempt < MAX_RETRIES) {
    try {
      const responses = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractionFunction,
        args: [options]
      });
      
      if (Array.isArray(responses) && responses.length > 0) {
        const result = responses[0].result;
        
        // Verifica se o resultado é um objeto (extração inteligente) ou string (extração normal)
        if (typeof result === 'object') {
          return {
            id: tab.id,
            title: tab.title || "(Sem Título)",
            url: tab.url,
            ...result,
            extractionMode: "inteligente"
          };
        } else if (typeof result === "string") {
          return {
            id: tab.id,
            title: tab.title || "(Sem Título)",
            url: tab.url,
            content: result,
            extractionMode: "completo"
          };
        }
      }
      
      console.warn(`Resposta inesperada na aba ${tab.id}. Tentativa ${attempt + 1}.`);
    } catch (err) {
      console.error(`Erro ao injetar script na aba ${tab.id} (tentativa ${attempt + 1}):`, err);
    }
    attempt++;
  }
  
  // Se todas as tentativas falharem
  return {
    id: tab.id,
    title: tab.title || "(Sem Título)",
    url: tab.url,
    content: "",
    extractionMode: "falha"
  };
}

/**
 * Processa as abas selecionadas em lotes com opções avançadas
 */
async function processTabsConcurrently(tabsArray, useIntelligentExtraction = false, options = {}) {
  const results = [];

  async function processTab(tab) {
    const extracted = await extractTextFromTab(tab, useIntelligentExtraction, options);
    results.push(extracted);
  }

  for (let i = 0; i < tabsArray.length; i += CONCURRENCY_LIMIT) {
    const batch = tabsArray.slice(i, i + CONCURRENCY_LIMIT).map(tab => processTab(tab));
    await Promise.all(batch);
  }

  return results;
}

/**
 * Listener para as requisições vindas do popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getTabs") {
    (async () => {
      try {
        // Pega a janela que estava focada antes do popup
        const currentWindow = await chrome.windows.getLastFocused({ populate: true });
        let tabs = currentWindow.tabs || [];
        // Filtra somente abas http/https e exclui páginas de extensão
        const validTabs = tabs.filter(tab => /^https?:\/\//.test(tab.url) && !/^chrome-extension:\/\//.test(tab.url));
        
        // Adiciona informações visuais às abas
        const enhancedTabs = validTabs.map(tab => {
          return {
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favIconUrl: processTabFavIcon(tab)
          };
        });
        
        sendResponse({ success: true, data: enhancedTabs });
      } catch (error) {
        console.error("Erro ao obter abas:", error);
        sendResponse({ success: false, message: "Não foi possível obter as abas." });
      }
    })();
    return true;
  }

  if (message.action === "extractSelectedTabs") {
    (async () => {
      try {
        const selectedTabIds = message.tabIds;
        const useIntelligentExtraction = message.useIntelligentExtraction || false;
        const options = message.options || {};
        
        // Obtém as abas completas pelos IDs
        const tabs = await Promise.all(selectedTabIds.map(id => chrome.tabs.get(id)));
        
        // Processa as abas selecionadas com as opções
        const results = await processTabsConcurrently(tabs, useIntelligentExtraction, options);
        
        sendResponse({ 
          success: true, 
          data: results,
          extractionMode: useIntelligentExtraction ? "inteligente" : "completo"
        });
      } catch (error) {
        console.error("Erro durante a extração:", error);
        sendResponse({ success: false, message: "Erro durante a extração das abas selecionadas." });
      }
    })();
    return true;
  }
});
